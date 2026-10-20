#!/bin/bash
# Lecture seule du statut SQL depuis la 1.1.1 epinglee ; aucun upgrade ni Run.
set +x
set +a
set -euo pipefail
umask 077
unset jm_password
trap 'printf "MIGRATION_STATUS_NOT_CONFIRMED: shell_check_line_%s\n" "$LINENO" >&2' ERR
trap 'unset jm_password; exec 3>&-' EXIT
[[ $# == 0 ]]
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_SYSTEM_CA SSL_CERT_FILE SSL_CERT_DIR OPENSSL_CONF
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd
jm_checkout=/srv/customer/jessiemessage-operator/production-111-cfa7dd35
jm_sha=cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a
jm_tree=94b2fec5383fd948df7605b63f65a4e23078c2a1
jm_node=/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node
jm_git() { /usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$jm_checkout" "$@"; }
[[ ! -L "$jm_checkout" && $(jm_git rev-parse HEAD) == "$jm_sha" ]]
[[ $(jm_git rev-parse 'HEAD^{tree}') == "$jm_tree" ]]
jm_status=$(jm_git status --porcelain --untracked-files=normal)
[[ -z "$jm_status" ]]
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c ]]
[[ $("$jm_node" --version) == v24.22.0 ]]
cd -- "$jm_checkout"
# Le telechargement du script peut occuper stdin : les saisies utilisent le TTY.
exec 3<>/dev/tty
[[ -t 3 ]]
printf '%s' 'Identite SQL du compte de migration existant : ' >&3
IFS= read -r -u 3 jm_migrator
[[ "$jm_migrator" =~ ^[a-zA-Z0-9_]{1,80}$ ]]
printf '%s' 'Mot de passe SQL de ce compte (saisie masquee) : ' >&3
IFS= read -r -s -u 3 jm_password
printf '\n' >&3
jm_code='
let configuration, password;
try {
  const { readRuntimeDatabaseConfiguration } = await import("./server/config/runtime-database-file.mjs");
  const { readPassword } = await import("./scripts/migration-input.mjs");
  const { run } = await import("./scripts/migrate-stdin.mjs");
  configuration = await readRuntimeDatabaseConfiguration("/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851");
  configuration.password = "";
  const user = process.argv[1];
  if (!/^[a-zA-Z0-9_]{1,80}$/.test(user ?? "") || user === configuration.user) {
    throw new Error("MIGRATION_STATUS_ACCOUNT_REFUSED");
  }
  const options = { command: "status", host: configuration.host, port: configuration.port,
    database: configuration.database, confirmation: configuration.database, user };
  password = await readPassword(process.stdin);
  const result = await run(options, password);
  process.stdout.write(JSON.stringify({ ...result, readOnly: true, migrated: false, noRestart: true,
    source: "cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a", version: "1.1.1" }) + "\n");
} catch {
  process.stderr.write("MIGRATION_STATUS_NOT_CONFIRMED: inspecter le compte de migration et la configuration operateur.\n");
  process.exitCode = 1;
} finally {
  if (configuration) configuration.password = "";
  password = "";
}
'
# Le secret passe seulement par stdin ; FD 3 est ferme dans le processus Node.
printf '%s' "$jm_password" | "$jm_node" --input-type=module -e "$jm_code" "$jm_migrator" 3<&-
unset jm_password
