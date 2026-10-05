#!/usr/bin/env node
/**
 * Het script achter het templatedeel van /stack-cloudflare:updaten: brengt de app van de klant naar de nieuwste
 * versie van de Stage Two-template, als pull request van de klant zelf. Twee aanroepen
 * per ronde (KTD9), allebei vanuit de open checkout van de klant:
 *
 *   node bijwerken.mjs --json --droogloop [--repo <eigenaar>/<naam>]
 *       voorcontrole, tijdelijke kloon van de app en van de template (op de tag van de
 *       doelversie), branch stack-bijwerken/v<n>, de kern toepassen; niets gepusht.
 *       Het resultaat bevat `werkmap` voor de tweede aanroep.
 *
 *   node bijwerken.mjs --json --werkmap <map> [--los-op <pad> template|eigen]...
 *       keuzes voor overgeslagen bestanden toepassen, committen met de identiteit uit de
 *       checkout, pushen als de boom verschilt, de pull request openen of bijwerken.
 *
 * Met --repo werkt het script een andere app van de klant bij, zonder dat die op deze
 * computer staat: dezelfde route, alleen komt de kloon dan rechtstreeks van GitHub
 * (via de gh-login) in plaats van via de origin van de open map.
 *
 * De open checkout van de klant wordt nooit gewijzigd (KTD4): alles gebeurt in een
 * tijdelijke map met rechten 0700, die na de tweede aanroep en bij elke mislukking
 * verdwijnt. Er komt geen token van Stage Two aan te pas: de kloon van de app loopt met
 * de eigen login van de klant (gh of ssh), de template komt anoniem binnen (KTD5).
 *
 * Elke uitkomst is één JSON-object op stdout met een `status`:
 *   bij            de app staat al op de nieuwste versie
 *   geen-template  deze repo is niet uit de template gebouwd
 *   klaar          (na --droogloop) de werkkopie staat klaar; zie bijgewerkt, overgeslagen
 *   gepusht        (na --werkmap) de branch staat op GitHub; zie pr of vergelijkUrl
 *   gestopt        er is een reden om niet door te gaan (bijvoorbeeld een open PR van de
 *                  beheerde run, of een branch waar iemand zelf op heeft gecommit)
 *   mislukt        een voorwaarde ontbreekt; `reden` is één zin met één handeling
 * De reden bevat nooit een token: een URL met login wordt afgeplakt.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCloudflareManifest, leesManifest, toegestaan as toegestaneBestandenVan } from "../../../lib/manifest.mjs";
import { BEVESTIGING, branchNaam, prTekst, prTitel, sluitTekst } from "../../../lib/pr-tekst.mjs";
import {
  alGelijkOpGitHub,
  branchHerbouwbaar,
  checkoutTag,
  commit,
  eersteRegel,
  gewijzigdePaden,
  ghAanwezig,
  ghIngelogd,
  git,
  gitIdentiteit,
  gitVoorKern,
  hoogsteTagVersie,
  kloonRepo,
  kloonTemplate,
  maakBranch,
  openOfWerkPRBij,
  openPRVoorVersie,
  originPushUrl,
  originUrl,
  pnpmVoorKern,
  push,
  pushDroog,
  repoUitUrl,
  sluitOuderePRs,
  templateRepo,
  vergelijkUrl,
  versieOpAfstand,
} from "../../../lib/repo.mjs";
import { LOCKFILE, MANIFEST_PAD, leesVersie, pasToe } from "../../../lib/toepassen.mjs";

export const AFZENDER = "klantsessie";
export const WERKMAP_PREFIX = "stack-bijwerken-";
const WERKMAP_MAX_LEEFTIJD_MS = 60 * 60 * 1000;
const TOESTAND = "toestand.json";

// ---------------------------------------------------------------- argumenten

export function leesArgumenten(argv) {
  const uit = { json: false, droogloop: false, werkmap: null, losOp: [], checkout: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") uit.json = true;
    else if (a === "--droogloop") uit.droogloop = true;
    else if (a === "--werkmap") uit.werkmap = argv[++i] ?? null;
    else if (a === "--checkout") uit.checkout = argv[++i] ?? null;
    else if (a === "--repo") uit.repo = argv[++i] ?? null;
    else if (a === "--los-op") {
      uit.losOp.push({ pad: argv[++i] ?? null, keuze: argv[++i] ?? null });
    } else throw new Error(`onbekend argument: ${a}`);
  }
  return uit;
}

// ---------------------------------------------------------------- hulpjes

/** Een URL met login (https://gebruiker:token@host) mag nooit in een uitkomst staan. */
export function zonderLogin(tekst) {
  return String(tekst).replace(/(https?:\/\/)[^\s/@]+@/g, "$1***@");
}

