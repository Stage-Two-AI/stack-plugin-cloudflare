/**
 * De kern van het bijwerken: brengt een werkkopie van een app van de template-versie
 * waar hij op staat naar de versie van een template-kopie. Puur over twee mappen; geen
 * console, geen netwerk, geen eigen git-commando's. Wat git wél moet doen (een bestand
 * tonen op een tag, een bestand verwijderen, zeggen wat er gewijzigd is) komt binnen
 * als callback, zodat de tests zonder git kunnen en de aanroepers (de skill en de
 * beheerde run) hetzelfde gedrag delen.
 *
 * Waarom dit veilig kan: in het manifest staat wat van de template is, en dat zijn
 * precies de bestanden die niemand lokaal aanpast. Wat niemand aanpast, kun je in zijn
 * geheel vervangen. Wijkt een bestand toch af van de template op de vórige versie, dan
 * heeft iemand er iets aan gedaan; dat overschrijven we niet stil, maar melden we als
 * overgeslagen. En na afloop controleert de kern zichzelf: is er iets gewijzigd buiten
 * het manifest, dan is de status gestopt en mag de aanroeper niets pushen.
 *
 *   pasToe({ map, tmplMap, git, pnpm }) ->
 *     { status, van, naar, reden, bijgewerkt: [{pad, hoe}], verwijderd: [pad],
 *       overgeslagen: [{pad, reden}], buitenManifest: [pad], gewijzigd: [pad] }
 *
 *   status  bijgewerkt     de werkkopie staat klaar om te committen
 *           bij            de app staat al op de doelversie; niets geschreven
 *           geen-template  geen .claude/stack-version in de werkkopie; niets geschreven
 *           gestopt        zie `reden`; de werkkopie is dan niet te vertrouwen
 *
 *   git     { tonenOpTag(tag, pad) -> tekst|null, verwijder(pad), gewijzigd() -> [pad] }
 *   pnpm    { lockfile(map) -> boolean }  (false: pnpm ontbreekt)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { metNieuwsteActionPins, zonderActionPins } from "./action-pins.mjs";
import {
  formaatOndersteund,
  leesManifest,
  toegestaan as toegestaneBestanden,
  tussenMarkeringen,
  voegSleutelsSamen,
} from "./manifest.mjs";

export const MANIFEST_PAD = ".claude/stack-manifest.json";
export const VERSIE_PAD = ".claude/stack-version";
export const LOCKFILE = "pnpm-lock.yaml";

export function leesVersie(map) {
  const pad = join(map, VERSIE_PAD);
  if (!existsSync(pad)) return null;
  const n = Number(readFileSync(pad, "utf8").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function pasToe({ map, tmplMap, git, pnpm }) {
  const van = leesVersie(map);
  const naar = leesVersie(tmplMap);
  const basis = { van, naar, bijgewerkt: [], verwijderd: [], overgeslagen: [], buitenManifest: [], gewijzigd: [] };
  const gestopt = (reden) => ({ ...basis, status: "gestopt", reden });

  if (van === null) {
    return { ...basis, status: "geen-template", reden: "deze repo heeft geen .claude/stack-version en is dus niet uit de Stage Two-template gebouwd" };
  }
  if (naar === null) return gestopt("de template heeft geen leesbaar versienummer");

  const manifest = leesManifest(readFileSync(join(tmplMap, MANIFEST_PAD), "utf8"));
  if (!formaatOndersteund(manifest)) {
    return gestopt(`de template gebruikt manifestformaat ${manifest.formaat}, deze plugin kent formaat 1: werk de plugin bij`);
  }
  if (van >= naar) return { ...basis, status: "bij", reden: null };

  // Het vorige manifest komt altijd uit de tag van de vorige versie, nooit uit de repo:
  // dat is de enige bron die zegt wat er toen van de template was. Ontbreekt de tag,
  // dan kunnen we niet weten wat we mogen verwijderen of vergelijken, en stoppen we.
  const vorigRuw = git.tonenOpTag(`stack-v${van}`, MANIFEST_PAD);
  if (vorigRuw === null) {
    return gestopt(`vorige versie niet te vinden: de template heeft geen tag stack-v${van}`);
  }
  const vorig = leesManifest(vorigRuw);
  const toegestaan = toegestaneBestanden(manifest);
  const { bijgewerkt, verwijderd, overgeslagen } = basis;

  // 1. Bestanden die de template zelf niet meer heeft, moeten ook bij de klant weg. Anders
  //    blijft er een script achter dat niemand meer aanroept. Alleen dan: levert de
  //    template het bestand op de doelversie nog, of zegt het nieuwe manifest dat het
  //    voortaan van het project is, dan blijft het staan.
  for (const pad of vorig.vervangen) {
    if (toegestaan.has(pad) || manifest.vanHetProject.includes(pad) || existsSync(join(tmplMap, pad)) || !existsSync(join(map, pad))) continue;
    git.verwijder(pad);
    verwijderd.push(pad);
  }

  // 2. Is het bestand met de markeringen verhuisd (versie 5: van CLAUDE.md naar
  //    AGENTS.md), dan staat het projectdeel nog in het oude bestand. Dat gaat mee.
  const verhuisd = new Set();
  for (const [pad, naam] of Object.entries(manifest.markeringen)) {
    if (existsSync(join(map, pad))) continue;
    const oudPad = Object.entries(vorig.markeringen).find(
      ([kandidaat, oudeNaam]) => kandidaat !== pad && oudeNaam === naam,
    )?.[0];
    if (!oudPad || !existsSync(join(map, oudPad)) || !existsSync(join(tmplMap, pad))) continue;
    const nieuw = tussenMarkeringen(lees(map, oudPad), lees(tmplMap, pad), naam);
    if (nieuw === null) continue;
    schrijf(map, pad, nieuw);
    verhuisd.add(pad);
    bijgewerkt.push({ pad, hoe: `nieuw; projectdeel verhuisd uit ${oudPad}` });
  }

  // 3. Vervangen, met de afwijkingscontrole tegen de vorige versie. Had de template het
  //    bestand op de vorige versie nog niet, maar staat het hier al, dan is het van de
  //    klant: dat overschrijven we alleen als het al gelijk is aan wat de template brengt.
  for (const pad of manifest.vervangen) {
    if (!existsSync(join(tmplMap, pad))) continue;
    const huidig = existsSync(join(map, pad)) ? lees(map, pad) : null;
    if (huidig !== null && !(pad in vorig.markeringen)) {
      const vorige = git.tonenOpTag(`stack-v${van}`, pad);
      if (vorige === null) {
        if (zonderActionPins(lees(tmplMap, pad)) !== zonderActionPins(huidig)) {
          overgeslagen.push({ pad, reden: `bestond niet in de template op versie ${van}; hier staat een eigen bestand` });
          continue;
        }
      } else if (zonderActionPins(vorige) !== zonderActionPins(huidig)) {
        overgeslagen.push({ pad, reden: `wijkt af van de template op versie ${van}; hier is lokaal iets aangepast` });
        continue;
      }
    }
    const nieuw = metNieuwsteActionPins(lees(tmplMap, pad), huidig);
    if (nieuw === huidig) continue;
    schrijf(map, pad, nieuw);
    bijgewerkt.push({ pad, hoe: huidig === null ? "nieuw" : "vervangen" });
  }

  // 4. Sleutels samenvoegen (package.json).
  let packageJsonGewijzigd = false;
  for (const [pad, welke] of Object.entries(manifest.sleutels)) {
    if (!existsSync(join(map, pad)) || !existsSync(join(tmplMap, pad))) continue;
    const huidig = lees(map, pad);
    const nieuw = voegSleutelsSamen(huidig, lees(tmplMap, pad), welke);
    // Inhoudelijk gelijk (alleen de volgorde van sleutels anders) is geen wijziging;
    // anders zou elke run package.json en het lockfile opnieuw schrijven.
    if (isDeepStrictEqual(JSON.parse(nieuw), JSON.parse(huidig))) continue;
    schrijf(map, pad, nieuw);
    if (pad === "package.json") packageJsonGewijzigd = true;
    bijgewerkt.push({ pad, hoe: `sleutels samengevoegd (${welke.join(", ")})` });
  }

  // 5. Tussen de markeringen.
  for (const [pad, naam] of Object.entries(manifest.markeringen)) {
    if (verhuisd.has(pad) || !existsSync(join(map, pad)) || !existsSync(join(tmplMap, pad))) continue;
    const huidig = lees(map, pad);
    const nieuw = tussenMarkeringen(huidig, lees(tmplMap, pad), naam);
    if (nieuw === null) {
      overgeslagen.push({ pad, reden: `de markeringen ${naam}:begin en ${naam}:end ontbreken` });
      continue;
    }
    if (nieuw === huidig) continue;
    schrijf(map, pad, nieuw);
    bijgewerkt.push({ pad, hoe: "tussen de markeringen" });
  }

  // 6. Een andere package.json vraagt een ander lockfile; de CI van elke app installeert
  //    met --frozen-lockfile en zou anders rood staan op een update van de template.
  const afgeleid = new Set();
  if (packageJsonGewijzigd) {
    if (!pnpm.lockfile(map)) return gestopt("pnpm ontbreekt en package.json is gewijzigd: installeer pnpm");
    afgeleid.add(LOCKFILE);
    bijgewerkt.push({ pad: LOCKFILE, hoe: "opnieuw berekend uit package.json" });
  }

  // 7. De controle op zichzelf: raakten we alleen wat we mochten raken?
  const gewijzigd = git.gewijzigd();
  const magOok = new Set([...toegestaan, ...verwijderd, ...afgeleid]);
  const buiten = gewijzigd.filter((pad) => !magOok.has(pad));
  if (buiten.length > 0) {
    return { ...gestopt("er zou iets buiten het manifest wijzigen"), buitenManifest: buiten, gewijzigd };
  }
  return { ...basis, status: "bijgewerkt", reden: null, gewijzigd };
}

function lees(map, pad) {
  return readFileSync(join(map, pad), "utf8");
}

function schrijf(map, pad, inhoud) {
  mkdirSync(dirname(join(map, pad)), { recursive: true });
  writeFileSync(join(map, pad), inhoud);
}
