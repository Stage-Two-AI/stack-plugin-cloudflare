import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  alleBestanden,
  appBestanden,
  maakMappen,
  nepGit,
  nepPnpm,
  opruimen,
  schrijfBestanden,
  templateBestanden,
} from "./test-hulp.mjs";
import { pasToe } from "./toepassen.mjs";

function opzet(opties = {}) {
  const p = maakMappen(opties);
  const gitCb = nepGit({ map: p.app, opTag: { "stack-v8": p.tmpl8, ...(opties.zonderTag8 ? { "stack-v8": undefined } : {}) } });
  return { ...p, git: gitCb, voor: alleBestanden(p.app) };
}

test("happy path: van 8 naar 9, alleen de templatebestanden, status bijgewerkt", () => {
  const o = opzet();
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt", r.reden);
    assert.equal(r.van, 8);
    assert.equal(r.naar, 9);
    const paden = r.bijgewerkt.map((b) => b.pad).sort();
    assert.deepEqual(paden, [
      ".claude/stack-manifest.json",
      ".claude/stack-version",
      ".github/workflows/ci.yml",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "pnpm-lock.yaml",
      "scripts/guard-nieuw.mjs",
    ]);
    assert.deepEqual(r.verwijderd, ["scripts/guard-oud.mjs"]);
    assert.deepEqual(r.overgeslagen, []);
    assert.equal(readFileSync(join(o.app, ".claude/stack-version"), "utf8").trim(), "9");
    // AGENTS.md: alleen tussen de markeringen; de projectkop blijft.
    const agents = readFileSync(join(o.app, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith("# Mijn app\nEen app voor de kwekerij.\n"));
    assert.ok(agents.includes("Afspraken versie 9"));
    // package.json: scripts van de template winnen, eigen script blijft, devDependencies samengevoegd.
    const pkg = JSON.parse(readFileSync(join(o.app, "package.json"), "utf8"));
    assert.equal(pkg.name, "mijn-app");
    assert.equal(pkg.scripts.check, "pnpm test && pnpm guard");
    assert.equal(pkg.scripts.eigen, "echo hoi");
    assert.deepEqual(pkg.devDependencies, { biome: "^2.1.0", eigen: "1.0.0", vitest: "^3.2.0" });
    // Projectbestanden onaangeroerd.
    const na = alleBestanden(o.app);
    assert.equal(na["src/App.tsx"], o.voor["src/App.tsx"]);
    assert.equal(na["README.md"], o.voor["README.md"]);
    assert.ok(!existsSync(join(o.app, "scripts/guard-oud.mjs")));
    assert.ok(existsSync(join(o.app, "scripts/guard-nieuw.mjs")));
  } finally {
    opruimen(o.wortel);
  }
});

test("afwijking: een lokaal aangepast templatebestand blijft staan en wordt gemeld", () => {
  const o = opzet();
  try {
    writeFileSync(join(o.app, "CLAUDE.md"), "@AGENTS.md\n<!-- hier heeft iemand aan gezeten -->\n");
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt");
    assert.deepEqual(r.overgeslagen.map((s) => s.pad), ["CLAUDE.md"]);
    assert.match(r.overgeslagen[0].reden, /versie 8/);
    assert.ok(readFileSync(join(o.app, "CLAUDE.md"), "utf8").includes("hier heeft iemand aan gezeten"));
    assert.ok(!r.bijgewerkt.some((b) => b.pad === "CLAUDE.md"));
  } finally {
    opruimen(o.wortel);
  }
});

test("een Dependabot-bump van een Action-pin is geen afwijking en de nieuwere pin blijft", () => {
  const o = opzet();
  try {
    const ci = join(o.app, ".github/workflows/ci.yml");
    writeFileSync(ci, readFileSync(ci, "utf8").replace("checkout@v5", "checkout@v7"));
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt");
    assert.deepEqual(r.overgeslagen, []);
    const nieuw = readFileSync(ci, "utf8");
    assert.ok(nieuw.includes("checkout@v7"));
    assert.ok(nieuw.includes("versie 9"));
  } finally {
    opruimen(o.wortel);
  }
});

