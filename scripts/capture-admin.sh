#!/usr/bin/env bash
# The owner runs this in their own SSH terminal; no password input file is made.
set +x
set -euo pipefail

if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'ADMIN_CAPTURE_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi

JM_ADMIN_CAPTURE_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_ADMIN_CAPTURE_PASSWORD JM_ADMIN_CAPTURE_CONFIRMATION
trap 'unset JM_ADMIN_CAPTURE_PASSWORD JM_ADMIN_CAPTURE_CONFIRMATION' EXIT
trap 'unset JM_ADMIN_CAPTURE_PASSWORD JM_ADMIN_CAPTURE_CONFIRMATION; exit 129' HUP
trap 'unset JM_ADMIN_CAPTURE_PASSWORD JM_ADMIN_CAPTURE_CONFIRMATION; exit 130' INT
trap 'unset JM_ADMIN_CAPTURE_PASSWORD JM_ADMIN_CAPTURE_CONFIRMATION; exit 143' TERM

# Validate private configuration, SQL, physical auth schema, fresh setup output
# and the absence of an administrator before asking for a new password.
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_ADMIN_CAPTURE_DIRECTORY/admin-bootstrap-stdin.mjs" check "$@"

if ! IFS= read -r -s -p 'Mot de passe administrateur, 14 a 128 caracteres (saisie masquee) : ' JM_ADMIN_CAPTURE_PASSWORD; then
  printf '\n%s\n' 'ADMIN_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if ! IFS= read -r -s -p 'Confirmer le mot de passe administrateur (saisie masquee) : ' JM_ADMIN_CAPTURE_CONFIRMATION; then
  printf '\n%s\n' 'ADMIN_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if [[ "$JM_ADMIN_CAPTURE_PASSWORD" != "$JM_ADMIN_CAPTURE_CONFIRMATION" ]]; then
  printf '%s\n' 'ADMIN_CAPTURE_MISMATCH: Les deux saisies ne correspondent pas ; aucun compte cree.' >&2
  exit 1
fi
unset JM_ADMIN_CAPTURE_CONFIRMATION
printf '%s' "$JM_ADMIN_CAPTURE_PASSWORD" | JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node "$JM_ADMIN_CAPTURE_DIRECTORY/admin-bootstrap-stdin.mjs" "$@"
