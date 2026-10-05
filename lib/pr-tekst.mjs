/**
 * De tekst van de pull request, in gewone taal, als zuivere functie van het
 * resultaatobject van de kern. Twee afzenders: de klantsessie (de skill
 * /stack-cloudflare:updaten) en de beheerde run van Stage Two. De vaste regels onderaan zijn
 * geen opsmuk: de guards in de CI van elke app lezen ze (guard:template eist de
 * bevestigingsregel, guard:tests de regel over tests, de PR-sjabloon de preview-regel).
 */

export const BEVESTIGING = "Bevestigd: templatebestanden gewijzigd";

export function prTitel(naar) {
  return `Stack-template naar versie ${naar}`;
}

export function branchNaam(afzender, versie) {
  return afzender === "beheerd" ? `stack-sync/v${versie}` : `stack-bijwerken/v${versie}`;
}

export function prTekst({ resultaat, afzender }) {
  const { van, naar, bijgewerkt, verwijderd, overgeslagen, opgelost = [] } = resultaat;
  const regels = [
    `Deze pull request brengt dit project van stack-versie ${van} naar ${naar}.`,
    "",
    afzender === "beheerd"
      ? "Aangemaakt door de beheerde run van Stage Two. Hij raakt alleen bestanden die van de gedeelde template zijn, nooit je eigen code."
      : "Aangemaakt met /stack-cloudflare:updaten vanuit je eigen Claude Code-sessie. Hij raakt alleen bestanden die van de gedeelde template zijn, nooit je eigen code.",
  ];
  if (bijgewerkt.length > 0) {
    regels.push("", "**Bijgewerkt:**", ...bijgewerkt.map((b) => `- \`${b.pad}\` (${b.hoe})`));
  }
  if (verwijderd.length > 0) {
    regels.push("", "**Verwijderd, want dit zit niet meer in de template:**", ...verwijderd.map((pad) => `- \`${pad}\``));
  }
  if (opgelost.length > 0) {
    regels.push(
      "",
      "**Samen opgelost tijdens het bijwerken:**",
      ...opgelost.map((o) =>
        o.keuze === "template"
          ? `- \`${o.pad}\`: de versie van de template overgenomen; de lokale aanpassing is hiermee weg`
          : `- \`${o.pad}\`: de eigen versie behouden; dit bestand wijkt dus bewust af van de template`,
      ),
    );
  }
  if (overgeslagen.length > 0) {
    regels.push(
      "",
      "**Overgeslagen, want hier is lokaal iets aangepast.** Deze bestanden zijn niet bijgewerkt; kijk er zelf naar of vraag Stage Two mee te kijken:",
      ...overgeslagen.map((s) => `- \`${s.pad}\`: ${s.reden}`),
    );
  }
  regels.push(
    "",
    "Alle checks horen groen te zijn. Zo niet, dan voldoet de code van dit project niet",
    "aan een nieuwe regel; neem dan contact op met Stage Two in plaats van de check uit",
    "te zetten.",
    "",
    "Cloudflare-preview: niet van toepassing, deze wijziging raakt de app zelf niet",
    "",
    "Geen tests nodig: dit is een update van de gedeelde template",
    "",
    BEVESTIGING,
  );
  return regels.join("\n");
}

/** Voor een kopie van de template in de organisatie van een klant (alleen de beheerde run). */
export function spiegelTekst({ van, naar, gewijzigd, verwijderd }) {
  const regels = [
    `Deze pull request brengt jullie kopie van de stack-template van versie ${van} naar ${naar}.`,
    "",
    "Deze repo is een spiegel van de template van Stage Two. Hij bestaat om nieuwe apps",
    "uit te dupliceren, dus er wordt niet op doorgebouwd en hij wordt in zijn geheel",
    "gelijkgetrokken. Staat er hieronder iets in de diff dat je niet verwacht, dan is er",
    "in deze repo gewerkt in plaats van in een app; neem dan contact op met Stage Two.",
    "",
    `**${gewijzigd.length} bestand(en) gewijzigd.**`,
  ];
  if (verwijderd.length > 0) {
    regels.push("", "**Verwijderd, want dit zit niet meer in de template:**", ...verwijderd.map((pad) => `- \`${pad}\``));
  }
  regels.push(
    "",
    "Cloudflare-preview: niet van toepassing, dit is de template en geen app",
    "",
    "Geen tests nodig: dit is een update van de gedeelde template",
  );
  return regels.join("\n");
}

export function spiegelTitel(naar) {
  return `Template-kopie naar versie ${naar}`;
}

export function sluitTekst(naar) {
  return `Achterhaald: de stack-template staat inmiddels op versie ${naar} en daar staat een nieuwe pull request voor open, die alles van deze bevat. Deze wordt daarom gesloten zonder merge.`;
}
