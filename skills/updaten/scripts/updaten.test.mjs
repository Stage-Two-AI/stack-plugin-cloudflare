/**
 * Tests voor de twee nieuwe scripts van /stack-cloudflare:updaten: het overzicht van alle apps van
 * de klant (overzicht.mjs) en de PR met afhankelijkheden (afhankelijkheden.mjs). Met een
 * nep-gh en een nep-pnpm op het PATH, dus zonder GitHub en zonder register.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { git, insteadOfEnv, maakKlantRepo, maakTemplateRepo, nepGh, opruimen, tijdelijkeMap } from "../../../lib/test-hulp.mjs";
import { BRANCH, WERKMAP_PREFIX, hoofd as afhHoofd, hoofdversiesUit, prTekst } from "./afhankelijkheden.mjs";
import { hoofd as overzichtHoofd, leesArgumenten } from "./overzicht.mjs";

const GH_BASIS = {
  "--version": { stdout: "gh version 2.95.0\n" },
  "auth status": { stdout: "Logged in\n" },
};

function metOmgeving(env, fn) {
  const oud = { ...process.env };
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in oud)) delete process.env[k];
    Object.assign(process.env, oud);
  }
}

// ---------------------------------------------------------------- overzicht

function overzichtWereld(gh) {
  const wortel = tijdelijkeMap("overzicht-");
  const template = maakTemplateRepo(wortel); // tags stack-v8 en stack-v9: doel is 9
  const nep = nepGh(wortel, { ...GH_BASIS, ...gh });
  const leeg = join(wortel, "leeg");
  mkdirSync(leeg);
  const env = { PATH: `${nep.pad}:${process.env.PATH}`, STACK_TEMPLATE_REPO: template };
  return {
    nep,
    leeg,
    draai: (argv, cwd = leeg) => metOmgeving(env, () => overzichtHoofd(argv, { cwd, env: process.env })),
    opruimen: () => opruimen(wortel),
  };
}

const raw = (v) => ({ stdout: `${v}\n` });

test("overzicht: argumenten", () => {
  assert.deepEqual(leesArgumenten(["--json", "--eigenaar", "a", "--eigenaar", "b"]), { json: true, eigenaren: ["a", "b"] });
  assert.throws(() => leesArgumenten(["--eigenaar"]), /zonder naam/);
});

const CLOUDFLARE_MANIFEST = { variant: "cloudflare", stackVersion: 9 };

test("overzicht: alleen Cloudflare-template-apps met schrijfrecht (geen Vercel-apps), achterlopers eerst, open PR genoemd", () => {
  const w = overzichtWereld({
    "repo list": {
      stdout: [
        { nameWithOwner: "klant/voorraad", viewerPermission: "WRITE" },
        { nameWithOwner: "klant/portaal", viewerPermission: "ADMIN" },
        { nameWithOwner: "klant/website", viewerPermission: "WRITE" },
        { nameWithOwner: "klant/alleen-lezen", viewerPermission: "READ" },
        { nameWithOwner: "klant/nieuw", viewerPermission: "MAINTAIN" },
        { nameWithOwner: "klant/vercel-app", viewerPermission: "WRITE" },
      ],
    },
    "api repos/klant/voorraad/contents/.claude/stack-version": raw(9),
    "api repos/klant/portaal/contents/.claude/stack-version": raw(8),
    "api repos/klant/website/contents/.claude/stack-version": { exit: 1, stderr: "HTTP 404" },
    "api repos/klant/nieuw/contents/.claude/stack-version": raw(7),
    "api repos/klant/voorraad/contents/.claude/stack-manifest.json": { stdout: CLOUDFLARE_MANIFEST },
    "api repos/klant/portaal/contents/.claude/stack-manifest.json": { stdout: CLOUDFLARE_MANIFEST },
    "api repos/klant/website/contents/.claude/stack-manifest.json": { exit: 1, stderr: "HTTP 404" },
    "api repos/klant/nieuw/contents/.claude/stack-manifest.json": { stdout: CLOUDFLARE_MANIFEST },
    "api repos/klant/vercel-app/contents/.claude/stack-manifest.json": { stdout: { stackVersion: 6 } },
    "api repos/klant/vercel-app/contents/.claude/stack-version": raw(6),
    "pr list": { stdout: [{ number: 3, headRefName: "stack-sync/v9", url: "https://github.com/klant/portaal/pull/3" }] },
  });
  try {
    const r = w.draai(["--json", "--eigenaar", "klant"]);
    assert.equal(r.status, "ok", r.reden);
    assert.equal(r.doel, 9);
    assert.deepEqual(
      r.apps.map((a) => [a.repo, a.versie, a.achter]),
      [
        ["klant/nieuw", 7, true],
        ["klant/portaal", 8, true],
        ["klant/voorraad", 9, false],
      ],
    );
    assert.equal(r.apps.find((a) => a.repo === "klant/portaal").openPR, "https://github.com/klant/portaal/pull/3");
    assert.ok(!w.nep.aanroepen().some((a) => a[1]?.includes("alleen-lezen")), "een repo zonder schrijfrecht wordt niet eens bekeken");
  } finally {
    w.opruimen();
  }
});

test("overzicht: zonder open app en zonder --eigenaar kijkt hij naar het eigen account en de organisaties", () => {
  const w = overzichtWereld({
    "api user": { stdout: "bart\n" },
    "api user/orgs": { stdout: "klant\n" },
    "repo list": { stdout: [] },
  });
  try {
    const r = w.draai(["--json"]);
    assert.equal(r.status, "ok", r.reden);
    assert.deepEqual(r.eigenaren, ["klant", "bart"]);
    assert.equal(r.huidige, null);
  } finally {
    w.opruimen();
  }
});

test("overzicht: niet ingelogd bij gh is mislukt met de route naar installatie", () => {
  const w = overzichtWereld({ "auth status": { exit: 1, stderr: "not logged in" } });
  try {
    const r = w.draai(["--json"]);
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /gh auth login/);
  } finally {
    w.opruimen();
  }
});

// ---------------------------------------------------------------- afhankelijkheden

/** Een nep-pnpm: `update` herschrijft het lockfile (of niet), `outdated` geeft JSON en code 1. */
function nepPnpm(binMap, { verandert = true, outdated = {}, alsoPackageJson = false } = {}) {
  writeFileSync(
    join(binMap, "pnpm"),
    `#!/usr/bin/env node
const { writeFileSync, readFileSync } = require("node:fs");
const [cmd] = process.argv.slice(2);
if (cmd === "update") {
  if (${verandert}) writeFileSync("pnpm-lock.yaml", readFileSync("pnpm-lock.yaml", "utf8") + "# bijgewerkt\\n");
  if (${alsoPackageJson}) writeFileSync("package.json", "{}\\n");
  process.exit(0);
}
if (cmd === "outdated") { process.stdout.write(${JSON.stringify(JSON.stringify(outdated))}); process.exit(1); }
`,
  );
  execFileSync("chmod", ["+x", join(binMap, "pnpm")]);
}