test("ontbrekende vorige versie: geen tag stack-v8, dus gestopt en niets geschreven", () => {
  const o = opzet();
  try {
    const git = nepGit({ map: o.app, opTag: {} });
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "gestopt");
    assert.match(r.reden, /stack-v8/);
    assert.deepEqual(alleBestanden(o.app), o.voor);
  } finally {
    opruimen(o.wortel);
  }
});

test("manifestformaat: nieuwer dan de plugin kent is gestopt, ontbrekend telt als 1", () => {
  const o = opzet({ template9: templateBestanden(9, { manifestFormaat: 2 }) });
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "gestopt");
    assert.match(r.reden, /werk de plugin bij/);
    assert.deepEqual(alleBestanden(o.app), o.voor);
  } finally {
    opruimen(o.wortel);
  }
  const p = opzet({ template9: templateBestanden(9, { manifestFormaat: 1 }) });
  try {
    assert.equal(pasToe({ map: p.app, tmplMap: p.tmpl9, git: p.git, pnpm: nepPnpm.aanwezig }).status, "bijgewerkt");
  } finally {
    opruimen(p.wortel);
  }
});

test("lockfile: een gewijzigde package.json berekent pnpm-lock.yaml opnieuw; zonder pnpm gestopt", () => {
  const o = opzet();
  try {
    const voor = readFileSync(join(o.app, "pnpm-lock.yaml"), "utf8");
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt");
    assert.notEqual(readFileSync(join(o.app, "pnpm-lock.yaml"), "utf8"), voor);
    assert.ok(r.gewijzigd.includes("pnpm-lock.yaml"));
  } finally {
    opruimen(o.wortel);
  }
  const p = opzet();
  try {
    const r = pasToe({ map: p.app, tmplMap: p.tmpl9, git: p.git, pnpm: nepPnpm.afwezig });
    assert.equal(r.status, "gestopt");
    assert.match(r.reden, /installeer pnpm/);
  } finally {
    opruimen(p.wortel);
  }
});

test("package.json onveranderd (template zonder nieuwe sleutels): geen lockfile-stap", () => {
  const app = appBestanden();
  const t9 = templateBestanden(9);
  const o = opzet({
    app: { ...app, "package.json": t9["package.json"].replace('"template"', '"mijn-app"') },
  });
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.afwezig });
    assert.equal(r.status, "bijgewerkt", r.reden);
    assert.ok(!r.bijgewerkt.some((b) => b.pad === "pnpm-lock.yaml"));
  } finally {
    opruimen(o.wortel);
  }
});

test("buiten het manifest: zou er iets anders wijzigen, dan gestopt met dat pad", () => {
  const o = opzet();
  try {
    const git = { ...o.git, gewijzigd: () => [...o.git.gewijzigd(), "src/App.tsx"] };
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "gestopt");
    assert.deepEqual(r.buitenManifest, ["src/App.tsx"]);
  } finally {
    opruimen(o.wortel);
  }
});

