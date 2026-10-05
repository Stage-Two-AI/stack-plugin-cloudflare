import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  alGelijkOpGitHub,
  branchHerbouwbaar,
  checkoutTag,
  commit,
  gewijzigdePaden,
  gitIdentiteit,
  gitVoorKern,
  hoogsteTagVersie,
  kloonRepo,
  kloonTemplate,
  kloonUrl,
  maakBranch,
  openOfWerkPRBij,
  openPRVoorVersie,
  push,
  pushDroog,
  repoUitUrl,
  sh,
  sluitOuderePRs,
  versieOpAfstand,
} from "./repo.mjs";
import { commit as testCommit, git, maakKlantRepo, maakTemplateRepo, nepGh, opruimen, tijdelijkeMap } from "./test-hulp.mjs";

test("sh: een blokkerend subproces blijft begrensd, een eigen timeout wint van de standaard", () => {
  assert.throws(() => sh("sleep", ["5"], { timeout: 200 }), (fout) => fout.killed === true || fout.signal === "SIGTERM");
  assert.throws(() => sh("sleep", ["5"], { timeout: 50 }), (fout) => fout.killed === true || fout.signal === "SIGTERM");
  assert.equal(sh("sh", ["-c", "sleep 0.3; echo klaar"], { timeout: 5000 }), "klaar");
});

test("kloonUrl en repoUitUrl", () => {
  assert.equal(kloonUrl("Stage-Two-AI/stack-template-cloudflare"), "https://github.com/Stage-Two-AI/stack-template-cloudflare");
  assert.equal(kloonUrl("/tmp/x"), "/tmp/x");
  assert.equal(kloonUrl("https://github.com/a/b"), "https://github.com/a/b");
  assert.equal(repoUitUrl("https://github.com/Winco-Holland-B-V/plantas.git"), "Winco-Holland-B-V/plantas");
  assert.equal(repoUitUrl("git@github.com:Winco-Holland-B-V/plantas.git"), "Winco-Holland-B-V/plantas");
  assert.equal(repoUitUrl("https://github.com/a/b/"), "a/b");
  assert.equal(repoUitUrl("/tmp/klant-origin.git"), null);
});

test("template klonen: tags mee, hoogste tag is 9, checkout op de tag en niet op main", () => {
  const wortel = tijdelijkeMap();
  try {
    const bron = maakTemplateRepo(wortel);
    const doel = kloonTemplate({ repo: bron, doel: join(wortel, "kloon") });
    assert.equal(hoogsteTagVersie(doel), 9);
    assert.equal(versieOpAfstand(bron), 9);
    checkoutTag(doel, 9);
    assert.ok(readFileSync(join(doel, "CLAUDE.md"), "utf8").includes("versie 9"));
    assert.ok(!readFileSync(join(doel, "CLAUDE.md"), "utf8").includes("alleen op main"));
    const kern = gitVoorKern(doel, doel);
    assert.ok(kern.tonenOpTag("stack-v8", "CLAUDE.md").includes("versie 8"));
    assert.equal(kern.tonenOpTag("stack-v7", "CLAUDE.md"), null);
  } finally {
    opruimen(wortel);
  }
});

test("zonder tag stack-v9 is de hoogste tag 8; op afstand onbereikbaar geeft null", () => {
  const wortel = tijdelijkeMap();
  try {
    const bron = maakTemplateRepo(wortel, { tagV9: false });
    assert.equal(hoogsteTagVersie(kloonTemplate({ repo: bron, doel: join(wortel, "kloon") })), 8);
    assert.equal(versieOpAfstand(join(wortel, "bestaat-niet")), null);
  } finally {
    opruimen(wortel);
  }
});

