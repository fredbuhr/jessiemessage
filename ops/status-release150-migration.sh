#!/bin/bash
# Diagnostic borne et lecture seule du statut SQL ; aucun upgrade ni Run.
set +x
set +a
set -euo pipefail
umask 077
unset jm_password
trap 'printf "MIGRATION_STATUS_NOT_CONFIRMED: shell_check_line_%s\n" "$LINENO" >&2' ERR
jm_tty_state=
jm_cleanup() {
  if [[ -n "$jm_tty_state" ]]; then stty "$jm_tty_state" <&3 || true; fi
  unset jm_password
  exec 3>&-
}
trap jm_cleanup EXIT
[[ $# == 0 ]]
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_SYSTEM_CA SSL_CERT_FILE SSL_CERT_DIR OPENSSL_CONF
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd
# Source et arbre 1.4.1 publies et qualifies, controles avant toute lecture SQL.
jm_sha=bf022233fcb76ee4db89e0c33c64b9498adb9d50
jm_tree=a2f29930fe8ead853db6b6e8b76b613891ae4a04
[[ "$jm_sha" =~ ^[a-f0-9]{40}$ && "$jm_tree" =~ ^[a-f0-9]{40}$ ]]
jm_checkout=/srv/customer/jessiemessage-operator/production-141-${jm_sha:0:8}
jm_node=/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node
jm_git() { /usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$jm_checkout" "$@"; }
[[ ! -L "$jm_checkout" && $(jm_git rev-parse HEAD) == "$jm_sha" ]]
[[ $(jm_git rev-parse 'HEAD^{tree}') == "$jm_tree" ]]
jm_status=$(jm_git status --porcelain --untracked-files=normal)
[[ -z "$jm_status" ]]
[[ -f "$jm_node" && ! -L "$jm_node" ]]
[[ $(stat -c '%a:%h:%u' "$jm_node") == "700:1:$(id -u)" ]]
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c ]]
[[ $("$jm_node" --version) == v24.22.0 ]]
cd -- "$jm_checkout"
# Le telechargement du script peut occuper stdin : les saisies utilisent le TTY.
exec 3<>/dev/tty
[[ -t 3 ]]
printf '%s' 'Identite SQL du compte de migration existant : ' >&3
IFS= read -r -u 3 jm_migrator
[[ "$jm_migrator" =~ ^[a-zA-Z0-9_]{1,80}$ ]]
# Desactiver echo avant le prompt, y compris lors d'un collage immediat.
jm_tty_state=$(stty -g <&3)
stty -echo <&3
printf '%s' 'Mot de passe SQL de ce compte (saisie masquee) : ' >&3
IFS= read -r -s -u 3 jm_password
stty "$jm_tty_state" <&3
jm_tty_state=
printf '\n' >&3
jm_code='
let configuration, password;
let phase = "module_imports";
const permitted = new Set([
  "RUNTIME_DATABASE_CONFIGURATION", "MIGRATION_STATUS_ACCOUNT_REFUSED",
  "MIGRATION_INPUT_PASSWORD", "MIGRATION_INPUT_USAGE", "MIGRATION_INPUT_TRANSPORT",
  "MIGRATION_INPUT_HISTORY", "DATABASE_CONFIG", "DATABASE_TARGET", "DATABASE_VERSION",
  "HISTORY_DIVERGED", "CHECKSUM_DRIFT", "LEDGER_SHAPE", "DATABASE_NOT_EMPTY",
  "MIGRATION_LOCKED", "LOCK_RELEASE", "SQL_FORMAT", "MIGRATION_PLAN",
  "SQL_AUTHENTICATION_REFUSED", "SQL_DATABASE_ACCESS_REFUSED", "SQL_DATABASE_NOT_FOUND",
  "SQL_HOST_UNRESOLVED", "SQL_CONNECTION_REFUSED", "SQL_CONNECTION_TIMEOUT",
  "SQL_TLS_CERTIFICATE_REFUSED", "SQL_CONNECTION_FAILED"
]);
const connectionCodes = new Map([
  ["ER_ACCESS_DENIED_ERROR", "SQL_AUTHENTICATION_REFUSED"],
  ["ER_ACCESS_DENIED_NO_PASSWORD_ERROR", "SQL_AUTHENTICATION_REFUSED"],
  ["ER_DBACCESS_DENIED_ERROR", "SQL_DATABASE_ACCESS_REFUSED"],
  ["ER_BAD_DB_ERROR", "SQL_DATABASE_NOT_FOUND"],
  ["ENOTFOUND", "SQL_HOST_UNRESOLVED"], ["EAI_AGAIN", "SQL_HOST_UNRESOLVED"],
  ["ECONNREFUSED", "SQL_CONNECTION_REFUSED"], ["ETIMEDOUT", "SQL_CONNECTION_TIMEOUT"],
  ["ER_CONNECTION_TIMEOUT", "SQL_CONNECTION_TIMEOUT"], ["ER_SOCKET_TIMEOUT", "SQL_CONNECTION_TIMEOUT"],
  ["ER_GET_CONNECTION_TIMEOUT", "SQL_CONNECTION_TIMEOUT"],
  ...["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]
    .map(code => [code, "SQL_TLS_CERTIFICATE_REFUSED"])
]);
try {
  const { readRuntimeDatabaseConfiguration } = await import("./server/config/runtime-database-file.mjs");
  const { readPassword } = await import("./scripts/migration-input.mjs");
  const { run } = await import("./scripts/migrate-stdin.mjs");
  const { databaseOptions } = await import("./server/db/connection.mjs");
  const { loadMigrations, migrationStatus } = await import("./server/db/migrations.mjs");
  phase = "private_configuration";
  configuration = await readRuntimeDatabaseConfiguration("/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851");
  configuration.password = "";
  phase = "migration_account";
  const user = process.argv[1];
  if (!/^[a-zA-Z0-9_]{1,80}$/.test(user ?? "") || user === configuration.user) {
    const error = new Error(); error.code = "MIGRATION_STATUS_ACCOUNT_REFUSED"; throw error;
  }
  const options = { command: "status", host: configuration.host, port: configuration.port,
    database: configuration.database, confirmation: configuration.database, user };
  phase = "password_input";
  password = await readPassword(process.stdin);
  const result = await run(options, password, {
    loadPlan: async () => { phase = "migration_plan"; return loadMigrations(); },
    connect: async env => {
      phase = "sql_driver_import";
      const { default: mariadb } = await import("mariadb");
      const transport = databaseOptions(env);
      phase = "sql_connection";
      let connection;
      try { connection = await mariadb.createConnection(transport); }
      catch (original) {
        const error = new Error();
        error.code = connectionCodes.get(original?.code) ?? "SQL_CONNECTION_FAILED";
        throw error;
      }
      phase = "sql_transport";
      return connection;
    },
    status: async (connection, context) => {
      phase = "migration_history";
      return migrationStatus(connection, context);
    }
  });
  process.stdout.write(JSON.stringify({ ...result, readOnly: true, migrated: false, noRestart: true,
    diagnosticRevision: 3, source: "bf022233fcb76ee4db89e0c33c64b9498adb9d50", version: "1.4.1" }) + "\n");
} catch (error) {
  const code = permitted.has(error?.code) ? error.code : "UNCLASSIFIED_FAILURE";
  process.stdout.write(JSON.stringify({ status: "migration_status_not_confirmed", phase, code,
    readOnly: true, migrated: false, noRestart: true, diagnosticRevision: 3 }) + "\n");
  process.exitCode = 1;
} finally {
  if (configuration) configuration.password = "";
  password = "";
}

'
# Le secret passe seulement par stdin ; FD 3 est ferme dans le processus Node.
if printf '%s' "$jm_password" | "$jm_node" --input-type=module -e "$jm_code" "$jm_migrator" 3<&-; then
  unset jm_password
else
  unset jm_password
  exit 1
fi
