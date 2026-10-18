#!/usr/bin/env bash
# Personal SQL verification only; the password is never exported or appended.
set +x
set +a
set -euo pipefail
if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'TEXT_CLONE_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi
JM_TEXT_CLONE_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_TEXT_CLONE_PASSWORD
trap 'unset JM_TEXT_CLONE_PASSWORD' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
env -u NODE_OPTIONS -u NODE_PATH node "$JM_TEXT_CLONE_DIRECTORY/verify-text-clone.mjs" check "$@"
if ! IFS= read -r -s -p 'Mot de passe SQL du compte operateur de la copie (saisie masquee) : ' JM_TEXT_CLONE_PASSWORD; then
  printf '\n%s\n' 'TEXT_CLONE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
printf '%s' "$JM_TEXT_CLONE_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH node "$JM_TEXT_CLONE_DIRECTORY/verify-text-clone.mjs" verify "$@"
