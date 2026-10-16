#!/usr/bin/env bash
# Update only the SMTP password; preserve the existing durable messaging keys.
set +x
set +a
set -euo pipefail
if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'SMTP_UPDATE_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi
JM_SMTP_UPDATE_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_SMTP_UPDATE_PASSWORD JM_SMTP_UPDATE_CONFIRMATION
trap 'unset JM_SMTP_UPDATE_PASSWORD JM_SMTP_UPDATE_CONFIRMATION' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
env -u NODE_OPTIONS -u NODE_PATH node "$JM_SMTP_UPDATE_DIRECTORY/update-runtime-smtp.mjs" check "$@"
if ! IFS= read -r -s -p 'Nouveau mot de passe SMTP (saisie masquee) : ' JM_SMTP_UPDATE_PASSWORD; then
  printf '\n%s\n' 'SMTP_UPDATE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if ! IFS= read -r -s -p 'Confirmer le mot de passe SMTP (saisie masquee) : ' JM_SMTP_UPDATE_CONFIRMATION; then
  printf '\n%s\n' 'SMTP_UPDATE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if [[ "$JM_SMTP_UPDATE_PASSWORD" != "$JM_SMTP_UPDATE_CONFIRMATION" ]]; then
  printf '%s\n' 'SMTP_UPDATE_MISMATCH: Saisies differentes ; aucune modification.' >&2
  exit 1
fi
unset JM_SMTP_UPDATE_CONFIRMATION
printf '%s' "$JM_SMTP_UPDATE_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH node "$JM_SMTP_UPDATE_DIRECTORY/update-runtime-smtp.mjs" update "$@"
