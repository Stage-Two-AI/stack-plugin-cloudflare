import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formaatOndersteund,
  leesManifest,
  toegestaan,
  tussenMarkeringen,
  voegSleutelsSamen,
} from "./manifest.mjs";

const manifestTekst = JSON.stringify({
  stackVersion: 9,
  vanDeTemplate: {
    vervangen: ["CLAUDE.md", ".claude/stack-version"],
    sleutelsSamenvoegen: { "package.json": ["scripts", "devDependencies"] },
    tussenMarkeringen: { "AGENTS.md": "stack" },
  },
  vanHetProject: ["src/**"],
});

test("leesManifest: velden en formaat 1 als standaard", () => {
  const m = leesManifest(manifestTekst);
  assert.equal(m.formaat, 1);
  assert.equal(m.stackVersion, 9);
  assert.deepEqual(m.vervangen, ["CLAUDE.md", ".claude/stack-version"]);
  assert.deepEqual([...toegestaan(m)].sort(), [".claude/stack-version", "AGENTS.md", "CLAUDE.md", "package.json"]);
  assert.ok(formaatOndersteund(m));
});

test("een nieuwer manifestformaat wordt niet ondersteund, een ouder of gelijk wel", () => {
  assert.equal(formaatOndersteund(leesManifest('{"manifestFormaat": 2}')), false);
  assert.equal(formaatOndersteund(leesManifest('{"manifestFormaat": 1}')), true);
  assert.equal(formaatOndersteund(leesManifest('{"manifestFormaat": "x"}')), false);
});

test("tussenMarkeringen: alleen het deel tussen de markeringen wordt vervangen", () => {
  const bestaand = "# Mijn app\n<!-- stack:begin -->\noud\n<!-- stack:end -->\nstaart\n";
  const nieuw = "kop\n<!-- stack:begin -->\nnieuw\n<!-- stack:end -->\n";
  assert.equal(
    tussenMarkeringen(bestaand, nieuw, "stack"),
    "# Mijn app\n<!-- stack:begin -->\nnieuw\n<!-- stack:end -->\nstaart\n",
  );
  assert.equal(tussenMarkeringen("zonder markeringen", nieuw, "stack"), null);
});

test("voegSleutelsSamen: scripts wint de template, eigen extra's blijven, sleutels gesorteerd", () => {
  const uit = JSON.parse(
    voegSleutelsSamen(
      JSON.stringify({ name: "app", scripts: { dev: "oud", eigen: "x" } }),
      JSON.stringify({ scripts: { dev: "nieuw", test: "vitest" } }),
      ["scripts"],
    ),
  );
  assert.deepEqual(uit, { name: "app", scripts: { dev: "nieuw", eigen: "x", test: "vitest" } });
  assert.deepEqual(Object.keys(uit.scripts), ["dev", "eigen", "test"]);
});

test("voegSleutelsSamen: devDependencies erbij waar ze ontbreken, hoogste versie wint, eigen blijven", () => {
  const uit = JSON.parse(
    voegSleutelsSamen(
      JSON.stringify({ devDependencies: { vitest: "^3.2.0", eigen: "1.0.0", biome: "2.0.0" } }),
      JSON.stringify({ devDependencies: { vitest: "^3.1.0", biome: "2.1.0", nieuw: "^1.0.0" } }),
      ["devDependencies"],
    ),
  );
  assert.deepEqual(uit.devDependencies, {
    biome: "2.1.0",
    eigen: "1.0.0",
    nieuw: "^1.0.0",
    vitest: "^3.2.0",
  });
});

test("voegSleutelsSamen: een onvergelijkbare versie laat de template winnen", () => {
  const uit = JSON.parse(
    voegSleutelsSamen(
      JSON.stringify({ devDependencies: { x: "github:iemand/x" } }),
      JSON.stringify({ devDependencies: { x: "^2.0.0" } }),
      ["devDependencies"],
    ),
  );
  assert.equal(uit.devDependencies.x, "^2.0.0");
});

test("voegSleutelsSamen: een sleutel die de template niet heeft blijft onaangeroerd", () => {
  const bron = JSON.stringify({ scripts: { a: "1" } });
  assert.equal(voegSleutelsSamen(bron, "{}", ["scripts"]), `${JSON.stringify({ scripts: { a: "1" } }, null, 2)}\n`);
});
