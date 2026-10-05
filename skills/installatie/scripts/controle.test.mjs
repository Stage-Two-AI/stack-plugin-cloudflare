import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tijdelijkeMap } from "../../../lib/test-hulp.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "controle.sh");
const BASH = execFileSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim();

/** Een PATH met alleen verzonnen programma's, zodat de test niet van deze machine afhangt. */
function nepPad(programmas) {
  const bin = tijdelijkeMap("controle-bin-");
  for (const [naam, script] of Object.entries(programmas)) {
    writeFileSync(join(bin, naam), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, naam), 0o755);
  }
  // De basisgereedschappen die het script zelf gebruikt (head, grep, sed, uname, cut).
  for (const nodig of ["head", "grep", "sed", "uname", "cut", "printf"]) {
    let echt;
    try {
      echt = execFileSync("sh", ["-c", `command -v ${nodig}`], { encoding: "utf8" }).trim();
    } catch {
      continue;
    }
    if (echt) writeFileSync(join(bin, nodig), `#!/bin/sh\nexec ${echt} "$@"\n`), chmodSync(join(bin, nodig), 0o755);
  }
  return bin;
}

function draai(bin, args = [], home = tijdelijkeMap("controle-home-")) {
  const uit = execFileSync(BASH, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: bin, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
  });
  return Object.fromEntries(uit.trim().split("\n").map((r) => r.split(/=(.*)/s).slice(0, 2)));
}

test("een verse computer: alles ontbreekt", () => {
  const bin = nepPad({});
  const uit = draai(bin);
  assert.equal(uit.git, "ontbreekt");
  assert.equal(uit.node, "ontbreekt");
  assert.equal(uit.pnpm, "ontbreekt");
  assert.equal(uit.gh, "ontbreekt");
  assert.equal(uit.git_identiteit, "ontbreekt");
  assert.equal(uit.gh_ingelogd, undefined, "zonder gh geen inlogregel");
});

test("alles aanwezig, gh ingelogd, node te oud wordt gemeld", () => {
  const bin = nepPad({
    git: 'case "$1" in --version) echo "git version 2.55.0.windows.1";; config) exit 1;; esac',
    node: 'echo "v20.11.0"',
    pnpm: 'echo "10.4.1"',
    gh: 'case "$1 $2" in "--version ") echo "gh version 2.101.0 (2026-01-01)";; "auth status") exit 0;; "api user") echo "bart";; esac',
  });
  const uit = draai(bin);
  assert.equal(uit.git, "2.55.0");
  assert.equal(uit.node, "20.11.0");
  assert.equal(uit.node_te_oud, "ja");
  assert.equal(uit.pnpm, "10.4.1");
  assert.equal(uit.gh, "2.101.0");
  assert.equal(uit.gh_ingelogd, "bart");
});

test("gh aanwezig maar niet ingelogd", () => {
  const bin = nepPad({
    gh: 'case "$1 $2" in "--version ") echo "gh version 2.101.0";; "auth status") exit 1;; esac',
  });
  assert.equal(draai(bin).gh_ingelogd, "nee");
});

test("identiteit zetten: uit het GitHub-profiel, noreply-adres als het e-mailadres privé is, en bestaande instelling blijft", () => {
  const home = tijdelijkeMap("controle-home-");
  const echtGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = nepPad({
    git: `exec ${echtGit} "$@"`,
    gh: [
      'case "$*" in',
      '  "--version") echo "gh version 2.101.0";;',
      '  "auth status") exit 0;;',
      '  "api user -q .login") echo "bart";;',
      '  "api user -q .name // empty") echo "Bart Jansen";;',
      '  "api user -q .email // empty") echo "";;',
      '  "api user -q .id") echo "12345";;',
      "esac",
    ].join("\n"),
  });
  const eerste = draai(bin, ["--zet-identiteit"], home);
  assert.equal(eerste.identiteit, "gezet");
  const config = execFileSync(BASH, ["-c", `git config --global user.name; git config --global user.email`], {
    encoding: "utf8",
    env: { PATH: bin, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
  });
  assert.equal(config, "Bart Jansen\n12345+bart@users.noreply.github.com\n");

  // Tweede keer: er staat al iets, dat blijft.
  execFileSync(BASH, ["-c", `git config --global user.name "Andere Naam"`], {
    env: { PATH: bin, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
  });
  const tweede = draai(bin, ["--zet-identiteit"], home);
  assert.equal(tweede.git_identiteit, "Andere Naam <12345+bart@users.noreply.github.com>");
});
