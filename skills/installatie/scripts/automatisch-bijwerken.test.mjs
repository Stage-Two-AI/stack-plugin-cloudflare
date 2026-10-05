import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { BRON, aanvullen, automatischBijwerken, instellingenPad, watOntbreekt } from "./automatisch-bijwerken.mjs";

const SCRIPT = fileURLToPath(import.meta.url).replace(/\.test\.mjs$/, ".mjs");

function metMap(fn) {
  const map = mkdtempSync(join(tmpdir(), "auto-bijwerken-"));
  try {
    return fn(map, { CLAUDE_CONFIG_DIR: map });
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
}

const lees = (map) => JSON.parse(readFileSync(join(map, "settings.json"), "utf8"));

test("pad: CLAUDE_CONFIG_DIR gaat voor, anders .claude in de gebruikersmap", () => {
  assert.equal(instellingenPad({ CLAUDE_CONFIG_DIR: "/x" }), join("/x", "settings.json"));
  assert.equal(instellingenPad({}), join(homedir(), ".claude", "settings.json"));
});

test("geen bestand: wordt aangemaakt met precies de twee instellingen", () => {
  metMap((map, env) => {
    const r = automatischBijwerken({ env });
    assert.equal(r.status, "gezet");
    assert.deepEqual(lees(map), {
      env: { FORCE_AUTOUPDATE_PLUGINS: "1" },
      extraKnownMarketplaces: { "stagetwo-cloudflare": { source: BRON, autoUpdate: true } },
    });
    assert.equal(automatischBijwerken({ env }).status, "al-goed", "tweede keer: niets te doen");
  });
});

test("bestaand bestand: alles van de gebruiker blijft staan, ook de stagetwo-regel van het Vercel-spoor en een eigen stagetwo-cloudflare-regel", () => {
  metMap((map, env) => {
    const voor = {
      theme: "dark",
      env: { EIGEN: "ja" },
      enabledPlugins: { "stack@stagetwo": true },
      extraKnownMarketplaces: {
        ander: { source: { source: "github", repo: "x/y" } },
        stagetwo: { source: { source: "github", repo: "Stage-Two-AI/stack-plugin" } },
        "stagetwo-cloudflare": { source: { source: "git", url: "https://github.com/Stage-Two-AI/stack-plugin-cloudflare.git" } },
      },
    };
    writeFileSync(join(map, "settings.json"), JSON.stringify(voor));
    const r = automatischBijwerken({ env });
    assert.equal(r.status, "gezet");
    assert.deepEqual(r.gewijzigd, ["env.FORCE_AUTOUPDATE_PLUGINS", "extraKnownMarketplaces.stagetwo-cloudflare.autoUpdate"]);
    const na = lees(map);
    assert.equal(na.theme, "dark");
    assert.deepEqual(na.env, { EIGEN: "ja", FORCE_AUTOUPDATE_PLUGINS: "1" });
    assert.deepEqual(na.enabledPlugins, voor.enabledPlugins);
    assert.deepEqual(na.extraKnownMarketplaces.ander, voor.extraKnownMarketplaces.ander);
    assert.deepEqual(na.extraKnownMarketplaces.stagetwo, voor.extraKnownMarketplaces.stagetwo, "het Vercel-spoor blijft onaangeroerd");
    assert.deepEqual(na.extraKnownMarketplaces["stagetwo-cloudflare"], {
      source: voor.extraKnownMarketplaces["stagetwo-cloudflare"].source,
      autoUpdate: true,
    });
  });
});

test("--controle schrijft niets; kapotte JSON wordt nooit aangeraakt", () => {
  metMap((map, env) => {
    const c = automatischBijwerken({ env, controle: true });
    assert.equal(c.status, "ontbreekt");
    assert.equal(c.ontbreekt.length, 3);
    assert.ok(!existsSync(join(map, "settings.json")));

    writeFileSync(join(map, "settings.json"), "{ dit is geen json");
    const r = automatischBijwerken({ env });
    assert.equal(r.status, "mislukt");
    assert.match(r.reden, /geen geldige JSON/);
    assert.equal(readFileSync(join(map, "settings.json"), "utf8"), "{ dit is geen json");
  });
});

test("zuivere functies: watOntbreekt en aanvullen laten het origineel staan", () => {
  const leeg = {};
  assert.equal(watOntbreekt(leeg).length, 3);
  const aangevuld = aanvullen(leeg);
  assert.deepEqual(leeg, {});
  assert.deepEqual(watOntbreekt(aangevuld), []);
});

test("als opdracht: één JSON-object, exitcode 0 bij gezet", () => {
  metMap((map) => {
    mkdirSync(map, { recursive: true });
    const uit = execFileSync(process.execPath, [SCRIPT, "--json"], { env: { ...process.env, CLAUDE_CONFIG_DIR: map }, encoding: "utf8" });
    assert.equal(JSON.parse(uit).status, "gezet");
  });
});
