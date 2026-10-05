# Stage Two-plugin voor Claude Code (Cloudflare)

Je hebt een app die Stage Two voor je heeft gebouwd, en je werkt eraan met Claude Code.
Deze versie van de plugin is voor apps die op **Cloudflare** draaien, met hun gegevens bij
**Supabase**. Stage Two vertelt je bij de start welke plugin bij jouw bedrijf hoort.
Deze plugin zorgt dat Claude Code daarbij de werkwijze van Stage Two kent en bewaakt, en
dat je zelf verbeteringen aan die werkwijze kunt ophalen. Ook als Stage Two er niet meer
bij is.

Je hoeft geen programmeur te zijn om dit te gebruiken. De eerste keer loopt Stage Two het
met je door; daarna merk je er weinig van, behalve dat je assistent af en toe iets uitlegt
en je zelf nieuwe apps kunt beginnen.

## Wat de plugin doet

Vier commando's, en een bewaker op de achtergrond:

- **Een begin op een nieuwe computer.** Typ `/stack-cloudflare:installatie` en je assistent kijkt wat
  er op je computer ontbreekt, installeert het, helpt je inloggen bij GitHub en vraagt
  daarna wat je wilt doen. Zie hieronder.
- **Zelf een nieuwe app beginnen.** Typ `/stack-cloudflare:nieuwe-app`. Je assistent denkt eerst
  met je mee (wat moet de app doen en voor wie) en maakt hem daarna aan uit de nieuwste
  Stage Two-template, onder het GitHub-account van je bedrijf. De beheer-repo van je
  bedrijf zet hem daarna online, achter de deur. Zie hieronder.
- **Verder werken aan een app.** `/stack-cloudflare:verder-werken` is de vaste route voor elke
  wijziging, ook aan de database. Je hoeft het commando niet te typen: gewoon vragen wat
  je wilt werkt ook. De route staat ook in je app beschreven (`docs/routes/`).
- **Meekijken terwijl je bouwt.** In de Claude-app start je assistent de app vanzelf op
  je eigen computer en laat hij hem zien in het venster naast het gesprek (de preview).
  Hij kijkt daar zelf ook mee om zijn werk te controleren. De preview praat met de
  testdatabase, nooit met de echte gegevens. Opleveren gaat altijd via een pull request.
- **Een bewaker.** Een deel van de bestanden in je app is niet van jou maar van de
  gedeelde werkwijze: de automatische controles, de afspraken, de routes. Vraag je je
  assistent om daar iets in te wijzigen, dan houdt de plugin dat tegen en legt hij uit
  waarom. Zonder plugin houdt de controle op GitHub het alsnog tegen; met plugin hoor je
  het meteen.
- **Een melding als er een nieuwere werkwijze is.** Open je je app en heeft Stage Two de
  gedeelde werkwijze verbeterd, dan zegt je assistent dat één keer, hooguit één keer per
  dag. Meer niet: hij doet niets zonder dat jij het vraagt.
- **Alles updaten met één commando.** Typ `/stack-cloudflare:updaten`, en je assistent werkt alles
  bij zoals een update van je computer: de plugin, de programma's op je computer, je app
  naar de nieuwste werkwijze en de pakketten van je app. Wat je app verandert komt als
  voorstel (een pull request) dat jij bekijkt en goedkeurt. Daarna vraagt hij of je
  andere apps ook mee moeten. Je eigen werk raakt hij nooit aan.

Er komt geen wachtwoord, sleutel of computer van Stage Two aan te pas. Alles loopt via je
eigen GitHub-account en je eigen computer.

## Installeren

Je hebt Claude Code nodig: het tabblad **Code** in de Claude-app op je computer, of
Claude Code in een terminal. Op Windows heb je daarnaast **Git** nodig, en dat moet er
eerst zijn: zonder Git kan de plugin niet worden toegevoegd.

**Op Windows, vóór je de Claude-app installeert:** druk op de Windows-toets, typ
`PowerShell`, open het en plak deze regel:

```powershell
winget install -e --id Git.Git
```

Klik op **Ja** als Windows vraagt of dit programma wijzigingen mag aanbrengen. Doe dit
vóór de Claude-app, dan hoeft die daarna niet opnieuw te starten. Op een Mac hoeft dit
niet.

