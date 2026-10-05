#!/usr/bin/env node
/**
 * Het script achter /stack-cloudflare:nieuwe-app: maakt een nieuwe app aan uit de openbare
 * Cloudflare-template van Stage Two (Stage-Two-AI/stack-template-cloudflare), onder de
 * organisatie van de gebruiker, met
 * zijn eigen login. Dit is het deel van het opzetrecept dat een machine kan doen; het
 * gesprek ervoor (wat moet de app doen, welke databasestand) staat in SKILL.md.
 *
 *   node nieuwe-app.mjs --json --droogloop --naam <naam> --eigenaar <org> \
 *        [--omschrijving "..."] [--map <map>]
 *       Op het Cloudflare-spoor heeft elke app een eigen database (Supabase): daar loopt het
 *       inloggen via de deur van Cloudflare doorheen. `--database eigen` mag, andere standen niet.
 *       voorcontrole: staat alles klaar, bestaat de repo nog niet, waar landt hij, wie
 *       wordt reviewer. Maakt niets aan.
 *
 *   node nieuwe-app.mjs --json --doe-het ...dezelfde vlaggen...
 *       repo aanmaken uit de template, klonen, de paden uit `nietMeenemen` van het manifest
 *       weghalen, invullen, de Worker-naam in wrangler.jsonc op de appnaam zetten,
 *       databasestand zetten, pakketten installeren, committen met de identiteit van de gebruiker, pushen, main
 *       beschermen. Hosting en database koppelt Stage Two: daar komt bewust geen
 *       toegang voor op de computer van de gebruiker (GitHub blijft de enige poort).
 *
 *   node nieuwe-app.mjs --json --inrichten --naam <naam> --eigenaar <org> [--groepen a,b]
 *       kijkt eerst of de app in toegang.json van <org>/stack-beheer staat. Zo niet, dan
 *       opent het een pull request op stack-beheer die hem toevoegt met de gekozen groepen
 *       (status `wacht-op-toegang`; de eigenaar keurt goed, daarna opnieuw draaien). Staat
 *       hij erin, dan start het de workflow "App inrichten" in <org>/stack-beheer, wacht tot
 *       hij klaar is en leest het resultaat uit het logboek. Zo komen Cloudflare en Supabase
 *       erbij zonder dat er een Cloudflare- of Supabase-sleutel op deze computer staat.
 *
 * Elke uitkomst is één JSON-object op stdout met een `status`:
 *   klaar        (na --droogloop) alles staat klaar; zie `plan`
 *   gemaakt      (na --doe-het) de app staat op GitHub en op deze computer; zie `nogTeDoen`
 *   ingericht    (na --inrichten) hosting, deur en database staan; zie `resultaat`
 *   wacht-op-toegang (na --inrichten) de app staat nog niet in toegang.json; zie `pr`
 *   geen-beheer  (na --inrichten) deze eigenaar heeft geen beheer-repo; Stage Two koppelt
 *   mislukt      een voorwaarde ontbreekt of een stap faalde; `reden` is één zin met één
 *                handeling. Was de repo al aangemaakt, dan staat hij in `repo`.
 *
 * Er komt geen token van Stage Two aan te pas (KTD5): alles loopt via `gh` met de login
 * van de gebruiker. De map van de gebruiker wordt alleen aangevuld met één nieuwe
 * submap; bestaat die al, dan stopt het script.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eersteRegel, ghAanwezig, ghIngelogd, git, sh } from "../../../lib/repo.mjs";

export const TEMPLATE = "Stage-Two-AI/stack-template-cloudflare";
export const STAGE_TWO_LOGIN = "StageTwoAI";
// Op het Cloudflare-spoor heeft elke app een eigen database: het inloggen loopt van de
// deur van Cloudflare via Supabase (zie stack-beheer, inrichten-cloudflare.mjs).
export const DATABASESTANDEN = ["eigen"];
const HIER = dirname(fileURLToPath(import.meta.url));
const RULESET_PAD = join(HIER, "..", "ruleset.json");

// ---------------------------------------------------------------- argumenten

export function leesArgumenten(argv) {
  const uit = {
    json: false,
    droogloop: false,
    doeHet: false,
    inrichten: false,
    naam: null,
    eigenaar: null,
    omschrijving: null,
    database: null,
    gedeeldEigenaar: null,
    gedeeldRef: null,
    map: null,
    groepen: null,
  };
  const metWaarde = {
    "--naam": "naam",
    "--eigenaar": "eigenaar",
    "--omschrijving": "omschrijving",
    "--database": "database",
    "--gedeeld-eigenaar": "gedeeldEigenaar",
    "--gedeeld-ref": "gedeeldRef",
    "--map": "map",
    "--groepen": "groepen",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") uit.json = true;
    else if (a === "--droogloop") uit.droogloop = true;
    else if (a === "--doe-het") uit.doeHet = true;
    else if (a === "--inrichten") uit.inrichten = true;
    else if (a in metWaarde) {
      const waarde = argv[i + 1];
      if (waarde === undefined || waarde.startsWith("--")) throw new Error(`${a} vraagt een waarde`);
      uit[metWaarde[a]] = waarde;
      i += 1;
    } else throw new Error(`onbekende optie: ${a}`);
  }
  if (uit.database === null) uit.database = "eigen";
  if (uit.groepen !== null) uit.groepen = uit.groepen.split(",").map((g) => g.trim()).filter(Boolean);
  return uit;
}

/** Een repo-naam die overal werkt: kleine letters, cijfers en streepjes, 2 tot 60 tekens. */
export function geldigeNaam(naam) {
  return /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(naam ?? "");
}

