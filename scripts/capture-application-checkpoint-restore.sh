#!/usr/bin/env bash
set +x
set +a
set -euo pipefail
if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'APPLICATION_CHECKPOINT_IMPORT_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi
JM_APPLICATION_RESTORE_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_APPLICATION_RESTORE_PASSWORD
trap 'unset JM_APPLICATION_RESTORE_PASSWORD' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_APPLICATION_RESTORE_DIRECTORY/import-application-checkpoint.mjs" check "$@"
if ! IFS= read -r -s -p 'Mot de passe SQL du compte opérateur de la copie (saisie masquée) : ' JM_APPLICATION_RESTORE_PASSWORD; then
  printf '\n%s\n' 'APPLICATION_CHECKPOINT_IMPORT_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
printf '%s' "$JM_APPLICATION_RESTORE_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_APPLICATION_RESTORE_DIRECTORY/import-application-checkpoint.mjs" restore "$@"
