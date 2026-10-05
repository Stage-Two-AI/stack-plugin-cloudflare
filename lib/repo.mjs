/**
 * De git- en PR-stappen die de skill (/stack-cloudflare:updaten) en de beheerde run delen:
 * template klonen op een tag, branch maken, committen met een vaste trailer, kijken of
 * de boom al zo op GitHub staat, pushen, de pull request openen of bijwerken, oudere
 * PR's sluiten. Wat legitiem verschilt (identiteit, branchnaam, register, ruleset)
 * blijft bij de aanroeper.
 *
 * Elke commit van deze module draagt de trailer `Stack-bijwerken: v<n>`. Daaraan
 * herkennen we onze eigen commits: een branch op afstand wordt alleen opnieuw
 * opgebouwd als elke commit erop die trailer draagt. Heeft iemand er zelf op
 * gecommit, dan blijven we ervan af.
 */
import { execFileSync } from "node:child_process";

export const TRAILER = "Stack-bijwerken";
export const STANDAARD_TEMPLATE_REPO = "Stage-Two-AI/stack-template-cloudflare";

const OMGEVING = { GIT_TERMINAL_PROMPT: "0" };

/**
 * Voert een commando uit en geeft stdout terug; stderr blijft weg uit onze uitvoer.
 *
 * Standaard een tijdslimiet van 120 s: een gewone clone, push of gh-aanroep is daar
 * ruim binnen klaar, en een hangende netwerkstap (dode verbinding, wachtende proxy)
 * mag de beheerde run niet eindeloos blokkeren. Een aanroeper die meer of minder tijd
 * nodig heeft geeft zelf `timeout` mee; die wint van de standaard.
 */
export function sh(cmd, args, opties = {}) {
  const { ruw = false, ...rest } = opties;
  const uit = execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    ...rest,
    env: { ...process.env, ...OMGEVING, ...(rest.env ?? {}) },
  });
  return ruw ? uit : uit.trim();
}

export function git(map, ...args) {
  return sh("git", ["-C", map, ...args]);
}

/** De template-repo uit de omgeving (alleen voor tests en de bewijsronde) of de standaard. */
export function templateRepo(env = process.env) {
  return env.STACK_TEMPLATE_REPO || STANDAARD_TEMPLATE_REPO;
}

/** Een repo-aanduiding (owner/naam) of al een URL of lokaal pad naar iets kloonbaars. */
export function kloonUrl(repo) {
  return /^(?:[a-z+]+:\/\/|git@|\/|\.)/.test(repo) ? repo : `https://github.com/${repo}`;
}

/**
 * Kloont de template in `doel`; een gewone kloon brengt de tags al mee. Zonder token:
 * een publieke repo over https. `--filter=blob:none` haalt alleen de bestanden op die
 * we echt bekijken; een lokaal pad (tests) doet gewoon een volle kloon.
 */
export function kloonTemplate({ repo, doel, viaGh = false }) {
  const url = kloonUrl(repo);
  if (viaGh) {
    sh("gh", ["repo", "clone", repo, doel, "--", "--quiet"]);
  } else {
    const filter = url.startsWith("https://") ? ["--filter=blob:none"] : [];
    sh("git", ["clone", "--quiet", ...filter, url, doel]);
  }
  return doel;
}

/** De hoogste n uit de tags stack-v<n> in een kloon, of null. */
export function hoogsteTagVersie(map) {
  const tags = git(map, "tag", "--list", "stack-v*").split("\n");
  return hoogsteVersie(tags.map((t) => /^stack-v(\d+)$/.exec(t)?.[1]));
}

/** De hoogste n uit de tags stack-v<n> op afstand, zonder kloon en zonder login, of null. */
export function versieOpAfstand(repo, { timeoutMs = 3000 } = {}) {
  try {
    const uit = sh("git", ["ls-remote", "--tags", kloonUrl(repo)], { timeout: timeoutMs });
    return hoogsteVersie([...uit.matchAll(/refs\/tags\/stack-v(\d+)(?:\^\{\})?$/gm)].map((m) => m[1]));
  } catch {
    return null;
  }
}

function hoogsteVersie(nummers) {
  const geldig = nummers.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 100000);
  return geldig.length > 0 ? Math.max(...geldig) : null;
}

export function checkoutTag(map, versie) {
  git(map, "checkout", "-q", `stack-v${versie}`);
}

/** Klonen van de klantrepo: de skill met de URL uit de checkout van de klant, de beheerde run via gh. */
export function kloonRepo({ url, doel, viaGh = false }) {
  if (viaGh) sh("gh", ["repo", "clone", url, doel, "--", "--quiet"]);
  else sh("git", ["clone", "--quiet", url, doel]);
  return doel;
}

