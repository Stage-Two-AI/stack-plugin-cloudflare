/**
 * Tests voor de hook van de plugin (U3 en U4): de zuivere regels uit regels.mjs, de
 * parser en de netwerkvraag uit versie-op-afstand.mjs (met een exec-stub, dus zonder
 * netwerk), en de hook zelf als proces met een tijdelijke projectmap.
 *
 * De hook krijgt in de procestests STACK_VERSIE_OP_AFSTAND_TEST mee, de testhaak die de
 * netwerkvraag vervangt (zie stack-hook.mjs), zodat geen enkel scenario GitHub raakt.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASH_REGELS,
  BESCHERMDE_PREFIXEN,
  MATCHER,
  MIGRATIE_CONTEXT,
  beoordeelStart,
  beoordeelTool,
  beschermdePaden,
  moetControleren,
  normaliseerPad,
  stempelNaam,
} from "./regels.mjs";
import { hoogsteStackVersie, versieOpAfstand } from "./versie-op-afstand.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HIER, "stack-hook.mjs");
const PROJECT = "/home/klant/app";

// Een verkleinde kopie van .claude/stack-manifest.json uit de template (versie 9-vorm,
// met manifestFormaat), zodat de tests niet afhangen van een checkout van de template.
const MANIFEST = {
  manifestFormaat: 1,
  variant: "cloudflare",
  stackVersion: 9,
  vanDeTemplate: {
    vervangen: [
      ".claude/settings.json",
      ".claude/stack-manifest.json",
      ".claude/stack-version",
      "CLAUDE.md",
      ".github/workflows/ci.yml",
      ".github/workflows/deploy-db.yml",
      ".github/pull_request_template.md",
      "scripts/guard-template.mjs",
      "scripts/dev.mjs",
      "docs/WERKWIJZE.md",
      "docs/routes/verder-werken.md",
      "biome.json",
    ],
    sleutelsSamenvoegen: { "package.json": ["scripts", "devDependencies"] },
    tussenMarkeringen: { "AGENTS.md": "stack" },
  },
  vanHetProject: ["src/**", ".github/CODEOWNERS", "README.md"],
};

const TOE = { weiger: false, reden: null };
const bewerk = (file_path, extra = {}) =>
  beoordeelTool({ projectmap: PROJECT, manifest: MANIFEST, toolName: "Edit", toolInput: { file_path }, ...extra });
const bash = (command, env = {}) =>
  beoordeelTool({ projectmap: PROJECT, manifest: MANIFEST, toolName: "Bash", toolInput: { command }, env });

function geweigerd(uit, ...fragmenten) {
  assert.equal(uit.weiger, true, "hoort geweigerd te zijn");
  assert.equal(typeof uit.reden, "string");
  for (const f of fragmenten) assert.ok(uit.reden.includes(f), `reden hoort "${f}" te bevatten, maar is:\n${uit.reden}`);
  assert.doesNotMatch(uit.reden, /\u2014/, "geen em-dashes in klantgerichte tekst");
}

// ---------------------------------------------------------------- BASH_REGELS en matcher

test("regels: BASH_REGELS zijn de vier regels uit guard.mjs, met patroon, tenzij en reden", () => {
  assert.equal(BASH_REGELS.length, 4);
  for (const r of BASH_REGELS) {
    assert.ok(r.patroon instanceof RegExp);
    assert.equal(typeof r.reden, "string");
    assert.doesNotMatch(r.reden, /\u2014/);
  }
  assert.equal(typeof BASH_REGELS[0].tenzij, "function");
});

test("regels: de matcher noemt precies de gereedschappen die de hook beoordeelt", () => {
  assert.equal(MATCHER, "Edit|Write|MultiEdit|NotebookEdit|Bash");
});

// ---------------------------------------------------------------- beschermdePaden

test("paden: exact = vervangen plus .github/CODEOWNERS; prefixen = workflows en .claude", () => {
  const { exact, prefixen } = beschermdePaden(MANIFEST);
  assert.ok(exact.has(".github/workflows/ci.yml"));
  assert.ok(exact.has("biome.json"));
  assert.ok(exact.has("docs/routes/verder-werken.md"));
  assert.ok(exact.has(".github/CODEOWNERS"));
  assert.ok(!exact.has("AGENTS.md"), "markeringsbestand: het projectdeel mag bewerkt worden");
  assert.ok(!exact.has("package.json"), "sleutelsbestand: het projectdeel mag bewerkt worden");
  assert.deepEqual(prefixen, [".github/workflows/", ".claude/"]);
  assert.deepEqual(BESCHERMDE_PREFIXEN, [".github/workflows/", ".claude/"]);
});

test("paden: een manifest zonder vervangen-lijst geeft alleen CODEOWNERS en de prefixen", () => {
  const { exact } = beschermdePaden({ vanDeTemplate: {} });
  assert.deepEqual([...exact], [".github/CODEOWNERS"]);
  assert.deepEqual([...beschermdePaden(null).exact], [".github/CODEOWNERS"]);
});

// ---------------------------------------------------------------- normaliseerPad

test("pad: relatief, absoluut en met backslashes komt alles uit op hetzelfde relatieve pad", () => {
  assert.equal(normaliseerPad(PROJECT, ".github/workflows/ci.yml"), ".github/workflows/ci.yml");
  assert.equal(normaliseerPad(PROJECT, "./.github/workflows/ci.yml"), ".github/workflows/ci.yml");
  assert.equal(normaliseerPad(PROJECT, `${PROJECT}/.github/workflows/ci.yml`), ".github/workflows/ci.yml");
  assert.equal(normaliseerPad(`${PROJECT}/`, `${PROJECT}/src/App.tsx`), "src/App.tsx");
  assert.equal(normaliseerPad(PROJECT, ".github\\workflows\\ci.yml"), ".github/workflows/ci.yml");
  assert.equal(normaliseerPad("C:\\Users\\klant\\app", "C:\\Users\\klant\\app\\biome.json"), "biome.json");
  assert.equal(normaliseerPad(PROJECT, "src/../biome.json"), "biome.json");
});

test("pad: buiten de projectmap telt als buiten (null)", () => {
  assert.equal(normaliseerPad(PROJECT, "../ander/biome.json"), null);
  assert.equal(normaliseerPad(PROJECT, "/home/klant/ander/biome.json"), null);
  assert.equal(normaliseerPad(PROJECT, "/home/klant/app-2/biome.json"), null, "geen prefix-verwarring tussen app en app-2");
  assert.equal(normaliseerPad(PROJECT, ".."), null);
  assert.equal(normaliseerPad(PROJECT, ""), null);
  assert.equal(normaliseerPad(PROJECT, 42), null);
});

// ---------------------------------------------------------------- beoordeelTool: paden

test("tool: Edit van .github/workflows/ci.yml wordt geweigerd en de reden noemt /stack-cloudflare:updaten", () => {
  geweigerd(bewerk(".github/workflows/ci.yml"), "/stack-cloudflare:updaten", ".github/workflows/ci.yml", "Stage Two", "guard:template");
});

test("tool: src/App.tsx, AGENTS.md en package.json zijn toegestaan", () => {
  assert.deepEqual(bewerk("src/App.tsx"), TOE);
  assert.deepEqual(bewerk(`${PROJECT}/src/App.tsx`), TOE);
  assert.deepEqual(bewerk("AGENTS.md"), TOE);
  assert.deepEqual(bewerk("package.json"), TOE);
  assert.deepEqual(bewerk("README.md"), TOE);
});

test("tool: .github/CODEOWNERS wordt geweigerd, ook al staat het in vanHetProject", () => {
  geweigerd(bewerk(".github/CODEOWNERS"), ".github/CODEOWNERS");
});

test("tool: nieuwe bestanden onder de prefixen zijn geweigerd, een nieuw routebestand niet", () => {
  geweigerd(bewerk(".github/workflows/nachtwerk.yml"), ".github/workflows/nachtwerk.yml");
  geweigerd(bewerk(".claude/hooks/x.mjs"), ".claude/hooks/x.mjs");
  assert.deepEqual(bewerk("docs/routes/eigen.md"), TOE);
  assert.deepEqual(bewerk(".githubby/workflows/x.yml"), TOE, "prefix is een mapgrens, geen tekstbegin");
});

test("tool: Write, MultiEdit en NotebookEdit worden op hun padveld beoordeeld", () => {
  const t = (toolName, toolInput) => beoordeelTool({ projectmap: PROJECT, manifest: MANIFEST, toolName, toolInput });
  geweigerd(t("Write", { file_path: "biome.json", content: "{}" }), "biome.json");
  geweigerd(t("MultiEdit", { file_path: "CLAUDE.md", edits: [] }), "CLAUDE.md");
  geweigerd(t("NotebookEdit", { notebook_path: ".claude/proef.ipynb" }), ".claude/proef.ipynb");
  assert.deepEqual(t("NotebookEdit", { notebook_path: "notebooks/proef.ipynb" }), TOE);
  assert.deepEqual(t("Read", { file_path: "biome.json" }), TOE, "buiten de matcher: niet beoordeeld");
});

test("tool: een Windows-pad met backslashes wordt genormaliseerd en geweigerd", () => {
  geweigerd(bewerk(".github\\workflows\\ci.yml"), ".github/workflows/ci.yml");
  const uit = beoordeelTool({
    projectmap: "C:\\Users\\klant\\app",
    manifest: MANIFEST,
    toolName: "Edit",
    toolInput: { file_path: "C:\\Users\\klant\\app\\.github\\workflows\\ci.yml" },
  });
  geweigerd(uit, ".github/workflows/ci.yml");
});

test("tool: een pad met .. buiten de projectmap is toegestaan (buiten is niet beschermd)", () => {
  assert.deepEqual(bewerk("../ander/.github/workflows/ci.yml"), TOE);
  assert.deepEqual(bewerk("/ergens/anders/biome.json"), TOE);
});

test("tool: een absoluut pad binnen de projectmap wordt juist herkend", () => {
  geweigerd(bewerk(`${PROJECT}/biome.json`), "biome.json");
  geweigerd(bewerk(`${PROJECT}/src/../biome.json`), "biome.json");
  assert.deepEqual(bewerk(`${PROJECT}/src/biome.json`), TOE);
});

test("tool: STACK_ALLOW_POLICY_EDIT=1 laat padbewerkingen door, maar niet de Bash-regels", () => {
  const env = { STACK_ALLOW_POLICY_EDIT: "1" };
  assert.deepEqual(bewerk(".github/workflows/ci.yml", { env }), TOE);
  assert.deepEqual(bewerk(".claude/hooks/x.mjs", { env }), TOE);
  geweigerd(bash("git push --force", env), "Force pushen");
  geweigerd(bewerk(".github/workflows/ci.yml", { env: { STACK_ALLOW_POLICY_EDIT: "0" } }), "/stack-cloudflare:updaten");
});

test("tool: zonder manifest wordt nooit geweigerd (AE7)", () => {
  const t = (toolName, toolInput) => beoordeelTool({ projectmap: PROJECT, manifest: null, toolName, toolInput });
  assert.deepEqual(t("Edit", { file_path: ".github/workflows/ci.yml" }), TOE);
  assert.deepEqual(t("Bash", { command: "git push --force" }), TOE);
  assert.deepEqual(t("Bash", { command: "pnpm dev" }), TOE);
});

test("tool: kapotte invoer is een no-op", () => {
  const t = (toolName, toolInput) => beoordeelTool({ projectmap: PROJECT, manifest: MANIFEST, toolName, toolInput });
  assert.deepEqual(t("Edit", {}), TOE);
  assert.deepEqual(t("Edit", null), TOE);
  assert.deepEqual(t("Edit", { file_path: 12 }), TOE);
  assert.deepEqual(t("Bash", { command: 12 }), TOE);
  assert.deepEqual(t(undefined, undefined), TOE);
  assert.deepEqual(beoordeelTool({ projectmap: "", manifest: MANIFEST, toolName: "Edit", toolInput: { file_path: "biome.json" } }), TOE);
});

// ---------------------------------------------------------------- beoordeelTool: Bash

test("bash: pnpm dev zonder STACK_ALLOW_DEV=1 geweigerd, met toegestaan", () => {
  geweigerd(bash("pnpm dev"), "Geen dev-server", "STACK_ALLOW_DEV=1");
  geweigerd(bash("npm run dev"), "Geen dev-server");
  geweigerd(bash("vite"), "Geen dev-server");
  assert.deepEqual(bash("STACK_ALLOW_DEV=1 pnpm dev"), TOE);
  assert.deepEqual(bash("pnpm dev", { STACK_ALLOW_DEV: "1" }), TOE);
  assert.deepEqual(bash("vite build"), TOE);
  assert.deepEqual(bash("pnpm test"), TOE);
});

test("bash: git push --force en git push origin main worden geweigerd", () => {
  geweigerd(bash("git push --force"), "Force pushen");
  geweigerd(bash("git push --force-with-lease origin feat"), "Force pushen");
  geweigerd(bash("git push -f"), "Force pushen");
  geweigerd(bash("git push origin main"), "Rechtstreeks naar main");
  geweigerd(bash("git push origin HEAD:master"), "Rechtstreeks naar main");
  assert.deepEqual(bash("git push -u origin feat/x"), TOE);
  assert.deepEqual(bash("git push"), TOE);
});

test("bash: deploy-commando's worden geweigerd", () => {
  geweigerd(bash("vercel deploy"), "Niet met de hand deployen");
  geweigerd(bash("vercel --prod"), "Niet met de hand deployen");
  geweigerd(bash("pnpm exec wrangler deploy"), "Niet met de hand deployen");
  geweigerd(bash("npx wrangler versions upload"), "Niet met de hand deployen");
  geweigerd(bash("supabase db push"), "Niet met de hand deployen");
  geweigerd(bash("wrangler deploy"), "Niet met de hand deployen");
  assert.deepEqual(bash("pnpm db:start && pnpm db:reset"), TOE);
});

// ---------------------------------------------------------------- het skillcommando door de sessiehook van claudecode

const SESSIE_REGELS = "/home/claude/stack/machines/claudecode/hooks/sessie-check-regels.mjs";

test(
  "sessie-check: het commando van /stack-cloudflare:updaten gaat door de sessiehook van claudecode vanuit een klantmap",
  { skip: !existsSync(SESSIE_REGELS) && "Stack-checkout niet aanwezig op deze machine" },
  async () => {
    const { beoordeelTool: sessieBeoordeelTool } = await import(SESSIE_REGELS);
    const uit = sessieBeoordeelTool({
      cwd: "/home/claude/src/github.com/klantorg/app",
      home: "/home/claude",
      toolName: "Bash",
      toolInput: { command: 'node "${CLAUDE_SKILL_DIR}/scripts/bijwerken.mjs" --json --droogloop' },
    });
    assert.equal(uit.weiger, false, uit.reden ?? "");
  },
);

// ---------------------------------------------------------------- moetControleren en beoordeelStart

const NU = new Date("2026-09-19T10:00:00Z");
const uur = (n) => new Date(NU.getTime() - n * 3600 * 1000).toISOString();

test("start: zonder stempel, met een kapotte stempel of na 24 uur moet er gekeken worden", () => {
  assert.equal(moetControleren({ stempel: null, nu: NU }), true);
  assert.equal(moetControleren({ stempel: {}, nu: NU }), true);
  assert.equal(moetControleren({ stempel: { tijdstip: "gisteren" }, nu: NU }), true);
  assert.equal(moetControleren({ stempel: { tijdstip: uur(24) }, nu: NU }), true);
  assert.equal(moetControleren({ stempel: { tijdstip: uur(30) }, nu: NU }), true);
});

test("start: binnen 24 uur na de vorige controle wordt niet gekeken", () => {
  assert.equal(moetControleren({ stempel: { tijdstip: uur(1) }, nu: NU }), false);
  assert.equal(moetControleren({ stempel: { tijdstip: uur(23.9) }, nu: NU }), false);
  assert.equal(moetControleren({ stempel: { tijdstip: NU.toISOString() }, nu: NU }), false);
});

test("start: lokaal 9, op afstand 10, geen stempel: melding met beide nummers en /stack-cloudflare:updaten, plus stempel", () => {
  const { melding, nieuweStempel } = beoordeelStart({ versieLokaal: 9, versieOpAfstand: 10, stempel: null, nu: NU });
  assert.ok(melding);
  assert.match(melding, /versie 9/);
  assert.match(melding, /versie 10/);
  assert.match(melding, /\/stack-cloudflare:updaten/);
  assert.match(melding, /niet uit zonder dat/);
  assert.doesNotMatch(melding, /\u2014/);
  assert.deepEqual(nieuweStempel, { versieOpAfstand: 10, tijdstip: NU.toISOString() });
});

test("start: lokaal gelijk aan of hoger dan op afstand: geen melding, wel een stempel", () => {
  assert.deepEqual(beoordeelStart({ versieLokaal: 10, versieOpAfstand: 10, stempel: null, nu: NU }), {
    melding: null,
    nieuweStempel: { versieOpAfstand: 10, tijdstip: NU.toISOString() },
  });
  assert.equal(beoordeelStart({ versieLokaal: 11, versieOpAfstand: 10, stempel: null, nu: NU }).melding, null);
});

test("start: zonder lokale versie of zonder versie op afstand: geen melding, geen stempel", () => {
  const niets = { melding: null, nieuweStempel: null };
  assert.deepEqual(beoordeelStart({ versieLokaal: null, versieOpAfstand: 10, stempel: null, nu: NU }), niets);
  assert.deepEqual(beoordeelStart({ versieLokaal: 9, versieOpAfstand: null, stempel: null, nu: NU }), niets);
  assert.deepEqual(beoordeelStart({ versieLokaal: "9", versieOpAfstand: 10, stempel: null, nu: NU }), niets);
  assert.deepEqual(beoordeelStart({ versieLokaal: 9, versieOpAfstand: Number.NaN, stempel: null, nu: NU }), niets);
});

test("start: binnen 24 uur na de vorige controle: geen melding en geen nieuwe stempel", () => {
  const stempel = { versieOpAfstand: 10, tijdstip: uur(2) };
  assert.deepEqual(beoordeelStart({ versieLokaal: 9, versieOpAfstand: 10, stempel, nu: NU }), { melding: null, nieuweStempel: null });
});

// ---------------------------------------------------------------- stempelNaam

test("stempel: eigenaar en repo uit de origin-URL, https en ssh", () => {
  assert.equal(stempelNaam({ origin: "https://github.com/Winco-Holland-B-V/plantas.git", projectmap: PROJECT }), "Winco-Holland-B-V_plantas");
  assert.equal(stempelNaam({ origin: "https://github.com/Richplant/app", projectmap: PROJECT }), "Richplant_app");
  assert.equal(stempelNaam({ origin: "git@github.com:Richplant/app.git", projectmap: PROJECT }), "Richplant_app");
  assert.equal(stempelNaam({ origin: "ssh://git@github.com/Richplant/app.git\n", projectmap: PROJECT }), "Richplant_app");
});

test("stempel: zonder bruikbare origin een veilige naam uit de projectmap", () => {
  const naam = stempelNaam({ origin: null, projectmap: "/home/klant/mijn app" });
  assert.match(naam, /^[A-Za-z0-9._-]+$/);
  assert.notEqual(naam, stempelNaam({ origin: null, projectmap: "/home/klant/ander" }));
  assert.match(stempelNaam({ origin: "onzin", projectmap: PROJECT }), /^[A-Za-z0-9._-]+$/);
});

// ---------------------------------------------------------------- versie-op-afstand

test("afstand: de parser neemt de hoogste stack-v-tag, ook met ^{} erachter", () => {
  const uit = [
    "abc\trefs/tags/stack-v8",
    "abc\trefs/tags/stack-v8^{}",
    "def\trefs/tags/stack-v10",
    "def\trefs/tags/stack-v10^{}",
    "ghi\trefs/tags/stack-v9",
    "jkl\trefs/tags/v1.2.3",
  ].join("\n");
  assert.equal(hoogsteStackVersie(uit), 10);
  assert.equal(hoogsteStackVersie("x\trefs/tags/stack-v3^{}\n"), 3);
});

test("afstand: geen stack-tag, onleesbaar nummer of lege uitvoer geeft null", () => {
  assert.equal(hoogsteStackVersie("abc\trefs/tags/v1.0.0\n"), null);
  assert.equal(hoogsteStackVersie("abc\trefs/tags/stack-vabc\n"), null);
  assert.equal(hoogsteStackVersie("abc\trefs/tags/stack-v\n"), null);
  assert.equal(hoogsteStackVersie("abc\trefs/tags/stack-v99999999999999999999\n"), null);
  assert.equal(hoogsteStackVersie(""), null);
  assert.equal(hoogsteStackVersie(null), null);
  assert.equal(hoogsteStackVersie("abc\trefs/tags/stack-v9x\nabc\trefs/tags/stack-v7\n"), 7, "een onleesbare tag telt niet mee, de rest wel");
});

test("afstand: versieOpAfstand vraagt git ls-remote --tags zonder login en parseert het antwoord", () => {
  const aanroepen = [];
  const exec = (cmd, args, opties) => {
    aanroepen.push({ cmd, args, opties });
    return "abc\trefs/tags/stack-v10\n";
  };
  assert.equal(versieOpAfstand({ repo: "Proef/template", exec }), 10);
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].cmd, "git");
  assert.deepEqual(aanroepen[0].args, ["ls-remote", "--tags", "https://github.com/Proef/template"]);
  assert.equal(aanroepen[0].opties.timeout, 3000);
  assert.equal(aanroepen[0].opties.env.GIT_TERMINAL_PROMPT, "0");
  assert.deepEqual(aanroepen[0].opties.stdio, ["ignore", "pipe", "ignore"]);
});

test("afstand: een exec die gooit (geen netwerk, time-out) geeft null; een rare reponaam ook", () => {
  const gooit = () => {
    throw new Error("geen netwerk");
  };
  assert.equal(versieOpAfstand({ repo: "Proef/template", exec: gooit }), null);
  assert.equal(versieOpAfstand({ repo: "../../evil", exec: () => "x\trefs/tags/stack-v1\n" }), null);
});

// ---------------------------------------------------------------- de hook als proces

const NODE = process.execPath;

function maakProject({ manifest = true, versie = "9" } = {}) {
  const map = mkdtempSync(join(tmpdir(), "stack-hook-project-"));
  mkdirSync(join(map, ".claude"), { recursive: true });
  if (manifest) writeFileSync(join(map, ".claude", "stack-manifest.json"), JSON.stringify(MANIFEST));
  if (versie !== null) writeFileSync(join(map, ".claude", "stack-version"), `${versie}\n`);
  return map;
}

function draaiHook(event, { projectmap, data, opAfstand, env = {} } = {}) {
  const omgeving = { PATH: process.env.PATH, HOME: process.env.HOME ?? tmpdir(), ...env };
  if (projectmap) omgeving.CLAUDE_PROJECT_DIR = projectmap;
  if (data) omgeving.CLAUDE_PLUGIN_DATA = data;
  if (opAfstand !== undefined) omgeving.STACK_VERSIE_OP_AFSTAND_TEST = String(opAfstand);
  const uit = spawnSync(NODE, [HOOK], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    env: omgeving,
    encoding: "utf8",
    timeout: 10000,
  });
  return { status: uit.status, stdout: uit.stdout ?? "", stderr: uit.stderr ?? "" };
}

const start = (cwd) => ({ hook_event_name: "SessionStart", session_id: "t", cwd, source: "startup" });
const pre = (cwd, tool_name, tool_input) => ({ hook_event_name: "PreToolUse", session_id: "t", cwd, tool_name, tool_input });

test("hook: kapotte invoer is exit 0 zonder uitvoer", () => {
  for (const invoer of ["", "dit is geen json {", "null", JSON.stringify({ tool_name: "Edit" })]) {
    const uit = draaiHook(invoer);
    assert.deepEqual(uit, { status: 0, stdout: "", stderr: "" }, `invoer: ${invoer}`);
  }
});

test("hook: een repo zonder manifest geeft exit 0 zonder uitvoer, ook bij een beschermd pad en bij sessiestart (AE7)", () => {
  const map = maakProject({ manifest: false });
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  assert.deepEqual(draaiHook(pre(map, "Edit", { file_path: ".github/workflows/ci.yml" })), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(draaiHook(start(map), { data, opAfstand: 10 }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(readdirSync(data), [], "geen stempel zonder manifest");
});

test("hook: een app van het Vercel-spoor (manifest zonder variant cloudflare) laat deze plugin met rust", () => {
  const map = maakProject();
  const { variant, ...vercel } = MANIFEST;
  assert.equal(variant, "cloudflare");
  writeFileSync(join(map, ".claude", "stack-manifest.json"), JSON.stringify(vercel));
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  assert.deepEqual(draaiHook(pre(map, "Edit", { file_path: ".github/workflows/ci.yml" })), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(draaiHook(start(map), { data, opAfstand: 10 }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(readdirSync(data), [], "geen versiemelding of stempel voor een Vercel-app");
});

test("hook: PreToolUse in een repo met manifest weigert een templatebestand met JSON op stdout", () => {
  const map = maakProject();
  const uit = draaiHook(pre(map, "Edit", { file_path: join(map, ".github/workflows/ci.yml") }));
  assert.equal(uit.status, 0);
  const json = JSON.parse(uit.stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(json.hookSpecificOutput.permissionDecision, "deny");
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /\/stack-cloudflare:updaten/);
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /\.github\/workflows\/ci\.yml/);
});

test("tool: schrijven in supabase/migrations/ wordt toegestaan met de databaseroute als context", () => {
  for (const toolName of ["Write", "Edit"]) {
    const r = beoordeelTool({ projectmap: PROJECT, manifest: MANIFEST, toolName, toolInput: { file_path: `${PROJECT}/supabase/migrations/20261001_items.sql` } });
    assert.equal(r.weiger, false);
    assert.equal(r.context, MIGRATIE_CONTEXT);
    assert.match(r.context, /docs\/routes\/databasewijziging\.md/);
  }
  const elders = beoordeelTool({ projectmap: PROJECT, manifest: MANIFEST, toolName: "Write", toolInput: { file_path: "supabase/functions/x/index.ts" } });
  assert.deepEqual(elders, TOE, "alleen de migratiemap krijgt de herinnering");
  const zonderManifest = beoordeelTool({ projectmap: PROJECT, manifest: null, toolName: "Write", toolInput: { file_path: "supabase/migrations/a.sql" } });
  assert.deepEqual(zonderManifest, TOE, "buiten een stack-repo zegt de hook niets");
});

test("hook: PreToolUse op een migratie geeft additionalContext zonder permissionDecision", () => {
  const map = maakProject();
  const uit = draaiHook(pre(map, "Write", { file_path: join(map, "supabase/migrations/20261001_items.sql"), content: "create table x();" }));
  assert.equal(uit.status, 0);
  const json = JSON.parse(uit.stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(json.hookSpecificOutput.permissionDecision, undefined, "de gewone toestemmingsvraag blijft staan");
  assert.match(json.hookSpecificOutput.additionalContext, /databasewijziging\.md/);
});

test("hook: PreToolUse laat src/App.tsx door en volgt cwd als CLAUDE_PROJECT_DIR ontbreekt", () => {
  const map = maakProject();
  assert.deepEqual(draaiHook(pre(map, "Edit", { file_path: "src/App.tsx" })), { status: 0, stdout: "", stderr: "" });
  const uit = draaiHook(pre(map, "Bash", { command: "pnpm dev" }));
  assert.equal(JSON.parse(uit.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(draaiHook(pre(map, "Bash", { command: "pnpm dev" }), { env: { STACK_ALLOW_DEV: "1" } }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(draaiHook(pre(map, "Edit", { file_path: "biome.json" }), { env: { STACK_ALLOW_POLICY_EDIT: "1" } }), { status: 0, stdout: "", stderr: "" });
});

test("hook: SessionStart lokaal 9, op afstand 10, geen stempel: melding en stempel; zelfde dag geen tweede melding (AE1)", () => {
  const map = maakProject();
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  const eerste = draaiHook(start(map), { projectmap: map, data, opAfstand: 10 });
  assert.equal(eerste.status, 0, eerste.stderr);
  assert.match(eerste.stdout, /versie 9/);
  assert.match(eerste.stdout, /versie 10/);
  assert.match(eerste.stdout, /\/stack-cloudflare:updaten/);
  const stempels = readdirSync(data);
  assert.equal(stempels.length, 1);
  assert.match(stempels[0], /\.json$/);
  const stempel = JSON.parse(readFileSync(join(data, stempels[0]), "utf8"));
  assert.equal(stempel.versieOpAfstand, 10);
  assert.ok(Math.abs(Date.now() - Date.parse(stempel.tijdstip)) < 60000);

  // Tweede sessie dezelfde dag: ook als de "template" nu 11 zou melden, wordt er niet gekeken.
  const tweede = draaiHook(start(map), { projectmap: map, data, opAfstand: 11 });
  assert.deepEqual(tweede, { status: 0, stdout: "", stderr: "" });
  assert.equal(JSON.parse(readFileSync(join(data, stempels[0]), "utf8")).versieOpAfstand, 10, "stempel ongewijzigd");
});

test("hook: op afstand null (geen netwerk): geen melding, geen stempel, exit 0 (AE2)", () => {
  const map = maakProject();
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  assert.deepEqual(draaiHook(start(map), { projectmap: map, data, opAfstand: "null" }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(readdirSync(data), []);
});

test("hook: lokaal gelijk aan op afstand: geen melding, wel een stempel", () => {
  const map = maakProject({ versie: "10" });
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  assert.deepEqual(draaiHook(start(map), { projectmap: map, data, opAfstand: 10 }), { status: 0, stdout: "", stderr: "" });
  assert.equal(readdirSync(data).length, 1);
});

test("hook: een repo zonder versienummer krijgt geen melding en geen stempel", () => {
  const map = maakProject({ versie: null });
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  assert.deepEqual(draaiHook(start(map), { projectmap: map, data, opAfstand: 10 }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(readdirSync(data), []);
  const map2 = maakProject({ versie: "negen" });
  assert.deepEqual(draaiHook(start(map2), { projectmap: map2, data, opAfstand: 10 }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(readdirSync(data), []);
});

test("hook: twee repo's van dezelfde klant krijgen twee onafhankelijke stempels", () => {
  const a = maakProject();
  const b = maakProject();
  const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
  assert.match(draaiHook(start(a), { projectmap: a, data, opAfstand: 10 }).stdout, /\/stack-cloudflare:updaten/);
  assert.match(draaiHook(start(b), { projectmap: b, data, opAfstand: 10 }).stdout, /\/stack-cloudflare:updaten/, "de stempel van a remt b niet");
  assert.equal(readdirSync(data).length, 2);
});

test(
  "hook: met een origin op GitHub heet de stempel <eigenaar>_<repo>.json",
  { skip: spawnSync("git", ["--version"]).status !== 0 && "git ontbreekt" },
  () => {
    const map = maakProject();
    const git = (...args) => spawnSync("git", ["-C", map, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("remote", "add", "origin", "git@github.com:Klantorg/mooie-app.git");
    const data = mkdtempSync(join(tmpdir(), "stack-hook-data-"));
    draaiHook(start(map), { projectmap: map, data, opAfstand: 10 });
    assert.deepEqual(readdirSync(data), ["Klantorg_mooie-app.json"]);
  },
);