Installeer daarna de Claude-app (claude.ai/download) en log in. Open in het tabblad
**Code** een map (leeg mag, bijvoorbeeld `Documenten\Apps`) en typ in het chatvenster:

```text
/plugin marketplace add Stage-Two-AI/stack-plugin-cloudflare
```

Er verschijnt een klein venster met de vraag of je deze bron vertrouwt. Bevestig dat.
Daarna opent een scherm met plugins waarin `stack-cloudflare` al klaarstaat: klik op het **plusje**
ernaast om hem te installeren. Dat is alles.

Werk je in een terminal en verschijnt dat scherm niet, typ dan ook nog:

```text
/plugin install stack-cloudflare@stagetwo-cloudflare
```

**Controleren dat het werkt.** Typ `/stack-cloudflare:` en kijk of de vier commando's verschijnen
(installatie, nieuwe-app, verder-werken en updaten). Zie je ze niet, sluit Claude Code dan en open de map opnieuw.

**Bijwerken van de plugin zelf.** Dat gaat vanzelf, zonder dat je iets hoeft te typen.
`/stack-cloudflare:installatie` zet het aan; het werkt in elke map. Kort nadat je de Claude-app
hebt geopend en je eerste bericht hebt gestuurd, kijkt Claude Code op de achtergrond of
er een nieuwe versie is en haalt die binnen. Je hoeft de app daarvoor niet open te
houden of opnieuw te starten: de nieuwe versie verschijnt vanzelf.

## Beginnen op een nieuwe computer

Typ `/stack-cloudflare:installatie`. Je assistent kijkt wat er ontbreekt (Git, Node, pnpm en de
GitHub-opdrachtregel) en installeert dat. Twee dingen om te weten:

- **Windows vraagt een paar keer om toestemming.** Er verschijnt dan een venster of dit
  programma wijzigingen mag aanbrengen. Klik op **Ja**. Op een Mac kan om je wachtwoord
  worden gevraagd.
- **Inloggen bij GitHub doe je zelf, één keer, in een terminal.** Je assistent legt het
  precies uit: je opent Git Bash (Windows) of Terminal (Mac), typt `gh auth login`,
  kiest GitHub.com, HTTPS, Yes en "Login with a web browser", en typt een code over in
  de browser. **Onthoud die code; kopieer hem niet:** Ctrl+C breekt in dat venster het
  inloggen af. Daarna zeg je "klaar" in het chatvenster.

Soms kent Claude Code een net geïnstalleerd programma nog niet. Je assistent vraagt je
dan de app opnieuw te starten. Dat is normaal en gebeurt maar één keer. Twee dingen
die je daarbij niet vanzelf ziet:

- **Het kruisje sluit de app niet af.** Op Windows blijft hij rechtsonder in het
  systeemvak draaien. Klik daar op het pijltje **^**, klik met de rechtermuisknop op het
  Claude-icoon en kies **Afsluiten**. Open de app daarna opnieuw.
- **Je gesprek opent niet vanzelf.** Klik het aan in de linkerzijbalk en typ
  **ga verder**.

Tot slot zet je assistent je naam in Git, zodat later zichtbaar blijft welke wijziging
van jou is, welke van een collega en welke van Stage Two. Daarna vraagt hij wat je wilt:
een nieuwe app beginnen, verder werken aan een bestaande app, of alles updaten.

## Een nieuwe app beginnen

Typ `/stack-cloudflare:nieuwe-app`. Het eerste deel is een gesprek, en dat is bewust: de keuzes
daar zijn achteraf duur om te veranderen.

1. Is het echt een nieuwe app, of past het bij een app die je al hebt? De regel is: één
   app per verzameling gegevens. Gaat het over gegevens die al in een app zitten, dan is
   het een uitbreiding van die app, en die maak je met `/stack-cloudflare:verder-werken`.
2. Wat moet de app doen, voor wie, met welke gegevens, en wat is de eerste versie waar
   iemand echt iets aan heeft?
3. Een naam, de plek (onder het GitHub-account van je bedrijf, in een nieuwe map op je
   computer) en wie erbij mag (een of meer groepen uit de toegangslijst van je bedrijf).

