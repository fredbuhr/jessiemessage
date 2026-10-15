#!/usr/bin/env bash
# Run in the operator's own SSH terminal. Read an existing runtime password
# without echo; send it through stdin, never arguments, history or exports.
set +x
set -euo pipefail

if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'RUNTIME_CAPTURE_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi

JM_RUNTIME_CAPTURE_SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
JM_RUNTIME_CAPTURE_ENTRY="provision-runtime-stdin.mjs"
JM_RUNTIME_CAPTURE_PROMPT='Mot de passe SQL du compte application (saisie masquee) : '
if [[ "${1-}" == 'diagnose' ]]; then
  shift
  JM_RUNTIME_CAPTURE_ENTRY="diagnose-runtime-stdin.mjs"
  JM_RUNTIME_CAPTURE_PROMPT='Diagnostic uniquement : une copie privee du mot de passe SQL sera conservee pour investigation, sans activation (saisie masquee) : '
fi
unset JM_RUNTIME_CAPTURE_PASSWORD
trap 'unset JM_RUNTIME_CAPTURE_PASSWORD' EXIT
trap 'unset JM_RUNTIME_CAPTURE_PASSWORD; exit 129' HUP
trap 'unset JM_RUNTIME_CAPTURE_PASSWORD; exit 130' INT
trap 'unset JM_RUNTIME_CAPTURE_PASSWORD; exit 143' TERM

# Validate all metadata before prompting, with no password in this subprocess.
node --input-type=module - "$JM_RUNTIME_CAPTURE_SCRIPT_DIRECTORY/$JM_RUNTIME_CAPTURE_ENTRY" "$@" <<'NODE'
import { pathToFileURL } from "node:url";
try {
  const { parseArguments } = await import(pathToFileURL(process.argv[2]).href);
  parseArguments(process.argv.slice(3));
} catch {
  process.stderr.write("RUNTIME_INPUT_USAGE: Invalid runtime provisioning arguments.\n");
  process.exitCode = 2;
}
NODE

if ! IFS= read -r -s -p "$JM_RUNTIME_CAPTURE_PROMPT" JM_RUNTIME_CAPTURE_PASSWORD; then
  printf '\n%s\n' 'RUNTIME_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n'
printf '%s' "$JM_RUNTIME_CAPTURE_PASSWORD" | node "$JM_RUNTIME_CAPTURE_SCRIPT_DIRECTORY/$JM_RUNTIME_CAPTURE_ENTRY" "$@"
