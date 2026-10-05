import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { alleBestanden, git, insteadOfEnv, maakKlantRepo, maakTemplateRepo, nepGh, nepPnpm_opPad, opruimen, tijdelijkeMap } from "../../../lib/test-hulp.mjs";
import { BEVESTIGING, WERKMAP_PREFIX, controleerWerkmap, hoofd, leesArgumenten, zonderLogin } from "./bijwerken.mjs";

const SCRIPT = fileURLToPath(import.meta.url).replace(/\.test\.mjs$/, ".mjs");

const GH_STANDAARD = {
  "--version": { stdout: "gh version 2.95.0\n" },
  "auth status": { stdout: "Logged in\n" },
  "pr list": { stdout: [] },
  "pr create": { stdout: "Creating pull request\nhttps://github.com/klant/app/pull/1\n" },
  "pr edit": { stdout: "" },
  "pr close": { stdout: "" },
};

/**
 * Eén wereld per test: template-repo met tags, klantrepo met kale origin en checkout,
 * nep-gh op het PATH, en een eigen TMPDIR zodat we kunnen zien wat er gekloond is.
 */
function wereld({ gh = GH_STANDAARD, tagV9 = true, app } = {}) {
  const wortel = tijdelijkeMap("bijwerken-wereld-");
  const tmp = join(wortel, "tmp");
  mkdirSync(tmp);
  const template = maakTemplateRepo(wortel, { tagV9 });
  const githubUrl = "https://github.com/klant/app.git";
  const klant = maakKlantRepo(wortel, { githubUrl, ...(app ? { app } : {}) });
  const nep = nepGh(wortel, gh);
  nepPnpm_opPad(nep.pad);
  const env = {
    ...process.env,
    ...insteadOfEnv(githubUrl, klant.origin),
    PATH: `${nep.pad}:${process.env.PATH}`,
    TMPDIR: tmp,
    STACK_TEMPLATE_REPO: template,
  };
  const draai = (argv, extra = {}) => {
    const oud = { ...process.env };
    Object.assign(process.env, env, extra);
    try {
      return hoofd(argv, { cwd: klant.checkout, env: process.env });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in oud)) delete process.env[k];
      Object.assign(process.env, oud);
    }
  };
  const werkmappen = () => (existsSync(tmp) ? readdirSync(tmp).filter((n) => n.startsWith(WERKMAP_PREFIX)) : []);
  return { wortel, tmp, template, klant, nep, env, draai, werkmappen, opruimen: () => opruimen(wortel) };
}

test("argumenten en het afplakken van een login in een URL", () => {
  assert.deepEqual(leesArgumenten(["--json", "--droogloop"]), { json: true, droogloop: true, werkmap: null, losOp: [], checkout: null, repo: null });
  assert.equal(leesArgumenten(["--droogloop", "--repo", "klant/voorraad"]).repo, "klant/voorraad");
  assert.deepEqual(leesArgumenten(["--werkmap", "/t/x", "--los-op", "a.yml", "template", "--los-op", "b.yml", "eigen"]).losOp, [
    { pad: "a.yml", keuze: "template" },
    { pad: "b.yml", keuze: "eigen" },
  ]);
  assert.throws(() => leesArgumenten(["--raar"]), /onbekend argument/);
  assert.equal(zonderLogin("fatal: https://bart:ghp_x@github.com/k/a"), "fatal: https://***@github.com/k/a");
});

test("controleerWerkmap weigert alles wat niet uit een droogloop komt", () => {
  const tmp = tijdelijkeMap("cw-");
  try {
    assert.equal(controleerWerkmap(null, { tmp }).eigen, false);
    assert.match(controleerWerkmap(null, { tmp }).fout, /--werkmap/);
    assert.match(controleerWerkmap("/etc", { tmp }).fout, /tijdelijke map/);
    const goed = join(tmp, `${WERKMAP_PREFIX}abc`);
    mkdirSync(goed);
    const zonderToestand = controleerWerkmap(goed, { tmp });
    assert.match(zonderToestand.fout, /geen droogloop/);
    assert.equal(zonderToestand.eigen, false, "zonder toestand.json is de map niet bewezen van ons");
    writeFileSync(join(goed, "toestand.json"), "{}");
    assert.deepEqual(controleerWerkmap(goed, { tmp }), { fout: null, eigen: true });
    const verouderd = controleerWerkmap(goed, { tmp, nu: Date.now() + 2 * 3600 * 1000 });
    assert.match(verouderd.fout, /ouder dan een uur/);
    assert.equal(verouderd.eigen, true, "een verouderde map is wel van ons en mag opgeruimd worden");
    assert.match(controleerWerkmap(join(tmp, "andere-abc"), { tmp }).fout, /tijdelijke map/);
  } finally {
    opruimen(tmp);
  }
});