function afhWereld({ gh = {}, pnpm = {} } = {}) {
  const wortel = tijdelijkeMap("afh-");
  const tmp = join(wortel, "tmp");
  mkdirSync(tmp);
  const githubUrl = "https://github.com/klant/app.git";
  const klant = maakKlantRepo(wortel, { githubUrl });
  const nep = nepGh(wortel, {
    ...GH_BASIS,
    "pr list": { stdout: [] },
    "pr create": { stdout: "https://github.com/klant/app/pull/5\n" },
    ...gh,
  });
  nepPnpm(nep.pad, pnpm);
  const env = { ...insteadOfEnv(githubUrl, klant.origin), PATH: `${nep.pad}:${process.env.PATH}`, TMPDIR: tmp };
  return {
    klant,
    nep,
    werkmappen: () => readdirSync(tmp).filter((n) => n.startsWith(WERKMAP_PREFIX)),
    draai: (argv) => metOmgeving(env, () => afhHoofd(argv, { cwd: klant.checkout })),
    opruimen: () => opruimen(wortel),
  };
}

test("afhankelijkheden: hoofdversies uit pnpm outdated, alleen echte sprongen", () => {
  const uit = hoofdversiesUit(
    JSON.stringify({
      vite: { current: "6.3.1", latest: "7.0.2", wanted: "6.3.5" },
      zod: { current: "3.24.0", latest: "3.25.1", wanted: "3.25.1" },
      "@playwright/test": { current: "1.50.0", latest: "2.0.0" },
    }),
  );
  assert.deepEqual(uit, [
    { naam: "@playwright/test", huidig: "1.50.0", nieuwste: "2.0.0" },
    { naam: "vite", huidig: "6.3.1", nieuwste: "7.0.2" },
  ]);
  assert.deepEqual(hoofdversiesUit("geen json"), []);
  const tekst = prTekst({ hoofdversies: uit, dependabot: [{ number: 26, title: "Bump de kleine updates", url: "u" }] });
  assert.match(tekst, /vite`: 6\.3\.1 → 7\.0\.2/);
  assert.match(tekst, /#26 Bump de kleine updates/);
  assert.match(tekst, /\/stack-cloudflare:updaten/);
});

test("afhankelijkheden: lockfile veranderd geeft een eigen PR met de naam van de gebruiker, main onaangeroerd", () => {
  const w = afhWereld({ pnpm: { outdated: { vite: { current: "6.0.0", latest: "7.0.0" } } } });
  try {
    const mainVoor = git(w.klant.origin, "rev-parse", "main");
    const r = w.draai(["--json"]);
    assert.equal(r.status, "gepusht", r.reden);
    assert.deepEqual(r.pr, { url: "https://github.com/klant/app/pull/5", nieuw: true });
    assert.deepEqual(r.hoofdversies, [{ naam: "vite", huidig: "6.0.0", nieuwste: "7.0.0" }]);
    assert.equal(git(w.klant.origin, "rev-parse", "main"), mainVoor);
    assert.equal(git(w.klant.origin, "log", "-1", "--format=%an <%ae>", BRANCH), "Bart Klant <bart@example.com>");
    assert.deepEqual(git(w.klant.origin, "diff", "--name-only", `main..${BRANCH}`).split("\n"), ["pnpm-lock.yaml"]);
    assert.deepEqual(w.werkmappen(), [], "de tijdelijke kopie is opgeruimd");
  } finally {
    w.opruimen();
  }
});

test("afhankelijkheden: niets veranderd is bij, en een open voorstel stopt zonder te klonen", () => {
  const w = afhWereld({ pnpm: { verandert: false } });
  try {
    const r = w.draai(["--json"]);
    assert.equal(r.status, "bij", r.reden);
    assert.equal(git(w.klant.origin, "branch", "--list", BRANCH), "");
  } finally {
    w.opruimen();
  }

  const o = afhWereld({ gh: { "pr list": { stdout: [{ number: 4, headRefName: BRANCH, url: "https://github.com/klant/app/pull/4" }] } } });
  try {
    const r = o.draai(["--json"]);
    assert.equal(r.status, "gestopt");
    assert.match(r.reden, /pull\/4/);
    assert.deepEqual(o.werkmappen(), []);
  } finally {
    o.opruimen();
  }
});

test("afhankelijkheden: wijzigt er meer dan het lockfile, dan stopt hij en pusht niets", () => {
  const w = afhWereld({ pnpm: { alsoPackageJson: true } });
  try {
    const r = w.draai(["--json"]);
    assert.equal(r.status, "gestopt");
    assert.deepEqual(r.buiten, ["package.json"]);
    assert.equal(git(w.klant.origin, "branch", "--list", BRANCH), "");
  } finally {
    w.opruimen();
  }
});
