/**
 * De netwerkvraag van de sessiehook (U4, KTD5): de nieuwste versie van de template is de
 * hoogste tag `stack-v<n>`, gelezen met één anonieme `git ls-remote --tags`. Dit staat
 * apart van regels.mjs zodat de regels zuiver blijven; `exec` is injecteerbaar zodat de
 * tests geen netwerk nodig hebben.
 *
 * GIT_TERMINAL_PROMPT=0 zorgt dat git nooit om een login vraagt (een privé template of
 * een verkeerde reponaam geeft dan meteen een fout, en dus null). Elke fout, een time-out
 * en een antwoord zonder stack-tag geven null: geen melding, geen stempel.
 */
import { execFileSync } from "node:child_process";

export const STANDAARD_REPO = "Stage-Two-AI/stack-template-cloudflare";

/** Alleen `eigenaar/repo`, zodat een vreemde waarde in STACK_TEMPLATE_REPO geen rare URL wordt. */
const REPO_VORM = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * De hoogste `n` uit regels `<sha>\trefs/tags/stack-v<n>` (ook met `^{}` erachter, de
 * ontdane vorm van een geannoteerde tag), als klein geheel getal; anders null.
 */
export function hoogsteStackVersie(uitvoer) {
  if (typeof uitvoer !== "string") return null;
  let hoogste = null;
  for (const regel of uitvoer.split(/\r?\n/)) {
    const m = /\trefs\/tags\/stack-v(\d{1,6})(?:\^\{\})?$/.exec(regel);
    if (!m) continue;
    const n = Number(m[1]);
    if (hoogste === null || n > hoogste) hoogste = n;
  }
  return hoogste;
}

function standaardExec(cmd, args, opties) {
  return execFileSync(cmd, args, opties);
}

/**
 * De versie op afstand als getal, of null. `repo` komt standaard uit STACK_TEMPLATE_REPO
 * (alleen voor tests en de bewijsronde bedoeld); `timeoutMs` is de tijdslimiet van de
 * hele git-aanroep (KTD7: drie seconden).
 */
export function versieOpAfstand({
  repo = process.env.STACK_TEMPLATE_REPO ?? STANDAARD_REPO,
  timeoutMs = 3000,
  exec = standaardExec,
} = {}) {
  if (!REPO_VORM.test(repo)) return null;
  try {
    const uit = exec("git", ["ls-remote", "--tags", `https://github.com/${repo}`], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return hoogsteStackVersie(String(uit));
  } catch {
    return null;
  }
}