test("voorcontrole: gh niet ingelogd, geen netwerk, geen manifest, geen schrijfrecht; niets gekloond", () => {
  const w = wereld({ gh: { ...GH_STANDAARD, "auth status": { exit: 1, stderr: "not logged in" } } });
  try {
    const r = w.draai(["--json", "--droogloop"]);
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /gh auth login/);
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }

  const n = wereld();
  try {
    // Ook hier de nep-gh op het PATH: anders zegt een niet-ingelogde echte gh (CI) iets anders.
    const r = n.draai(["--droogloop"], { STACK_TEMPLATE_REPO: join(n.wortel, "bestaat-niet") });
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /niet bereikbaar/);
    assert.deepEqual(n.werkmappen(), []);
  } finally {
    n.opruimen();
  }

  const m = wereld();
  try {
    git(m.klant.checkout, "rm", "-q", ".claude/stack-version");
    const r = m.draai(["--droogloop"]);
    assert.equal(r.status, "geen-template");
    assert.deepEqual(m.werkmappen(), []);
  } finally {
    m.opruimen();
  }

  const v = wereld();
  try {
    // Een app uit de Vercel-template: geen variant in het manifest. Die is van de andere plugin.
    const pad = join(v.klant.checkout, ".claude", "stack-manifest.json");
    const { variant, ...vercel } = JSON.parse(readFileSync(pad, "utf8"));
    assert.equal(variant, "cloudflare");
    writeFileSync(pad, JSON.stringify(vercel));
    const r = v.draai(["--droogloop"]);
    assert.equal(r.status, "ander-spoor");
    assert.match(r.reden, /Vercel/);
    assert.deepEqual(v.werkmappen(), []);
  } finally {
    v.opruimen();
  }

  const s = wereld();
  try {
    git(s.klant.checkout, "remote", "set-url", "--push", "origin", join(s.wortel, "alleen-lezen.git"));
    const r = s.draai(["--droogloop"]);
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /schrijfrecht/);
    assert.deepEqual(s.werkmappen(), [], "na een mislukte voorcontrole is er geen tijdelijke map meer");
  } finally {
    s.opruimen();
  }
});

test("open PR van de beheerde run voor dezelfde versie: gestopt met de URL, niets gekloond", () => {
  const w = wereld({
    gh: { ...GH_STANDAARD, "pr list": { stdout: [{ number: 7, headRefName: "stack-sync/v9", url: "https://github.com/klant/app/pull/7" }] } },
  });
  try {
    const r = w.draai(["--droogloop"]);
    assert.equal(r.status, "gestopt");
    assert.match(r.reden, /pull\/7/);
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }
});

test("gh pr list faalt: mislukt met een reden over de pull requests, niets gekloond", () => {
  const w = wereld({ gh: { ...GH_STANDAARD, "pr list": { exit: 1, stderr: "boom" } } });
  try {
    const r = w.draai(["--json", "--droogloop"]);
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /pull requests/);
    assert.match(r.reden, /boom/);
    assert.deepEqual(w.werkmappen(), [], "de fout valt vóór het klonen; er is geen werkmap");
  } finally {
    w.opruimen();
  }
});

