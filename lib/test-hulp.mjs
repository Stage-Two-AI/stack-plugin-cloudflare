/**
 * Gedeelde opbouw voor de tests: een verzonnen template op versie 8 en 9, een app die
 * op 8 staat, en waar nodig echte git-repo's (template met tags, klantrepo met een kale
 * origin). Geen testbestand zelf; de globs in package.json pakken alleen *.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

export function tijdelijkeMap(naam = "stack-test-") {
  return mkdtempSync(join(tmpdir(), naam));
}

export function schrijfBestanden(map, bestanden) {
  for (const [pad, inhoud] of Object.entries(bestanden)) {
    mkdirSync(dirname(join(map, pad)), { recursive: true });
    writeFileSync(join(map, pad), inhoud);
  }
}

/**
 * docs/WERKWIJZE.md zit in beide versies van de template, maar verhuist van `vervangen`
 * (versie 8) naar `vanHetProject` (versie 9): de klant mag er dan zelf in schrijven en
 * het bijwerken moet er vanaf blijven.
 */
function manifest(versie, extra = {}, markeringenPad = "AGENTS.md") {
  return `${JSON.stringify(
    {
      variant: "cloudflare",
      stackVersion: versie,
      vanDeTemplate: {
        vervangen: [
          ".claude/stack-manifest.json",
          ".claude/stack-version",
          "CLAUDE.md",
          ".github/workflows/ci.yml",
          ...(versie === 8 ? ["scripts/guard-oud.mjs", "docs/WERKWIJZE.md"] : ["scripts/guard-nieuw.mjs"]),
        ],
        sleutelsSamenvoegen: { "package.json": versie === 8 ? ["scripts"] : ["scripts", "devDependencies"] },
        tussenMarkeringen: { [markeringenPad]: "stack" },
      },
      vanHetProject: versie === 8 ? ["src/**", "README.md"] : ["src/**", "README.md", "docs/WERKWIJZE.md"],
      ...extra,
    },
    null,
    2,
  )}\n`;
}

/**
 * De bestanden van de verzonnen template op een versie. Met `markeringenPad` staat het
 * bestand met de stack-markeringen op een ander pad dan AGENTS.md (een verhuizing, zoals
 * versie 5 die van CLAUDE.md naar AGENTS.md deed).
 */
export function templateBestanden(versie, extraManifest = {}, { markeringenPad = "AGENTS.md" } = {}) {
  const v = versie;
  return {
    ".claude/stack-version": `${v}\n`,
    ".claude/stack-manifest.json": manifest(v, extraManifest, markeringenPad),
    "CLAUDE.md": `@AGENTS.md\n<!-- versie ${v} -->\n`,
    ".github/workflows/ci.yml": `name: CI\nsteps:\n  - uses: actions/checkout@v5\n  - run: echo versie ${v}\n`,
    ...(v === 8 ? { "scripts/guard-oud.mjs": "// oud\n" } : { "scripts/guard-nieuw.mjs": "// nieuw\n" }),
    "package.json": `${JSON.stringify(
      v === 8
        ? { name: "template", scripts: { check: "pnpm test", test: "vitest" } }
        : { name: "template", scripts: { check: "pnpm test && pnpm guard", test: "vitest", guard: "node scripts/guard-nieuw.mjs" }, devDependencies: { vitest: "^3.1.0", biome: "^2.1.0" } },
      null,
      2,
    )}\n`,
    [markeringenPad]: `# stack-template\n\n<!-- stack:begin -->\nAfspraken versie ${v}\n<!-- stack:end -->\n`,
    "README.md": `# Template ${v}\n`,
    "docs/WERKWIJZE.md": `# Werkwijze (template ${v})\n`,
  };
}

/** Een app die uit versie 8 is gebouwd, met eigen projectbestanden. */
export function appBestanden() {
  const t = templateBestanden(8);
  return {
    ...t,
    "package.json": `${JSON.stringify(
      { name: "mijn-app", scripts: { check: "pnpm test", test: "vitest", eigen: "echo hoi" }, devDependencies: { vitest: "^3.2.0", eigen: "1.0.0" } },
      null,
      2,
    )}\n`,
    "AGENTS.md": `# Mijn app\nEen app voor de kwekerij.\n\n<!-- stack:begin -->\nAfspraken versie 8\n<!-- stack:end -->\n`,
    "README.md": "# Mijn app\n",
    "src/App.tsx": "export default () => null;\n",
    "pnpm-lock.yaml": "lockfileVersion: 9\n",
  };
}