function mislukt(reden) {
  return { status: "mislukt", reden: zonderLogin(reden) };
}

function gestopt(reden, extra = {}) {
  return { status: "gestopt", reden: zonderLogin(reden), ...extra };
}

function verwijderWerkmap(map) {
  if (!map) return;
  try {
    rmSync(map, { recursive: true, force: true });
  } catch {
    // niet erg: de tijdelijke map van de computer ruimt het op
  }
}

function leesToestand(werkmap) {
  return JSON.parse(readFileSync(join(werkmap, TOESTAND), "utf8"));
}

/**
 * Alleen een map die dit script zelf heeft gemaakt, en niet ouder dan een uur. Geeft
 * `{ fout, eigen }`: `fout` is de reden om te weigeren (of null), `eigen` is true zodra
 * vaststaat dat de map van dit script is; dan mag de aanroeper hem ook opruimen.
 */
export function controleerWerkmap(werkmap, { tmp = tmpdir(), nu = Date.now() } = {}) {
  if (typeof werkmap !== "string" || !werkmap) return { fout: "geef --werkmap de map uit de droogloop mee", eigen: false };
  const echt = resolve(werkmap);
  const basis = resolve(tmp);
  if (dirname(echt) !== basis || !echt.slice(basis.length + 1).startsWith(WERKMAP_PREFIX)) {
    return { fout: "de werkmap ligt niet in de tijdelijke map van deze computer; gebruik de map uit de droogloop", eigen: false };
  }
  if (!existsSync(join(echt, TOESTAND))) return { fout: "de werkmap is geen droogloop van dit script; draai eerst --droogloop", eigen: false };
  const leeftijd = nu - statSync(join(echt, TOESTAND)).mtimeMs;
  if (leeftijd > WERKMAP_MAX_LEEFTIJD_MS) return { fout: "de droogloop is ouder dan een uur; draai --droogloop opnieuw", eigen: true };
  return { fout: null, eigen: true };
}

/** Het verschil tussen het bestand in de app en dat in de template, als tekst voor de bouwer. */
function verschil(kloon, tmplMap, pad, maxRegels = 200) {
  try {
    git(kloon, "diff", "--no-index", "--", join(kloon, pad), join(tmplMap, pad));
    return "";
  } catch (fout) {
    const regels = String(fout.stdout ?? "").split("\n");
    return regels.length > maxRegels ? `${regels.slice(0, maxRegels).join("\n")}\n... (ingekort)` : regels.join("\n");
  }
}

// ---------------------------------------------------------------- de droogloop

const GEEN_TEMPLATE = {
  status: "geen-template",
  reden: "deze repo heeft geen .claude/stack-version en .claude/stack-manifest.json en is dus niet uit de Stage Two-template gebouwd",
};

function isTemplateApp(map) {
  return existsSync(join(map, MANIFEST_PAD)) && leesVersie(map) !== null;
}

const ANDER_SPOOR = {
  status: "ander-spoor",
  reden: "deze app komt uit de Vercel-template van Stage Two; die werk je bij met /stack:updaten van de andere Stage Two-plugin, niet met deze",
};

function isCloudflareApp(map) {
  try {
    return isCloudflareManifest(JSON.parse(readFileSync(join(map, MANIFEST_PAD), "utf8")));
  } catch {
    return false;
  }
}

function alBij(versie, doel) {
  return { status: "bij", van: versie, naar: doel, reden: `deze app staat al op versie ${versie}` };
}

/**
 * Zonder `opAfstand` de app in de open map (`checkout`); met `opAfstand` (eigenaar/naam)
 * een andere app van de klant, rechtstreeks van GitHub. Die kennen we pas na het klonen,
 * dus de controle op template en versie komt dan na de kloon.
 */