Elke app krijgt een deur (alleen wie op de toegangslijst staat komt erin) en een eigen
database bij Supabase, want het inloggen loopt daar doorheen. Daar hoef je niets voor te
kiezen.

Daarna maakt je assistent de app aan uit de nieuwste template, zet de eerste versie op
GitHub en beschermt de hoofdtak. Hij eindigt met wat er nog open staat en met de
volgende stap: open de nieuwe map in Claude Code en typ `/stack-cloudflare:verder-werken`.

Hosting, deur en database worden daarna ingericht door de workflow **App inrichten** op
GitHub, in de beheer-repo van je bedrijf (`stack-beheer`, Stage Two zet die bij de start
neer). Staat de app nog niet op de toegangslijst, dan opent je assistent eerst een
voorstel (pull request) op die beheer-repo; de eigenaar keurt dat goed, en dan gaat het
verder. Je assistent start de workflow en wacht op het resultaat. Dat is bewust zo
gebouwd: de toegang tot Cloudflare en Supabase hoort niet op een werkcomputer te staan.
GitHub is de enige plek waar de regels worden afgedwongen, en zo blijft dat. Heeft je
bedrijf nog geen beheer-repo, dan richt Stage Two de hosting en de database in.

Laat Stage Two weten dat de app bestaat. Dan komt hij in het overzicht en doet hij mee
met updates van de werkwijze.

## Alles updaten

Zegt je assistent dat er een nieuwere versie van de werkwijze is, of wil je het gewoon
bij de tijd houden, typ dan in de map van je app:

```text
/stack-cloudflare:updaten
```

Wat er dan gebeurt, in deze volgorde:

1. **De plugin zelf** wordt bijgewerkt. Een nieuwe versie werkt na het opnieuw openen
   van de app.
2. **De programma's op je computer** (Git, Node, pnpm en de GitHub-opdrachtregel) worden
   bijgewerkt. Op Windows vraagt Windows een paar keer of dat mag; klik op **Ja**.
3. **Je app naar de nieuwste werkwijze.** Je assistent maakt in een tijdelijke kopie van
   je app een voorstel klaar; je eigen bestanden en je lopende werk blijven
   onaangeraakt. Alleen als een bestand van de werkwijze bij jou anders is dan verwacht
   (omdat iemand het ooit heeft aangepast) stelt hij een vraag: de nieuwe versie
   overnemen, of jouw versie houden. Twijfel je? Kies "houden"; dat verandert niets aan
   wat nu werkt, en Stage Two kan er later naar kijken.
4. **De pakketten van je app** worden bijgewerkt, binnen de grenzen die in je app
   staan, als een tweede, los voorstel. Grote sprongen naar een nieuwe hoofdversie
   noemt hij alleen; die pakt Stage Two op.
5. **Je andere apps.** Je assistent laat zien welke andere apps van je bedrijf nog op
   een oudere werkwijze staan, en vraagt welke je nu wilt bijwerken. Die hoeven niet op
   je computer te staan. Elke gekozen app krijgt zijn eigen voorstellen.

Elk voorstel staat op GitHub als pull request, onder jouw naam, met een uitleg in
gewone taal. Daarna is het aan jou, precies zoals bij elke andere wijziging: open de
pull request, wacht tot de controles groen zijn en klik op **Merge**. Zijn de controles rood, dan
voldoet je app niet aan een nieuwe regel. Neem dan contact op met Stage Two en zet de
controle niet uit.

## Als iets niet lukt