test("droogloop zonder afwijkingen: resultaat noemt de paden, werkmap staat klaar, niets op origin (AE3)", () => {
  const w = wereld();
  try {
    const voor = alleBestanden(w.klant.checkout);
    const r = w.draai(["--json", "--droogloop"]);
    assert.equal(r.status, "klaar", r.reden);
    assert.equal(r.van, 8);
    assert.equal(r.naar, 9);
    assert.equal(r.branch, "stack-bijwerken/v9");
    assert.ok(r.bijgewerkt.some((b) => b.pad === "CLAUDE.md"));
    assert.deepEqual(r.verwijderd, ["scripts/guard-oud.mjs"]);
    assert.deepEqual(r.overgeslagen, []);
    assert.equal(r.samenvatting.length, 3);
    assert.ok(r.werkmap.startsWith(w.tmp));
    assert.equal(statSync(r.werkmap).mode & 0o777, 0o700);
    assert.equal(git(w.klant.origin, "branch", "--list", "stack-bijwerken/v9"), "", "droogloop pusht niets");
    assert.deepEqual(alleBestanden(w.klant.checkout), voor, "de checkout van de klant is onaangeroerd");
    // De template-kloon staat op de tag, niet op main.
    assert.ok(readFileSync(join(r.werkmap, "template", "CLAUDE.md"), "utf8").includes("versie 9"));
  } finally {
    w.opruimen();
  }
});

test("echte run: branch op origin met de identiteit van de klant, main onaangeroerd, PR met bevestigingsregel, werkmap weg (AE3)", () => {
  const w = wereld();
  try {
    const mainVoor = git(w.klant.origin, "rev-parse", "main");
    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    const r = w.draai(["--json", "--werkmap", d.werkmap]);
    assert.equal(r.status, "gepusht", r.reden);
    assert.equal(r.gepusht, true);
    assert.deepEqual(r.pr, { url: "https://github.com/klant/app/pull/1", nieuw: true });
    assert.equal(r.vergelijkUrl, null);
    assert.ok(!existsSync(d.werkmap), "de tijdelijke map is opgeruimd");
    assert.equal(git(w.klant.origin, "rev-parse", "main"), mainVoor);
    assert.equal(git(w.klant.origin, "log", "-1", "--format=%an <%ae>", "stack-bijwerken/v9"), "Bart Klant <bart@example.com>");
    assert.match(git(w.klant.origin, "log", "-1", "--format=%B", "stack-bijwerken/v9"), /Stack-bijwerken: v9/);
    assert.equal(git(w.klant.origin, "show", "stack-bijwerken/v9:.claude/stack-version"), "9");
    const create = w.nep.aanroepen().find((a) => a[0] === "pr" && a[1] === "create");
    assert.equal(create[create.indexOf("--repo") + 1], "klant/app");
    const body = create[create.indexOf("--body") + 1];
    assert.ok(body.endsWith(BEVESTIGING));
    assert.ok(body.includes("/stack-cloudflare:updaten"));
    assert.ok(!body.includes("Stage Two stack-sync"));
    // Geen commit als Stage Two in de klantrepo vanuit de skill.
    assert.ok(!git(w.klant.origin, "log", "--format=%an", "stack-bijwerken/v9").includes("Stage Two"));
  } finally {
    w.opruimen();
  }
});

test("--repo: een andere app bijwerken zonder dat die op deze computer staat, met de globale git-naam", () => {
  const w = wereld();
  const leeg = tijdelijkeMap("lege-map-");
  // Geen open app: de naam komt uit de globale git-config (hier via de omgeving).
  const identiteit = {
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_1: "user.name",
    GIT_CONFIG_VALUE_1: "Bart Globaal",
    GIT_CONFIG_KEY_2: "user.email",
    GIT_CONFIG_VALUE_2: "bart@globaal.example",
  };
  try {
    const mainVoor = git(w.klant.origin, "rev-parse", "main");
    const d = w.draai(["--json", "--droogloop", "--repo", "klant/app", "--checkout", leeg], identiteit);
    assert.equal(d.status, "klaar", d.reden);
    assert.equal(d.repo, "klant/app");
    assert.equal(d.van, 8);
    const r = w.draai(["--json", "--werkmap", d.werkmap], identiteit);
    assert.equal(r.status, "gepusht", r.reden);
    assert.equal(git(w.klant.origin, "rev-parse", "main"), mainVoor);
    assert.equal(git(w.klant.origin, "log", "-1", "--format=%an <%ae>", "stack-bijwerken/v9"), "Bart Globaal <bart@globaal.example>");
    const create = w.nep.aanroepen().find((a) => a[0] === "pr" && a[1] === "create");
    assert.equal(create[create.indexOf("--repo") + 1], "klant/app");
  } finally {
    opruimen(leeg);
    w.opruimen();
  }
});

