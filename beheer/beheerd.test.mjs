import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { commit, git, maakKlantRepo, maakTemplateRepo, nepGh, nepPnpm_opPad, opruimen, tijdelijkeMap } from "../lib/test-hulp.mjs";
import { IDENTITEIT, hoofd, leesArgumenten } from "./beheerd.mjs";

const b64 = (tekst) => Buffer.from(tekst).toString("base64");
const KLEUR = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, "g");

/**
 * Zet op de origin een branch stack-sync/v9 met een commit van een mens: gewoon git,
 * zonder de trailer Stack-bijwerken. Vanuit een tweede kloon, zodat de checkout van de
 * klant er niets van merkt. Geeft de sha terug die na de run nog moet staan.
 */
function menselijkeCommitOpSyncBranch(wortel, origin) {
  const kloon = join(wortel, "tweede-kloon");
  git(wortel, "clone", "-q", origin, kloon);
  git(kloon, "checkout", "-q", "-b", "stack-sync/v9");
  writeFileSync(join(kloon, "README.md"), "# Handmatig bijgewerkt\n");
  commit(kloon, "handwerk op de sync-branch");
  git(kloon, "push", "-q", "origin", "stack-sync/v9");
  return git(origin, "rev-parse", "stack-sync/v9");
}

function wereld({ route = "beheerd", soort = "app", prs = [], ruleset = [{ id: 1 }] } = {}) {
  const wortel = tijdelijkeMap("beheerd-");
  const tmp = join(wortel, "tmp");
  mkdirSync(tmp);
  const template = maakTemplateRepo(wortel);
  const klant = maakKlantRepo(wortel);
  const repo = "klant/app";
  const nep = nepGh(wortel, {
    "repo clone": { map: { [repo]: klant.origin } },
    [`api repos/${repo}/contents/.claude/stack-version`]: { stdout: { content: b64("8\n") } },
    [`api repos/${repo}/rulesets`]: { stdout: ruleset },
    "pr list": { stdout: prs },
    "pr create": { stdout: "https://github.com/klant/app/pull/9\n" },
    "pr edit": { stdout: "" },
    "pr close": { stdout: "" },
  });
  nepPnpm_opPad(nep.pad);
  const registerPad = join(wortel, "projecten.json");
  writeFileSync(registerPad, JSON.stringify({ projecten: [{ repo, soort, route, klant: "proef", sinds: "2026-09-19" }] }));
  const rulesetPad = join(wortel, "ruleset.json");
  writeFileSync(rulesetPad, "{}");
  const regels = [];
  const draai = (argv) => {
    const oud = { ...process.env };
    Object.assign(process.env, { PATH: `${nep.pad}:${process.env.PATH}`, TMPDIR: tmp, STACK_TEMPLATE_REPO: template });
    delete process.env.GH_TOKEN;
    try {
      return hoofd(["--register", registerPad, "--ruleset", rulesetPad, ...argv], { env: process.env, log: (r) => regels.push(r) });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in oud)) delete process.env[k];
      Object.assign(process.env, oud);
    }
  };
  const tekst = () => regels.join("\n").replace(KLEUR, "");
  return { wortel, klant, nep, draai, tekst, opruimen: () => opruimen(wortel) };
}

test("argumenten: register en ruleset zijn verplicht", () => {
  assert.throws(() => leesArgumenten(["--status"]), /--register/);
  assert.deepEqual(leesArgumenten(["--register", "r", "--ruleset", "s", "--doe-het", "--repo", "a/b"]), {
    register: "r",
    ruleset: "s",
    status: false,
    doeHet: true,
    repo: "a/b",
    templateRef: null,
  });
});

test("met GH_TOKEN in de omgeving weigert de run", () => {
  const regels = [];
  assert.equal(hoofd(["--register", "x", "--ruleset", "y"], { env: { GH_TOKEN: "x" }, log: (r) => regels.push(r) }), 1);
  assert.match(regels.join("\n"), /klanttoken/);
  assert.equal(hoofd(["--register", "x", "--ruleset", "y"], { env: { GITHUB_TOKEN: "x" }, log: () => {} }), 1);
});

test("--status: één regel met versie, ruleset en route; niets gekloond of gepusht", () => {
  const w = wereld();
  try {
    assert.equal(w.draai(["--status"]), 0);
    const t = w.tekst();
    assert.match(t, /klant\/app\s+versie 8 -> 9\s+route beheerd/);
    assert.match(t, /alleen-status: 1/);
    assert.equal(git(w.klant.origin, "branch", "--list", "stack-sync/v9"), "");
    assert.ok(!w.nep.aanroepen().some((a) => a[0] === "repo"));
  } finally {
    w.opruimen();
  }
});