| Je ziet | Wat er aan de hand is | Wat je doet |
|---|---|---|
| "log eerst in bij GitHub met `gh auth login`" | Je computer is niet ingelogd bij GitHub | Typ `gh auth login` in een terminal en volg de stappen |
| "de template is niet bereikbaar" | Geen internet, of GitHub is even niet bereikbaar | Later opnieuw proberen |
| "je hebt geen schrijfrecht" | Je account mag niet in deze app schrijven | Vraag de eigenaar van de app je toe te voegen |
| "installeer pnpm" | `pnpm` ontbreekt op je computer | Vraag Stage Two, of installeer het zoals bij de start is uitgelegd |
| "er staat al een pull request open" | Er ligt al een voorstel voor deze versie | Bekijk die pull request en merge hem, of vraag Stage Two |
| Je assistent weigert een bestand te wijzigen | Dat bestand hoort bij de gedeelde werkwijze | Wil je de nieuwste versie: `/stack-cloudflare:updaten`. Wil je het anders: vraag het Stage Two |
| "er staat al een voorstel voor de afhankelijkheden open" | De pakketten-PR van een vorige keer is nog niet gemerged | Merge die eerst (als de controles groen zijn), of sluit hem, en typ dan opnieuw `/stack-cloudflare:updaten` |
| De preview toont geen gegevens | Deze app heeft nog geen testdatabase ingesteld | Vraag Stage Two; het opleveren via de pull request werkt gewoon |
| Na installeren zegt `/stack-cloudflare:installatie` nog steeds dat iets ontbreekt | Claude Code kent het nieuwe programma nog niet | De app helemaal afsluiten (Windows: systeemvak rechtsonder, rechtermuisknop op Claude, Afsluiten), opnieuw openen, het gesprek aanklikken in de linkerzijbalk en **ga verder** typen |
| `/plugin marketplace add` lukt niet op Windows | Git ontbreekt | Git installeren zoals onder "Installeren", de app afsluiten via het systeemvak en opnieuw openen |
| `gh auth login` stopt halverwege | Ctrl+C gedrukt om de code te kopiëren; dat breekt het af | Opnieuw `gh auth login` typen en de nieuwe code onthouden in plaats van kopiëren |
| "de repo bestaat al" bij `/stack-cloudflare:nieuwe-app` | Er is al een app met die naam | Kies een andere naam |
| "main is nog niet beschermd" na `/stack-cloudflare:nieuwe-app` | Het GitHub-account staat op het gratis plan | Vraag Stage Two; de app werkt, alleen de bescherming ontbreekt nog |

Kom je er niet uit, dan is de vraag altijd welkom bij Stage Two. Vertel wat je typte en
wat er terugkwam; de melding is bedoeld om door te geven.

## Voor Stage Two

Alles hieronder is voor wie de plugin en de template onderhoudt.

### Twee sporen

Stage Two heeft sinds 05-10-2026 twee sporen, elk met een eigen template en een eigen plugin:

| Spoor | Template | Plugin | Marketplace |
|---|---|---|---|
| Vercel | `Stage-Two-AI/stack-template` | `Stage-Two-AI/stack-plugin` (`stack`) | `stagetwo` |
| Cloudflare | `Stage-Two-AI/stack-template-cloudflare` | deze repo (`stack-cloudflare`) | `stagetwo-cloudflare` |

Deze repo is begonnen als kopie van `stack-plugin` 2.1.0. Wat anders is:

- de template is `Stage-Two-AI/stack-template-cloudflare` (melding, updaten, nieuwe-app);
- de hook, `updaten` en het overzicht doen alleen iets bij een app met
  `"variant": "cloudflare"` in `.claude/stack-manifest.json`; een Vercel-app laten ze aan
  de andere plugin over, ook als beide plugins op één computer staan;
- `nieuwe-app` haalt de paden uit `nietMeenemen` weg, zet de Worker-naam in
  `wrangler.jsonc` op de appnaam, geeft elke app een eigen database, en `--inrichten`
  controleert eerst `toegang.json` van `<org>/stack-beheer` (zo nodig een pull request)
  en start dan de Cloudflare-variant van **App inrichten** (inputs `app` en `droogloop`);
- `automatisch-bijwerken.mjs` zet de marketplace `stagetwo-cloudflare`.

Een verbetering die voor beide sporen geldt, doe je in beide repo's.

### Wat waar staat