test("--repo: ongeldige naam, al bij, en zonder gh; nooit een werkmap achtergelaten", () => {
  const w = wereld();
  try {
    const fout = w.draai(["--droogloop", "--repo", "geen-schuine-streep"]);
    assert.equal(fout.status, "mislukt");
    assert.match(fout.reden, /eigenaar\/naam/);

    // De app op GitHub op 9 zetten: dan staat hij al bij en blijft er niets achter.
    git(w.klant.checkout, "checkout", "-q", "main");
    writeFileSync(join(w.klant.checkout, ".claude/stack-version"), "9\n");
    git(w.klant.checkout, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "v9");
    git(w.klant.checkout, "push", "-q", w.klant.origin, "main");
    const bij = w.draai(["--droogloop", "--repo", "klant/app"]);
    assert.equal(bij.status, "bij", bij.reden);
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }

  const z = wereld({ gh: { "--version": { exit: 127 } } });
  try {
    const r = z.draai(["--droogloop", "--repo", "klant/app"]);
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /installatie/);
  } finally {
    z.opruimen();
  }
});

test("tweede run vóór de merge: dezelfde branch, geen tweede PR, geen push als de boom gelijk is", () => {
  const w = wereld();
  try {
    const d1 = w.draai(["--droogloop"]);
    assert.equal(w.draai(["--werkmap", d1.werkmap]).status, "gepusht");
    const shaVoor = git(w.klant.origin, "rev-parse", "stack-bijwerken/v9");
    w.nep.zet({ ...GH_STANDAARD, "pr list": { stdout: [{ number: 1, headRefName: "stack-bijwerken/v9", url: "https://github.com/klant/app/pull/1" }] } });
    const d2 = w.draai(["--droogloop"]);
    assert.equal(d2.status, "klaar", d2.reden);
    const r = w.draai(["--werkmap", d2.werkmap]);
    assert.equal(r.status, "gepusht");
    assert.equal(r.gepusht, false);
    assert.deepEqual(r.pr, { url: "https://github.com/klant/app/pull/1", number: 1, nieuw: false });
    assert.equal(git(w.klant.origin, "rev-parse", "stack-bijwerken/v9"), shaVoor, "niets gepusht: dezelfde commit");
    assert.equal(w.nep.aanroepen().filter((a) => a[0] === "pr" && a[1] === "create").length, 1);
  } finally {
    w.opruimen();
  }
});

test("run na de merge: status bij", () => {
  const w = wereld();
  try {
    const d = w.draai(["--droogloop"]);
    w.draai(["--werkmap", d.werkmap]);
    // De klant merget de PR: main op origin krijgt de branch; zijn checkout haalt hem op.
    git(w.klant.origin, "update-ref", "refs/heads/main", "refs/heads/stack-bijwerken/v9");
    git(w.klant.checkout, "pull", "-q", w.klant.origin, "main");
    const r = w.draai(["--droogloop"]);
    assert.equal(r.status, "bij");
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }
});

test("kapotte toestand.json: mislukt zonder stack trace en de werkmap is weg", () => {
  const w = wereld();
  try {
    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    writeFileSync(join(d.werkmap, "toestand.json"), "dit is geen json {{{\n");
    const r = w.draai(["--json", "--werkmap", d.werkmap]);
    assert.equal(r.status, "mislukt");
    assert.ok(r.reden.length > 0);
    assert.ok(!existsSync(d.werkmap), "de kapotte werkmap is opgeruimd");
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }
});

test("droogloop ouder dan een uur: mislukt en de werkmap is opgeruimd", () => {
  const w = wereld();
  try {
    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    const tweeUurTerug = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(join(d.werkmap, "toestand.json"), tweeUurTerug, tweeUurTerug);
    const r = w.draai(["--json", "--werkmap", d.werkmap]);
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /ouder dan een uur/);
    assert.ok(!existsSync(d.werkmap), "de verouderde werkmap is opgeruimd");
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }
});

