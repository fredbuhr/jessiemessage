#!/bin/bash
# Sources, arbres et empreintes des lanceurs epingles au recu de preparation heberge.
# Un statut SQL conforme et un arret Manager atteste restent necessaires avant execution.
# --service-stopped exige toujours un arret Manager effectivement atteste avant execution.
# Les empreintes ne prouvent ni cet arret, ni le schema SQL actuellement applique.
# Mise a niveau 0033 apres arret Manager atteste, puis precontroles sans Run.
set +x
set +a
set -Eeuo pipefail
umask 077
unset jm_password
jm_phase=local_pins
jm_shell_failure() {
  printf '{"status":"release160_upgrade_not_confirmed","phase":"%s","schemaState":"not_checked","runtimeStarted":false}\n' "$jm_phase" >&2
}
trap jm_shell_failure ERR
jm_tty_state=
jm_cleanup() {
  if [[ -n "$jm_tty_state" ]]; then stty "$jm_tty_state" <&3 || true; fi
  unset jm_password
  exec 3>&-
}
trap jm_cleanup EXIT
[[ $# == 1 && "$1" == --service-stopped ]]
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_SYSTEM_CA SSL_CERT_FILE SSL_CERT_DIR OPENSSL_CONF
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd
# Verifier les sources, arbres et lanceurs epingles avant toute lecture SQL.
jm_sha=71e62184d2d25a4242e0349c403027e1eeb6537c
jm_tree=f769c99aa800486bd04065a308f1f4269841c215
jm_sha160=9590741e7065067aee9d1ad5d1206739cc27eb6b
jm_tree160=38e72545ab4fd6feb4a04e934b2eb8685f82b970
jm_start151_sha=804142f4fd2116b99bce9240edfad3eaa8eecda9b57a04baf52586f6ff345274
jm_check151_sha=165f2b472c94060085758b6a3d9e1817347b26ad5edae36e06bd610199a89ae4
jm_start160_sha=39015e53147112981203b5172f11f52563311be7e92a92f2b78bf4dca744f1b4
jm_check160_sha=13362ac14caa4795a4fbf3ee3fc50e94188938179c1cde119d6d968427a50971
for jm_pin in "$jm_sha" "$jm_tree" "$jm_sha160" "$jm_tree160"; do [[ "$jm_pin" =~ ^[a-f0-9]{40}$ ]]; done
for jm_pin in "$jm_start151_sha" "$jm_check151_sha" "$jm_start160_sha" "$jm_check160_sha"; do [[ "$jm_pin" =~ ^[a-f0-9]{64}$ ]]; done
[[ "$jm_sha" != "$jm_sha160" ]]
jm_checkout=/srv/customer/jessiemessage-operator/production-151-${jm_sha:0:8}
jm_node=/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node
jm_git() { /usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$jm_checkout" "$@"; }
jm_source() {
  local directory=$1 expected_commit=$2 expected_tree=$3 observed
  [[ ! -L "$directory" && $(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" rev-parse HEAD) == "$expected_commit" ]]
  [[ $(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" rev-parse 'HEAD^{tree}') == "$expected_tree" ]]
  observed=$(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" status --porcelain --untracked-files=normal)
  [[ -z "$observed" ]]
}
jm_file() {
  [[ -f "$1" && ! -L "$1" ]]
  [[ $(stat -c '%a:%h:%u' "$1") == "700:1:$(id -u)" ]]
  [[ $(sha256sum "$1" | cut -d' ' -f1) == "$2" ]]
}
jm_target160=/srv/customer/jessiemessage-operator/production-160-${jm_sha160:0:8}
jm_start151=/srv/customer/jessiemessage-private/start-primary-release151-${jm_sha:0:8}.sh
jm_check151=/srv/customer/jessiemessage-private/check-primary-release151-${jm_sha:0:8}.sh
jm_start160=/srv/customer/jessiemessage-private/start-primary-release160-${jm_sha160:0:8}.sh
jm_check160=/srv/customer/jessiemessage-private/check-primary-release160-${jm_sha160:0:8}.sh
jm_source "$jm_checkout" "$jm_sha" "$jm_tree"
jm_source "$jm_target160" "$jm_sha160" "$jm_tree160"
jm_file "$jm_start151" "$jm_start151_sha"
jm_file "$jm_check151" "$jm_check151_sha"
jm_file "$jm_start160" "$jm_start160_sha"
jm_file "$jm_check160" "$jm_check160_sha"
for jm_log in /srv/customer/jessiemessage-private/jm151-node2422.log \
  /srv/customer/jessiemessage-private/jm160-node2422.log \
  "/srv/customer/jessiemessage-private/jm151-preflight-${jm_sha:0:8}.log" \
  "/srv/customer/jessiemessage-private/jm160-preflight-${jm_sha160:0:8}.log"; do
  [[ -f "$jm_log" && ! -L "$jm_log" ]]
  [[ $(stat -c '%a:%h:%u' "$jm_log") == "600:1:$(id -u)" ]]
done
[[ -f "$jm_node" && ! -L "$jm_node" ]]
[[ $(stat -c '%a:%h:%u' "$jm_node") == "700:1:$(id -u)" ]]
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c ]]
[[ $("$jm_node" --version) == v24.22.0 ]]
for jm_script in "$jm_check151" "$jm_check160"; do bash -n "$jm_script"; done
command -v timeout >/dev/null
jm_phase=credential_input
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
let upgradeAttempted = false, schema33Confirmed = false;
let phase = "module_imports";
const permitted = new Set([
  "RUNTIME_DATABASE_CONFIGURATION", "MIGRATION_STATUS_ACCOUNT_REFUSED",
  "MIGRATION_INPUT_PASSWORD", "MIGRATION_INPUT_USAGE", "MIGRATION_INPUT_TRANSPORT",
  "MIGRATION_INPUT_HISTORY", "MIGRATION_INPUT_NOT_UPGRADABLE", "SCHEMA_STATUS_UNEXPECTED",
  "RECOVERY_REQUIRED", "MIGRATION_FAILED", "LEDGER_WRITE", "DATABASE_CONFIG", "DATABASE_TARGET", "DATABASE_VERSION",
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
  const dependencies = {
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
  };
  const before = await run(options, password, dependencies);
  if (before.status !== "checked" || before.migrations !== 33 || before.interrupted !== false
    || !((before.applied === 32 && before.pending === 1) || (before.applied === 33 && before.pending === 0))) {
    const error = new Error(); error.code = "SCHEMA_STATUS_UNEXPECTED"; throw error;
  }
  let result = { status: "already_applied", migrations: 33, applied: 0, unchanged: 33 };
  if (before.applied === 32) {
    phase = "schema_upgrade";
    upgradeAttempted = true;
    result = await run({ ...options, command: "upgrade" }, password, dependencies);
    if (result.status !== "upgraded" || result.migrations !== 33 || result.applied !== 1 || result.unchanged !== 32) {
      const error = new Error(); error.code = "SCHEMA_STATUS_UNEXPECTED"; throw error;
    }
  }
  const after = await run(options, password, dependencies);
  if (after.status !== "checked" || after.migrations !== 33 || after.applied !== 33
    || after.pending !== 0 || after.interrupted !== false) {
    const error = new Error(); error.code = "SCHEMA_STATUS_UNEXPECTED"; throw error;
  }
  schema33Confirmed = true;
  process.stdout.write(JSON.stringify({ status: "schema33_confirmed_before_prechecks", migration: result,
    schemaMigrations: 33, upgradeAttempted, schema33Confirmed, runtimeStarted: false,
    serviceStopOperatorAttested: true, source: "71e62184d2d25a4242e0349c403027e1eeb6537c" }) + "\n");
} catch (error) {
  const code = permitted.has(error?.code) ? error.code : "UNCLASSIFIED_FAILURE";
  process.stdout.write(JSON.stringify({ status: "release160_upgrade_not_confirmed", phase, code,
    upgradeAttempted, schema33Confirmed, migrationApplied: upgradeAttempted ? null : false,
    schemaState: upgradeAttempted ? "inspection_required" : "not_confirmed",
    runtimeStarted: false, restart150Allowed: false, noAutomaticRetry: true }) + "\n");
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

# Les scripts epingles consignent leurs resultats dans les journaux prives existants.
# Aucun lanceur start n'est execute et aucun journal n'est tronque.
trap - ERR
if ! timeout --kill-after=5s 60s bash "$jm_check151" >/dev/null 2>&1; then
  printf '%s\n' '{"status":"release160_precheck_failed","release":"1.5.1","schema33Confirmed":true,"runtimeStarted":false,"restart150Allowed":false}'
  exit 1
fi
if ! timeout --kill-after=5s 60s bash "$jm_check160" >/dev/null 2>&1; then
  printf '%s\n' '{"status":"release160_precheck_failed","release":"1.6.0","schema33Confirmed":true,"rollback151HostedQualified":true,"runtimeStarted":false,"restart150Allowed":false}'
  exit 1
fi
printf '%s\n' '{"status":"schema33_prechecks_passed","schemaMigrations":33,"schema33Confirmed":true,"rollback151HostedQualified":true,"release160PrecheckPassed":true,"runtimeStarted":false,"managerChanged":false,"checkpointChanged":false,"restart150Allowed":false,"targetVersion":"1.6.0","targetSource":"9590741e7065067aee9d1ad5d1206739cc27eb6b"}'
