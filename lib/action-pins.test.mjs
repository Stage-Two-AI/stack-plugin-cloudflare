import assert from "node:assert/strict";
import { test } from "node:test";
import { metNieuwsteActionPins, zonderActionPins } from "./action-pins.mjs";

const template = `steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - name: Rapport
        uses: actions/upload-artifact@v4
`;
const bijKlant = template
  .replace("checkout@v5", "checkout@v7")
  .replace("action-setup@v4", "action-setup@v6");

test("een Dependabot-bump van een action-pin telt niet als lokale afwijking", () => {
  assert.equal(zonderActionPins(template), zonderActionPins(bijKlant));
});

test("een echte aanpassing telt wél", () => {
  const aangepast = bijKlant.replace("version: 10", "version: 9");
  assert.notEqual(zonderActionPins(template), zonderActionPins(aangepast));
});

test("de nieuwste pin wint, per action", () => {
  const nieuweTemplate = template.replace("upload-artifact@v4", "upload-artifact@v9");
  const uitkomst = metNieuwsteActionPins(nieuweTemplate, bijKlant);
  assert.match(uitkomst, /checkout@v7/);
  assert.match(uitkomst, /action-setup@v6/);
  assert.match(uitkomst, /upload-artifact@v9/);
});

test("zonder bestaand bestand blijft de template zoals hij is", () => {
  assert.equal(metNieuwsteActionPins(template, null), template);
});

test("een pin die geen simpele major is laat de template winnen", () => {
  const sha = bijKlant.replace("checkout@v7", "checkout@abc123def");
  assert.match(metNieuwsteActionPins(template, sha), /checkout@v5/);
});
