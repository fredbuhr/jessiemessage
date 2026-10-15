#!/usr/bin/env bash
# Optional operator convenience for an Infomaniak SSH terminal. The database
# password goes through a hidden read and a pipe, never through command args.
set +x
set -euo pipefail

if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'MIGRATION_CAPTURE_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi

JM_CAPTURE_SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
trap 'unset JM_CAPTURE_PASSWORD' EXIT
if ! IFS= read -r -s -p 'Mot de passe SQL du compte de migration (saisie masquee) : ' JM_CAPTURE_PASSWORD; then
  printf '\n%s\n' 'MIGRATION_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n'
printf '%s' "$JM_CAPTURE_PASSWORD" | node "$JM_CAPTURE_SCRIPT_DIRECTORY/migrate-stdin.mjs" "$@"