test("afwijking: droogloop toont het verschil, --los-op template neemt over, eigen laat staan (AE5)", () => {
  const w = wereld();
  try {
    const co = w.klant.checkout;
    writeFileSync(join(co, "CLAUDE.md"), "@AGENTS.md\n<!-- eigen aanpassing -->\n");
    writeFileSync(join(co, ".github/workflows/ci.yml"), "name: CI\nsteps:\n  - run: echo eigen\n");
    git(co, "add", "-A");
    git(co, "-c", "user.name=B", "-c", "user.email=b@b", "commit", "-q", "-m", "eigen aanpassingen");
    git(co, "push", "-q", w.klant.origin, "HEAD:main");

    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    assert.deepEqual(d.overgeslagen.map((s) => s.pad).sort(), [".github/workflows/ci.yml", "CLAUDE.md"]);
    assert.ok(d.overgeslagen.every((s) => s.verschil.includes("@@")));

    const fout = w.draai(["--werkmap", d.werkmap, "--los-op", "src/App.tsx", "template"]);
    assert.equal(fout.status, "mislukt");
    assert.match(fout.reden, /niet in de lijst/);
    assert.ok(!existsSync(d.werkmap));

    const d2 = w.draai(["--droogloop"]);
    const r = w.draai(["--werkmap", d2.werkmap, "--los-op", "CLAUDE.md", "template", "--los-op", ".github/workflows/ci.yml", "eigen"]);
    assert.equal(r.status, "gepusht", r.reden);
    assert.deepEqual(r.opgelost, [{ pad: "CLAUDE.md", keuze: "template" }, { pad: ".github/workflows/ci.yml", keuze: "eigen" }]);
    assert.deepEqual(r.overgeslagen, []);
    assert.ok(git(w.klant.origin, "show", "stack-bijwerken/v9:CLAUDE.md").includes("versie 9"));
    assert.ok(git(w.klant.origin, "show", "stack-bijwerken/v9:.github/workflows/ci.yml").includes("echo eigen"));
    const body = w.nep.aanroepen().find((a) => a[0] === "pr" && a[1] === "create").at(-1);
    assert.ok(body.includes("de eigen versie behouden"));
  } finally {
    w.opruimen();
  }
});

test("AGENTS.md zonder markeringen: overgeslagen met reden, --los-op template weigert (projectdeel), eigen slaagt", () => {
  const w = wereld();
  try {
    const co = w.klant.checkout;
    writeFileSync(join(co, "AGENTS.md"), "# Mijn app\nEen app voor de kwekerij.\n\nAfspraken versie 8, zonder markeringen\n");
    git(co, "add", "-A");
    git(co, "-c", "user.name=B", "-c", "user.email=b@b", "commit", "-q", "-m", "markeringen per ongeluk weggehaald");
    git(co, "push", "-q", w.klant.origin, "HEAD:main");

    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    const agents = d.overgeslagen.find((s) => s.pad === "AGENTS.md");
    assert.ok(agents, "AGENTS.md staat bij overgeslagen");
    assert.match(agents.reden, /markeringen stack:begin en stack:end ontbreken/);

    const fout = w.draai(["--werkmap", d.werkmap, "--los-op", "AGENTS.md", "template"]);
    assert.equal(fout.status, "mislukt");
    assert.match(fout.reden, /projectdeel/);
    assert.ok(!existsSync(d.werkmap), "na de weigering is de werkmap weg");

    const d2 = w.draai(["--droogloop"]);
    assert.equal(d2.status, "klaar", d2.reden);
    const r = w.draai(["--werkmap", d2.werkmap, "--los-op", "AGENTS.md", "eigen"]);
    assert.equal(r.status, "gepusht", r.reden);
    assert.deepEqual(r.opgelost, [{ pad: "AGENTS.md", keuze: "eigen" }]);
    assert.ok(git(w.klant.origin, "show", "stack-bijwerken/v9:AGENTS.md").includes("zonder markeringen"), "de eigen versie staat op de branch");
    assert.ok(!existsSync(d2.werkmap));
  } finally {
    w.opruimen();
  }
});

