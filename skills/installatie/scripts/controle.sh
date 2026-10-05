#!/usr/bin/env bash
#
# De controle achter /stack-cloudflare:installatie: wat staat er op deze computer, en wat ontbreekt?
# Bewust een shellscript en geen Node: op een verse computer is Node juist een van de
# dingen die kunnen ontbreken, en dan moet de controle nog steeds draaien. Bash is er
# altijd waar Claude Code draait (op Windows via Git Bash).
#
#   controle.sh                 drukt per onderdeel één regel `naam=waarde` af
#   controle.sh --zet-identiteit zet de git-identiteit uit het GitHub-profiel als die ontbreekt
#
# Waarden: een versienummer of `ja` als het er is, `ontbreekt` als het er niet is.
# Het script installeert zelf niets en logt nergens in; dat blijft bij de agent en de
# gebruiker, met de uitleg uit SKILL.md.

set -u

versie_van() {
  # Eerste getal-met-punten in de uitvoer van `<cmd> --version`, of leeg.
  "$@" 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -1
}

meld() { printf '%s=%s\n' "$1" "$2"; }

besturingssysteem() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    Darwin) echo macos ;;
    Linux) echo linux ;;
    *) echo onbekend ;;
  esac
}

controleer_programma() {
  local naam="$1"; shift
  if command -v "$naam" >/dev/null 2>&1; then
    local v; v="$(versie_van "$naam" --version)"
    meld "$naam" "${v:-ja}"
    return 0
  fi
  meld "$naam" ontbreekt
  return 1
}

zet_identiteit() {
  # Naam en e-mail uit het GitHub-profiel van de ingelogde gebruiker. Een leeg
  # e-mailadres (privé op GitHub) wordt het noreply-adres dat GitHub zelf aan de
  # gebruiker koppelt; zo blijven de commits op github.com aan het account hangen.
  local login naam email id
  login="$(gh api user -q .login 2>/dev/null)" || { meld identiteit "mislukt: gh is niet ingelogd"; return 1; }
  naam="$(gh api user -q '.name // empty' 2>/dev/null)"
  email="$(gh api user -q '.email // empty' 2>/dev/null)"
  id="$(gh api user -q .id 2>/dev/null)"
  [[ -n "$naam" ]] || naam="$login"
  [[ -n "$email" ]] || email="${id}+${login}@users.noreply.github.com"
  if [[ -z "$(git config --global user.name 2>/dev/null)" ]]; then
    git config --global user.name "$naam" || { meld identiteit "mislukt: kon user.name niet zetten"; return 1; }
  fi
  if [[ -z "$(git config --global user.email 2>/dev/null)" ]]; then
    git config --global user.email "$email" || { meld identiteit "mislukt: kon user.email niet zetten"; return 1; }
  fi
  meld identiteit "gezet"
}

ZET_IDENTITEIT=0
for a in "$@"; do
  case "$a" in
    --zet-identiteit) ZET_IDENTITEIT=1 ;;
    *) echo "onbekende optie: $a" >&2; exit 2 ;;
  esac
done

meld os "$(besturingssysteem)"

controleer_programma git || true
if controleer_programma node; then
  # Node 22 is de ondergrens van de template en van de plugin zelf.
  major="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  if [[ -n "$major" && "$major" -lt 22 ]]; then meld node_te_oud ja; fi
fi
controleer_programma pnpm || true
if controleer_programma gh; then
  if gh auth status >/dev/null 2>&1; then
    meld gh_ingelogd "$(gh api user -q .login 2>/dev/null || echo ja)"
  else
    meld gh_ingelogd nee
  fi
fi

# Installeerders, zodat de agent weet welke weg er is.
command -v winget >/dev/null 2>&1 && meld winget ja
command -v brew >/dev/null 2>&1 && meld brew ja

naam="$(git config --global user.name 2>/dev/null || true)"
email="$(git config --global user.email 2>/dev/null || true)"
if [[ -n "$naam" && -n "$email" ]]; then
  meld git_identiteit "$naam <$email>"
else
  meld git_identiteit ontbreekt
fi

if [[ "$ZET_IDENTITEIT" == "1" ]]; then
  zet_identiteit || true
fi
