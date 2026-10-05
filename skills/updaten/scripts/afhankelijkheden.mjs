#!/usr/bin/env node
/**
 * Het afhankelijkhedendeel van /stack-cloudflare:updaten: werkt de pakketten van een app bij binnen
 * de versiegrenzen die in package.json staan, als een eigen pull request naast die van
 * de template (één PR = één onderwerp).
 *
 *   node afhankelijkheden.mjs --json [--repo <eigenaar>/<naam>]
 *
 * Wat het doet, in een tijdelijke kopie (de open map blijft onaangeroerd):
 *   1. `pnpm update --no-save`: alleen pnpm-lock.yaml verandert, package.json niet. De
 *      grenzen in package.json zijn deels van de template (devDependencies); die
 *      verschuiven hoort bij een nieuwe templateversie, niet hier.
 *   2. Is het lockfile veranderd: commit met de git-naam van de gebruiker, push naar de
 *      branch stack-afhankelijkheden en open een pull request. De CI-checks op die PR
 *      zijn de test: groen is veilig om te mergen.
 *   3. Altijd: welke pakketten een nieuwe hoofdversie hebben (die vragen om aandacht van
 *      Stage Two of Dependabot) en welke Dependabot-PR's er nog openstaan.
 *
 * Uitkomst: één JSON-object met `status`:
 *   gepusht   de PR staat open; zie pr, hoofdversies, dependabot
 *   bij       niets bij te werken binnen de grenzen; hoofdversies en dependabot staan er wel bij
 *   gestopt   er staat al een voorstel open (pr), of er zou iets anders dan het lockfile wijzigen
 *   mislukt   een voorwaarde ontbreekt; `reden` is één zin met één handeling
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  eersteRegel,
  ghAanwezig,
  ghIngelogd,
  git,
  gitIdentiteit,
  gewijzigdePaden,
  kloonRepo,
  maakBranch,
  openOfWerkPRBij,
  openPRs,
  originUrl,
  push,
  pushDroog,
  repoUitUrl,
  sh,
} from "../../../lib/repo.mjs";

export const BRANCH = "stack-afhankelijkheden";
export const WERKMAP_PREFIX = "stack-afhankelijkheden-";
const LOCKFILE = "pnpm-lock.yaml";

export function leesArgumenten(argv) {
  const uit = { json: false, repo: null, checkout: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") uit.json = true;
    else if (a === "--repo") uit.repo = argv[++i] ?? null;
    else if (a === "--checkout") uit.checkout = argv[++i] ?? null;
    else throw new Error(`onbekend argument: ${a}`);
  }
  return uit;
}

function zonderLogin(tekst) {
  return String(tekst).replace(/(https?:\/\/)[^\s/@]+@/g, "$1***@");
}

const mislukt = (reden) => ({ status: "mislukt", reden: zonderLogin(reden) });

function hoofdversie(v) {
  const m = /^(\d+)/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
}

/** Pakketten met een nieuwere hoofdversie dan de huidige; uit `pnpm outdated --format json`. */
export function hoofdversiesUit(json) {
  let data;
  try {
    data = JSON.parse(json || "{}");
  } catch {
    return [];
  }
  const lijst = Array.isArray(data) ? data.map((d) => [d.packageName ?? d.name, d]) : Object.entries(data);
  return lijst
    .map(([naam, d]) => ({ naam, huidig: d.current, nieuwste: d.latest }))
    .filter((p) => p.naam && hoofdversie(p.nieuwste) !== null && hoofdversie(p.huidig) !== null && hoofdversie(p.nieuwste) > hoofdversie(p.huidig))
    .sort((a, b) => a.naam.localeCompare(b.naam));
}

function hoofdversiesVan(map) {
  // `pnpm outdated` eindigt met code 1 zodra er iets verouderd is; de JSON staat dan op stdout.
  try {
    return hoofdversiesUit(sh("pnpm", ["outdated", "--format", "json"], { cwd: map, timeout: 180000 }));
  } catch (fout) {
    return hoofdversiesUit(String(fout.stdout ?? ""));
  }
}

function dependabotPRs(repo) {
  try {
    const lijst = JSON.parse(sh("gh", ["pr", "list", "--repo", repo, "--state", "open", "--author", "app/dependabot", "--json", "number,title,url"]));
    return lijst.map(({ number, title, url }) => ({ number, title, url }));
  } catch {
    return [];
  }
}

export function prTekst({ hoofdversies, dependabot }) {
  const regels = [
    "Afhankelijkheden bijgewerkt binnen de versiegrenzen uit `package.json`. Alleen `pnpm-lock.yaml` verandert; `package.json` blijft zoals hij is.",
    "",
    "Aangemaakt met /stack-cloudflare:updaten vanuit je eigen Claude Code-sessie. Wacht tot de checks groen zijn en druk dan op Merge. Rood? Neem contact op met Stage Two en zet de check niet uit.",
  ];
  if (hoofdversies.length > 0) {
    regels.push("", "**Nieuwe hoofdversies (niet meegenomen, die vragen om aandacht van Stage Two):**", "");
    for (const p of hoofdversies) regels.push(`- \`${p.naam}\`: ${p.huidig} → ${p.nieuwste}`);
  }
  if (dependabot.length > 0) {
    regels.push("", "**Openstaande Dependabot-voorstellen:**", "");
    for (const pr of dependabot) regels.push(`- #${pr.number} ${pr.title}`);
  }
  return regels.join("\n");
}