export function alleBestanden(map, basis = map) {
  const uit = {};
  for (const naam of readdirSync(map)) {
    if (naam === ".git") continue;
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) Object.assign(uit, alleBestanden(pad, basis));
    else uit[relative(basis, pad)] = readFileSync(pad, "utf8");
  }
  return uit;
}

/** Welke paden verschillen tussen twee momentopnamen (gewijzigd, nieuw of weg)? */
export function verschil(voor, na) {
  const paden = new Set([...Object.keys(voor), ...Object.keys(na)]);
  return [...paden].filter((p) => voor[p] !== na[p]).sort();
}

/**
 * Een template-vervanger voor de kern: geen git, alleen mappen. `opTag` is een map per
 * tagnaam (stack-v8 -> map met die versie); tonenOpTag leest daaruit.
 */
export function nepGit({ map, opTag }) {
  const start = alleBestanden(map);
  return {
    tonenOpTag(tag, pad) {
      const bron = opTag[tag];
      if (!bron || !existsSync(join(bron, pad))) return null;
      return readFileSync(join(bron, pad), "utf8");
    },
    verwijder(pad) {
      rmSync(join(map, pad));
    },
    gewijzigd() {
      return verschil(start, alleBestanden(map));
    },
  };
}

export const nepPnpm = {
  aanwezig: {
    lockfile(map) {
      writeFileSync(join(map, "pnpm-lock.yaml"), "lockfileVersion: 9\n# herberekend uit package.json\n");
      return true;
    },
  },
  afwezig: { lockfile: () => false },
};

/** Template op 8 en 9 in aparte mappen plus een app op 8; alles in één tijdelijke wortel. */
export function maakMappen({ app = appBestanden(), template9 = templateBestanden(9) } = {}) {
  const wortel = tijdelijkeMap();
  const paden = { wortel, tmpl8: join(wortel, "tmpl8"), tmpl9: join(wortel, "tmpl9"), app: join(wortel, "app") };
  schrijfBestanden(paden.tmpl8, templateBestanden(8));
  schrijfBestanden(paden.tmpl9, template9);
  schrijfBestanden(paden.app, app);
  return paden;
}

// ---------------------------------------------------------------- echte git