export function controleerArgumenten(arg) {
  if ([arg.droogloop, arg.doeHet, arg.inrichten].filter(Boolean).length !== 1) {
    return "geef precies één van --droogloop, --doe-het en --inrichten mee";
  }
  if (!geldigeNaam(arg.naam)) {
    return "de naam mag alleen kleine letters, cijfers en streepjes bevatten (bijvoorbeeld voorraad-app)";
  }
  if (!arg.eigenaar) return "geef met --eigenaar het GitHub-account of de organisatie mee waar de app komt";
  if (!DATABASESTANDEN.includes(arg.database)) {
    return "op het Cloudflare-spoor heeft elke app een eigen database; laat --database weg of geef eigen mee";
  }
  // De beheer-workflow accepteert hooguit 41 tekens (Access- en Supabase-namen krijgen er
  // nog een voorvoegsel en een achtervoegsel bij).
  if (arg.naam.length > 41) return "de naam mag hooguit 41 tekens lang zijn";
  if (arg.groepen && !arg.groepen.every((g) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(g))) {
    return "--groepen: namen van groepen uit toegang.json, met komma's (kleine letters, cijfers, streepjes)";
  }
  return null;
}

// ---------------------------------------------------------------- zuivere stappen

/**
 * Wie wordt de reviewer in CODEOWNERS? Stage Two zolang die bij de organisatie hoort;
 * anders de gebruiker zelf, want een CODEOWNERS die naar iemand zonder toegang wijst
 * blokkeert het mergen op de gevoelige paden.
 */
export function kiesReviewer({ login, stageTwoLid }) {
  return stageTwoLid ? STAGE_TWO_LOGIN : login;
}

