---
name: nieuwe-app
description: Een nieuwe app starten op de manier van Stage Two, op Cloudflare en Supabase - eerst meedenken over wat de app moet doen, dan de app aanmaken uit de nieuwste Cloudflare-template van Stage Two onder de organisatie van de gebruiker, en hosting, deur en database laten inrichten door de beheer-repo. Gebruik dit als de gebruiker /stack-cloudflare:nieuwe-app typt of een nieuwe, losstaande app wil beginnen (niet een uitbreiding van een bestaande app).
---

Je helpt iemand die niet technisch is om een nieuwe app goed te beginnen. Het gesprek
is het belangrijkste deel: de keuzes hieronder zijn achteraf duur om te veranderen. Praat
in gewone taal, stel één vraag tegelijk, en geef bij elke keuze een advies met de reden.
De gebruiker beslist. Voer niets uit wat hier niet staat.

## Stap 1: is het wel een nieuwe app?

Vraag wat de gebruiker wil maken, in één of twee zinnen. Toets het aan dit lijstje:

| Wat je hoort | Waarschijnlijk |
|---|---|
| Gaat over gegevens die al in een app van het bedrijf zitten (dezelfde planten, orders, voorraad, klanten) | uitbreiding van die app |
| Een scherm, een overzicht of een werktuig erbij voor dezelfde mensen | uitbreiding van die app |
| Andere gebruikers, of gegevens die niets met elkaar te maken hebben | nieuwe app |
| "Kan dit er ook nog bij?" | vaak een uitbreiding |

De regel erachter is simpel en de gebruiker mag hem horen: **één app per verzameling
gegevens.** Gegevens die op twee plekken staan gaan uit elkaar lopen, en een app die de
gegevens van een andere app gebruikt is voor iedereen moeilijker te overzien. Is het een
uitbreiding? Zeg dat, en verwijs naar `/stack-cloudflare:verder-werken` in de map van die app. Stop
dan hier.

Wil de gebruiker toch een aparte app op de gegevens van een bestaande app, bijvoorbeeld
een portaal voor mensen van buiten? Dat kan, maar dat is een keuze met een eigen
beveiligingsopzet, en die maakt Stage Two samen met de gebruiker. Verwijs naar Stage Two
en stop hier.

Moet de app **vindbaar zijn in Google** (een website, een webshop, een pagina die mensen
delen)? Dan past deze template niet: die is voor werk-apps achter een login. Zeg dat en
verwijs naar Stage Two. Stop dan hier.

## Stap 2: het idee scherp

Vraag door tot je op elk punt een concreet antwoord hebt. "Dat zien we later wel" is
het duurste antwoord.

1. **Wat kan iemand straks dat nu niet kan?** Eén zin, vanuit de gebruiker geschreven.
   Dit wordt de omschrijving van de app.
2. **Wie gaat het gebruiken?** Hoeveel mensen, en alleen eigen personeel of ook mensen
   van buiten.
3. **Welke gegevens gaan erin?** En of daar persoonsgegevens bij zitten.
4. **Wat is de eerste versie waar iemand echt iets aan heeft?** Het kleinste ding dat
   maandag al gebruikt zou worden.

## Stap 3: wat de app meekrijgt

Hier is niets te kiezen; zeg het in twee zinnen. Elke app op dit spoor staat achter een
deur: alleen de mensen uit de toegangslijst van het bedrijf komen erin, en ze loggen in
met hun werkaccount (of met een code per mail). En elke app krijgt een eigen database bij
Supabase, want het inloggen loopt daar doorheen. Een database is gratis zolang het om een
paar apps gaat; daarna kost hij enkele tientallen euro's per maand, Stage Two weet het
precieze bedrag.

## Stap 4: naam en plek

- **Naam.** Stel er een voor uit de omschrijving: kort, kleine letters, streepjes,
  bijvoorbeeld `voorraad-app`. Laat de gebruiker kiezen.
- **Eigenaar.** Toon de organisaties van de gebruiker met `gh api user/orgs -q '.[].login'`.
  Kies de organisatie van het bedrijf: daar staat de beheer-repo die hosting en database
  inricht, en dan is de app van het bedrijf en niet van één persoon. Is er geen
  organisatie, zeg dan dat Stage Two die eerst moet aanmaken, en stop hier.
- **Wie erbij mag.** Lees de groepen uit de toegangslijst:
  `gh api repos/<eigenaar>/stack-beheer/contents/toegang.json -H "Accept: application/vnd.github.raw"`.
  Staat de naam van de app al onder `apps`, dan is dit al geregeld; zeg dat. Zo niet, toon
  dan de groepen (met wie erin zit, in gewone woorden) en laat de gebruiker kiezen. Zijn
  er geen groepen, dan maakt Stage Two die aan; ga gewoon door, stap 5b meldt het.
- **Map.** De app komt als nieuwe submap met de naam van de app onder de map die nu open
  staat. Zeg dat.

## Stap 5: droogloop, dan aanmaken

