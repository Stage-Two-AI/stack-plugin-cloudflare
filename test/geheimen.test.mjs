/**
 * Deze repo is openbaar vanaf de eerste commit. Deze test is de bewaker: hij loopt elk
 * tekstbestand in de boom langs én de hele git-geschiedenis (`git log -p --all`), en
 * faalt op een regel met een tokenpatroon of een publieke SSH-sleutel. Hij draait bij
 * elke `npm test` en in de CI, dus ook vóór elke merge naar main.
 *
 * Bij een treffer drukt de test alleen bestand of commit, regelnummer en patroonnaam af,
 * nooit de regel zelf: een gelekt token hoort ook niet in de testuitvoer.
 *
 * De patronen zijn dezelfde als in Stack/machines/claudecode/geheimen.test.mjs. De
 * nep-tokens hieronder zijn opgebouwd uit losse stukken, zodat dit bestand zichzelf
 * niet als lek aanmerkt.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const OVERSLAAN = new Set(["node_modules", ".git", ".context"]);

// Elk patroon eist het lijf van een echt token, niet alleen het voorvoegsel: zo mag
// documentatie "begint met ghp_" zeggen zonder dat de test afgaat.
const PATRONEN = [
  { naam: "Tailscale-sleutel (tskey-)", patroon: /tskey-[A-Za-z0-9_-]{8,}/ },
  { naam: "GitHub klassiek token (ghp_)", patroon: /ghp_[A-Za-z0-9]{20,}/ },
  { naam: "GitHub fijnmazig token (github_pat_)", patroon: /github_pat_[A-Za-z0-9_]{20,}/ },
  { naam: "PEM-blok (BEGIN)", patroon: /-{5}BEGIN/ },
  { naam: "Anthropic-sleutel (sk-ant-)", patroon: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { naam: "API-sleutel (sk-...)", patroon: /sk-[A-Za-z0-9]{20,}/ },
  { naam: "JWT (eyJ...)", patroon: /eyJ[A-Za-z0-9_\-+/=]{20,}/ },
  { naam: "publieke SSH-sleutel", patroon: /ssh-(ed25519|rsa|ecdsa-[a-z0-9-]+) AAAA/ },
];

export function zoekGeheimen(tekst) {
  const treffers = [];
  tekst.split(/\r?\n/).forEach((regel, i) => {
    for (const { naam, patroon } of PATRONEN) {
      if (patroon.test(regel)) treffers.push({ regel: i + 1, patroon: naam });
    }
  });
  return treffers;
}

function isTekst(buffer) {
  return !buffer.subarray(0, 8000).includes(0);
}

function alleBestanden(map) {
  const uit = [];
  for (const naam of readdirSync(map)) {
    if (OVERSLAAN.has(naam)) continue;
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) uit.push(...alleBestanden(pad));
    else uit.push(pad);
  }
  return uit;
}

export function zoekInBoom(wortel) {
  const lekken = [];
  for (const pad of alleBestanden(wortel)) {
    const buffer = readFileSync(pad);
    if (!isTekst(buffer)) continue;
    for (const t of zoekGeheimen(buffer.toString("utf8"))) {
      lekken.push(`${relative(wortel, pad)}:${t.regel}: ${t.patroon}`);
    }
  }
  return lekken;
}

/** De hele geschiedenis, alle branches. Buiten een git-repo: niets te doorzoeken. */
export function zoekInGeschiedenis(wortel) {
  let log;
  try {
    log = execFileSync("git", ["-C", wortel, "log", "-p", "--all", "--no-color"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const lekken = [];
  let commit = "?";
  log.split(/\r?\n/).forEach((regel) => {
    const kop = /^commit ([0-9a-f]{7})/.exec(regel);
    if (kop) commit = kop[1];
    // Alleen toegevoegde regels tellen: een verwijderde regel staat al in een eerdere
    // commit en wordt daar gemeld.
    if (!regel.startsWith("+") || regel.startsWith("+++")) return;
    for (const { naam, patroon } of PATRONEN) {
      if (patroon.test(regel)) lekken.push(`commit ${commit}: ${naam}`);
    }
  });
  return lekken;
}

// Nep-tokens, in stukken zodat deze regels zelf geen treffer zijn.
const nep = {
  ghp: ["ghp", "_", "a1B2c3".repeat(6)].join(""),
  pat: ["github", "_pat_", "11AAAA".repeat(5), "_", "xyz".repeat(8)].join(""),
  tskey: ["tskey", "-auth-", "kABCDEF", "CNTRL", "-", "abcdefgh12345678"].join(""),
  pem: ["-----", "BEGIN", " OPENSSH PRIVATE KEY-----"].join(""),
  ant: ["sk-", "ant-", "api03-", "Zz9".repeat(10)].join(""),
  sk: ["sk-", "proj", "Aa0".repeat(8)].join(""),
  jwt: ["eyJ", "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIx"].join(""),
  ssh: ["ssh-", "ed25519 ", "AAAA", "C3NzaC1lZDI1NTE5AAAAIExample"].join(""),
};

test("elk nep-token in een tekst is een treffer (de test bijt)", () => {
  for (const [soort, token] of Object.entries(nep)) {
    const treffers = zoekGeheimen(`regel een\nTOKEN=${token}\nregel drie\n`);
    assert.ok(treffers.length >= 1, `nep-token van soort ${soort} werd niet herkend`);
    assert.equal(treffers[0].regel, 2, `nep-token van soort ${soort} op de verkeerde regel`);
  }
});

test("gewone tekst met alleen een voorvoegsel is geen treffer", () => {
  assert.deepEqual(zoekGeheimen("tokens beginnen met ghp_ of github_pat_\n"), []);
});

test("een nep-token in een tijdelijke repo wordt in boom en geschiedenis gevonden", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const map = mkdtempSync(join(tmpdir(), "geheimen-"));
  try {
    const git = (...args) =>
      execFileSync("git", ["-C", map, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-q");
    writeFileSync(join(map, "config.txt"), `TOKEN=${nep.ghp}\n`);
    git("add", "config.txt");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "lek");
    assert.equal(zoekInBoom(map).length, 1);
    assert.equal(zoekInGeschiedenis(map).length, 1);
    // Weghalen uit de boom helpt niet: de geschiedenis onthoudt het.
    rmSync(join(map, "config.txt"));
    assert.equal(zoekInBoom(map).length, 0);
    assert.equal(zoekInGeschiedenis(map).length, 1);
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("geen tokenpatroon of publieke SSH-sleutel in de boom van deze repo", () => {
  const lekken = zoekInBoom(WORTEL);
  assert.deepEqual(lekken, [], `mogelijke geheimen:\n  ${lekken.join("\n  ")}`);
});

test("geen tokenpatroon of publieke SSH-sleutel in de geschiedenis van deze repo", () => {
  const lekken = zoekInGeschiedenis(WORTEL);
  assert.deepEqual(lekken, [], `mogelijke geheimen in de geschiedenis:\n  ${lekken.join("\n  ")}`);
});