export function droogloop({ checkout, opAfstand = null, env = process.env }) {
  if (opAfstand !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opAfstand)) {
    return mislukt("geef --repo als eigenaar/naam, bijvoorbeeld Mijn-Bedrijf/voorraad");
  }
  if (opAfstand === null && !isTemplateApp(checkout)) return GEEN_TEMPLATE;
  if (opAfstand === null && !isCloudflareApp(checkout)) return ANDER_SPOOR;

  const metGh = ghAanwezig();
  if (opAfstand !== null && !metGh) return mislukt("een andere app bijwerken kan alleen met de GitHub-opdrachtregel (gh); draai eerst /stack-cloudflare:installatie");
  if (metGh && !ghIngelogd()) return mislukt("log eerst in bij GitHub met `gh auth login`, dan kan de pull request geopend worden");

  const origin = opAfstand !== null ? `https://github.com/${opAfstand}.git` : originUrl(checkout);
  if (!origin) return mislukt("deze checkout heeft geen origin op GitHub; voeg die toe met `git remote add origin <url>`");
  const repo = opAfstand ?? repoUitUrl(origin);

  const tmplRepo = templateRepo(env);
  const doel = versieOpAfstand(tmplRepo);
  if (doel === null) return mislukt("de template is niet bereikbaar (geen netwerk, of nog geen versie-tag); probeer het later opnieuw");
  if (opAfstand === null && leesVersie(checkout) >= doel) return alBij(leesVersie(checkout), doel);

  const branch = branchNaam(AFZENDER, doel);
  if (metGh && repo) {
    let andere = null;
    try {
      andere = openPRVoorVersie(repo, doel);
    } catch (fout) {
      return mislukt(`de open pull requests van ${repo} zijn niet op te vragen: ${eersteRegel(fout)}`);
    }
    if (andere && andere.headRefName !== branch) {
      return gestopt(`er staat al een pull request open voor versie ${doel}, geopend door Stage Two: ${andere.url}; merge die, of vraag Stage Two hem te sluiten`, { pr: andere });
    }
  }

  const werkmap = mkdtempSync(join(tmpdir(), WERKMAP_PREFIX));
  try {
    const kloon = kloonRepo({ url: origin, doel: join(werkmap, "app") });
    if (opAfstand !== null) {
      if (!isTemplateApp(kloon)) {
        verwijderWerkmap(werkmap);
        return GEEN_TEMPLATE;
      }
      if (leesVersie(kloon) >= doel) {
        verwijderWerkmap(werkmap);
        return alBij(leesVersie(kloon), doel);
      }
    } else {
      const pushUrl = originPushUrl(checkout);
      if (pushUrl) git(kloon, "remote", "set-url", "--push", "origin", pushUrl);
    }
    if (!pushDroog(kloon, branch)) {
      verwijderWerkmap(werkmap);
      return mislukt(`je hebt geen schrijfrecht op ${repo ?? "deze repo"}; vraag de eigenaar je toe te voegen als medewerker`);
    }
    if (!branchHerbouwbaar(kloon, branch)) {
      verwijderWerkmap(werkmap);
      return gestopt(`op de branch ${branch} staat een commit die niet van /stack-cloudflare:updaten is; bekijk de open pull request voor die branch of verwijder de branch, en draai dan opnieuw`);
    }

    const tmplMap = kloonTemplate({ repo: tmplRepo, doel: join(werkmap, "template") });
    const hoogste = hoogsteTagVersie(tmplMap);
    if (hoogste !== doel) {
      verwijderWerkmap(werkmap);
      return mislukt(`de template-kloon heeft geen tag stack-v${doel}; probeer het later opnieuw`);
    }
    checkoutTag(tmplMap, doel);
    maakBranch(kloon, branch);

    const resultaat = pasToe({ map: kloon, tmplMap, git: gitVoorKern(kloon, tmplMap), pnpm: pnpmVoorKern() });
    if (resultaat.status !== "bijgewerkt") {
      verwijderWerkmap(werkmap);
      return { ...resultaat, reden: resultaat.reden && zonderLogin(resultaat.reden) };
    }
    for (const s of resultaat.overgeslagen) s.verschil = verschil(kloon, tmplMap, s.pad);

    const toestand = { checkout: opAfstand === null ? checkout : null, origin: zonderLogin(origin), repo, branch, metGh, resultaat, tijdstip: new Date().toISOString() };
    writeFileSync(join(werkmap, TOESTAND), `${JSON.stringify(toestand, null, 2)}\n`);
    return { ...resultaat, status: "klaar", branch, repo, werkmap, ...uitlegNaDroogloop(resultaat) };
  } catch (fout) {
    verwijderWerkmap(werkmap);
    return mislukt(eersteRegel(fout));
  }
}

