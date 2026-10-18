#!/usr/bin/env bash
# Run personally in an interactive SSH terminal; credentials travel on stdin.
set +x
set +a
set -euo pipefail

if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'MESSAGING_CAPTURE_TTY: Ouvrir une console SSH interactive.' >&2
  exit 2
fi

JM_MESSAGING_SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
unset JM_MESSAGING_SMTP_USER JM_MESSAGING_SMTP_PASSWORD JM_MESSAGING_SMTP_CONFIRMATION
trap 'unset JM_MESSAGING_SMTP_USER JM_MESSAGING_SMTP_PASSWORD JM_MESSAGING_SMTP_CONFIRMATION' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# The exact metadata, anchored DB/auth files and absence of the target file are
# checked before personal input; no connection, SMTP send or key generation.
env -u NODE_OPTIONS -u NODE_PATH node "$JM_MESSAGING_SCRIPT_DIRECTORY/prepare-runtime-messaging.mjs" check "$@"

if ! IFS= read -r -s -p 'Identifiant SMTP (saisie masquee) : ' JM_MESSAGING_SMTP_USER; then
  printf '\n%s\n' 'MESSAGING_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if ! IFS= read -r -s -p 'Mot de passe SMTP (saisie masquee) : ' JM_MESSAGING_SMTP_PASSWORD; then
  printf '\n%s\n' 'MESSAGING_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if ! IFS= read -r -s -p 'Confirmer le mot de passe SMTP (saisie masquee) : ' JM_MESSAGING_SMTP_CONFIRMATION; then
  printf '\n%s\n' 'MESSAGING_CAPTURE_CANCELLED: Saisie interrompue.' >&2
  exit 1
fi
printf '\n' >&2
if [[ "$JM_MESSAGING_SMTP_PASSWORD" != "$JM_MESSAGING_SMTP_CONFIRMATION" ]]; then
  printf '%s\n' 'MESSAGING_CAPTURE_MISMATCH: Saisies differentes ; aucune configuration creee.' >&2
  exit 1
fi
unset JM_MESSAGING_SMTP_CONFIRMATION
printf '%s\n%s' "$JM_MESSAGING_SMTP_USER" "$JM_MESSAGING_SMTP_PASSWORD" | env -u NODE_OPTIONS -u NODE_PATH node "$JM_MESSAGING_SCRIPT_DIRECTORY/prepare-runtime-messaging.mjs" prepare "$@"