/** De "Vervang dit"-aanwijzingen weg, de projectnaam en omschrijving erin. */
export function vulIn(map, { naam, omschrijving, reviewer }) {
  for (const bestand of ["README.md", "AGENTS.md"]) {
    const pad = join(map, bestand);
    if (!existsSync(pad)) throw new Error(`${bestand} ontbreekt na het klonen; de template is niet goed overgenomen`);
    let tekst = readFileSync(pad, "utf8");
    tekst = tekst.replace(/<!--\s*Vervang[\s\S]*?-->\n*/g, "");
    tekst = tekst.replaceAll("<projectnaam>", naam);
    if (omschrijving) {
      tekst = tekst.replace("<!-- Wat deze app doet, in één zin, vanuit de gebruiker geschreven. -->", omschrijving);
    }
    writeFileSync(pad, tekst);
  }
  const codeowners = join(map, ".github", "CODEOWNERS");
  if (existsSync(codeowners)) {
    writeFileSync(codeowners, readFileSync(codeowners, "utf8").replaceAll(`@${STAGE_TWO_LOGIN}`, `@${reviewer}`));
  }
  for (const bestand of ["README.md", "AGENTS.md"]) {
    if (readFileSync(join(map, bestand), "utf8").includes("<projectnaam>")) {
      throw new Error(`de projectnaam is niet overal ingevuld in ${bestand}`);
    }
  }
}

/**
 * Haalt de paden uit `nietMeenemen` van het manifest weg: wat alleen in de template zelf
 * hoort (de inrichtingsscripts in beheer/ en de proef-workflows met de brede sleutels).
 * Patronen: `map/**` (de hele map) of een pad met `*` in het laatste deel.
 */
export function verwijderNietMeenemen(map) {
  const manifestPad = join(map, ".claude", "stack-manifest.json");
  if (!existsSync(manifestPad)) return [];
  const patronen = JSON.parse(readFileSync(manifestPad, "utf8")).nietMeenemen ?? [];
  const weg = [];
  for (const patroon of patronen) {
    if (typeof patroon !== "string" || patroon.includes("..") || patroon.startsWith("/")) continue;
    if (patroon.endsWith("/**")) {
      const dir = patroon.slice(0, -3);
      if (existsSync(join(map, dir))) {
        rmSync(join(map, dir), { recursive: true, force: true });
        weg.push(patroon);
      }
      continue;
    }
    const map2 = dirname(patroon) === "." ? "" : dirname(patroon);
    const naam = patroon.slice(map2 ? map2.length + 1 : 0);
    if (!naam.includes("*")) {
      if (existsSync(join(map, patroon))) {
        rmSync(join(map, patroon), { recursive: true, force: true });
        weg.push(patroon);
      }
      continue;
    }
    const delen = naam.split("*").map((d) => d.replace(/[.+?^$()|[\]{}\\]/g, "\\$&"));
    const regex = new RegExp(`^${delen.join("[^/]*")}$`);
    if (!existsSync(join(map, map2))) continue;
    for (const bestand of readdirSync(join(map, map2))) {
      if (regex.test(bestand)) {
        rmSync(join(map, map2, bestand), { recursive: true, force: true });
        weg.push(map2 ? `${map2}/${bestand}` : bestand);
      }
    }
  }
  return weg;
}

/**
 * De Worker-naam in wrangler.jsonc wordt de appnaam. De template draagt de naam van zijn
 * eigen proef-Worker; zonder deze stap zou de nieuwe app over die Worker heen uitrollen.
 * Het adres wordt zo <appnaam>.<subdomein>.workers.dev.
 */