export function afhankelijkheden({ checkout, opAfstand = null }) {
  if (opAfstand !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opAfstand)) {
    return mislukt("geef --repo als eigenaar/naam, bijvoorbeeld Mijn-Bedrijf/voorraad");
  }
  if (!ghAanwezig()) return mislukt("de GitHub-opdrachtregel (gh) ontbreekt; draai eerst /stack-cloudflare:installatie");
  if (!ghIngelogd()) return mislukt("log eerst in bij GitHub met `gh auth login` (zie /stack-cloudflare:installatie)");

  const origin = opAfstand !== null ? `https://github.com/${opAfstand}.git` : originUrl(checkout);
  if (!origin) return mislukt("deze map heeft geen origin op GitHub; open de map van een app of geef --repo mee");
  const repo = opAfstand ?? repoUitUrl(origin);
  if (!repo) return mislukt("de origin van deze map staat niet op GitHub");

  let open;
  try {
    open = openPRs(repo).find((pr) => pr.headRefName === BRANCH) ?? null;
  } catch (fout) {
    return mislukt(`de open pull requests van ${repo} zijn niet op te vragen: ${eersteRegel(fout)}`);
  }
  if (open) {
    return { status: "gestopt", reden: `er staat al een voorstel voor de afhankelijkheden open: ${open.url}; merge of sluit dat eerst`, pr: { url: open.url, nieuw: false } };
  }

  const werkmap = mkdtempSync(join(tmpdir(), WERKMAP_PREFIX));
  const ruimOp = () => rmSync(werkmap, { recursive: true, force: true });
  try {
    const kloon = kloonRepo({ url: origin, doel: join(werkmap, "app") });
    if (!pushDroog(kloon, BRANCH)) {
      ruimOp();
      return mislukt(`je hebt geen schrijfrecht op ${repo}; vraag de eigenaar je toe te voegen als medewerker`);
    }
    maakBranch(kloon, BRANCH);
    try {
      sh("pnpm", ["update", "--no-save", "--ignore-scripts"], { cwd: kloon, timeout: 600000 });
    } catch (fout) {
      ruimOp();
      if (fout.code === "ENOENT") return mislukt("pnpm ontbreekt op deze computer; draai eerst /stack-cloudflare:installatie");
      return mislukt(`pnpm update mislukte: ${eersteRegel(fout)}`);
    }
    const hoofdversies = hoofdversiesVan(kloon);
    const dependabot = dependabotPRs(repo);

    const gewijzigd = gewijzigdePaden(kloon);
    const buiten = gewijzigd.filter((p) => p !== LOCKFILE);
    if (buiten.length > 0) {
      ruimOp();
      return { status: "gestopt", reden: "er zou meer wijzigen dan alleen het lockfile; vraag Stage Two ernaar", buiten };
    }
    if (gewijzigd.length === 0) {
      ruimOp();
      return { status: "bij", repo, reden: "alle pakketten staan al op de nieuwste versie binnen de grenzen", hoofdversies, dependabot };
    }

    const identiteit = gitIdentiteit(checkout ?? kloon);
    if (!identiteit.naam || !identiteit.email) {
      ruimOp();
      return mislukt("git kent je naam en e-mailadres niet; stel ze in met `git config --global user.name` en `user.email`");
    }
    git(kloon, "add", LOCKFILE);
    git(kloon, "-c", `user.name=${identiteit.naam}`, "-c", `user.email=${identiteit.email}`, "commit", "-q", "-m", "chore: afhankelijkheden bijwerken binnen de versiegrenzen");
    push(kloon, BRANCH);
    const pr = openOfWerkPRBij({ repo, branch: BRANCH, titel: "Afhankelijkheden bijwerken", tekst: prTekst({ hoofdversies, dependabot }) });
    ruimOp();
    return { status: "gepusht", repo, branch: BRANCH, pr, hoofdversies, dependabot };
  } catch (fout) {
    ruimOp();
    return mislukt(eersteRegel(fout));
  }
}

export function hoofd(argv, { cwd = process.cwd() } = {}) {
  let args;
  try {
    args = leesArgumenten(argv);
  } catch (fout) {
    return mislukt(fout.message);
  }
  const checkout = args.repo !== null ? null : resolve(args.checkout ?? cwd);
  return afhankelijkheden({ checkout, opAfstand: args.repo });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let uitkomst;
  try {
    uitkomst = hoofd(argv);
  } catch (fout) {
    uitkomst = mislukt(eersteRegel(fout));
  }
  process.stdout.write(`${JSON.stringify(uitkomst, null, 2)}\n`);
  process.exitCode = uitkomst.status === "mislukt" || uitkomst.status === "gestopt" ? 1 : 0;
}