```text
.claude-plugin/    plugin.json (naam stack-cloudflare, versie) en marketplace.json (naam stagetwo-cloudflare)
hooks/             de bewaker (PreToolUse) en de melding bij sessiestart (SessionStart)
skills/            de vier skills; met een script: updaten (bijwerken.mjs voor de
                   template, afhankelijkheden.mjs, overzicht.mjs), installatie
                   (controle.sh, shell omdat Node kan ontbreken) en nieuwe-app
                   (nieuwe-app.mjs: aanmaken, en --inrichten start de workflow in de
                   beheer-repo van de klant; plus ruleset.json voor main)
lib/               de kern: manifest lezen, toepassen, PR-tekst, git- en PR-stappen
beheer/            de beheerde run over het register van Stage Two; geen skill, alleen voor Stage Two
test/              de geheimenscan over boom en geschiedenis
```

`beheer/beheerd.mjs` staat bewust niet onder `bin/`: die map zet Claude Code op het
PATH van elke sessie waarin de plugin aanstaat, ook bij klanten. De beheerde run wordt
gestart vanuit `Stack/bin/stack-sync.mjs`, dat het register en de ruleset meegeeft.

### Hoe het werkt, in het kort

- De bewaker leest de beschermde paden uit `.claude/stack-manifest.json` van de repo
  (de lijst `vervangen`, plus `.github/CODEOWNERS` en alles onder `.github/workflows/`
  en `.claude/`). Zonder manifest doet hij niets. `STACK_ALLOW_POLICY_EDIT=1` laat
  padbewerkingen door, voor onderhoud aan de template zelf.
- De melding vergelijkt `.claude/stack-version` met de hoogste tag `stack-v<n>` op de
  publieke Cloudflare-template (één anonieme `git ls-remote`, drie seconden), met een dagstempel
  per repo in `${CLAUDE_PLUGIN_DATA}`.
- Het templatedeel van `/stack-cloudflare:updaten` (`bijwerken.mjs`) draait in twee stappen: `--droogloop` (voorcontrole, tijdelijke
  kloon, kern toepassen, resultaat als JSON) en `--werkmap <map>` (keuzes toepassen,
  committen met de identiteit van de gebruiker, pushen als de boom verschilt, PR openen
  of bijwerken). Elke commit draagt de trailer `Stack-bijwerken: v<n>`; een branch met
  een commit zonder die trailer wordt nooit opnieuw opgebouwd. De tijdelijke map
  verdwijnt na de tweede aanroep en bij elke mislukking. Met `--repo eigenaar/naam`
  werkt het een app bij die niet op de computer staat (kloon via de gh-login). De
  branchnaam `stack-bijwerken/v<n>` en de trailer blijven zo heten: de beheerde run en
  de bestaande pull requests van klanten leunen erop.
- `afhankelijkheden.mjs`: `pnpm update --no-save` in een tijdelijke kloon (alleen het
  lockfile verandert, de grenzen in package.json zijn deels van de template), PR op de
  vaste branch `stack-afhankelijkheden`; staat die PR al open, dan stopt hij. Noemt de
  hoofdversies uit `pnpm outdated` en de open Dependabot-PR's.
- `overzicht.mjs`: de apps uit de template met schrijfrecht, per eigenaar via
  `gh repo list` en de inhoud van `.claude/stack-version`; wijzigt niets.
- De hook geeft bij schrijven in `supabase/migrations/` de databaseroute mee als
  `additionalContext` (geen weigering, de gewone toestemmingsvraag blijft). Dat
  vervangt de vroegere skill databasewijziging.
- De kern (`lib/toepassen.mjs`) controleert zichzelf: raakt er iets buiten het manifest,
  dan stopt hij. Een eigen bestand van de klant wordt nooit stil overschreven of
  verwijderd; het komt in `overgeslagen` met een reden en een keuze.

### Een klant aansluiten (checklist)

Vooraf: de template is publiek, de tag `stack-v<n>` van de nieuwste versie staat, de
accounts van de klant staan (GitHub-organisatie op een betaald plan, Cloudflare met Zero
Trust, Supabase) en `<klantorg>/stack-beheer` is ingericht met de Cloudflare-variant
(`bin/klant-inrichten.sh --variant cloudflare` in Stage-Two-AI/stack-beheer), met minstens
één groep in `toegang.json`. De klant heeft Write op stack-beheer, zodat hij de workflow
mag starten; de sleutels staan in de omgeving `beheer` en zijn voor hem niet te lezen.

