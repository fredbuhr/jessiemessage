#!/usr/bin/env bash
# The owner enters a new backup passphrase personally in an interactive SSH TTY.
set +x
set +a
set -euo pipefail

if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'PRIVATE_SECRETS_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi

JM_SECRETS_SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_SECRETS_PASSWORD JM_SECRETS_CONFIRMATION
trap 'unset JM_SECRETS_PASSWORD JM_SECRETS_CONFIRMATION' EXIT
trap 'unset JM_SECRETS_PASSWORD JM_SECRETS_CONFIRMATION; exit 129' HUP
trap 'unset JM_SECRETS_PASSWORD JM_SECRETS_CONFIRMATION; exit 130' INT
trap 'unset JM_SECRETS_PASSWORD JM_SECRETS_CONFIRMATION; exit 143' TERM

# Metadata and executable checks precede the personal prompt; no source content
# or passphrase is needed by this first process. Node preloads are not inherited.
env -u NODE_OPTIONS -u NODE_PATH node "$JM_SECRETS_SCRIPT_DIRECTORY/private-secrets-backup.mjs" check "$@"

if ! IFS= read -r -s -p 'Phrase du coffre, au moins 20 caracteres / 5 mots conseilles (saisie masquee) : ' JM_SECRETS_PASSWORD; then
  printf '\n%s\n' 'PRIVATE_SECRETS_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if ! IFS= read -r -s -p 'Confirmer la phrase du coffre (saisie masquee) : ' JM_SECRETS_CONFIRMATION; then
  printf '\n%s\n' 'PRIVATE_SECRETS_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if [[ "$JM_SECRETS_PASSWORD" != "$JM_SECRETS_CONFIRMATION" ]]; then
  printf '%s\n' 'PRIVATE_SECRETS_MISMATCH: Les deux saisies ne correspondent pas ; aucun coffre cree.' >&2
  exit 1
fi
unset JM_SECRETS_CONFIRMATION
printf '%s' "$JM_SECRETS_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH node "$JM_SECRETS_SCRIPT_DIRECTORY/private-secrets-backup.mjs" "$@"