test("droogloop: toont wat er zou gebeuren, pusht niets", () => {
  const w = wereld({ ruleset: [] });
  try {
    assert.equal(w.draai([]), 0);
    const t = w.tekst();
    assert.match(t, /GEEN ruleset op main/);
    assert.match(t, /zou de ruleset aanbrengen \(droogloop\)/);
    assert.match(t, /scripts\/guard-oud\.mjs \(verwijderd\)/);
    assert.match(t, /droogloop: niets gepusht/);
    assert.equal(git(w.klant.origin, "branch", "--list", "stack-sync/v9"), "");
  } finally {
    w.opruimen();
  }
});

test("--doe-het: PR stack-sync/v9 met de identiteit Stage Two stack-sync en de ruleset aangebracht", () => {
  const w = wereld({ ruleset: [] });
  try {
    assert.equal(w.draai(["--doe-het"]), 0);
    const t = w.tekst();
    assert.match(t, /ruleset aangebracht/);
    assert.match(t, /pull\/9/);
    assert.match(t, /pr-geopend: 1/);
    assert.equal(git(w.klant.origin, "log", "-1", "--format=%an <%ae>", "stack-sync/v9"), `${IDENTITEIT.naam} <${IDENTITEIT.email}>`);
    assert.match(git(w.klant.origin, "log", "-1", "--format=%B", "stack-sync/v9"), /Stack-bijwerken: v9/);
    assert.equal(git(w.klant.origin, "show", "stack-sync/v9:.claude/stack-version"), "9");
    const create = w.nep.aanroepen().find((a) => a[0] === "pr" && a[1] === "create");
    assert.ok(create.at(-1).includes("beheerde run van Stage Two"));
    assert.ok(create.at(-1).endsWith("Bevestigd: templatebestanden gewijzigd"));
    assert.ok(w.nep.aanroepen().some((a) => a[0] === "api" && a[2] === "-X" && a[3] === "POST"));
  } finally {
    w.opruimen();
  }
});

test("route plugin: --status toont het, --doe-het slaat het over met een zin", () => {
  const w = wereld({ route: "plugin" });
  try {
    w.draai(["--status"]);
    assert.match(w.tekst(), /route plugin/);
    w.draai(["--doe-het"]);
    assert.match(w.tekst(), /de klant haalt dit zelf op met \/stack-cloudflare:updaten/);
    assert.match(w.tekst(), /overgeslagen: 1/);
    assert.equal(git(w.klant.origin, "branch", "--list", "stack-sync/v9"), "");
  } finally {
    w.opruimen();
  }
});

test("open stack-bijwerken/v9-PR van de klant: overgeslagen en de PR genoemd", () => {
  const w = wereld({ prs: [{ number: 3, headRefName: "stack-bijwerken/v9", url: "https://github.com/klant/app/pull/3" }] });
  try {
    w.draai(["--status"]);
    assert.match(w.tekst(), /klant-PR open: https:\/\/github\.com\/klant\/app\/pull\/3/);
    w.draai(["--doe-het"]);
    assert.match(w.tekst(), /de klant heeft al een pull request open \(https:\/\/github\.com\/klant\/app\/pull\/3\)/);
    assert.equal(git(w.klant.origin, "branch", "--list", "stack-sync/v9"), "");
  } finally {
    w.opruimen();
  }
});

test("soort template: droogloop toont de spiegel-regels en pusht niets", () => {
  const w = wereld({ soort: "template" });
  try {
    assert.equal(w.draai([]), 0);
    const t = w.tekst();
    assert.match(t, /spiegel: \d+ bestand\(en\) anders, \d+ verwijderd/);
    assert.match(t, /droogloop: niets gepusht/);
    assert.match(t, /droogloop: 1/);
    assert.equal(git(w.klant.origin, "branch", "--list", "stack-sync/v9"), "");
  } finally {
    w.opruimen();
  }
});

test("soort template: een sync-branch met een commit van een mens wordt ook voor een spiegel niet overschreven", () => {
  const w = wereld({ soort: "template" });
  try {
    const shaVooraf = menselijkeCommitOpSyncBranch(w.wortel, w.klant.origin);
    assert.doesNotMatch(git(w.klant.origin, "log", "-1", "--format=%B", "stack-sync/v9"), /Stack-bijwerken/);
    assert.equal(w.draai(["--doe-het"]), 0);
    const t = w.tekst();
    assert.match(t, /x GESTOPT: op stack-sync\/v9 staat een commit die niet van de sync is/);
    assert.doesNotMatch(t, /spiegel:/);
    assert.match(t, /gestopt: 1/);
    assert.equal(git(w.klant.origin, "rev-parse", "stack-sync/v9"), shaVooraf);
    assert.ok(!w.nep.aanroepen().some((a) => a[0] === "pr" && a[1] === "create"));
  } finally {
    w.opruimen();
  }
});

test("--template-ref: de template op een branch in plaats van de tag, bijvoorbeeld vóór het taggen", () => {
  const w = wereld();
  try {
    assert.equal(w.draai(["--template-ref", "main"]), 0);
    assert.match(w.tekst(), /template op main in plaats van de nieuwste tag/);
    assert.match(w.tekst(), /versie 8 -> 9/);
  } finally {
    w.opruimen();
  }
});