export function zetWorkerNaam(map, naam) {
  const pad = join(map, "wrangler.jsonc");
  if (!existsSync(pad)) throw new Error("wrangler.jsonc ontbreekt na het klonen; de template is niet goed overgenomen");
  const tekst = readFileSync(pad, "utf8");
  // De eerste "name" op het bovenste niveau (twee spaties inspringing, zoals in de template).
  const patroon = /^( {2}"name"\s*:\s*")[^"]*(")/m;
  if (!patroon.test(tekst)) throw new Error('wrangler.jsonc heeft geen "name" op het bovenste niveau');
  writeFileSync(pad, tekst.replace(patroon, `$1${naam}$2`));
}

/**
 * De databasestand in stack.config.json. `geen` en `gedeeld` bezitten geen database;
 * dan gaan de voorbeeldmigraties weg, anders laat guard:migrations de poort falen.
 */
export function zetDatabaseStand(map, { database, gedeeldEigenaar, gedeeldRef }) {
  const pad = join(map, "stack.config.json");
  const config = JSON.parse(readFileSync(pad, "utf8"));
  if (database === "eigen") {
    config.database = true;
    delete config.gedeelde_database;
  } else if (database === "gedeeld") {
    config.database = "gedeeld";
    config.gedeelde_database = { eigenaar: gedeeldEigenaar, project_ref: gedeeldRef };
  } else {
    config.database = false;
    delete config.gedeelde_database;
  }
  writeFileSync(pad, `${JSON.stringify(config, null, 2)}\n`);
  const migraties = join(map, "supabase", "migrations");
  if (database !== "eigen" && existsSync(migraties)) rmSync(migraties, { recursive: true, force: true });
}

/** Wat er na het script nog te doen is, per databasestand en per uitkomst. */
export function nogTeDoen({ database, ruleset }) {
  const lijst = [];
  if (!ruleset.gelukt) {
    lijst.push(
      "main is nog niet beschermd (meestal: een privérepo op een gratis GitHub-plan). Regel het plan, of vraag Stage Two.",
    );
  }
  lijst.push(
    "Hosting, deur en database (Cloudflare en Supabase): Stage Two of de beheer-repo van de organisatie richt die in. Daar komt bewust geen toegang voor op deze computer. Tot die tijd kun je gewoon bouwen; de kwaliteitspoort draait tegen een eigen testdatabase.",
  );
  lijst.push("Foutbewaking (Sentry): Stage Two maakt een project aan en zet de DSN als omgevingsvariabele. Mag later.");
  return lijst;
}

// ---------------------------------------------------------------- gh-stappen

function ghJson(args) {
  return JSON.parse(sh("gh", ["api", ...args]));
}

function repoBestaat(repo) {
  try {
    sh("gh", ["repo", "view", repo, "--json", "name"]);
    return true;
  } catch {
    return false;
  }
}

function login() {
  return sh("gh", ["api", "user", "-q", ".login"]);
}

function isOrganisatie(eigenaar) {
  try {
    return ghJson([`users/${eigenaar}`]).type === "Organization";
  } catch {
    return false;
  }
}

function magInOrganisatie(eigenaar, gebruiker) {
  try {
    sh("gh", ["api", `orgs/${eigenaar}/memberships/${gebruiker}`]);
    return true;
  } catch {
    return false;
  }
}

function stageTwoIsLid(eigenaar) {
  try {
    sh("gh", ["api", `orgs/${eigenaar}/members/${STAGE_TWO_LOGIN}`]);
    return true;
  } catch {
    return false;
  }
}

function plan(eigenaar) {
  try {
    const p = sh("gh", ["api", `orgs/${eigenaar}`, "-q", ".plan.name // empty"]);
    return p || "onbekend";
  } catch {
    try {
      return sh("gh", ["api", `users/${eigenaar}`, "-q", ".plan.name // empty"]) || "onbekend";
    } catch {
      return "onbekend";
    }
  }
}

function pnpm(map, ...args) {
  // Op Windows is pnpm een .cmd-omhulsel; dat start alleen via de shell.
  return sh("pnpm", args, { cwd: map, timeout: 600000, shell: process.platform === "win32" });
}

function wachtTotGevuld(repo, { pogingen = 30, wachtMs = 2000 } = {}) {
  for (let i = 0; i < pogingen; i += 1) {
    try {
      sh("gh", ["api", `repos/${repo}/contents/package.json`]);
      return true;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wachtMs);
    }
  }
  return false;
}

function zetRuleset(repo) {
  try {
    sh("gh", ["api", `repos/${repo}/rulesets`, "-X", "POST", "--input", RULESET_PAD]);
    return { gelukt: true };
  } catch (fout) {
    return { gelukt: false, reden: eersteRegel(fout) };
  }
}

