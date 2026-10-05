#!/usr/bin/env node
/**
 * De beheerde run van Stage Two: gaat het register van projecten langs en brengt wie
 * achterloopt naar de nieuwste template, als pull request van `Stage Two stack-sync`.
 * Dit is Christijns overzicht en noodrem; de gewone weg is dat de klant zelf
 * /stack-cloudflare:updaten draait (KTD2). Dezelfde kern (lib/), dus hetzelfde gedrag.
 *
 * Dit is geen skill en geen commando van de plugin: het staat onder beheer/ (niet
 * bin/, want die map zet Claude Code op het PATH van elke sessie) en wordt gestart
 * vanuit Stack/bin/stack-sync.mjs, dat het register en de ruleset meegeeft:
 *
 *   node beheer/beheerd.mjs --register <projecten.json> --ruleset <ruleset.json> [opties]
 *     --status            alleen tonen wie achterloopt, plus route en open PR's
 *     (niets)             droogloop: zeggen wat er zou gebeuren
 *     --doe-het           echt pushen en PR's openen
 *     --repo owner/naam   alleen dit project
 *     --template-ref x    de template op branch of tag x in plaats van de nieuwste tag,
 *                         om een nieuwe versie droog te testen vóórdat hij getagd is
 *
 * Per project kent het register een `route`: `beheerd` (deze run opent PR's) of
 * `plugin` (de klant haalt zelf op; deze run toont alleen de status). Een project met
 * een open stack-bijwerken-PR van de klant wordt overgeslagen. Zonder --doe-het wordt
 * er niets gepusht: een script dat in de repo's van klanten schrijft, hoort niet per
 * ongeluk te kunnen draaien. Met GH_TOKEN in de omgeving (een klantmap) weigert het.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { branchNaam, prTekst, prTitel, sluitTekst, spiegelTekst, spiegelTitel } from "../lib/pr-tekst.mjs";
import {
  alGelijkOpGitHub,
  branchHerbouwbaar,
  checkoutTag,
  commit,
  eersteRegel,
  git,
  gitVoorKern,
  hoogsteTagVersie,
  kloonRepo,
  kloonTemplate,
  maakBranch,
  openOfWerkPRBij,
  openPRs,
  pnpmVoorKern,
  push,
  sh,
  sluitOuderePRs,
  templateRepo,
} from "../lib/repo.mjs";
import { leesVersie, pasToe } from "../lib/toepassen.mjs";

export const AFZENDER = "beheerd";
export const IDENTITEIT = { naam: "Stage Two stack-sync", email: "info@stagetwo.nl" };
const PREFIX = "stack-sync";

const ESC = String.fromCharCode(27);
const kleur = (code) => (tekst) => `${ESC}[${code}m${tekst}${ESC}[0m`;
const rood = kleur(31);
const groen = kleur(32);
const geel = kleur(33);
const grijs = kleur(90);

export function leesArgumenten(argv) {
  const uit = { register: null, ruleset: null, status: false, doeHet: false, repo: null, templateRef: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--status") uit.status = true;
    else if (a === "--doe-het") uit.doeHet = true;
    else if (a === "--register") uit.register = argv[++i] ?? null;
    else if (a === "--ruleset") uit.ruleset = argv[++i] ?? null;
    else if (a === "--repo") uit.repo = argv[++i] ?? null;
    else if (a === "--template-ref") uit.templateRef = argv[++i] ?? null;
    else throw new Error(`onbekend argument: ${a}`);
  }
  if (!uit.register || !uit.ruleset) {
    throw new Error("geef --register <projecten.json> en --ruleset <ruleset.json> mee (Stack/bin/stack-sync.mjs doet dat)");
  }
  return uit;
}

function ghJson(pad) {
  return JSON.parse(sh("gh", ["api", pad]));
}

/** Leest een bestand uit een repo op GitHub, of null als het er niet is. */
function leesOpAfstand(repo, pad) {
  try {
    return Buffer.from(ghJson(`repos/${repo}/contents/${pad}`).content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function heeftRuleset(repo) {
  try {
    return ghJson(`repos/${repo}/rulesets`).length > 0;
  } catch {
    return null;
  }
}

function openBijwerkPR(repo, versie) {
  try {
    return openPRs(repo).find((pr) => pr.headRefName === branchNaam("klantsessie", versie)) ?? null;
  } catch {
    return null;
  }
}

/** Een kopie van de template bij een klant is geen project maar een spiegel: de hele boom gelijktrekken. */
function spiegel({ repo, map, tmplMap, branch, versie, doelVersie, doeHet, log }) {
  maakBranch(map, branch);
  const bron = new Set(git(tmplMap, "ls-files").split("\n").filter(Boolean));
  const hier = new Set(git(map, "ls-files").split("\n").filter(Boolean));
  for (const pad of bron) {
    mkdirSync(dirname(join(map, pad)), { recursive: true });
    cpSync(join(tmplMap, pad), join(map, pad));
  }
  const verwijderd = [...hier].filter((pad) => !bron.has(pad));
  for (const pad of verwijderd) git(map, "rm", "-q", pad);
  git(map, "add", "-A");
  const gewijzigd = git(map, "diff", "--name-only", "--cached").split("\n").filter(Boolean);
  if (gewijzigd.length === 0) {
    log(`  ${grijs("spiegel is al gelijk aan de template")}`);
    return "niets";
  }
  log(`  spiegel: ${gewijzigd.length} bestand(en) anders, ${verwijderd.length} verwijderd`);
  if (!doeHet) {
    log(`  ${grijs("droogloop: niets gepusht")}`);
    return "droogloop";
  }
  commit({ map, identiteit: IDENTITEIT, bericht: `chore: template-kopie naar versie ${doelVersie}`, versie: doelVersie });
  if (alGelijkOpGitHub(map, branch)) {
    log(`  ${grijs("staat al zo op GitHub, niets gepusht")}`);
    return "al-bij";
  }
  push(map, branch);
  const pr = openOfWerkPRBij({
    repo,
    branch,
    titel: spiegelTitel(doelVersie),
    tekst: spiegelTekst({ van: versie, naar: doelVersie, gewijzigd, verwijderd }),
  });
  log(`  ${groen("v")} ${pr.nieuw ? pr.url : `bestaande PR #${pr.number} bijgewerkt`}`);
  return pr.nieuw ? "pr-geopend" : "pr-bijgewerkt";
}

export function verwerk({ project, werkmap, tmplMap, doelVersie, rulesetPad, opties, log }) {
  const { repo, route = "beheerd" } = project;
  const ruwe = leesOpAfstand(repo, ".claude/stack-version");
  const versie = ruwe === null ? null : Number(ruwe.trim());
  const ruleset = heeftRuleset(repo);
  const bijwerkPR = versie !== null && versie < doelVersie ? openBijwerkPR(repo, doelVersie) : null;

  const regels = [];
  if (versie === null) regels.push(rood("geen stack-version"));
  else if (versie >= doelVersie) regels.push(groen(`versie ${versie}, bij`));
  else regels.push(geel(`versie ${versie} -> ${doelVersie}`));
  if (ruleset === false) regels.push(rood("GEEN ruleset op main"));
  else if (ruleset === null) regels.push(geel("ruleset niet op te vragen"));
  regels.push(grijs(`route ${route}`));
  if (bijwerkPR) regels.push(geel(`klant-PR open: ${bijwerkPR.url}`));
  log(`${repo.padEnd(34)} ${regels.join("  ")}`);

  if (opties.status) return "alleen-status";

  // De tweede taak van deze run: staat de ruleset er wel? Een repo die de klant zelf
  // heeft aangemaakt heeft er nog geen, en dan kan er rechtstreeks naar main gepusht worden.
  if (ruleset === false) {
    if (opties.doeHet) {
      try {
        sh("gh", ["api", `repos/${repo}/rulesets`, "-X", "POST", "--input", rulesetPad]);
        log(`  ${groen("v")} ruleset aangebracht`);
      } catch (fout) {
        log(`  ${rood("x")} ruleset aanbrengen mislukt: ${eersteRegel(fout)}`);
      }
    } else {
      log(`  ${grijs("zou de ruleset aanbrengen (droogloop)")}`);
    }
  }

  if (versie === null || versie >= doelVersie) return "niets";
  if (route === "plugin") {
    log(`  ${grijs("route plugin: de klant haalt dit zelf op met /stack-cloudflare:updaten; geen PR van Stage Two")}`);
    return "overgeslagen";
  }
  if (bijwerkPR) {
    log(`  ${grijs(`overgeslagen: de klant heeft al een pull request open (${bijwerkPR.url})`)}`);
    return "overgeslagen";
  }

  const map = join(werkmap, repo.replaceAll("/", "_"));
  kloonRepo({ url: repo, doel: map, viaGh: true });

  // Deze rem geldt voor app én spiegel: een sync-branch waar een mens op heeft gewerkt
  // wordt nooit stilletjes opnieuw opgebouwd en overschreven.
  const branch = branchNaam(AFZENDER, doelVersie);
  if (!branchHerbouwbaar(map, branch)) {
    log(`  ${rood("x GESTOPT")}: op ${branch} staat een commit die niet van de sync is; bekijk die branch eerst`);
    return "gestopt";
  }
  if (project.soort === "template") return spiegel({ repo, map, tmplMap, branch, versie, doelVersie, doeHet: opties.doeHet, log });

  maakBranch(map, branch);
  const resultaat = pasToe({ map, tmplMap, git: gitVoorKern(map, tmplMap), pnpm: pnpmVoorKern() });

  if (resultaat.status === "gestopt") {
    log(`  ${rood("x GESTOPT")}: ${resultaat.reden}`);
    for (const pad of resultaat.buitenManifest ?? []) log(`      ${pad}`);
    return "gestopt";
  }
  if (resultaat.status !== "bijgewerkt") {
    log(`  ${grijs(resultaat.reden ?? resultaat.status)}`);
    return "niets";
  }
  log(
    `  ${resultaat.bijgewerkt.length} bestand(en) bijgewerkt, ${resultaat.verwijderd.length} verwijderd, ${resultaat.gewijzigd.length} echt gewijzigd`,
  );
  for (const b of resultaat.bijgewerkt) log(`      ${b.pad} (${b.hoe})`);
  for (const pad of resultaat.verwijderd) log(`      ${pad} (verwijderd)`);
  if (resultaat.overgeslagen.length > 0) {
    log(`  ${geel(`${resultaat.overgeslagen.length} overgeslagen wegens lokale afwijking:`)}`);
    for (const s of resultaat.overgeslagen) log(`      ${s.pad}: ${s.reden}`);
  }
  if (!opties.doeHet) {
    log(`  ${grijs("droogloop: niets gepusht")}`);
    return "droogloop";
  }

  commit({ map, identiteit: IDENTITEIT, bericht: `chore: stack-template naar versie ${doelVersie}`, versie: doelVersie });
  if (alGelijkOpGitHub(map, branch)) {
    log(`  ${grijs("staat al zo op GitHub, niets gepusht")}`);
    return "al-bij";
  }
  push(map, branch);
  const pr = openOfWerkPRBij({ repo, branch, titel: prTitel(doelVersie), tekst: prTekst({ resultaat, afzender: AFZENDER }) });
  log(`  ${groen("v")} ${pr.nieuw ? pr.url : `bestaande PR #${pr.number} bijgewerkt`}`);
  for (const naam of sluitOuderePRs({ repo, prefix: PREFIX, doelVersie, tekst: sluitTekst(doelVersie), map })) {
    const nawoord = naam.verwijderd ? " (branch verwijderd)" : " (branch blijft: eigen commits)";
    log(`  ${grijs(`oudere sync-PR op ${naam.branch} gesloten${nawoord}`)}`);
  }
  return pr.nieuw ? "pr-geopend" : "pr-bijgewerkt";
}

export function hoofd(argv, { env = process.env, log = console.log } = {}) {
  // gh leest ook GITHUB_TOKEN; dezelfde weigering, anders glipt een klanttoken er zo doorheen.
  if (env.GH_TOKEN || env.GITHUB_TOKEN) {
    log(rood("draai dit vanuit /home/claude met je eigen sessie, niet met een klanttoken"));
    return 1;
  }
  const opties = leesArgumenten(argv);
  const register = JSON.parse(readFileSync(opties.register, "utf8"));
  let projecten = register.projecten ?? [];
  if (opties.repo) projecten = projecten.filter((p) => p.repo === opties.repo);
  if (projecten.length === 0) {
    log(geel("Geen projecten om langs te gaan."));
    return 0;
  }

  const werkmap = mkdtempSync(join(tmpdir(), "stack-beheerd-"));
  try {
    // De template komt met Christijns gh-login binnen zolang hij privé is; een lokaal pad
    // (tests) gewoon met git.
    const tmplRepo = templateRepo(env);
    const tmplMap = kloonTemplate({ repo: tmplRepo, doel: join(werkmap, "template"), viaGh: !tmplRepo.startsWith("/") });
    let doelVersie;
    if (opties.templateRef) {
      git(tmplMap, "checkout", "-q", opties.templateRef);
      doelVersie = leesVersie(tmplMap);
      log(geel(`template op ${opties.templateRef} in plaats van de nieuwste tag`));
    } else {
      doelVersie = hoogsteTagVersie(tmplMap);
      if (doelVersie !== null) checkoutTag(tmplMap, doelVersie);
    }
    if (doelVersie === null) {
      log(rood("de template heeft geen tag stack-v<n> (of geen leesbaar versienummer op de opgegeven ref)"));
      return 1;
    }
    log(`template staat op ${groen(`versie ${doelVersie}`)}\n`);

    const tellen = {};
    for (const project of projecten) {
      let actie;
      try {
        actie = verwerk({ project, werkmap, tmplMap, doelVersie, rulesetPad: opties.ruleset, opties, log });
      } catch (fout) {
        log(`  ${rood("x")} ${project.repo}: ${eersteRegel(fout)}`);
        actie = "fout";
      }
      tellen[actie] = (tellen[actie] ?? 0) + 1;
    }
    log(`\n${Object.entries(tellen).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    if (!opties.doeHet && !opties.status) log(grijs("Droogloop. Gebruik --doe-het om de PR's echt te openen."));
    return 0;
  } finally {
    try {
      rmSync(werkmap, { recursive: true, force: true });
    } catch {
      // niet erg
    }
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = hoofd(process.argv.slice(2));
  } catch (fout) {
    console.error(rood(eersteRegel(fout)));
    process.exitCode = 1;
  }
}