function uitlegNaDroogloop(resultaat) {
  const n = resultaat.bijgewerkt.length;
  const w = resultaat.verwijderd.length;
  const o = resultaat.overgeslagen.length;
  return {
    samenvatting: [
      `Van versie ${resultaat.van} naar ${resultaat.naar}: ${n} bestand(en) bijgewerkt, ${w} verwijderd, ${o} overgeslagen.`,
      o > 0
        ? "Bij de overgeslagen bestanden is lokaal iets aangepast; kies per bestand: de template overnemen of de eigen versie houden."
        : "Alleen bestanden van de template zijn geraakt; je eigen code niet.",
      "Er is nog niets gepusht.",
    ],
  };
}

// ---------------------------------------------------------------- de tweede aanroep

export function voerUit({ werkmap, losOp }) {
  const controle = controleerWerkmap(werkmap);
  if (controle.fout) {
    // Een verouderde map van onszelf ruimen we op; een vreemde map laten we staan.
    if (controle.eigen) verwijderWerkmap(werkmap);
    return mislukt(controle.fout);
  }
  const kloon = join(werkmap, "app");
  const tmplMap = join(werkmap, "template");

  try {
    // Ook een kapotte toestand.json valt in de catch hieronder: reden in één regel, map weg.
    const { resultaat, branch, repo, metGh, checkout } = leesToestand(werkmap);
    const manifest = leesManifest(readFileSync(join(tmplMap, MANIFEST_PAD), "utf8"));
    const opgelost = [];
    for (const { pad, keuze } of losOp) {
      const overgeslagen = resultaat.overgeslagen.find((s) => s.pad === pad);
      if (!overgeslagen) {
        verwijderWerkmap(werkmap);
        return mislukt(`--los-op ${pad}: dit bestand staat niet in de lijst overgeslagen bestanden van de droogloop`);
      }
      if (keuze !== "template" && keuze !== "eigen") {
        verwijderWerkmap(werkmap);
        return mislukt(`--los-op ${pad}: kies template of eigen`);
      }
      if (keuze === "template") {
        if (pad in manifest.markeringen) {
          verwijderWerkmap(werkmap);
          return mislukt(`--los-op ${pad}: dit bestand heeft een projectdeel; zet de markeringen terug in plaats van het hele bestand te vervangen`);
        }
        mkdirSync(dirname(join(kloon, pad)), { recursive: true });
        cpSync(join(tmplMap, pad), join(kloon, pad));
      }
      opgelost.push({ pad, keuze });
    }
    const nogOvergeslagen = resultaat.overgeslagen.filter((s) => !opgelost.some((o) => o.pad === s.pad)).map(({ verschil: _, ...rest }) => rest);

    // De controle op zichzelf, nog een keer: ook na de keuzes mag alleen het manifest geraakt zijn.
    const magOok = new Set([...toegestaneBestandenVan(manifest), ...resultaat.verwijderd, LOCKFILE]);
    const buiten = gewijzigdePaden(kloon).filter((pad) => !magOok.has(pad));
    if (buiten.length > 0) {
      verwijderWerkmap(werkmap);
      return gestopt("er zou iets buiten het manifest wijzigen", { buitenManifest: buiten });
    }

    // Zonder open map (--repo) geldt de globale git-naam; de verse kloon heeft geen eigen.
    const identiteit = gitIdentiteit(checkout ?? kloon);
    if (!identiteit.naam || !identiteit.email) {
      verwijderWerkmap(werkmap);
      return mislukt("git kent je naam en e-mailadres niet; stel ze in met `git config --global user.name` en `user.email`");
    }
    const eind = { ...resultaat, overgeslagen: nogOvergeslagen, opgelost };
    commit({ map: kloon, identiteit, bericht: `chore: stack-template naar versie ${resultaat.naar}`, versie: resultaat.naar });

    // Tussen de droogloop en nu kan iemand op de branch hebben gecommit; ook dan blijven we ervan af.
    if (!branchHerbouwbaar(kloon, branch)) {
      verwijderWerkmap(werkmap);
      return gestopt(`op de branch ${branch} staat sinds de droogloop een commit die niet van /stack-cloudflare:updaten is; bekijk de open pull request voor die branch en draai dan opnieuw`);
    }
    const gepusht = !alGelijkOpGitHub(kloon, branch);
    if (gepusht) push(kloon, branch);

    const tekst = prTekst({ resultaat: eind, afzender: AFZENDER });
    let pr = null;
    if (metGh && repo) {
      pr = openOfWerkPRBij({ repo, branch, titel: prTitel(resultaat.naar), tekst });
      sluitOuderePRs({ repo, prefix: "stack-bijwerken", doelVersie: resultaat.naar, tekst: sluitTekst(resultaat.naar), map: kloon });
    }
    verwijderWerkmap(werkmap);
    return {
      status: "gepusht",
      van: resultaat.van,
      naar: resultaat.naar,
      branch,
      gepusht,
      pr,
      vergelijkUrl: repo && !pr ? vergelijkUrl(repo, branch) : null,
      bijgewerkt: eind.bijgewerkt,
      verwijderd: eind.verwijderd,
      overgeslagen: eind.overgeslagen,
      opgelost,
      samenvatting: uitlegNaPush({ gepusht, pr, repo, branch, resultaat: eind }),
    };
  } catch (fout) {
    verwijderWerkmap(werkmap);
    return mislukt(eersteRegel(fout));
  }
}