test("branch op afstand met een vreemde commit: gestopt en onaangeroerd; alleen skill-commits: herbouwd", () => {
  const w = wereld();
  try {
    const d = w.draai(["--droogloop"]);
    w.draai(["--werkmap", d.werkmap]);
    const eerste = git(w.klant.origin, "rev-parse", "stack-bijwerken/v9");
    // Alleen skill-commits: een tweede droogloop bouwt de branch opnieuw op (zelfde boom).
    const d2 = w.draai(["--droogloop"]);
    assert.equal(d2.status, "klaar");
    assert.ok(!existsSync(join(d2.werkmap, "x")));
    // Nu commit iemand zelf op de branch.
    const ander = join(w.wortel, "ander");
    execFileSync("git", ["clone", "-q", w.klant.origin, ander]);
    git(ander, "checkout", "-q", "stack-bijwerken/v9");
    writeFileSync(join(ander, "eigen.txt"), "x\n");
    git(ander, "add", "-A");
    git(ander, "-c", "user.name=K", "-c", "user.email=k@k", "commit", "-q", "-m", "eigen werk op de branch");
    git(ander, "push", "-q", "origin", "stack-bijwerken/v9");
    const tweede = git(w.klant.origin, "rev-parse", "stack-bijwerken/v9");
    assert.notEqual(tweede, eerste);
    const r = w.draai(["--droogloop"]);
    assert.equal(r.status, "gestopt");
    assert.match(r.reden, /niet van \/stack-cloudflare:updaten/);
    assert.equal(git(w.klant.origin, "rev-parse", "stack-bijwerken/v9"), tweede, "branch onaangeroerd");
    assert.deepEqual(w.werkmappen(), [d2.werkmap.split("/").pop()], "geen nieuwe werkmap; alleen die van de eerdere droogloop");
    // Ook de tweede aanroep van die eerdere droogloop mag de vreemde commit niet overschrijven.
    const laat = w.draai(["--werkmap", d2.werkmap]);
    assert.equal(laat.status, "gestopt");
    assert.equal(git(w.klant.origin, "rev-parse", "stack-bijwerken/v9"), tweede, "branch nog steeds onaangeroerd");
    assert.deepEqual(w.werkmappen(), []);
  } finally {
    w.opruimen();
  }
});

test("vuile checkout op een andere branch: de run slaagt en de checkout is byte-identiek na afloop", () => {
  const w = wereld();
  try {
    const co = w.klant.checkout;
    git(co, "checkout", "-q", "-b", "feature/iets");
    writeFileSync(join(co, "src/App.tsx"), "// half werk\n");
    writeFileSync(join(co, "nieuw.txt"), "los\n");
    const voor = alleBestanden(co);
    const statusVoor = git(co, "status", "--porcelain");
    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    assert.equal(w.draai(["--werkmap", d.werkmap]).status, "gepusht");
    assert.deepEqual(alleBestanden(co), voor);
    assert.equal(git(co, "status", "--porcelain"), statusVoor);
    assert.equal(git(co, "branch", "--show-current"), "feature/iets");
  } finally {
    w.opruimen();
  }
});

test("zonder gh: geen PR maar wel de branch en de vergelijkings-URL", () => {
  const w = wereld({ gh: { "--version": { exit: 127 } } });
  try {
    git(w.klant.checkout, "remote", "set-url", "origin", w.klant.origin);
    const d = w.draai(["--droogloop"]);
    assert.equal(d.status, "klaar", d.reden);
    const r = w.draai(["--werkmap", d.werkmap]);
    assert.equal(r.status, "gepusht", r.reden);
    assert.equal(r.pr, null);
    assert.equal(r.vergelijkUrl, null, "een lokale origin heeft geen GitHub-URL");
    assert.equal(git(w.klant.origin, "show", "stack-bijwerken/v9:.claude/stack-version"), "9");
  } finally {
    w.opruimen();
  }
});

test("het script als opdracht: --json geeft één JSON-object en de exitcode volgt de status", () => {
  const w = wereld();
  try {
    const uit = execFileSync("node", [SCRIPT, "--json", "--droogloop"], { cwd: w.klant.checkout, env: w.env, encoding: "utf8" });
    const r = JSON.parse(uit);
    assert.equal(r.status, "klaar");
    let code = 0;
    let fout = null;
    try {
      execFileSync("node", [SCRIPT, "--json", "--werkmap", "/etc"], { cwd: w.klant.checkout, env: w.env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      code = e.status;
      fout = JSON.parse(e.stdout);
    }
    assert.equal(code, 1);
    assert.equal(fout.status, "mislukt");
    w.draai(["--werkmap", r.werkmap]);
  } finally {
    w.opruimen();
  }
});