test("geen versienummer in de werkkopie: status geen-template, niets geschreven", () => {
  const o = opzet();
  try {
    const { ".claude/stack-version": _, ...zonder } = appBestanden();
    const p = maakMappen({ app: zonder });
    const voor = alleBestanden(p.app);
    const r = pasToe({ map: p.app, tmplMap: p.tmpl9, git: nepGit({ map: p.app, opTag: {} }), pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "geen-template");
    assert.deepEqual(alleBestanden(p.app), voor);
    opruimen(p.wortel);
  } finally {
    opruimen(o.wortel);
  }
});

test("al bij: versie gelijk aan de doelversie, niets geschreven", () => {
  const o = opzet();
  try {
    schrijfBestanden(o.app, { ".claude/stack-version": "9\n" });
    const voor = alleBestanden(o.app);
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bij");
    assert.deepEqual(alleBestanden(o.app), voor);
  } finally {
    opruimen(o.wortel);
  }
});

test("markeringen ontbreken in het projectbestand: overgeslagen met reden, rest gaat door", () => {
  const o = opzet();
  try {
    writeFileSync(join(o.app, "AGENTS.md"), "# Mijn app zonder markeringen\n");
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt");
    assert.deepEqual(r.overgeslagen.map((s) => s.pad), ["AGENTS.md"]);
    assert.match(r.overgeslagen[0].reden, /stack:begin/);
  } finally {
    opruimen(o.wortel);
  }
});

test("eigen bestand op een pad dat nieuw is in de template: overgeslagen, niet overschreven", () => {
  const o = opzet({ app: { ...appBestanden(), "scripts/guard-nieuw.mjs": "// van de klant\n" } });
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt", r.reden);
    assert.deepEqual(r.overgeslagen.map((s) => s.pad), ["scripts/guard-nieuw.mjs"]);
    assert.match(r.overgeslagen[0].reden, /eigen bestand/);
    assert.equal(readFileSync(join(o.app, "scripts/guard-nieuw.mjs"), "utf8"), "// van de klant\n");
    assert.ok(!r.bijgewerkt.some((b) => b.pad === "scripts/guard-nieuw.mjs"));
  } finally {
    opruimen(o.wortel);
  }
});

test("eigen bestand dat al gelijk is aan het nieuwe templatebestand: niets te melden", () => {
  const o = opzet({ app: { ...appBestanden(), "scripts/guard-nieuw.mjs": templateBestanden(9)["scripts/guard-nieuw.mjs"] } });
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt", r.reden);
    assert.deepEqual(r.overgeslagen, []);
    assert.ok(!r.bijgewerkt.some((b) => b.pad === "scripts/guard-nieuw.mjs"));
  } finally {
    opruimen(o.wortel);
  }
});

test("van vervangen naar vanHetProject verhuisd: het bestand blijft staan en wordt niet verwijderd", () => {
  const o = opzet();
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt", r.reden);
    assert.ok(!r.verwijderd.includes("docs/WERKWIJZE.md"));
    assert.ok(!r.bijgewerkt.some((b) => b.pad === "docs/WERKWIJZE.md"));
    assert.equal(readFileSync(join(o.app, "docs/WERKWIJZE.md"), "utf8"), o.voor["docs/WERKWIJZE.md"]);
    // Wat de template op versie 9 echt niet meer heeft, gaat wel weg.
    assert.deepEqual(r.verwijderd, ["scripts/guard-oud.mjs"]);
  } finally {
    opruimen(o.wortel);
  }
});

test("markeringenbestand verhuisd (AGENTS.md naar DOCS.md): het projectdeel gaat mee", () => {
  const o = opzet({ template9: templateBestanden(9, {}, { markeringenPad: "DOCS.md" }) });
  try {
    const r = pasToe({ map: o.app, tmplMap: o.tmpl9, git: o.git, pnpm: nepPnpm.aanwezig });
    assert.equal(r.status, "bijgewerkt", r.reden);
    const docs = readFileSync(join(o.app, "DOCS.md"), "utf8");
    assert.ok(docs.startsWith("# Mijn app\nEen app voor de kwekerij.\n"));
    assert.ok(docs.includes("<!-- stack:begin -->\nAfspraken versie 9\n<!-- stack:end -->"));
    const verhuisd = r.bijgewerkt.find((b) => b.pad === "DOCS.md");
    assert.ok(verhuisd?.hoe.startsWith("nieuw; projectdeel verhuisd uit AGENTS.md"), JSON.stringify(r.bijgewerkt));
    assert.deepEqual(r.overgeslagen, []);
    // Het oude bestand staat in geen enkele lijst van het nieuwe manifest en blijft dus onaangeroerd.
    assert.equal(readFileSync(join(o.app, "AGENTS.md"), "utf8"), o.voor["AGENTS.md"]);
    assert.ok(!r.bijgewerkt.some((b) => b.pad === "AGENTS.md"));
  } finally {
    opruimen(o.wortel);
  }
});