function uitlegNaPush({ gepusht, pr, repo, branch, resultaat }) {
  const regels = [];
  if (pr) regels.push(pr.nieuw ? `Pull request geopend: ${pr.url}` : `Bestaande pull request bijgewerkt: ${pr.url}`);
  else if (repo) regels.push(`De branch ${branch} staat op GitHub; open de pull request hier: ${vergelijkUrl(repo, branch)}`);
  else regels.push(`De branch ${branch} staat op je origin.`);
  if (!gepusht) regels.push("De inhoud stond al zo op GitHub; er is niets opnieuw gepusht.");
  regels.push("Wacht tot de checks groen zijn en druk dan op Merge. Rood? Neem contact op met Stage Two, zet de check niet uit.");
  if (resultaat.overgeslagen.length > 0) {
    regels.push(`${resultaat.overgeslagen.length} bestand(en) zijn niet bijgewerkt omdat ze lokaal afwijken; dat staat in de pull request.`);
  }
  return regels;
}

// ---------------------------------------------------------------- draaien

export function hoofd(argv, { cwd = process.cwd(), env = process.env } = {}) {
  let args;
  try {
    args = leesArgumenten(argv);
  } catch (fout) {
    return { status: "mislukt", reden: fout.message };
  }
  const checkout = resolve(args.checkout ?? cwd);
  if (args.werkmap) return voerUit({ werkmap: args.werkmap, losOp: args.losOp });
  if (args.droogloop) return droogloop({ checkout, opAfstand: args.repo, env });
  return mislukt("geef --droogloop (eerste aanroep) of --werkmap <map> (tweede aanroep) mee");
}

function toon(uitkomst, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(uitkomst, null, 2)}\n`);
    return;
  }
  const regels = [`status: ${uitkomst.status}`];
  if (uitkomst.reden) regels.push(uitkomst.reden);
  for (const r of uitkomst.samenvatting ?? []) regels.push(r);
  if (uitkomst.werkmap) regels.push(`werkmap: ${uitkomst.werkmap}`);
  process.stdout.write(`${regels.join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let uitkomst;
  try {
    uitkomst = hoofd(argv);
  } catch (fout) {
    // Nooit een stack trace op het scherm: ook een onverwachte fout wordt één JSON-object.
    uitkomst = { status: "mislukt", reden: zonderLogin(eersteRegel(fout)) };
  }
  toon(uitkomst, argv.includes("--json"));
  process.exitCode = uitkomst.status === "mislukt" || uitkomst.status === "gestopt" ? 1 : 0;
}

export { BEVESTIGING };