test("branch, commit met trailer, herbouwbaar, boom vergelijken, droge en echte push", () => {
  const wortel = tijdelijkeMap();
  try {
    const { origin, checkout } = maakKlantRepo(wortel);
    const kloon = kloonRepo({ url: origin, doel: join(wortel, "kloon") });
    assert.deepEqual(gitIdentiteit(checkout), { naam: "Bart Klant", email: "bart@example.com" });
    // De kloon zelf heeft geen lokale identiteit; wat git daar terugvalt op de globale
    // config is bijzaak, want we geven altijd de identiteit uit de checkout mee.

    maakBranch(kloon, "stack-bijwerken/v9");
    assert.equal(git(kloon, "branch", "--show-current"), "stack-bijwerken/v9");
    assert.ok(pushDroog(kloon, "stack-bijwerken/v9"), "schrijfrecht op de origin");
    assert.equal(git(origin, "branch", "--list", "stack-bijwerken/v9"), "", "droge push maakt niets aan");

    writeFileSync(join(kloon, "CLAUDE.md"), "nieuw\n");
    assert.deepEqual(gewijzigdePaden(kloon), ["CLAUDE.md"]);
    commit({ map: kloon, identiteit: gitIdentiteit(checkout), bericht: "chore: stack-template naar versie 9", versie: 9 });
    assert.equal(git(kloon, "log", "-1", "--format=%an <%ae>"), "Bart Klant <bart@example.com>");
    assert.match(git(kloon, "log", "-1", "--format=%B"), /Stack-bijwerken: v9/);

    assert.equal(alGelijkOpGitHub(kloon, "stack-bijwerken/v9"), false);
    push(kloon, "stack-bijwerken/v9");
    assert.equal(alGelijkOpGitHub(kloon, "stack-bijwerken/v9"), true);
    assert.equal(branchHerbouwbaar(kloon, "stack-bijwerken/v9"), true);
    assert.equal(branchHerbouwbaar(kloon, "bestaat-niet"), true);

    // Iemand commit zelf op de branch: dan blijven we ervan af.
    const ander = kloonRepo({ url: origin, doel: join(wortel, "ander") });
    git(ander, "checkout", "-q", "stack-bijwerken/v9");
    writeFileSync(join(ander, "eigen.txt"), "van de klant\n");
    git(ander, "add", "-A");
    git(ander, "-c", "user.name=K", "-c", "user.email=k@k", "commit", "-q", "-m", "eigen werk");
    git(ander, "push", "-q", "origin", "stack-bijwerken/v9");
    assert.equal(branchHerbouwbaar(kloon, "stack-bijwerken/v9"), false);
    assert.equal(git(origin, "rev-parse", "main"), git(checkout, "rev-parse", "main"), "main onaangeroerd");
  } finally {
    opruimen(wortel);
  }
});

test("droge push zonder schrijfrecht geeft false", () => {
  const wortel = tijdelijkeMap();
  try {
    const { origin, checkout } = maakKlantRepo(wortel);
    git(checkout, "remote", "set-url", "--push", "origin", join(wortel, "bestaat-niet.git"));
    assert.equal(pushDroog(checkout, "x"), false);
    assert.ok(origin);
  } finally {
    opruimen(wortel);
  }
});

