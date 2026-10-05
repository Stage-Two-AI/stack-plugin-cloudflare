#!/usr/bin/env node
/**
 * Zet automatisch bijwerken van de Stage Two-plugin aan, op gebruikersniveau
 * (~/.claude/settings.json), zodat de klant nooit zelf een commando hoeft te typen.
 *
 *   node automatisch-bijwerken.mjs --json [--controle]
 *
 * Waarom dit nodig is (vastgesteld 02-10-2026 op Windows, Claude desktop-app):
 *   - De desktop-app start Claude Code met DISABLE_AUTOUPDATER=1. Dat zet ook het
 *     bijwerken van plugins uit, tenzij FORCE_AUTOUPDATE_PLUGINS=1 er ook staat.
 *   - Een marketplace die de klant zelf toevoegt, krijgt geen autoUpdate; voor een
 *     marketplace die niet van Anthropic is, staat dat standaard uit.
 * `autoUpdate` in de .claude/settings.json van een app helpt daarom niet in de
 * desktop-app, en ook niet in een lege map. Op gebruikersniveau geldt het overal.
 *
 * Het script zet precies twee dingen en laat de rest van het bestand staan:
 *   env.FORCE_AUTOUPDATE_PLUGINS = "1"
 *   extraKnownMarketplaces.stagetwo-cloudflare = { source: github Stage-Two-AI/stack-plugin-cloudflare, autoUpdate: true }
 * Een bestaande stagetwo-cloudflare-regel (en een eventuele stagetwo-regel van het Vercel-spoor) houdt zijn eigen velden; alleen autoUpdate (en een
 * ontbrekende source) wordt aangevuld. Is het bestand geen geldige JSON, dan raakt het
 * script het niet aan.
 *
 * Uitkomst: één JSON-object met `status`:
 *   al-goed   alles stond er al
 *   gezet     het bestand is aangevuld; `gewijzigd` zegt wat (werkt vanaf de volgende start)
 *   ontbreekt (alleen met --controle) wat er nog mist, in `ontbreekt`; er is niets geschreven
 *   mislukt   `reden` in één zin
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKETPLACE = "stagetwo-cloudflare";
export const BRON = { source: "github", repo: "Stage-Two-AI/stack-plugin-cloudflare" };

export function instellingenPad(env = process.env) {
  // homedir() en niet $HOME: in Git Bash op Windows wijst $HOME soms ergens anders heen
  // dan de map die Claude Code zelf gebruikt (die volgt de Windows-gebruikersmap).
  const map = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(map, "settings.json");
}

/** Wat er aan deze instellingen ontbreekt; leeg = alles staat goed. */
export function watOntbreekt(instellingen) {
  const mist = [];
  if (instellingen?.env?.FORCE_AUTOUPDATE_PLUGINS !== "1") mist.push("env.FORCE_AUTOUPDATE_PLUGINS");
  const regel = instellingen?.extraKnownMarketplaces?.[MARKETPLACE];
  if (!regel?.source) mist.push(`extraKnownMarketplaces.${MARKETPLACE}.source`);
  if (regel?.autoUpdate !== true) mist.push(`extraKnownMarketplaces.${MARKETPLACE}.autoUpdate`);
  return mist;
}

/** De aangevulde instellingen; het origineel blijft onaangeroerd. */
export function aanvullen(instellingen) {
  const uit = { ...instellingen };
  uit.env = { ...(instellingen.env ?? {}), FORCE_AUTOUPDATE_PLUGINS: "1" };
  const markten = { ...(instellingen.extraKnownMarketplaces ?? {}) };
  const regel = { ...(markten[MARKETPLACE] ?? {}) };
  if (!regel.source) regel.source = { ...BRON };
  regel.autoUpdate = true;
  markten[MARKETPLACE] = regel;
  uit.extraKnownMarketplaces = markten;
  return uit;
}

export function automatischBijwerken({ controle = false, env = process.env } = {}) {
  const pad = instellingenPad(env);
  let instellingen = {};
  if (existsSync(pad)) {
    const tekst = readFileSync(pad, "utf8");
    if (tekst.trim() !== "") {
      try {
        instellingen = JSON.parse(tekst);
      } catch {
        return { status: "mislukt", pad, reden: `${pad} is geen geldige JSON; dat bestand raak ik niet aan. Vraag Stage Two ernaar.` };
      }
      if (instellingen === null || typeof instellingen !== "object" || Array.isArray(instellingen)) {
        return { status: "mislukt", pad, reden: `${pad} bevat geen JSON-object; dat bestand raak ik niet aan. Vraag Stage Two ernaar.` };
      }
    }
  }
  const ontbreekt = watOntbreekt(instellingen);
  if (ontbreekt.length === 0) return { status: "al-goed", pad };
  if (controle) return { status: "ontbreekt", pad, ontbreekt };

  try {
    mkdirSync(dirname(pad), { recursive: true });
    // Eerst naar een tijdelijk bestand, dan in één keer vervangen: nooit een half bestand.
    const tijdelijk = `${pad}.stack-${process.pid}.tmp`;
    writeFileSync(tijdelijk, `${JSON.stringify(aanvullen(instellingen), null, 2)}\n`);
    renameSync(tijdelijk, pad);
  } catch (fout) {
    return { status: "mislukt", pad, reden: `kon ${pad} niet schrijven: ${String(fout?.message ?? fout).split("\n")[0]}` };
  }
  return { status: "gezet", pad, gewijzigd: ontbreekt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const uitkomst = automatischBijwerken({ controle: argv.includes("--controle") });
  process.stdout.write(`${JSON.stringify(uitkomst, null, 2)}\n`);
  process.exitCode = uitkomst.status === "mislukt" ? 1 : 0;
}
