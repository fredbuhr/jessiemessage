#!/usr/bin/env bash
set +x
set +a
set -euo pipefail
if [[ ! -t 0 || ! -t 2 || ( "${1:-}" != '--offline' && "${1:-}" != 'inspect' && "${1:-}" != 'diagnose' ) ]]; then
  printf '%s\n' 'PRIVATE_CHECKPOINT_TTY: Ouvrir une console SSH interactive et choisir diagnose, inspect, ou --offline après arrêt de JessieMessage.' >&2
  exit 2
fi
JM_CHECKPOINT_COMMAND="$1"
if [[ "$1" == '--offline' ]]; then JM_CHECKPOINT_COMMAND='capture'; fi
shift
JM_CHECKPOINT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_CHECKPOINT_PASSWORD
trap 'unset JM_CHECKPOINT_PASSWORD' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_CHECKPOINT_DIRECTORY/private-checkpoint.mjs" check "$@"
if ! IFS= read -r -s -p 'Mot de passe SQL du compte de migration ou d’inspection (saisie masquée) : ' JM_CHECKPOINT_PASSWORD; then
  printf '\n%s\n' 'PRIVATE_CHECKPOINT_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if [[ "$JM_CHECKPOINT_COMMAND" == 'capture' ]]; then
  printf '%s' "$JM_CHECKPOINT_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_CHECKPOINT_DIRECTORY/private-checkpoint.mjs" capture --offline "$@"
else
  printf '%s' "$JM_CHECKPOINT_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_CHECKPOINT_DIRECTORY/private-checkpoint.mjs" "$JM_CHECKPOINT_COMMAND" "$@"
fi