// ---------------------------------------------------------------- inrichten

export const BEHEER_REPO = "stack-beheer";
export const BEHEER_WORKFLOW = "app-inrichten.yml";

/** De regel `INRICHTING {...}` uit het logboek van de workflow, of null. */
export function leesInrichting(logtekst) {
  const regels = String(logtekst ?? "").split("\n");
  for (let i = regels.length - 1; i >= 0; i -= 1) {
    const m = /INRICHTING (\{.*\})\s*$/.exec(regels[i]);
    if (!m) continue;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
  return null;
}

/** Wat er na een geslaagde inrichting nog open staat. */
export function nogTeDoenNaInrichting({ resultaat }) {
  const lijst = [
    "De eerste uitrol: maak een kleine wijziging via /stack-cloudflare:verder-werken en merge de pull request. Tot dan toont het adres \"Deze app wordt ingericht.\", al achter de deur.",
  ];
  if (resultaat?.waarschuwingen?.length) {
    for (const w of resultaat.waarschuwingen) lijst.push(`Waarschuwing van de inrichting, geef door aan Stage Two: ${w}`);
  }
  lijst.push("Foutbewaking (Sentry): Stage Two zet die aan in de beheer-repo. Mag later.");
  return lijst;
}

/**
 * Staat de app in toegang.json van de beheer-repo? `toegang` is de inhoud van dat bestand.
 * Geeft `{ staatErin, groepen }`: de groepen die er al zijn, om uit te kiezen.
 */
export function controleerToegang(toegang, app) {
  const groepen = Object.keys(toegang?.groepen ?? {});
  const gekozen = toegang?.apps?.[app];
  return { staatErin: Array.isArray(gekozen) && gekozen.length > 0, groepen };
}

/** toegang.json met de app erbij; de rest blijft precies staan. */
export function voegAppToe(toegang, app, groepen) {
  return { ...toegang, apps: { ...(toegang.apps ?? {}), [app]: [...groepen] } };
}

function slaap(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function leesToegang(beheer) {
  const bestand = ghJson([`repos/${beheer}/contents/toegang.json`]);
  return { toegang: JSON.parse(Buffer.from(bestand.content, "base64").toString("utf8")), sha: bestand.sha };
}

/**
 * Opent een pull request op de beheer-repo die de app aan toegang.json toevoegt. De
 * eigenaar van de beheer-repo keurt hem goed; zo beslist een mens wie bij een app mag.
 */
function vraagToegangAan(beheer, arg, toegang, sha) {
  const branch = `toegang/${arg.naam}`;
  const bestaand = JSON.parse(sh("gh", ["pr", "list", "--repo", beheer, "--head", branch, "--state", "open", "--json", "url"]));
  if (bestaand[0]?.url) return bestaand[0].url;
  const mainSha = sh("gh", ["api", `repos/${beheer}/git/ref/heads/main`, "-q", ".object.sha"]);
  try {
    sh("gh", ["api", `repos/${beheer}/git/refs`, "-X", "POST", "-f", `ref=refs/heads/${branch}`, "-f", `sha=${mainSha}`]);
  } catch {
    // De branch bestaat al van een eerdere poging; dan schrijven we daarop verder.
  }
  const nieuw = `${JSON.stringify(voegAppToe(toegang, arg.naam, arg.groepen), null, 2)}\n`;
  let huidigSha = sha;
  try {
    huidigSha = sh("gh", ["api", `repos/${beheer}/contents/toegang.json?ref=${branch}`, "-q", ".sha"]);
  } catch {
    huidigSha = sha;
  }
  sh("gh", [
    "api", `repos/${beheer}/contents/toegang.json`, "-X", "PUT",
    "-f", `message=toegang: ${arg.naam} voor ${arg.groepen.join(", ")}`,
    "-f", `content=${Buffer.from(nieuw).toString("base64")}`,
    "-f", `branch=${branch}`,
    "-f", `sha=${huidigSha}`,
  ]);
  return sh("gh", [
    "pr", "create", "--repo", beheer, "--base", "main", "--head", branch,
    "--title", `Toegang: ${arg.naam}`,
    "--body", `De nieuwe app **${arg.naam}** komt in toegang.json, voor de groep(en) ${arg.groepen.map((g) => `\`${g}\``).join(", ")}.\n\nAangevraagd met /stack-cloudflare:nieuwe-app. Na goedkeuring en merge kan de app worden ingericht.`,
  ]);
}

/**
 * Start de workflow in de beheer-repo en wacht op het resultaat. `gh` doet al het werk
 * met de login van de gebruiker: die heeft Write op stack-beheer (mag starten) en leest
 * het logboek. Er komt geen sleutel van Cloudflare of Supabase aan te pas: die staan
 * alleen in de omgeving beheer van de beheer-repo.
 */
export function richtIn(arg, { cwd = process.cwd(), wachtMs = 5000, maxWachtMinuten = 30 } = {}) {
  const fout = controleerArgumenten(arg);
  if (fout) return { status: "mislukt", reden: fout };
  if (!ghAanwezig()) return { status: "mislukt", reden: "de GitHub-opdrachtregel (gh) ontbreekt; draai eerst /stack-cloudflare:installatie" };
  if (!ghIngelogd()) return { status: "mislukt", reden: "log eerst in bij GitHub met `gh auth login` (zie /stack-cloudflare:installatie)" };

  const beheer = `${arg.eigenaar}/${BEHEER_REPO}`;
  if (!isOrganisatie(arg.eigenaar) || !repoBestaat(beheer)) {
    return {
      status: "geen-beheer",
      reden: `${arg.eigenaar} heeft geen beheer-repo (${beheer}); Stage Two richt de hosting en de database in`,
    };
  }
  const repo = `${arg.eigenaar}/${arg.naam}`;
  if (!repoBestaat(repo)) return { status: "mislukt", reden: `de repo ${repo} bestaat niet; maak de app eerst aan (--doe-het)` };

  let toegang;
  let sha;
  try {
    ({ toegang, sha } = leesToegang(beheer));
  } catch (f) {
    return { status: "mislukt", reden: `toegang.json van ${beheer} is niet te lezen: ${eersteRegel(f)}` };
  }
  const { staatErin, groepen } = controleerToegang(toegang, arg.naam);
  if (!staatErin) {
    if (!arg.groepen?.length) {
      return {
        status: "kies-groepen",
        groepen,
        reden: groepen.length
          ? `${arg.naam} staat nog niet in toegang.json; kies wie erbij mag uit de groepen ${groepen.join(", ")} en geef die mee met --groepen`
          : `er staan nog geen groepen in toegang.json van ${beheer}; vraag Stage Two die aan te maken`,
      };
    }
    const onbekend = arg.groepen.filter((g) => !groepen.includes(g));
    if (onbekend.length) return { status: "mislukt", reden: `onbekende groep(en) ${onbekend.join(", ")}; kies uit ${groepen.join(", ")}` };
    try {
      const pr = vraagToegangAan(beheer, arg, toegang, sha);
      return {
        status: "wacht-op-toegang",
        repo,
        pr,
        reden: `de app moet eerst in toegang.json; de eigenaar van ${beheer} keurt deze pull request goed, daarna draai je --inrichten opnieuw`,
      };
    } catch (f) {
      return { status: "mislukt", reden: `de pull request op ${beheer} openen mislukte: ${eersteRegel(f)} (heb je Write op ${beheer}?)` };
    }
  }

  const start = new Date();
  try {
    sh("gh", ["workflow", "run", BEHEER_WORKFLOW, "--repo", beheer, "-f", `app=${arg.naam}`, "-f", "droogloop=false"], { cwd });
  } catch (f) {
    return { status: "mislukt", reden: `de workflow starten mislukte: ${eersteRegel(f)} (heb je Write op ${beheer}?)` };
  }

  // GitHub registreert de run een paar seconden na het starten; zoek de eerste die van ná de start is.
  let run = null;
  for (let i = 0; i < 12 && !run; i += 1) {
    slaap(wachtMs);
    try {
      const lijst = JSON.parse(
        sh("gh", ["run", "list", "--repo", beheer, "--workflow", BEHEER_WORKFLOW, "--limit", "5", "--json", "databaseId,createdAt,url"], { cwd }),
      );
      run = lijst.find((r) => new Date(r.createdAt) >= new Date(start.getTime() - 60000)) ?? null;
    } catch {
      run = null;
    }
  }
  if (!run) return { status: "mislukt", reden: `de workflow is gestart maar de run is niet gevonden; kijk op https://github.com/${beheer}/actions` };

  try {
    sh("gh", ["run", "watch", String(run.databaseId), "--repo", beheer, "--interval", "10"], { cwd, timeout: maxWachtMinuten * 60000 });
  } catch (f) {
    if (f.killed || /ETIMEDOUT/.test(String(f.code))) {
      return { status: "mislukt", reden: `de workflow draait na ${maxWachtMinuten} minuten nog; kijk op ${run.url}`, url: run.url };
    }
  }
  let log = "";
  try {
    log = sh("gh", ["run", "view", String(run.databaseId), "--repo", beheer, "--log"], { cwd, ruw: true, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    log = "";
  }
  const resultaat = leesInrichting(log);
  if (!resultaat) return { status: "mislukt", reden: `geen resultaat gevonden in het logboek van de workflow; kijk op ${run.url}`, url: run.url };
  if (resultaat.status !== "gelukt") {
    return { status: "mislukt", reden: resultaat.reden ?? "de inrichting is mislukt", url: run.url };
  }
  return {
    status: "ingericht",
    repo,
    adres: resultaat.hostname ? `https://${resultaat.hostname}` : null,
    url: run.url,
    database: arg.database,
    resultaat,
    nogTeDoen: nogTeDoenNaInrichting({ resultaat }),
  };
}

// ---------------------------------------------------------------- de run

export function voorcontrole(arg, { cwd = process.cwd() } = {}) {
  const fout = controleerArgumenten(arg);
  if (fout) return { status: "mislukt", reden: fout };
  for (const cli of ["git", "pnpm"]) {
    try {
      sh(cli, ["--version"], { shell: cli === "pnpm" && process.platform === "win32" });
    } catch {
      return { status: "mislukt", reden: `${cli} staat niet op deze computer; draai eerst /stack-cloudflare:installatie` };
    }
  }
  if (!ghAanwezig()) return { status: "mislukt", reden: "de GitHub-opdrachtregel (gh) ontbreekt; draai eerst /stack-cloudflare:installatie" };
  if (!ghIngelogd()) return { status: "mislukt", reden: "log eerst in bij GitHub met `gh auth login` (zie /stack-cloudflare:installatie)" };

  const gebruiker = login();
  const org = isOrganisatie(arg.eigenaar);
  if (!org && arg.eigenaar !== gebruiker) {
    return {
      status: "mislukt",
      reden: `${arg.eigenaar} is geen organisatie en niet je eigen account (${gebruiker}); kies een van beide`,
    };
  }
  if (org && !magInOrganisatie(arg.eigenaar, gebruiker)) {
    return { status: "mislukt", reden: `je account ${gebruiker} is geen lid van de organisatie ${arg.eigenaar}` };
  }
  const repo = `${arg.eigenaar}/${arg.naam}`;
  if (repoBestaat(repo)) return { status: "mislukt", reden: `de repo ${repo} bestaat al; kies een andere naam` };
  const doel = resolve(arg.map ?? cwd, arg.naam);
  if (existsSync(doel)) return { status: "mislukt", reden: `de map ${doel} bestaat al; kies een andere naam of map` };
  if (arg.database === "gedeeld" && !repoBestaat(arg.gedeeldEigenaar)) {
    return { status: "mislukt", reden: `de app ${arg.gedeeldEigenaar} die de database bezit is niet gevonden op GitHub` };
  }

  const stageTwoLid = org ? stageTwoIsLid(arg.eigenaar) : false;
  return {
    status: "klaar",
    plan: {
      repo,
      url: `https://github.com/${repo}`,
      map: doel,
      database: arg.database,
      reviewer: kiesReviewer({ login: gebruiker, stageTwoLid }),
      gebruiker,
      organisatie: org,
      githubPlan: plan(arg.eigenaar),
      template: TEMPLATE,
    },
  };
}

export function doeHet(arg, { cwd = process.cwd() } = {}) {
  const controle = voorcontrole(arg, { cwd });
  if (controle.status !== "klaar") return controle;
  const { repo, map, reviewer, gebruiker } = controle.plan;
  const uitkomst = { status: "mislukt", repo, url: controle.plan.url };

  try {
    sh("gh", [
      "repo",
      "create",
      repo,
      "--private",
      "--template",
      TEMPLATE,
      ...(arg.omschrijving ? ["--description", arg.omschrijving] : []),
    ]);
  } catch (fout) {
    return { status: "mislukt", reden: `de repo aanmaken mislukte: ${eersteRegel(fout)}` };
  }
  if (!wachtTotGevuld(repo)) {
    return { ...uitkomst, reden: `GitHub heeft de template na een minuut nog niet gekopieerd; kijk op ${controle.plan.url}` };
  }

  try {
    mkdirSync(dirname(map), { recursive: true });
    sh("gh", ["repo", "clone", repo, map, "--", "--quiet"], { timeout: 300000 });
    verwijderNietMeenemen(map);
    vulIn(map, { naam: arg.naam, omschrijving: arg.omschrijving, reviewer });
    zetWorkerNaam(map, arg.naam);
    zetDatabaseStand(map, arg);
    pnpm(map, "install", "--silent");

    const naam = git(map, "config", "--get", "user.name") || gebruiker;
    let email;
    try {
      email = git(map, "config", "--get", "user.email");
    } catch {
      email = "";
    }
    email ||= `${gebruiker}@users.noreply.github.com`;
    git(map, "add", "-A");
    git(map, "-c", `user.name=${naam}`, "-c", `user.email=${email}`, "commit", "-q", "-m", "chore: projectnaam, reviewer, Worker-naam en databasestand invullen");
    git(map, "push", "-q", "origin", "HEAD");
  } catch (fout) {
    return { ...uitkomst, map, reden: `het klaarzetten van de app mislukte: ${eersteRegel(fout)}` };
  }

  const ruleset = zetRuleset(repo);
  return {
    status: "gemaakt",
    repo,
    url: controle.plan.url,
    map,
    database: arg.database,
    reviewer,
    ruleset,
    nogTeDoen: nogTeDoen({ database: arg.database, ruleset }),
  };
}

// ---------------------------------------------------------------- start

function schrijf(uit, json) {
  if (json) process.stdout.write(`${JSON.stringify(uit)}\n`);
  else process.stdout.write(`${JSON.stringify(uit, null, 2)}\n`);
  process.exitCode = uit.status === "mislukt" ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let arg;
  try {
    arg = leesArgumenten(process.argv.slice(2));
  } catch (fout) {
    schrijf({ status: "mislukt", reden: fout.message }, true);
    process.exit(1);
  }
  try {
    schrijf(arg.inrichten ? richtIn(arg) : arg.doeHet ? doeHet(arg) : voorcontrole(arg), arg.json);
  } catch (fout) {
    schrijf({ status: "mislukt", reden: eersteRegel(fout) }, arg.json);
  }
}