export function standaardBranch(map) {
  try {
    return git(map, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(/^origin\//, "");
  } catch {
    return "main";
  }
}

/** Een verse branch vanaf origin/<standaard>, ook als hij lokaal of op afstand al bestond. */
export function maakBranch(map, branch) {
  git(map, "fetch", "-q", "origin");
  git(map, "checkout", "-q", "-B", branch, `origin/${standaardBranch(map)}`);
}

/**
 * Mag de branch op afstand opnieuw opgebouwd worden? Ja als hij er niet is, of als
 * elke commit erop (boven de standaardbranch) onze trailer draagt.
 */
export function branchHerbouwbaar(map, branch) {
  git(map, "fetch", "-q", "origin");
  let regels;
  try {
    // Eén git-aanroep voor alle commits: per commit de sha en de waarde van de trailer.
    regels = sh("git", ["-C", map, "log", `--format=%H %(trailers:key=${TRAILER},valueonly)`, `origin/${standaardBranch(map)}..origin/${branch}`], { ruw: true });
  } catch {
    return true;
  }
  return regels
    .split("\n")
    .filter((regel) => regel.trim() !== "")
    .every((regel) => regel.trim().includes(" "));
}

/** De git-callbacks voor de kern (lib/toepassen.mjs): tonen op een tag, verwijderen, wat is gewijzigd. */
export function gitVoorKern(map, tmplMap) {
  return {
    tonenOpTag(tag, pad) {
      try {
        return git(tmplMap, "show", `${tag}:${pad}`);
      } catch {
        return null;
      }
    },
    verwijder(pad) {
      git(map, "rm", "-q", pad);
    },
    gewijzigd() {
      return gewijzigdePaden(map);
    },
  };
}

/** Alle paden die anders zijn dan HEAD: gewijzigd, nieuw (ook nog niet toegevoegd) of weg. */
export function gewijzigdePaden(map) {
  // Niet trimmen: de eerste regel begint met een spatie als het bestand alleen in de
  // werkboom is gewijzigd (" M pad"), en die spatie hoort bij de vaste kolombreedte.
  const uit = sh("git", ["-C", map, "status", "--porcelain", "--untracked-files=all"], { ruw: true });
  return uit
    .split("\n")
    .filter((regel) => regel.length > 3)
    .map((regel) => regel.slice(3).split(" -> ").pop())
    .sort();
}

/**
 * De pnpm-callback voor de kern: lockfile opnieuw berekenen; false als pnpm ontbreekt.
 *
 * `--ignore-scripts` houdt de lifecycle-scripts tegen, maar niet de hooks uit een
 * .pnpmfile.cjs van de klant; die zouden anders op de machine van Stage Two draaien.
 * Daarom ook `--ignore-pnpmfile`. De template levert zelf geen .pnpmfile.cjs mee, dus
 * het lockfile wordt er niet anders van.
 */
export function pnpmVoorKern() {
  return {
    lockfile(map) {
      try {
        sh("pnpm", ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile"], { cwd: map, timeout: 180000 });
        return true;
      } catch (fout) {
        if (fout.code === "ENOENT") return false;
        throw new Error(`pnpm install --lockfile-only mislukte: ${eersteRegel(fout)}`);
      }
    },
  };
}

/** De git-identiteit zoals de klant die in zijn checkout heeft staan. */
export function gitIdentiteit(map) {
  const lees = (sleutel) => {
    try {
      return git(map, "config", "--get", sleutel) || null;
    } catch {
      return null;
    }
  };
  return { naam: lees("user.name"), email: lees("user.email") };
}

export function commit({ map, identiteit, bericht, versie }) {
  git(map, "add", "-A");
  git(
    map,
    "-c", `user.name=${identiteit.naam}`,
    "-c", `user.email=${identiteit.email}`,
    "commit", "-q", "-m", bericht, "--trailer", `${TRAILER}: v${versie}`,
  );
}

/**
 * Staat op GitHub al precies deze inhoud op de branch? Dan is pushen zinloos en zelfs
 * schadelijk: elke push is een nieuw event op de pull request, dus een volledige
 * kwaliteitspoort. We vergelijken de boom (de inhoud), niet de commit.
 */
export function alGelijkOpGitHub(map, branch) {
  try {
    const daar = git(map, "rev-parse", "--verify", "--quiet", `origin/${branch}^{tree}`);
    return daar === git(map, "rev-parse", "HEAD^{tree}");
  } catch {
    return false;
  }
}

export function push(map, branch) {
  git(map, "push", "-q", "-f", "-u", "origin", branch);
}

/**
 * Bewijst schrijfrecht zonder iets te schrijven. Met --force, net als de echte push
 * straks: bestaat de branch al op afstand (een eerdere ronde), dan zou een gewone
 * droge push op "niet fast-forward" stuklopen en dat zegt niets over het recht.
 */
export function pushDroog(map, branch) {
  try {
    git(map, "push", "--dry-run", "--force", "-q", "origin", `HEAD:refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- GitHub via gh

export function ghAanwezig() {
  try {
    sh("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export function ghIngelogd() {
  try {
    sh("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

/** owner/naam uit een https- of ssh-URL van GitHub, of null. */
export function repoUitUrl(url) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}` : null;
}

/** De origin zoals hij in de config staat (dus vóór een eventuele insteadOf-herschrijving). */
export function originUrl(map) {
  try {
    return git(map, "config", "--get", "remote.origin.url") || null;
  } catch {
    return null;
  }
}

/** Een aparte push-URL, als de klant die heeft ingesteld; anders null. */
export function originPushUrl(map) {
  try {
    return git(map, "config", "--get", "remote.origin.pushurl") || null;
  } catch {
    return null;
  }
}

export function openPRs(repo) {
  return JSON.parse(sh("gh", ["pr", "list", "--repo", repo, "--state", "open", "--json", "number,headRefName,url"]));
}

/** Een open PR voor deze versie, van de skill of van de beheerde run. */
export function openPRVoorVersie(repo, versie) {
  const namen = new Set([`stack-bijwerken/v${versie}`, `stack-sync/v${versie}`]);
  return openPRs(repo).find((pr) => namen.has(pr.headRefName)) ?? null;
}

export function openOfWerkPRBij({ repo, branch, titel, tekst }) {
  const bestaande = openPRs(repo).find((pr) => pr.headRefName === branch);
  if (bestaande) {
    sh("gh", ["pr", "edit", String(bestaande.number), "--repo", repo, "--body", tekst]);
    return { url: bestaande.url, number: bestaande.number, nieuw: false };
  }
  const uit = sh("gh", ["pr", "create", "--repo", repo, "--head", branch, "--title", titel, "--body", tekst]);
  return { url: uit.split("\n").pop(), nieuw: true };
}

/**
 * Een PR voor een oudere versie (branch <prefix>/v<ouder>) is achterhaald zodra er een
 * nieuwere staat: de nieuwe bevat alles van de oude. Sluiten met uitleg en de branch
 * opruimen. Nooit mergen: dat blijft mensenwerk.
 *
 * Met `map` (een lokale kloon met `origin` = deze repo) verwijderen we de branch alleen
 * als elke commit erop van ons is (zie branchHerbouwbaar); heeft iemand er zelf op
 * gecommit, dan sluiten we de PR wel maar blijft de branch staan, anders raakt dat
 * werk kwijt. Zonder `map` gaat de branch altijd weg (oud gedrag).
 * Geeft per gesloten PR `{ branch, verwijderd }` terug.
 */
export function sluitOuderePRs({ repo, prefix, doelVersie, tekst, map = null }) {
  const gesloten = [];
  let open;
  try {
    open = openPRs(repo);
  } catch {
    return gesloten;
  }
  for (const pr of open) {
    const m = new RegExp(`^${prefix}/v(\\d+)$`).exec(pr.headRefName);
    if (!m || Number(m[1]) >= doelVersie) continue;
    const verwijderen = map ? branchVanOns(map, pr.headRefName) : true;
    try {
      sh("gh", ["pr", "close", String(pr.number), "--repo", repo, ...(verwijderen ? ["--delete-branch"] : []), "--comment", tekst]);
      gesloten.push({ branch: pr.headRefName, verwijderd: verwijderen });
    } catch {
      // niet erg: de volgende run probeert het opnieuw
    }
  }
  return gesloten;
}

/** Als we niet kunnen vaststellen dat de branch van ons is (fetch mislukt), blijft hij staan. */
function branchVanOns(map, branch) {
  try {
    return branchHerbouwbaar(map, branch);
  } catch {
    return false;
  }
}

export function vergelijkUrl(repo, branch) {
  return `https://github.com/${repo}/compare/${branch}?expand=1`;
}

export function eersteRegel(fout) {
  return String(fout?.stderr || fout?.message || fout).split("\n").find((r) => r.trim()) ?? "";
}
