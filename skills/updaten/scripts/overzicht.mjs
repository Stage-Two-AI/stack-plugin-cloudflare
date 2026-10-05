#!/usr/bin/env node
/**
 * Het overzicht achter /stack-cloudflare:updaten: welke apps van de klant zijn uit de Stage Two-template
 * gebouwd, op welke versie staan ze, en welke lopen achter?
 *
 *   node overzicht.mjs --json [--eigenaar <organisatie of account>]...
 *
 * Zonder --eigenaar kijkt het script naar de eigenaar van de open map (de origin op
 * GitHub); staat er geen app open, dan naar het eigen account en alle organisaties van
 * de gebruiker. Alleen repo's waar de gebruiker naar mag schrijven tellen mee: een app
 * die je niet kunt bijwerken, hoort niet in de vraag "welke wil je bijwerken?".
 *
 * Het script wijzigt niets. De skill toont het overzicht en vraagt welke apps mee
 * moeten; bijwerken gaat daarna per app met `bijwerken.mjs --repo`.
 *
 * Uitkomst: één JSON-object met `status`:
 *   ok        `apps` (achterlopers eerst), `doel`, `huidige` (de open app of null)
 *   mislukt   een voorwaarde ontbreekt; `reden` is één zin met één handeling
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCloudflareManifest } from "../../../lib/manifest.mjs";
import {
  eersteRegel,
  ghAanwezig,
  ghIngelogd,
  openPRVoorVersie,
  originUrl,
  repoUitUrl,
  sh,
  templateRepo,
  versieOpAfstand,
} from "../../../lib/repo.mjs";

const SCHRIJVERS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

export function leesArgumenten(argv) {
  const uit = { json: false, eigenaren: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") uit.json = true;
    else if (a === "--eigenaar") {
      const e = argv[++i];
      if (!e) throw new Error("--eigenaar zonder naam");
      uit.eigenaren.push(e);
    } else throw new Error(`onbekend argument: ${a}`);
  }
  return uit;
}

/** De templateversie van een repo op GitHub, of null als hij niet uit de Cloudflare-template komt. */
export function versieVanRepo(repo) {
  try {
    const manifest = JSON.parse(sh("gh", ["api", `repos/${repo}/contents/.claude/stack-manifest.json`, "-H", "Accept: application/vnd.github.raw"]));
    if (!isCloudflareManifest(manifest)) return null;
    const tekst = sh("gh", ["api", `repos/${repo}/contents/.claude/stack-version`, "-H", "Accept: application/vnd.github.raw"]);
    const n = Number.parseInt(tekst.trim(), 10);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function eigenarenVanGebruiker() {
  const login = sh("gh", ["api", "user", "--jq", ".login"]).trim();
  const orgs = sh("gh", ["api", "user/orgs", "--jq", ".[].login"])
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  return [...orgs, login].filter(Boolean);
}

function reposVan(eigenaar) {
  const lijst = JSON.parse(
    sh("gh", ["repo", "list", eigenaar, "--no-archived", "--limit", "300", "--json", "nameWithOwner,viewerPermission"]),
  );
  return lijst.filter((r) => SCHRIJVERS.has(r.viewerPermission)).map((r) => r.nameWithOwner);
}

export function overzicht({ cwd = process.cwd(), eigenaren = [], env = process.env } = {}) {
  if (!ghAanwezig()) return { status: "mislukt", reden: "de GitHub-opdrachtregel (gh) ontbreekt; draai eerst /stack-cloudflare:installatie" };
  if (!ghIngelogd()) return { status: "mislukt", reden: "log eerst in bij GitHub met `gh auth login` (zie /stack-cloudflare:installatie)" };

  const doel = versieOpAfstand(templateRepo(env));
  if (doel === null) return { status: "mislukt", reden: "de template is niet bereikbaar (geen netwerk, of nog geen versie-tag); probeer het later opnieuw" };

  const huidige = repoUitUrl(originUrl(cwd));
  let welke = eigenaren;
  try {
    if (welke.length === 0) welke = huidige ? [huidige.split("/")[0]] : eigenarenVanGebruiker();
  } catch (fout) {
    return { status: "mislukt", reden: `je organisaties zijn niet op te vragen: ${eersteRegel(fout)}` };
  }

  const apps = [];
  const gezien = new Set();
  for (const eigenaar of welke) {
    let repos;
    try {
      repos = reposVan(eigenaar);
    } catch (fout) {
      return { status: "mislukt", reden: `de repo's van ${eigenaar} zijn niet op te vragen: ${eersteRegel(fout)}` };
    }
    for (const repo of repos) {
      if (gezien.has(repo)) continue;
      gezien.add(repo);
      const versie = versieVanRepo(repo);
      if (versie === null) continue;
      const achter = versie < doel;
      let openPR = null;
      if (achter) {
        try {
          openPR = openPRVoorVersie(repo, doel)?.url ?? null;
        } catch {
          openPR = null;
        }
      }
      apps.push({ repo, versie, achter, openPR, huidige: repo === huidige });
    }
  }
  apps.sort((a, b) => Number(b.achter) - Number(a.achter) || a.versie - b.versie || a.repo.localeCompare(b.repo));
  return { status: "ok", doel, huidige, eigenaren: welke, apps };
}

export function hoofd(argv, { cwd = process.cwd(), env = process.env } = {}) {
  let args;
  try {
    args = leesArgumenten(argv);
  } catch (fout) {
    return { status: "mislukt", reden: fout.message };
  }
  return overzicht({ cwd, eigenaren: args.eigenaren, env });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let uitkomst;
  try {
    uitkomst = hoofd(argv);
  } catch (fout) {
    uitkomst = { status: "mislukt", reden: eersteRegel(fout) };
  }
  process.stdout.write(`${JSON.stringify(uitkomst, null, 2)}\n`);
  process.exitCode = uitkomst.status === "ok" ? 0 : 1;
}
