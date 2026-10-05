/**
 * Het manifest (.claude/stack-manifest.json in elke app) zegt welke bestanden van de
 * gedeelde template zijn en hoe ze bijgewerkt worden:
 *
 *   vervangen            in zijn geheel overschrijven
 *   sleutelsSamenvoegen  alleen de genoemde sleutels van een JSON-bestand samenvoegen
 *   tussenMarkeringen    alleen het deel tussen <!-- naam:begin --> en <!-- naam:end -->
 *
 * Alles wat hier niet in staat, is van het project en wordt nooit aangeraakt. Deze
 * module leest en interpreteert het manifest; ze schrijft niets.
 */

/**
 * Het formaat dat deze plugin kent (KTD11). Een template met een hoger nummer vraagt
 * iets wat deze plugin niet begrijpt; dan stopt de kern in plaats van half werk te doen.
 * Een manifest zonder nummer is formaat 1: alle manifesten tot en met versie 8.
 */
export const KEND_FORMAAT = 1;

/** Sleutels waarbij niet de template wint maar de hoogste versie. */
const VERSIESLEUTELS = new Set(["dependencies", "devDependencies"]);

export function leesManifest(tekst) {
  const ruw = JSON.parse(tekst);
  const van = ruw.vanDeTemplate ?? {};
  return {
    formaat: ruw.manifestFormaat ?? 1,
    variant: ruw.variant ?? null,
    stackVersion: ruw.stackVersion ?? null,
    vervangen: van.vervangen ?? [],
    sleutels: van.sleutelsSamenvoegen ?? {},
    markeringen: van.tussenMarkeringen ?? {},
    vanHetProject: ruw.vanHetProject ?? [],
  };
}

/**
 * Deze plugin hoort bij het Cloudflare-spoor. Een app uit de Vercel-template heeft geen
 * `variant` in het manifest; die laat deze plugin aan de andere Stage Two-plugin
 * (`stack@stagetwo`) over, zodat er nooit Cloudflare-bestanden in een Vercel-app komen.
 */
export const VARIANT = "cloudflare";

export function isCloudflareManifest(ruw) {
  return Boolean(ruw && typeof ruw === "object" && ruw.variant === VARIANT);
}

export function formaatOndersteund(manifest) {
  return Number.isInteger(manifest.formaat) && manifest.formaat <= KEND_FORMAAT;
}

/** Alle paden die de kern mag aanraken. */
export function toegestaan(manifest) {
  return new Set([
    ...manifest.vervangen,
    ...Object.keys(manifest.sleutels),
    ...Object.keys(manifest.markeringen),
  ]);
}

/** Vervangt de inhoud tussen <!-- naam:begin --> en <!-- naam:end -->. Null als een van beide de markeringen mist. */
export function tussenMarkeringen(bestaand, nieuw, naam) {
  const begin = `<!-- ${naam}:begin -->`;
  const eind = `<!-- ${naam}:end -->`;
  const knip = (tekst) => {
    const a = tekst.indexOf(begin);
    const b = tekst.indexOf(eind);
    return a === -1 || b === -1 || b < a ? null : { a, b: b + eind.length };
  };
  const hier = knip(bestaand);
  const daar = knip(nieuw);
  if (!hier || !daar) return null;
  return bestaand.slice(0, hier.a) + nieuw.slice(daar.a, daar.b) + bestaand.slice(hier.b);
}

/**
 * Voegt alleen de genoemde sleutels samen. Eigen extra's van het project blijven. Bij
 * een sleutel die beide hebben wint de template, behalve bij dependencies en
 * devDependencies: daar wint de hoogste versie, zodat een Dependabot-bump in het
 * project overleeft en een hogere eis van de template toch doorkomt.
 */
export function voegSleutelsSamen(bestaandJson, nieuwJson, welke) {
  const uit = JSON.parse(bestaandJson);
  const van = JSON.parse(nieuwJson);
  for (const sleutel of welke) {
    if (!van[sleutel]) continue;
    const samen = { ...(uit[sleutel] ?? {}) };
    for (const [naam, waarde] of Object.entries(van[sleutel])) {
      const eigen = samen[naam];
      samen[naam] =
        VERSIESLEUTELS.has(sleutel) && eigen !== undefined && hogereVersie(eigen, waarde)
          ? eigen
          : waarde;
    }
    uit[sleutel] = Object.fromEntries(
      Object.keys(samen)
        .sort()
        .map((k) => [k, samen[k]]),
    );
  }
  return `${JSON.stringify(uit, null, 2)}\n`;
}

/** Is a hoger dan b? Alleen gewone versies (met ^ of ~ ervoor) zijn vergelijkbaar; anders wint b, de template. */
function hogereVersie(a, b) {
  const va = versieNummers(a);
  const vb = versieNummers(b);
  if (!va || !vb) return false;
  for (let i = 0; i < 3; i += 1) {
    if (va[i] !== vb[i]) return va[i] > vb[i];
  }
  return false;
}

function versieNummers(tekst) {
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(String(tekst).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
