import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { schrijfBestanden, tijdelijkeMap } from "../../../lib/test-hulp.mjs";
import {
  STAGE_TWO_LOGIN,
  controleerArgumenten,
  geldigeNaam,
  kiesReviewer,
  leesArgumenten,
  leesInrichting,
  nogTeDoen,
  nogTeDoenNaInrichting,
  controleerToegang,
  foutTekst,
  hervatBesluit,
  installeer,
  regelOmgevingen,
  verwijderNietMeenemen,
  voegAppToe,
  vulIn,
  zetDatabaseStand,
  zetWorkerNaam,
} from "./nieuwe-app.mjs";

function verseTemplate() {
  const map = tijdelijkeMap("nieuwe-app-");
  schrijfBestanden(map, {
    "README.md": "# <projectnaam>\n\n<!-- Vervang <projectnaam> en schrijf hieronder in één zin wat deze app doet,\nvanuit de gebruiker. -->\n\n<!-- Wat deze app doet, in één zin, vanuit de gebruiker geschreven. -->\n\nVerder.\n",
    "AGENTS.md": "# <projectnaam>\n\n<!-- Vervang <projectnaam> en de regel hieronder bij het opzetten van een project. -->\n<!-- Wat deze app doet, in één zin, vanuit de gebruiker geschreven. -->\n\n<!-- stack:begin -->\nkern\n<!-- stack:end -->\n",
    ".github/CODEOWNERS": `/supabase/ @${STAGE_TWO_LOGIN}\n/.github/ @${STAGE_TWO_LOGIN}\n`,
    "stack.config.json": `${JSON.stringify({ $beschrijving: ["uitleg"], database: true }, null, 2)}\n`,
    "supabase/migrations/0001_items.sql": "create table items ();\n",
  });
  return map;
}

test("argumenten: alle vlaggen, en een vlag zonder waarde is een fout", () => {
  const a = leesArgumenten(["--json", "--droogloop", "--naam", "voorraad", "--eigenaar", "Org", "--database", "eigen", "--omschrijving", "Voorraad bijhouden", "--map", "/x"]);
  assert.equal(a.json, true);
  assert.equal(a.droogloop, true);
  assert.equal(a.naam, "voorraad");
  assert.equal(a.eigenaar, "Org");
  assert.equal(a.database, "eigen");
  assert.equal(a.omschrijving, "Voorraad bijhouden");
  assert.equal(a.map, "/x");
  assert.throws(() => leesArgumenten(["--naam"]), /vraagt een waarde/);
  assert.throws(() => leesArgumenten(["--naam", "--json"]), /vraagt een waarde/);
  assert.throws(() => leesArgumenten(["--foo"]), /onbekende optie/);
});

test("naam: kleine letters, cijfers en streepjes; geen hoofdletters, spaties of randstreepjes", () => {
  for (const goed of ["voorraad", "voorraad-app", "app2", "a1"]) assert.equal(geldigeNaam(goed), true, goed);
  for (const fout of ["Voorraad", "voorraad app", "-voorraad", "voorraad-", "", "a", "ä"]) assert.equal(geldigeNaam(fout), false, fout);
});