1. Op Windows eerst Git (`winget install -e --id Git.Git` in PowerShell), dán de
   Claude-app. Plugin installeren zoals hierboven onder "Installeren" (desktop-app: één
   commando, vertrouwen bevestigen, plusje). Getest 22-09-2026 en, van een kale VM af,
   01-10-2026 op Windows in de desktop-app.
2. `/stack-cloudflare:installatie` samen doorlopen: installaties, de terminalstap voor `gh auth login`,
   de git-identiteit. Leg vooraf uit: de UAC-vensters, dat de code van `gh auth login`
   overgetypt wordt (Ctrl+C breekt af), en dat een herstart via het systeemvak gaat en
   het gesprek daarna via de linkerzijbalk terugkomt ("ga verder").
3. Controleer dat de vier skills verschijnen als `/stack-cloudflare:<naam>`.
4. Open een app op versie 9 of nieuwer en controleer dat de bewaker vuurt: vraag de agent
   één regel te wijzigen in `.github/workflows/ci.yml`; dat moet geweigerd worden.
5. Controleer dat de plugin zichzelf bijwerkt. `/stack-cloudflare:installatie` (stap 5) zet dat op
   gebruikersniveau aan, in `~/.claude/settings.json`: `env.FORCE_AUTOUPDATE_PLUGINS = "1"`
   en `extraKnownMarketplaces.stagetwo-cloudflare.autoUpdate = true`. Beide zijn nodig. De desktop-app
   start Claude Code met `DISABLE_AUTOUPDATER=1`, en dat zet ook het bijwerken van plugins
   uit; een marketplace die de klant zelf toevoegt, krijgt bovendien geen `autoUpdate`
   (standaard uit). De `autoUpdate` in `.claude/settings.json` van een app (template v11)
   is daarom in de desktop-app niet genoeg. Vastgesteld en bewezen op 02-10-2026 op de
   Windows-VM: na de instelling, één herstart en één bericht kwam 2.0.0 binnen, zonder
   nog een herstart. Controle: vraag de assistent `~/.claude/plugins/installed_plugins.json`
   te tonen.
6. Loop de melding en `/stack-cloudflare:updaten` één keer samen door, en `/stack-cloudflare:nieuwe-app` als
   de klant zelf apps gaat starten. Cloudflare en Supabase richt de workflow "App
   inrichten" in `<klantorg>/stack-beheer` in (recept: Stage-Two-AI/stack-beheer,
   `klant-cloudflare/`); die toegang komt nooit op de computer van de klant (besluit
   22-09-2026).
7. Zet in `Stack/projecten.json` de `route` van het project op `plugin`; een app die de
   klant zelf met `/stack-cloudflare:nieuwe-app` maakte, voeg je toe zodra hij hem meldt.

### Een nieuwe versie uitbrengen

Volgorde bij elke release: eerst de plugin, dan de template. Een oude plugin stopt op
een nieuwer manifestformaat; een nieuwe plugin kan altijd met een oudere template
overweg.

1. Plugin: versie in `.claude-plugin/plugin.json` ophogen, pull request, groene check,
   merge naar `main`. Alleen een hoger versienummer laat een klant een update zien.
2. Template: wijzigingen als pull request op `stack-template-cloudflare`, met
   `.claude/stack-version` en `stackVersion` in het manifest opgehoogd. Een bestand uit
   `vervangen` wijzigt alleen samen met zo'n versieverhoging.
3. Na de merge de tag zetten: `git tag stack-v<n> && git push origin stack-v<n>`. Pas
   dan bestaat de versie voor de melding en de skill. Een tag wordt nooit verplaatst;
   de ruleset op de template weigert dat.
4. Registerprojecten: `node bin/stack-sync.mjs --status` in Stack, dan de droogloop,
   dan `--doe-het`.

### De repo beschermen

De ruleset op `main` (`.github/ruleset.json`) staat: geen directe push, pull request
met de check `Tests` groen. Opnieuw zetten na een herinrichting:

```sh
gh api repos/Stage-Two-AI/stack-plugin-cloudflare/rulesets -X POST --input .github/ruleset.json
```

### Tests

```sh
npm test
claude plugin validate .
```

Licentie: MIT (zie `LICENSE`). De naam Stage Two en de huisstijl vallen daar niet onder.