export function git(map, ...args) {
  return execFileSync("git", ["-C", map, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

const IDENTITEIT = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

export function commit(map, bericht) {
  git(map, "add", "-A");
  git(map, ...IDENTITEIT, "commit", "-q", "--allow-empty", "-m", bericht);
}

/**
 * Een echte template-repo: versie 8 getagd als stack-v8, versie 9 getagd als stack-v9,
 * en daarna nog een commit op main die niet in een tag zit (KTD5: de skill neemt de
 * tag, nooit main).
 */
export function maakTemplateRepo(wortel, { tagV9 = true } = {}) {
  const map = join(wortel, "template-repo");
  mkdirSync(map, { recursive: true });
  git(map, "init", "-q", "-b", "main");
  git(map, "config", "uploadpack.allowFilter", "true");
  schrijfBestanden(map, templateBestanden(8));
  commit(map, "versie 8");
  git(map, "tag", "stack-v8");
  rmSync(join(map, "scripts/guard-oud.mjs"));
  schrijfBestanden(map, templateBestanden(9));
  commit(map, "versie 9");
  if (tagV9) git(map, "tag", "stack-v9");
  writeFileSync(join(map, "CLAUDE.md"), "@AGENTS.md\n<!-- alleen op main, zonder versie -->\n");
  commit(map, "los werk op main na de tag");
  return map;
}

/**
 * Een klantrepo: kale origin plus de open checkout van de klant, app op versie 8. Met
 * `githubUrl` krijgt de checkout die URL als origin; de aanroeper zet dan met
 * `insteadOfEnv` git's url.<pad>.insteadOf zodat die URL op de kale origin uitkomt.
 * Zo ziet het script een echte GitHub-repo (owner/naam) zonder netwerk.
 */
export function maakKlantRepo(wortel, { app = appBestanden(), githubUrl = null } = {}) {
  const origin = join(wortel, "klant-origin.git");
  const checkout = join(wortel, "klant-checkout");
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q", "--bare", "-b", "main");
  mkdirSync(checkout, { recursive: true });
  git(checkout, "init", "-q", "-b", "main");
  schrijfBestanden(checkout, app);
  commit(checkout, "app op versie 8");
  git(checkout, "remote", "add", "origin", origin);
  git(checkout, "push", "-q", "-u", "origin", "main");
  git(checkout, "config", "user.name", "Bart Klant");
  git(checkout, "config", "user.email", "bart@example.com");
  if (githubUrl) git(checkout, "remote", "set-url", "origin", githubUrl);
  return { origin, checkout, githubUrl };
}

/** Omgevingsvariabelen die git elke `githubUrl` naar het lokale pad laten herschrijven. */
export function insteadOfEnv(githubUrl, pad) {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pad}.insteadOf`,
    GIT_CONFIG_VALUE_0: githubUrl,
  };
}

/**
 * Een nep-`gh` op het PATH: leest zijn gedrag uit een JSON-bestand (per subcommando een
 * antwoord) en logt elke aanroep. Zo testen we de PR-stappen zonder GitHub.
 */
export function nepGh(wortel, antwoorden = {}) {
  const binMap = join(wortel, "bin");
  mkdirSync(binMap, { recursive: true });
  const configPad = join(wortel, "gh-antwoorden.json");
  const logPad = join(wortel, "gh-log.jsonl");
  writeFileSync(configPad, JSON.stringify(antwoorden));
  writeFileSync(
    join(binMap, "gh"),
    `#!/usr/bin/env node
const { readFileSync, appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPad)}, JSON.stringify(args) + "\\n");
const config = JSON.parse(readFileSync(${JSON.stringify(configPad)}, "utf8"));
const sleutel = args.slice(0, 2).join(" ");
if (sleutel === "repo clone") {
  // "repo clone <repo> <doel> -- --quiet": kloon uit de map met lokale paden per repo.
  const bron = (config["repo clone"] ?? {}).map?.[args[2]];
  if (!bron) { process.stderr.write("nep-gh: geen kloonbron voor " + args[2] + "\\n"); process.exit(1); }
  require("node:child_process").execFileSync("git", ["clone", "-q", bron, args[3]]);
  process.exit(0);
}
const antwoord = config[sleutel] ?? config["*"];
if (antwoord === undefined) { process.stderr.write("nep-gh: geen antwoord voor " + sleutel + "\\n"); process.exit(1); }
if (antwoord.exit) { process.stderr.write(antwoord.stderr ?? ""); process.exit(antwoord.exit); }
process.stdout.write(typeof antwoord.stdout === "string" ? antwoord.stdout : JSON.stringify(antwoord.stdout ?? ""));
`,
  );
  execFileSync("chmod", ["+x", join(binMap, "gh")]);
  return {
    pad: binMap,
    env: () => ({ ...process.env, PATH: `${binMap}:${process.env.PATH}` }),
    zet(nieuw) {
      writeFileSync(configPad, JSON.stringify(nieuw));
    },
    aanroepen() {
      if (!existsSync(logPad)) return [];
      return readFileSync(logPad, "utf8").trim().split("\n").filter(Boolean).map((r) => JSON.parse(r));
    },
  };
}

/**
 * Een nep-`pnpm` in dezelfde bin-map als de nep-gh: `install --lockfile-only` schrijft
 * een vers lockfile zonder netwerk. De echte pnpm zou de verzonnen devDependencies
 * van de testtemplate willen ophalen.
 */
export function nepPnpm_opPad(binMap) {
  writeFileSync(
    join(binMap, "pnpm"),
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
if (process.argv[2] === "install") writeFileSync("pnpm-lock.yaml", "lockfileVersion: 9\\n# herberekend uit package.json\\n");
`,
  );
  execFileSync("chmod", ["+x", join(binMap, "pnpm")]);
}

export function opruimen(map) {
  rmSync(map, { recursive: true, force: true });
}

export { cpSync };
