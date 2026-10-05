/**
 * Dependabot hoogt in elk klantrepo de pins van GitHub Actions op (`checkout@v5` wordt
 * `checkout@v7`), en dat maakt een workflow tekstueel anders dan de template op de
 * vorige versie. Dat is geen lokale aanpassing, en de sync mag er dus niet op stuklopen:
 * anders krijgt een repo na de eerste Dependabot-PR nooit meer een nieuwe workflow.
 * Voor de vergelijking laten we de pins daarom weg.
 */
const ACTION_PIN = /^(\s*(?:-\s*)?uses:\s*[^@\s]+)@\S+/gm;

export function zonderActionPins(tekst) {
  return tekst.replace(ACTION_PIN, "$1").trim();
}

/**
 * Bij het overzetten van een workflow houden we de pins van de repo als die nieuwer
 * zijn dan die van de template. Anders draait de sync elke Dependabot-bump terug en
 * opent Dependabot hem de volgende dag opnieuw.
 */
export function metNieuwsteActionPins(nieuw, huidig) {
  if (huidig === null) return nieuw;
  const pins = new Map();
  for (const m of huidig.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@(\S+)/gm)) {
    pins.set(m[1], m[2]);
  }
  return nieuw.replace(/^(\s*(?:-\s*)?uses:\s*)([^@\s]+)@(\S+)/gm, (regel, kop, naam, pin) => {
    const vanRepo = pins.get(naam);
    return vanRepo && nieuwerePin(vanRepo, pin) ? `${kop}${naam}@${vanRepo}` : regel;
  });
}

/** Alleen simpele majorpins (`v5`, `v7`) zijn vergelijkbaar; al het andere laat de template winnen. */
function nieuwerePin(a, b) {
  const [ma, mb] = [a, b].map((p) => /^v(\d+)$/.exec(p)?.[1]);
  return ma !== undefined && mb !== undefined && Number(ma) > Number(mb);
}