test("controle: precies één modus; op het Cloudflare-spoor altijd een eigen database", () => {
  const basis = { droogloop: true, doeHet: false, naam: "voorraad", eigenaar: "Org", database: "eigen" };
  assert.equal(controleerArgumenten(basis), null);
  assert.match(controleerArgumenten({ ...basis, doeHet: true }), /precies één/);
  assert.match(controleerArgumenten({ ...basis, droogloop: false }), /precies één/);
  assert.equal(controleerArgumenten({ ...basis, droogloop: false, inrichten: true }), null);
  assert.match(controleerArgumenten({ ...basis, naam: "Voorraad" }), /kleine letters/);
  assert.match(controleerArgumenten({ ...basis, eigenaar: null }), /--eigenaar/);
  assert.match(controleerArgumenten({ ...basis, database: "geen" }), /eigen database/);
  assert.match(controleerArgumenten({ ...basis, database: "gedeeld" }), /eigen database/);
  assert.match(controleerArgumenten({ ...basis, naam: "a".repeat(42) }), /41 tekens/);
  assert.match(controleerArgumenten({ ...basis, groepen: ["Kantoor"] }), /--groepen/);
  assert.equal(controleerArgumenten({ ...basis, groepen: ["kantoor", "it"] }), null);
  assert.equal(leesArgumenten(["--droogloop", "--naam", "x1", "--eigenaar", "Org"]).database, "eigen", "zonder --database: eigen");
  assert.deepEqual(leesArgumenten(["--inrichten", "--naam", "x1", "--eigenaar", "Org", "--groepen", "kantoor, it"]).groepen, ["kantoor", "it"]);
});

test("reviewer: altijd de bouwer zelf, ook als Stage Two lid is", () => {
  assert.equal(kiesReviewer({ login: "bart" }), "bart");
});

