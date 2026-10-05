---
name: installatie
description: De eerste stap op een computer waar nog niets staat - controleert en installeert wat er nodig is om met de Stage Two-werkwijze te werken (Git, Node, pnpm, de GitHub-opdrachtregel), begeleidt het inloggen bij GitHub, zet de naam voor Git, en vraagt daarna wat de gebruiker wil doen (een nieuwe app starten, een bestaande app openen of alles updaten). Gebruik dit als de gebruiker /stack-cloudflare:installatie typt, net begint, in een lege map zit, of vraagt wat er geïnstalleerd moet worden.
---

Je helpt iemand die niet technisch is om zijn computer klaar te maken. Praat in gewone
taal, één ding tegelijk, en leg uit wat er gaat gebeuren vóórdat het gebeurt. Vraag geen
toestemming voor stappen die hieronder staan; de gebruiker heeft `/stack-cloudflare:installatie` getypt
en dat is de opdracht. Voer niets uit wat hier niet staat.

## Stap 1: kijken wat er is

Draai dit precies zo, met Bash:

```sh
bash "${CLAUDE_SKILL_DIR}/scripts/controle.sh"
```

Je krijgt per onderdeel één regel `naam=waarde`. `ontbreekt` betekent: installeren.
`node_te_oud=ja` betekent: Node opnieuw installeren (22 of nieuwer is nodig).
`gh_ingelogd=nee` betekent: stap 3. `git_identiteit=ontbreekt` betekent: stap 4.

Staat alles er en is gh ingelogd, ga dan meteen naar stap 5.

## Stap 2: installeren wat ontbreekt

Zeg eerst in twee regels wat er ontbreekt en dat je het nu installeert. Op Windows
zeg je erbij dat Windows een paar keer een venster toont met de vraag of dit programma
wijzigingen mag aanbrengen, en dat "Ja" het antwoord is. Op macOS kan om het
wachtwoord van de computer worden gevraagd.

Gebruik alleen deze commando's, in deze volgorde, en alleen voor wat ontbreekt:

Windows (`os=windows`, `winget=ja`). Git staat er normaal al: zonder Git kan de plugin
op Windows niet worden toegevoegd, dus de gebruiker heeft het vóór de Claude-app
geïnstalleerd (README, "Installeren"). De regel blijft hier voor het geval het toch
ontbreekt:

```sh
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements
npm install -g pnpm
```

macOS (`os=macos`, `brew=ja`):

```sh
brew install git node gh pnpm
```

Ontbreekt winget of brew, dan stop je: vraag de gebruiker contact op te nemen met Stage
Two, en zeg welk onderdeel ontbreekt. Verzin geen andere installatieweg.

Draai daarna stap 1 opnieuw. Meldt de controle iets nog steeds als `ontbreekt` terwijl
de installatie is gelukt, dan kent deze sessie het nieuwe programma nog niet. Zeg dan
dat de app opnieuw moet starten, dat dit normaal is en maar één keer gebeurt, en geef
deze uitleg letterlijk genoeg om te volgen:

1. Sluit de Claude-app **helemaal** af. Op Windows is het kruisje niet genoeg: de app
   blijft dan rechtsonder in het systeemvak draaien. Klik daar op het pijltje **^**,
   klik met de rechtermuisknop op het Claude-icoon en kies **Afsluiten**. Op macOS:
   cmd+Q.
2. Open de Claude-app opnieuw.
3. Dit gesprek opent niet vanzelf. Klik het aan in de **linkerzijbalk** en typ daar
   **ga verder**.

Zegt de gebruiker daarna "ga verder", begin dan weer bij stap 1.

## Stap 3: inloggen bij GitHub (doet de gebruiker zelf, in een terminal)

Dit is de enige stap die de gebruiker zelf doet. Inloggegevens typ jij nooit in en je
probeert het inloggen niet zelf uit te voeren, ook niet als het zou kunnen. Geef deze
uitleg, letterlijk genoeg om te volgen:

1. Open een terminal. Windows: druk op de Windows-toets, typ `Git Bash` en open dat.
   macOS: open `Terminal` via Spotlight (cmd+spatie).