test("gh-stappen met een nep-gh: open PR's voor een versie, PR openen of bijwerken, oudere sluiten", () => {
  const wortel = tijdelijkeMap();
  const gh = nepGh(wortel, {
    "pr list": { stdout: [{ number: 4, headRefName: "stack-sync/v9", url: "https://x/4" }, { number: 3, headRefName: "stack-sync/v8", url: "https://x/3" }] },
    "pr create": { stdout: "Creating pull request\nhttps://github.com/o/r/pull/5\n" },
    "pr edit": { stdout: "" },
    "pr close": { stdout: "" },
  });
  const oudPath = process.env.PATH;
  process.env.PATH = `${gh.pad}:${oudPath}`;
  try {
    assert.equal(openPRVoorVersie("o/r", 9).number, 4);
    assert.equal(openPRVoorVersie("o/r", 10), null);
    assert.deepEqual(openOfWerkPRBij({ repo: "o/r", branch: "stack-bijwerken/v9", titel: "t", tekst: "b" }), {
      url: "https://github.com/o/r/pull/5",
      nieuw: true,
    });
    assert.deepEqual(openOfWerkPRBij({ repo: "o/r", branch: "stack-sync/v9", titel: "t", tekst: "b2" }), {
      url: "https://x/4",
      number: 4,
      nieuw: false,
    });
    assert.deepEqual(sluitOuderePRs({ repo: "o/r", prefix: "stack-sync", doelVersie: 9, tekst: "dicht" }), [
      { branch: "stack-sync/v8", verwijderd: true },
    ]);
    const aanroepen = gh.aanroepen();
    assert.ok(aanroepen.some((a) => a[0] === "pr" && a[1] === "edit" && a[2] === "4" && a.includes("b2")));
    assert.ok(aanroepen.some((a) => a[0] === "pr" && a[1] === "close" && a[2] === "3" && a.includes("--delete-branch")));
    assert.ok(!aanroepen.some((a) => a[0] === "pr" && a[1] === "close" && a[2] === "4"));
  } finally {
    process.env.PATH = oudPath;
    opruimen(wortel);
  }
});

test("oudere PR's sluiten met een kloon: alleen een branch die helemaal van ons is gaat weg", () => {
  const wortel = tijdelijkeMap();
  const gh = nepGh(wortel, {
    "pr list": {
      stdout: [
        { number: 4, headRefName: "stack-bijwerken/v9", url: "https://x/4" },
        { number: 3, headRefName: "stack-bijwerken/v8", url: "https://x/3" },
        { number: 2, headRefName: "stack-bijwerken/v7", url: "https://x/2" },
      ],
    },
    "pr close": { stdout: "" },
  });
  const oudPath = process.env.PATH;
  process.env.PATH = `${gh.pad}:${oudPath}`;
  try {
    const { origin, checkout } = maakKlantRepo(wortel);
    const identiteit = gitIdentiteit(checkout);
    const kloon = kloonRepo({ url: origin, doel: join(wortel, "kloon") });

    // v7: alleen onze commits (met trailer) -> branch mag weg.
    maakBranch(kloon, "stack-bijwerken/v7");
    writeFileSync(join(kloon, "CLAUDE.md"), "versie 7\n");
    commit({ map: kloon, identiteit, bericht: "chore: stack-template naar versie 7", versie: 7 });
    push(kloon, "stack-bijwerken/v7");

    // v8: onze commit plus een commit van een mens zonder trailer -> branch blijft staan.
    maakBranch(kloon, "stack-bijwerken/v8");
    writeFileSync(join(kloon, "CLAUDE.md"), "versie 8\n");
    commit({ map: kloon, identiteit, bericht: "chore: stack-template naar versie 8", versie: 8 });
    writeFileSync(join(kloon, "eigen.txt"), "van de klant\n");
    testCommit(kloon, "eigen werk op de branch");
    push(kloon, "stack-bijwerken/v8");

    assert.deepEqual(sluitOuderePRs({ repo: "o/r", prefix: "stack-bijwerken", doelVersie: 9, tekst: "dicht", map: kloon }), [
      { branch: "stack-bijwerken/v8", verwijderd: false },
      { branch: "stack-bijwerken/v7", verwijderd: true },
    ]);
    const sluitingen = gh.aanroepen().filter((a) => a[0] === "pr" && a[1] === "close");
    assert.equal(sluitingen.length, 2);
    const voorV8 = sluitingen.find((a) => a[2] === "3");
    const voorV7 = sluitingen.find((a) => a[2] === "2");
    assert.ok(voorV8 && !voorV8.includes("--delete-branch") && voorV8.includes("dicht"), "v8: sluiten, branch laten staan");
    assert.ok(voorV7?.includes("--delete-branch"), "v7: sluiten en branch opruimen");
    assert.ok(!sluitingen.some((a) => a[2] === "4"), "de doelversie zelf blijft open");
  } finally {
    process.env.PATH = oudPath;
    opruimen(wortel);
  }
});