Draai eerst de droogloop, met Bash, precies zo:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/nieuwe-app.mjs" --json --droogloop --naam "<naam>" --eigenaar "<eigenaar>" --omschrijving "<omschrijving>"
```

Het antwoord is één JSON-object met een `status`.

- `mislukt`: `reden` is één zin met wat de gebruiker moet doen. Geef die door en stop.
  Probeer het niet te omzeilen.
- `klaar`: vat `plan` samen in hooguit vier regels: welke repo, waar op deze computer,
  en wie de reviewer is. Staat `githubPlan` op `free` en is de
  eigenaar een organisatie, zeg dan dat main straks niet beschermd kan worden op het
  gratis plan en dat Stage Two dat bij de start van het project regelt; doorgaan mag.

Zeg dan: "Ik maak hem nu aan; dat duurt een paar minuten." Draai hetzelfde commando met
`--doe-het` in plaats van `--droogloop`. Vraag geen toestemming meer; het typen van
`/stack-cloudflare:nieuwe-app` en de bevestiging van het plan waren de opdracht.

- `mislukt`: geef `reden` door (dat is de volledige foutmelding). Staat er een `repo` in
  het antwoord, dan is de repo al aangemaakt: **draai precies hetzelfde `--doe-het`-commando
  nog een keer**. Het script ziet dat de repo uit de template komt en maakt af wat er nog
  ontbreekt (invullen, installeren, committen, pushen, main beschermen, de omgevingen).
  Lukt het de tweede keer ook niet, stop dan en geef de melding door aan de gebruiker voor
  Stage Two.

  **Zet nooit zelf repo-instellingen met de hand**: geen `gh api .../rulesets`, geen
  omgevingen, geen secrets, geen `git push` naar main. Dat doet alleen het script. Claude
  Code houdt zo'n handmatige aanroep terecht tegen, en een half met de hand ingerichte
  repo laat later App inrichten vastlopen. Verwijder ook zelf niets.
- `gemaakt`: zeg waar de app staat (`url` en `map`). Ga dan door naar stap 5b; de
  `nogTeDoen` uit dit antwoord gebruik je alleen als stap 5b `geen-beheer` geeft.

## Stap 5b: hosting, deur en database laten inrichten

Hosting en deur (Cloudflare) en de database (Supabase) worden ingericht door de workflow
**App inrichten** in de beheer-repo van de organisatie (`<eigenaar>/stack-beheer`), op
GitHub. Daar staan alle sleutels; op deze computer komt bewust geen Cloudflare- of
Supabase-toegang. Probeer dat nooit zelf te doen, ook niet als er een opdrachtregel voor
blijkt te staan (`wrangler`, `supabase`).

Draai:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/nieuwe-app.mjs" --json --inrichten --naam "<naam>" --eigenaar "<eigenaar>" [--groepen "<groep1>,<groep2>"]
```

`--groepen` alleen als de app nog niet in de toegangslijst stond (stap 4). Zeg vooraf dat
dit tot een kwartier kan duren: een nieuwe database moet opstarten. Het antwoord:

- `kies-groepen`: de app staat nog niet in de toegangslijst en er zijn geen groepen
  meegegeven. Toon `groepen`, laat kiezen, en draai opnieuw met `--groepen`. Is de lijst
  leeg, geef dan `reden` door: Stage Two maakt de groepen aan.
- `wacht-op-toegang`: er staat nu een pull request op de beheer-repo (`pr`) die de app
  aan de toegangslijst toevoegt. Zeg dat de eigenaar van de beheer-repo die moet
  goedkeuren en mergen (zo beslist een mens wie bij een app mag), en dat je daarna
  hetzelfde commando nog een keer draait, zonder `--groepen`. Je kunt intussen al bouwen.
- `geen-beheer`: deze organisatie heeft (nog) geen beheer-repo. Zeg dat Stage Two de
  hosting en de database inricht, en loop de `nogTeDoen` van stap 5 langs.
- `mislukt`: geef `reden` door, met de `url` van de run als die er is. De app zelf is
  gewoon klaar; alleen de inrichting ontbreekt. Verwijs naar Stage Two.
- `ingericht`: deur, inloggen en database staan. Het adres van de app staat in `adres`;
  tot de eerste uitrol toont het "Deze app wordt ingericht.", al achter de deur. Loop
  `nogTeDoen` langs, elk punt in één zin.

## Stap 6: en nu verder

Zeg tot slot, in deze volgorde:

1. Open de nieuwe map in Claude Code (Bestand, map openen). De afspraken en de bewaker
   van de werkwijze werken alleen in de map van de app zelf.
2. Typ daar `/stack-cloudflare:verder-werken` en beschrijf de eerste versie uit stap 2.
   Komen er gegevens in, dan begint dat werk met de eerste tabellen; die route zit in
   `/stack-cloudflare:verder-werken` (met `docs/routes/databasewijziging.md`). De eerste
   merge zet de app echt neer.
3. Laat Stage Two weten dat deze app bestaat (naam en link), zodat hij in het overzicht
   komt en meedoet met updates van de werkwijze.