2. Typ daar `gh auth login` en druk op Enter.
3. Beantwoord de vragen zo: **GitHub.com**, dan **HTTPS**, dan **Yes** (Git mag je
   inloggegevens gebruiken), dan **Login with a web browser**.
4. Er verschijnt een code van acht tekens, zoals `ABCD-1234`. **Onthoud die; kopieer
   hem niet.** Ctrl+C betekent in dit venster "stoppen" en breekt het inloggen af.
   Druk op Enter en typ de code over in de browserpagina die opent. Klik op
   **Authorize**. Is het inloggen toch afgebroken, typ dan gewoon opnieuw
   `gh auth login`: je krijgt een nieuwe code.
5. Kom terug naar dit venster en zeg "klaar".

Zegt de gebruiker "klaar", draai dan stap 1 opnieuw en controleer dat `gh_ingelogd`
nu een accountnaam toont. Zo niet, vraag wat er op het scherm stond en help met de
melding; verzin geen omweg.

## Stap 4: de naam voor Git

Git zet bij elke wijziging wie hem heeft gemaakt. Zo blijft later zichtbaar wat de
gebruiker zelf heeft gedaan, wat een collega deed en wat Stage Two deed. Draai:

```sh
bash "${CLAUDE_SKILL_DIR}/scripts/controle.sh" --zet-identiteit
```

Het script neemt naam en e-mailadres over van het GitHub-profiel als er nog niets
staat, en laat bestaande instellingen met rust. Zeg de gebruiker welke naam en welk
adres nu gebruikt worden (`git_identiteit=...`). Wil hij een andere naam, pas die
dan aan met `git config --global user.name "<naam>"` en zeg dat je dat hebt gedaan.

## Stap 5: automatisch bijwerken aanzetten

Zeg in één regel dat je zorgt dat de Stage Two-plugin zichzelf voortaan bijwerkt, zodat
de gebruiker daar nooit meer naar hoeft te kijken. Draai:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/automatisch-bijwerken.mjs" --json
```

- `gezet` of `al-goed`: klaar. Zeg niets over de details; het werkt vanaf de volgende
  keer dat de app start.
- `mislukt`: geef `reden` door en ga door met stap 6. De plugin werkt gewoon; alleen het
  vanzelf bijwerken ontbreekt, en `/stack-cloudflare:updaten` doet het dan met de hand.

Achtergrond, niet voor de gebruiker: de desktop-app start Claude Code met
`DISABLE_AUTOUPDATER=1`, en dat zet ook het bijwerken van plugins uit. Het script zet in
de instellingen van de gebruiker `FORCE_AUTOUPDATE_PLUGINS=1` en `autoUpdate` voor de
marketplace `stagetwo-cloudflare`, en laat de rest van dat bestand staan.

## Stap 6: wat wil je doen?

Alles staat klaar. Vraag nu, met deze drie keuzes:

1. **Een nieuwe app beginnen.** Typ `/stack-cloudflare:nieuwe-app`. Die route denkt eerst mee
   over wat de app moet doen, en zet daarna alles
   klaar.
2. **Verder werken aan een bestaande app.** Vraag welke app. Kun je hem niet uit de
   naam halen, toon dan de lijst met `gh repo list <organisatie> --limit 50` (de
   organisatie is meestal het bedrijf van de gebruiker; `gh api user/orgs -q '.[].login'`
   noemt ze). Kloon de app in een eigen map onder de huidige map met
   `gh repo clone <eigenaar>/<naam>` en draai daarin `pnpm install`. Zeg daarna dat
   de gebruiker die map in Claude Code moet openen (Bestand, map openen) en daar verder
   kan met `/stack-cloudflare:verder-werken`. Werk niet vanuit de huidige map aan die app: de
   afspraken en de bewaker werken alleen als de map van de app zelf open staat.
3. **Alles bijwerken.** Typ `/stack-cloudflare:updaten`. Dat werkt de plugin en de programma's op
   deze computer bij, en daarna de apps die de gebruiker kiest, elk als pull request.
   Een app hoeft daarvoor niet op deze computer te staan.

Zeg tot slot dat `/stack-cloudflare:installatie` altijd opnieuw getypt mag worden, bijvoorbeeld op een
andere computer of na een herinstallatie: het slaat over wat al goed staat.