test("invullen: projectnaam, omschrijving en reviewer erin, aanwijzingen eruit", () => {
  const map = verseTemplate();
  vulIn(map, { naam: "voorraad", omschrijving: "Zien wat er op voorraad is.", reviewer: "bart" });
  const readme = readFileSync(join(map, "README.md"), "utf8");
  const agents = readFileSync(join(map, "AGENTS.md"), "utf8");
  assert.match(readme, /^# voorraad\n/);
  assert.doesNotMatch(readme, /Vervang/);
  assert.match(readme, /Zien wat er op voorraad is\./);
  assert.match(agents, /^# voorraad\n/);
  assert.match(agents, /Zien wat er op voorraad is\./);
  assert.match(agents, /stack:begin/, "de markeringen blijven staan");
  assert.equal(readFileSync(join(map, ".github/CODEOWNERS"), "utf8"), "/supabase/ @bart\n/.github/ @bart\n");
});

test("invullen: zonder omschrijving blijft de plek staan, en een ontbrekend bestand is een fout", () => {
  const map = verseTemplate();
  vulIn(map, { naam: "voorraad", omschrijving: null, reviewer: STAGE_TWO_LOGIN });
  assert.match(readFileSync(join(map, "AGENTS.md"), "utf8"), /Wat deze app doet/);
  const leeg = tijdelijkeMap("nieuwe-app-leeg-");
  assert.throws(() => vulIn(leeg, { naam: "x", omschrijving: null, reviewer: "x" }), /README.md ontbreekt/);
});

test("databasestand geen: false, migraties weg, uitleg blijft", () => {
  const map = verseTemplate();
  zetDatabaseStand(map, { database: "geen" });
  const config = JSON.parse(readFileSync(join(map, "stack.config.json"), "utf8"));
  assert.equal(config.database, false);
  assert.equal(config.gedeelde_database, undefined);
  assert.deepEqual(config.$beschrijving, ["uitleg"]);
  assert.equal(existsSync(join(map, "supabase/migrations")), false);
});

test("databasestand gedeeld: blok met eigenaar en ref, migraties weg", () => {
  const map = verseTemplate();
  zetDatabaseStand(map, { database: "gedeeld", gedeeldEigenaar: "Org/erp", gedeeldRef: "abcdefghijklmnopqrst" });
  const config = JSON.parse(readFileSync(join(map, "stack.config.json"), "utf8"));
  assert.equal(config.database, "gedeeld");
  assert.deepEqual(config.gedeelde_database, { eigenaar: "Org/erp", project_ref: "abcdefghijklmnopqrst" });
  assert.equal(existsSync(join(map, "supabase/migrations")), false);
});

test("databasestand eigen: true, migraties blijven", () => {
  const map = verseTemplate();
  zetDatabaseStand(map, { database: "eigen" });
  const config = JSON.parse(readFileSync(join(map, "stack.config.json"), "utf8"));
  assert.equal(config.database, true);
  assert.equal(existsSync(join(map, "supabase/migrations/0001_items.sql")), true);
});

test("nog te doen: hosting, deur en database via de beheer-repo, ruleset alleen als die faalde", () => {
  const goed = nogTeDoen({ database: "eigen", ruleset: { gelukt: true } });
  assert.equal(goed.length, 2);
  assert.match(goed[0], /Cloudflare en Supabase/);
  assert.match(goed[1], /Sentry/);
  const open = nogTeDoen({ database: "eigen", ruleset: { gelukt: false } });
  assert.equal(open.length, 3);
  assert.match(open[0], /niet beschermd/);
  for (const regel of [...goed, ...open]) assert.doesNotMatch(regel, /Vercel/);
});

test("inrichting lezen: de laatste INRICHTING-regel uit een logboek met voorvoegsels", () => {
  const log = [
    "inrichten\tCloudflare en Supabase inrichten\t2026-09-22T10:00:00Z ::add-mask::geheim",
    'inrichten\tCloudflare en Supabase inrichten\t2026-09-22T10:00:01Z INRICHTING {"status":"gelukt","worker":"voorraad"}',
    "inrichten\tSamenvatting\t2026-09-22T10:00:02Z klaar",
  ].join("\n");
  assert.deepEqual(leesInrichting(log), { status: "gelukt", worker: "voorraad" });
  assert.equal(leesInrichting("niets hier"), null);
  assert.equal(leesInrichting("INRICHTING {kapot"), null);
});

test("na inrichting: eerste uitrol, waarschuwingen doorgeven, altijd Sentry", () => {
  const kaal = nogTeDoenNaInrichting({ resultaat: { status: "gelukt", waarschuwingen: [] } });
  assert.equal(kaal.length, 2);
  assert.match(kaal[0], /eerste uitrol/);
  const met = nogTeDoenNaInrichting({ resultaat: { status: "gelukt", waarschuwingen: ["geen session pooler"] } });
  assert.equal(met.length, 3);
  assert.match(met[1], /session pooler/);
});

test("toegang.json: staat de app erin, en toevoegen laat de rest precies staan", () => {
  const toegang = {
    $beschrijving: "wie bij welke app mag",
    groepen: { kantoor: { domeinen: ["richplant.nl"] }, it: { adressen: ["it@richplant.nl"] } },
    apps: { oud: ["it"] },
  };
  assert.deepEqual(controleerToegang(toegang, "oud"), { staatErin: true, groepen: ["kantoor", "it"] });
  assert.deepEqual(controleerToegang(toegang, "nieuw"), { staatErin: false, groepen: ["kantoor", "it"] });
  assert.equal(controleerToegang({ groepen: {}, apps: { leeg: [] } }, "leeg").staatErin, false, "een app zonder groep telt niet");
  assert.equal(controleerToegang({}, "x").staatErin, false);
  const na = voegAppToe(toegang, "nieuw", ["kantoor"]);
  assert.deepEqual(na.apps, { oud: ["it"], nieuw: ["kantoor"] });
  assert.equal(na.$beschrijving, toegang.$beschrijving);
  assert.deepEqual(na.groepen, toegang.groepen);
  assert.deepEqual(toegang.apps, { oud: ["it"] }, "het origineel blijft onaangeroerd");
});

test("Worker-naam: de naam op het bovenste niveau wordt de appnaam, de rest blijft staan", () => {
  const map = tijdelijkeMap("worker-naam-");
  const voor = '{\n  "$schema": "node_modules/wrangler/config-schema.json",\n  // de proef-Worker\n  "name": "cf-proef",\n  "compatibility_date": "2026-09-01",\n  "env": { "x": {\n    "name": "binnen"\n  } }\n}\n';
  schrijfBestanden(map, { "wrangler.jsonc": voor });
  zetWorkerNaam(map, "richplant-start");
  const na = readFileSync(join(map, "wrangler.jsonc"), "utf8");
  assert.match(na, /^ {2}"name": "richplant-start",$/m);
  assert.match(na, /"name": "binnen"/, "een geneste name blijft staan");
  assert.equal(na.replace("richplant-start", "cf-proef"), voor);
  const leeg = tijdelijkeMap("worker-naam-");
  assert.throws(() => zetWorkerNaam(leeg, "x1"), /wrangler.jsonc ontbreekt/);
  schrijfBestanden(leeg, { "wrangler.jsonc": "{}\n" });
  assert.throws(() => zetWorkerNaam(leeg, "x1"), /"name"/);
});

test("nietMeenemen: beheer/ en de proef-workflows gaan weg, de rest blijft", () => {
  const map = tijdelijkeMap("niet-meenemen-");
  schrijfBestanden(map, {
    ".claude/stack-manifest.json": JSON.stringify({ nietMeenemen: ["beheer/**", ".github/workflows/proef-*.yml", "../buiten", "bestaat-niet.txt"] }),
    "beheer/inrichten-cloudflare.mjs": "x",
    "beheer/lib/cloudflare.mjs": "x",
    ".github/workflows/proef-inrichten.yml": "x",
    ".github/workflows/proef-toegang.yml": "x",
    ".github/workflows/ci.yml": "x",
    ".github/workflows/uitrollen.yml": "x",
    "src/main.tsx": "x",
  });
  const weg = verwijderNietMeenemen(map);
  assert.deepEqual(weg.sort(), [".github/workflows/proef-inrichten.yml", ".github/workflows/proef-toegang.yml", "beheer/**"]);
  assert.ok(!existsSync(join(map, "beheer")));
  assert.ok(!existsSync(join(map, ".github/workflows/proef-toegang.yml")));
  for (const blijft of [".github/workflows/ci.yml", ".github/workflows/uitrollen.yml", "src/main.tsx", ".claude/stack-manifest.json"]) {
    assert.ok(existsSync(join(map, blijft)), blijft);
  }
  assert.deepEqual(verwijderNietMeenemen(tijdelijkeMap("geen-manifest-")), [], "zonder manifest: niets");
});

test("foutTekst: de hele melding, niet alleen de eerste regel, en hooguit de staart", () => {
  const fout = Object.assign(new Error("Command failed: pnpm install"), {
    stderr: "ERR_PNPM_X  Could not resolve the installed @pnpm/exe at C:\\Users\\bob\\AppData\\Local\\pnpm\n\nDetails: EPERM\n",
  });
  const tekst = foutTekst(fout);
  assert.match(tekst, /C:\\Users\\bob/);
  assert.match(tekst, /Details: EPERM/);
  const lang = { stderr: Array.from({ length: 60 }, (_, i) => `regel ${i + 1}`).join("\n") };
  const staart = foutTekst(lang, 40).split("\n");
  assert.equal(staart[0], "…");
  assert.equal(staart.at(-1), "regel 60");
  assert.equal(staart.length, 41);
  assert.equal(foutTekst(new Error("alleen een bericht")), "alleen een bericht");
});

test("installeer: eerst pnpm --version, en bij een fout de install nog één keer", () => {
  const aanroepen = [];
  let fouten = 1;
  const run = (...args) => {
    aanroepen.push(args.join(" "));
    if (args[0] === "install" && fouten-- > 0) throw new Error("versiewissel mislukt");
    return "";
  };
  assert.deepEqual(installeer("/x", { run }), { pogingen: 2 });
  assert.deepEqual(aanroepen, ["--version", "install --silent", "install --silent"]);

  const goed = [];
  assert.deepEqual(installeer("/x", { run: (...a) => goed.push(a.join(" ")) }), { pogingen: 1 });
  assert.deepEqual(goed, ["--version", "install --silent"]);

  assert.throws(() => installeer("/x", { run: (a) => { if (a === "install") throw new Error("kapot"); } }), /kapot/);
});

test("hervatBesluit: nieuw, hervatten, of weigeren als het niet van ons is", () => {
  assert.equal(hervatBesluit({ repo: false, map: false }).besluit, "nieuw");
  assert.equal(hervatBesluit({ repo: true, uitTemplate: true, map: false }).besluit, "hervat");
  assert.equal(hervatBesluit({ repo: true, uitTemplate: true, map: true, mapIsKloon: true }).besluit, "hervat");
  assert.equal(hervatBesluit({ repo: true, uitTemplate: false, map: false }).besluit, "weiger");
  assert.equal(hervatBesluit({ repo: true, uitTemplate: true, map: true, mapIsKloon: false }).besluit, "weiger");
  assert.equal(hervatBesluit({ repo: false, map: true }).besluit, "weiger");
});

function nepGitHub(beginstand) {
  const omgevingen = structuredClone(beginstand);
  let volgendId = 100;
  const log = [];
  const api = (methode, pad, velden = {}) => {
    log.push(`${methode} ${pad}`);
    const m = /environments(?:\/([^/?]+))?(?:\/(deployment-branch-policies|secrets)(?:\/(\d+))?)?/.exec(pad);
    const [, naam, sub, id] = m;
    if (!naam) return { environments: Object.keys(omgevingen).map((n) => ({ name: n })) };
    if (methode === "PUT" && !sub) {
      omgevingen[naam] ??= { regels: [], geheimen: 0 };
      omgevingen[naam].beperkt = velden["deployment_branch_policy[custom_branch_policies]"] === true;
      return {};
    }
    if (methode === "DELETE" && !sub) {
      delete omgevingen[naam];
      return null;
    }
    if (sub === "secrets") return { total_count: omgevingen[naam].geheimen };
    if (methode === "GET") return { branch_policies: omgevingen[naam].regels };
    if (methode === "POST") {
      omgevingen[naam].regels.push({ id: volgendId++, name: velden.name, type: velden.type });
      return {};
    }
    if (methode === "DELETE") {
      omgevingen[naam].regels = omgevingen[naam].regels.filter((r) => r.id !== Number(id));
      return null;
    }
    throw new Error(`onverwacht: ${methode} ${pad}`);
  };
  return { api, omgevingen, log };
}

test("regelOmgevingen: production en preview alleen main, lege proef-beheer weg", () => {
  // Zo trof App inrichten het bij Bob aan: drie omgevingen, geen enkele beperkt.
  const gh = nepGitHub({
    production: { regels: [], geheimen: 0 },
    preview: { regels: [{ id: 1, name: "*", type: "branch" }], geheimen: 0 },
    "proef-beheer": { regels: [], geheimen: 0 },
  });
  const gedaan = regelOmgevingen("Org/app", { api: gh.api });
  for (const naam of ["production", "preview"]) {
    assert.equal(gh.omgevingen[naam].beperkt, true);
    assert.deepEqual(gh.omgevingen[naam].regels.map((r) => r.name), ["main"]);
  }
  assert.equal(gh.omgevingen["proef-beheer"], undefined);
  assert.ok(gedaan.includes("proef-beheer: weg (leeg)"));

  // Nog een keer draaien verandert niets en voegt main niet dubbel toe.
  regelOmgevingen("Org/app", { api: gh.api });
  assert.deepEqual(gh.omgevingen.production.regels.map((r) => r.name), ["main"]);
});

test("regelOmgevingen: maakt ontbrekende omgevingen aan en laat een proef-beheer met geheimen staan", () => {
  const gh = nepGitHub({ "proef-beheer": { regels: [], geheimen: 2 } });
  const gedaan = regelOmgevingen("Org/app", { api: gh.api });
  assert.deepEqual(gh.omgevingen.production.regels.map((r) => r.name), ["main"]);
  assert.deepEqual(gh.omgevingen.preview.regels.map((r) => r.name), ["main"]);
  assert.ok(gh.omgevingen["proef-beheer"]);
  assert.ok(gedaan.some((g) => g.startsWith("proef-beheer: blijft")));
});
