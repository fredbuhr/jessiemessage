#!/bin/bash
# SQL33 -> SQL36 explicite ; le CLI nu conserve son plan normal SQL33.
# Usage : --status|--service-stopped SHA256_RECU_STAGING SHA256_BUNDLE7
# --service-stopped atteste un arret Manager reel ; processus et port sont aussi
# controles. Aucun arret, start, Manager, checkpoint ou effacement n'est execute.
set +x
set +a
set -Eeuo pipefail
umask 077
unset jm_password
jm_phase=local_pins
jm_shell_failure() {
  local state=not_checked
  if [[ "$jm_phase" == sql_status_or_upgrade ]]; then state=inspection_required; fi
  printf '{"status":"release180_upgrade_not_confirmed","phase":"%s","schemaState":"%s","runtimeStarted":false,"noAutomaticRetry":true}\n' "$jm_phase" "$state" >&2
}
trap jm_shell_failure ERR
jm_tty_state=
jm_cleanup() {
  if [[ -n "$jm_tty_state" ]]; then stty "$jm_tty_state" <&3 || true; fi
  unset jm_password
  exec 3>&-
}
trap jm_cleanup EXIT
[[ $# == 3 && ( "$1" == --status || "$1" == --service-stopped ) ]]
jm_mode=$1
jm_staging_sha=$2
jm_bundle_sha=$3
[[ "$jm_staging_sha" =~ ^[a-f0-9]{64}$ && "$jm_bundle_sha" =~ ^[a-f0-9]{64}$ ]]
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_SYSTEM_CA SSL_CERT_FILE SSL_CERT_DIR OPENSSL_CONF
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd
jm_sha171=c2d7b3b31c6d0955892829f808dc4135d7d8debf
jm_tree171=d4945207f25375abb5d89c3a23ae91b6e34ea115
jm_sha172=6b3319a77c307ed7d6b003fe33de36807c70c266
jm_tree172=924d500375a69ae50bc63414b15df71271e2bf8a
jm_sha180=fd6e53b14b520231b0b307a2761331dd8c740a5b
jm_tree180=324c3563fc6b1cfce669bcf58d90962c23c966b8
for jm_pin in "$jm_sha171" "$jm_tree171" "$jm_sha172" "$jm_tree172" "$jm_sha180" "$jm_tree180"; do [[ "$jm_pin" =~ ^[a-f0-9]{40}$ ]]; done
[[ "$jm_sha171" != "$jm_sha172" && "$jm_sha172" != "$jm_sha180" ]]
jm_checkout=/srv/customer/jessiemessage-operator/production-180-${jm_sha180:0:8}
jm_node=/srv/customer/jessiemessage-private/runtime-node-v24.22.1/bin/node
[[ -f "$jm_node" && ! -L "$jm_node" && $(stat -c '%a:%h:%u' "$jm_node") == "700:1:$(id -u)" ]]
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb ]]
[[ $("$jm_node" --version) == v24.22.1 ]]
command -v timeout >/dev/null
jm_source() {
  local directory=$1 expected_commit=$2 expected_tree=$3 version=$4 observed
  [[ ! -L "$directory" ]]
  [[ $(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" rev-parse HEAD) == "$expected_commit" ]]
  [[ $(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" rev-parse 'HEAD^{tree}') == "$expected_tree" ]]
  [[ $(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" rev-parse "refs/tags/v$version^{commit}") == "$expected_commit" ]]
  observed=$(/usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$directory" status --porcelain --untracked-files=normal)
  [[ -z "$observed" ]]
}
jm_source /srv/customer/jessiemessage-operator/production-171-c2d7b3b3 "$jm_sha171" "$jm_tree171" 1.7.1
jm_source /srv/customer/jessiemessage-operator/production-172-6b3319a7 "$jm_sha172" "$jm_tree172" 1.7.2
jm_source "$jm_checkout" "$jm_sha180" "$jm_tree180" 1.8.0
cd -- "$jm_checkout"
jm_common='
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withPrivateDirectory } from "./server/files/private-directory.mjs";
const ROOT = "/srv/customer/jessiemessage-private", BUNDLE = ROOT + "/runtime-video-180", SOURCE6 = ROOT + "/primary-origin-candidate-4a355851";
const OPERATIONS = ROOT + "/recurring-backup-052", VIDEO_ROOT = ROOT + "/video-180";
const RECEIPT = "jm180-staging.json", NODE_HASH = "e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb";
const PROFILE = "photos-notify-recovery-crm-broadcast-video";
const RELEASES = [
  { version: "1.7.2", source: "6b3319a77c307ed7d6b003fe33de36807c70c266", tree: "924d500375a69ae50bc63414b15df71271e2bf8a", short: "172" },
  { version: "1.8.0", source: "fd6e53b14b520231b0b307a2761331dd8c740a5b", tree: "324c3563fc6b1cfce669bcf58d90962c23c966b8", short: "180" }
].map(value => ({ ...value, checkout: "/srv/customer/jessiemessage-operator/production-" + value.short + "-" + value.source.slice(0,8) }));
const SOURCE171 = { version: "1.7.1", source: "c2d7b3b31c6d0955892829f808dc4135d7d8debf", tree: "d4945207f25375abb5d89c3a23ae91b6e34ea115", checkout: "/srv/customer/jessiemessage-operator/production-171-c2d7b3b3" };
const NAMES = ["runtime-database.json", "runtime-auth.json", "runtime-messaging.json", "runtime-media.json", "runtime-notifications.json", "runtime-crm.json", "runtime-video.json"].sort();
const [mode, stagingPin, bundlePin] = process.argv.slice(1);
const refuse = code => { throw Object.assign(new Error("Private release operation was not confirmed."), { code }); };
const same = (a,b) => ["dev","ino","mode","uid","nlink","size","mtimeNs","ctimeNs"].every(name => a[name] === b[name]);
const hash = content => createHash("sha256").update(content).digest("hex");
function regular(value, permissions, maximum) {
  if (!value.isFile() || value.uid !== BigInt(process.getuid()) || value.nlink !== 1n || (value.mode & 0o7777n) !== BigInt(permissions)
    || maximum !== undefined && (value.size < 1n || value.size > BigInt(maximum))) refuse("RELEASE_PINS");
}
async function pinnedRead(scope, name, permissions, maximum) {
  let handle, buffer;
  try {
    await scope.assertReady(); const path = scope.file(name), visible = await lstat(path, { bigint:true }); regular(visible, permissions, maximum);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint:true }); regular(before, permissions, maximum); if (!same(visible,before)) refuse("RELEASE_PINS");
    buffer = Buffer.alloc(Number(before.size)+1); let length = 0;
    while (length < buffer.length) { const part = await handle.read(buffer,length,buffer.length-length,length); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await handle.stat({ bigint:true }), final = await lstat(path, { bigint:true });
    if (!same(before,after) || !same(after,final) || length !== Number(before.size)) refuse("RELEASE_PINS");
    await scope.assertReady(); return Buffer.from(buffer.subarray(0,length));
  } finally { buffer?.fill(0); await handle?.close(); }
}
async function verifySource(value) {
  if ((await lstat(value.checkout)).isSymbolicLink() || await realpath(value.checkout) !== value.checkout) refuse("RELEASE_SOURCE");
  const git = async (...args) => (await promisify(execFile)("/usr/bin/git", ["--no-optional-locks","-c","core.fsmonitor=false","-c","core.hooksPath=/dev/null","-C",value.checkout,...args], { timeout:15000, maxBuffer:1048576 })).stdout.trim();
  if (await git("rev-parse","HEAD") !== value.source || await git("rev-parse","HEAD^{tree}") !== value.tree
    || await git("rev-parse","refs/tags/v" + value.version + "^{commit}") !== value.source || await git("status","--porcelain","--untracked-files=normal") !== "") refuse("RELEASE_SOURCE");
}
async function verifyPins() {
  if (!["--status","--service-stopped"].includes(mode) || !/^[a-f0-9]{64}$/.test(stagingPin ?? "") || !/^[a-f0-9]{64}$/.test(bundlePin ?? "")) refuse("RELEASE_PINS");
  for (const value of [SOURCE171,...RELEASES]) await verifySource(value);
  await withPrivateDirectory(ROOT, async scope => {
    const bytes = await pinnedRead(scope,RECEIPT,0o600,65536); let receipt;
    try { if (hash(bytes) !== stagingPin) refuse("RELEASE_PINS"); receipt = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
    finally { bytes.fill(0); }
    if (receipt.format !== "jessiemessage-release180-staging" || receipt.version !== 1 || receipt.status !== "release180_sources_staged_not_qualified"
      || receipt.nodeVersion !== "v24.22.1" || receipt.nodeBinarySha256 !== NODE_HASH || receipt.schemaMigrationsExpected !== 36 || receipt.baselineMigrationFiles !== 33
      || receipt.videoConfigurationDirectory !== BUNDLE || receipt.operationsDirectory !== OPERATIONS || receipt.rollbackRelease !== "1.7.2"
      || receipt.normalMigrationsPreserved !== true || receipt.candidateVideoMigrationsIdentical !== true || receipt.priorActivePreserved !== true
      || receipt.rollbackPrepared !== true || receipt.noRestart !== true || !Array.isArray(receipt.releases) || receipt.releases.length !== 2
      || ["started","migrated","runtimeStarted","managerChanged","checkpointChanged","hostedQualified","sqlStatusChecked","videoConfigurationPrepared","rollbackHostedQualified"].some(name => receipt[name] !== false)) refuse("RELEASE_PINS");
    for (const [index, expected] of RELEASES.entries()) {
      const release = receipt.releases[index], suffix = expected.short + "-" + expected.source.slice(0,8);
      const start = "start-primary-release" + suffix + ".sh", check = "check-primary-release" + suffix + ".sh";
      if (release.version !== expected.version || release.source !== expected.source || release.tree !== expected.tree || release.checkout !== expected.checkout
        || release.launcher !== ROOT + "/" + start || release.checkLauncher !== ROOT + "/" + check || release.profile !== PROFILE || release.videoConfigurationDirectory !== BUNDLE
        || release.launcherMode !== "0700" || release.checkLauncherMode !== "0700"
        || ["started","migrated","precheckPassed","hostedQualified","videoConfigurationPrepared"].some(name => release[name] !== false)) refuse("RELEASE_PINS");
      for (const [name,pin] of [[start,release.launcherSha256],[check,release.checkLauncherSha256]]) {
        const content = await pinnedRead(scope,name,0o700,65536);
        try { if (!/^[a-f0-9]{64}$/.test(pin ?? "") || hash(content) !== pin) refuse("RELEASE_PINS"); }
        finally { content.fill(0); }
      }
      if (release.log !== ROOT + "/jm" + expected.short + "-node24221.log" || release.precheckLog !== ROOT + "/jm" + expected.short + "-preflight-node24221-" + expected.source.slice(0,8) + ".log"
        || release.logMode !== "0600" || release.precheckLogMode !== "0600") refuse("RELEASE_PINS");
      for (const name of [release.log,release.precheckLog]) {
        regular(await lstat(scope.file(name.slice(ROOT.length+1)),{bigint:true}),0o600);
      }
    }
  });
  await withPrivateDirectory(BUNDLE, async scope => {
    if ((await readdir(scope.path)).sort().join(",") !== NAMES.join(",")) refuse("RELEASE_BUNDLE");
    const digest = createHash("sha256");
    for (const name of NAMES) {
      const content = await pinnedRead(scope,name,0o600,16384);
      try {
        digest.update(name); digest.update(Buffer.from([0])); digest.update(String(content.length)); digest.update(Buffer.from([0])); digest.update(content);
        if (name !== "runtime-video.json") await withPrivateDirectory(SOURCE6, async source => {
          const original = await pinnedRead(source,name,0o600,16384); try { if (!original.equals(content)) refuse("RELEASE_BUNDLE"); } finally { original.fill(0); }
        });
      } finally { content.fill(0); }
    }
    if (digest.digest("hex") !== bundlePin) refuse("RELEASE_BUNDLE");
  });
}
// BEGIN STOP CHECK: observation only; never signal or start any process.
function refuseLiveService(facts) {
  for (const fact of facts) if (fact.pid !== process.pid && fact.uid === process.getuid()
    && (fact.exe.startsWith(ROOT + "/runtime-node-") || /(?:^|\/)node(?:js)?$/.test(fact.exe)
      && (fact.cwd.startsWith("/srv/customer/jessiemessage-operator/") || fact.command.includes("/srv/customer/jessiemessage-private/") || fact.command.includes("scripts/private-messaging-child.mjs")))) refuse("SERVICE_NOT_STOPPED");
}
async function ownedProcessFacts() {
  const facts = [], entries = await readdir("/proc");
  if (entries.length > 131072) refuse("SERVICE_STOP_UNVERIFIED");
  for (const name of entries.filter(value => /^[1-9][0-9]*$/.test(value))) {
    if (Number(name) === process.pid) continue;
    try {
      const status = await readFile("/proc/" + name + "/status","utf8"), match = /^Uid:\s+([0-9]+)/m.exec(status);
      if (!match) refuse("SERVICE_STOP_UNVERIFIED"); if (Number(match[1]) !== process.getuid()) continue;
      const [exe,cwd,command] = await Promise.all([readlink("/proc/" + name + "/exe"),readlink("/proc/" + name + "/cwd"),readFile("/proc/" + name + "/cmdline","utf8")]);
      facts.push({pid:Number(name),uid:Number(match[1]),exe,cwd,command});
    } catch (error) { if (!["ENOENT","ESRCH"].includes(error?.code)) refuse("SERVICE_STOP_UNVERIFIED"); }
  }
  return facts;
}
async function portClosed(host, port = 3000) {
  return new Promise((resolve,reject) => {
    const socket = createConnection({host,port}); let settled = false;
    const finish = error => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(); };
    socket.once("connect",() => finish(Object.assign(new Error(),{code:"SERVICE_NOT_STOPPED"})));
    socket.once("error",error => finish(error.code === "ECONNREFUSED" ? null : Object.assign(new Error(),{code:"SERVICE_STOP_UNVERIFIED"})));
    socket.setTimeout(1000,() => finish(Object.assign(new Error(),{code:"SERVICE_STOP_UNVERIFIED"})));
  });
}
async function assertServiceStopped() {
  refuseLiveService(await ownedProcessFacts()); await portClosed("127.0.0.1"); await portClosed("::1"); refuseLiveService(await ownedProcessFacts());
}
// END STOP CHECK
try { await verifyPins(); if (mode === "--service-stopped") await assertServiceStopped(); }
catch (error) { process.stderr.write(JSON.stringify({status:"release180_pins_not_confirmed",code:["SERVICE_NOT_STOPPED","SERVICE_STOP_UNVERIFIED"].includes(error?.code)?error.code:"RELEASE_PINS",runtimeStarted:false,noAutomaticRetry:true}) + "\n"); process.exit(1); }
'
# Verifier recu, fichiers, bundle et arret avant toute saisie ou lecture SQL.
"$jm_node" --input-type=module -e "$jm_common" -- "$jm_mode" "$jm_staging_sha" "$jm_bundle_sha"
jm_phase=credential_input
exec 3<>/dev/tty
[[ -t 3 ]]
printf '%s' 'Identite SQL du compte de migration existant : ' >&3
IFS= read -r -u 3 jm_migrator
[[ "$jm_migrator" =~ ^[a-zA-Z0-9_]{1,80}$ ]]
jm_tty_state=$(stty -g <&3)
stty -echo <&3
printf '%s' 'Mot de passe SQL de ce compte (saisie masquee) : ' >&3
IFS= read -r -s -u 3 jm_password
stty "$jm_tty_state" <&3
jm_tty_state=
printf '\n' >&3
jm_code='
let configuration, environment, videoConfiguration, pool, password, crmKey;
let upgradeAttempted = false, schema36Confirmed = false, videoInitializationAttempted = false, phase = "module_imports";
const permitted = new Set(["RELEASE_PINS","RELEASE_SOURCE","RELEASE_BUNDLE","SERVICE_NOT_STOPPED","SERVICE_STOP_UNVERIFIED","HISTORICAL_CLOSURE_PENDING","ERASURE_PENDING","ERASURE_CHANGED","OPERATIONS_BUSY","OPERATIONS_RECONCILIATION_REQUIRED","MIGRATION_STATUS_ACCOUNT_REFUSED","MIGRATION_INPUT_PASSWORD","MIGRATION_INPUT_TRANSPORT","MIGRATION_INPUT_HISTORY","MIGRATION_INPUT_NOT_UPGRADABLE","SCHEMA_STATUS_UNEXPECTED","MIGRATION_PLAN","MIGRATION_FAILED","RECOVERY_REQUIRED","HISTORY_DIVERGED","CHECKSUM_DRIFT","LEDGER_SHAPE","LEDGER_WRITE","MIGRATION_LOCKED","LOCK_RELEASE","SQL_FORMAT","DATABASE_VERSION","VIDEO_INITIALIZATION","RUNTIME_VIDEO_STORAGE"]);
const connectionCodes = new Map([
  ["ER_ACCESS_DENIED_ERROR","SQL_AUTHENTICATION_REFUSED"],["ER_ACCESS_DENIED_NO_PASSWORD_ERROR","SQL_AUTHENTICATION_REFUSED"],
  ["ER_DBACCESS_DENIED_ERROR","SQL_DATABASE_ACCESS_REFUSED"],["ER_BAD_DB_ERROR","SQL_DATABASE_NOT_FOUND"],
  ["ENOTFOUND","SQL_HOST_UNRESOLVED"],["EAI_AGAIN","SQL_HOST_UNRESOLVED"],["ECONNREFUSED","SQL_CONNECTION_REFUSED"],
  ...["ETIMEDOUT","ER_CONNECTION_TIMEOUT","ER_SOCKET_TIMEOUT","ER_GET_CONNECTION_TIMEOUT"].map(code=>[code,"SQL_CONNECTION_TIMEOUT"]),
  ...["CERT_HAS_EXPIRED","ERR_TLS_CERT_ALTNAME_INVALID","DEPTH_ZERO_SELF_SIGNED_CERT","SELF_SIGNED_CERT_IN_CHAIN","UNABLE_TO_VERIFY_LEAF_SIGNATURE","UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].map(code=>[code,"SQL_TLS_CERTIFICATE_REFUSED"])
]);
for (const code of [...connectionCodes.values(),"SQL_CONNECTION_FAILED"]) permitted.add(code);
try {
  const { readRuntimeDatabaseConfiguration } = await import("./server/config/runtime-database-file.mjs");
  const { loadRuntimeVideoEnvironment, VIDEO_RUNTIME_OPTIONS } = await import("./server/config/runtime-video.mjs");
  const { runtimeVideoConfiguration, assertDistinctVideoRoots } = await import("./server/config/runtime-video-storage.mjs");
  const { privateAuthenticationProcessOptions } = await import("./server/config/private-auth-environment.mjs");
  const { clearRuntimeMessagingSecrets } = await import("./server/config/runtime-messaging.mjs");
  const { readPassword } = await import("./scripts/migration-input.mjs");
  const { run } = await import("./scripts/migrate-stdin.mjs");
  const { databaseOptions } = await import("./server/db/connection.mjs");
  const { loadMigrations, migrationStatus, applyMigrations } = await import("./server/db/migrations.mjs");
  const { loadVideoMigrations } = await import("./server/video/migrations.mjs");
  const { createMediaStorage } = await import("./server/media/storage.mjs");
  const { createVideoStorage } = await import("./server/video/storage.mjs");
  const { captureOperationalState } = await import("./server/backup/operational-checkpoint.mjs");
  const { snapshotErasureRegistry, authenticateRegistrySnapshot } = await import("./server/backup/registry-snapshot.mjs");
  phase = "private_configuration";
  configuration = await readRuntimeDatabaseConfiguration(SOURCE6); configuration.password = "";
  environment = await loadRuntimeVideoEnvironment(BUNDLE,{...privateAuthenticationProcessOptions(process.env,[]),...VIDEO_RUNTIME_OPTIONS});
  videoConfiguration = runtimeVideoConfiguration(environment);
  if (videoConfiguration.root !== VIDEO_ROOT || videoConfiguration.capacity.ownerBytes !== 1073741824 || videoConfiguration.capacity.totalBytes !== 10737418240 || videoConfiguration.minimumFreeBytes !== 536870912) refuse("RELEASE_BUNDLE");
  phase = "migration_account"; const user = process.argv[4];
  if (!/^[a-zA-Z0-9_]{1,80}$/.test(user ?? "") || user === configuration.user) refuse("MIGRATION_STATUS_ACCOUNT_REFUSED");
  phase = "password_input"; password = await readPassword(process.stdin);
  const options = {command:"status",host:configuration.host,port:configuration.port,database:configuration.database,confirmation:configuration.database,user};
  phase = "migration_plan"; const ordinary = await loadMigrations(), plan = await loadVideoMigrations();
  if (ordinary.length !== 33 || plan.length !== 36 || plan.slice(0,33).some((item,index) => JSON.stringify(item) !== JSON.stringify(ordinary[index]))
    || plan.slice(33).map(value => value.name).join(",") !== "0034_video_storage_state.sql,0035_video_assets.sql,0036_message_video.sql") refuse("MIGRATION_PLAN");
  await assertDistinctVideoRoots(environment.JESSIEMESSAGE_MEDIA_ROOT,videoConfiguration.root);
  const photoKey = Buffer.from(environment.JESSIEMESSAGE_MEDIA_KEY,"base64url"); crmKey = Buffer.from(environment.JESSIEMESSAGE_CRM_KEY,"base64url");
  let photos, videos;
  try { photos = await createMediaStorage({root:environment.JESSIEMESSAGE_MEDIA_ROOT,key:photoKey,pathMode:"linux-dirfd"}); videos = await createVideoStorage({root:videoConfiguration.root,key:videoConfiguration.key,pathMode:"linux-dirfd"}); }
  finally { photoKey.fill(0); }
  const binding = {database:configuration.database,rootFingerprint:(await photos.fingerprint()).toString("hex"),videoRootFingerprint:(await videos.fingerprint()).toString("hex")};
  async function closureBarrier() {
    phase = "historical_closure_barrier";
    const state = await withPrivateDirectory(OPERATIONS,scope => captureOperationalState(scope,{key:crmKey,binding}));
    const {jobs} = authenticateRegistrySnapshot(snapshotErasureRegistry(state,{key:crmKey,binding}),{key:crmKey,binding});
    const identities = new Set();
    for (const {record} of jobs.values()) {
      if (identities.has(record.clientId)) refuse("ERASURE_CHANGED"); identities.add(record.clientId);
      if (record.phase !== "completed") refuse(record.version === 1 ? "HISTORICAL_CLOSURE_PENDING" : "ERASURE_PENDING");
    }
    return jobs.size;
  }
  async function emptyVideoRoot() {
    if ((await withPrivateDirectory(videoConfiguration.root,scope => readdir(scope.path))).length !== 0) refuse("VIDEO_INITIALIZATION");
    const space = await videos.availableSpace();
    if (typeof space?.availableBytes !== "bigint" || space.availableBytes < BigInt(videoConfiguration.minimumFreeBytes) + 65n) refuse("VIDEO_INITIALIZATION");
  }
  const dependencies = {
    loadPlan: async () => plan,
    connect: async env => {
      phase = "sql_connection";
      try { return await (await import("mariadb")).default.createConnection(databaseOptions(env)); }
      catch (error) { refuse(connectionCodes.get(error?.code) ?? "SQL_CONNECTION_FAILED"); }
    },
    status: async (connection,context) => { phase = "migration_history"; return migrationStatus(connection,context); },
    apply: async (connection,context) => { await verifyPins(); await assertServiceStopped(); await closureBarrier(); phase = "schema_ddl"; return applyMigrations(connection,context); }
  };
  const before = await run(options,password,dependencies);
  if (before.status !== "checked" || before.migrations !== 36 || before.engineVerified !== true || before.transportVerified !== true || before.interrupted !== false
    || !((before.applied === 33 && before.pending === 3) || (before.applied === 36 && before.pending === 0))) refuse("SCHEMA_STATUS_UNEXPECTED");
  const completedReceipts = await closureBarrier();
  if (mode === "--status") {
    process.stdout.write(JSON.stringify({...before,status:"release180_schema_status_checked",readOnly:true,migrated:false,runtimeStarted:false,completedReceipts,normalPlanMigrations:33,candidateMigrations:plan.slice(33).map(({version,name,checksum}) => ({version,name,checksum}))}) + "\n");
  } else {
    await verifyPins(); await assertServiceStopped(); await closureBarrier(); await emptyVideoRoot();
    let result = {status:"already_applied",migrations:36,applied:0,unchanged:36};
    if (before.applied === 33) {
      phase = "schema_upgrade"; upgradeAttempted = true;
      result = await run({...options,command:"upgrade"},password,dependencies);
      if (result.status !== "upgraded" || result.migrations !== 36 || result.applied !== 3 || result.unchanged !== 33) refuse("SCHEMA_STATUS_UNEXPECTED");
    }
    const after = await run(options,password,dependencies);
    if (after.status !== "checked" || after.migrations !== 36 || after.applied !== 36 || after.pending !== 0 || after.interrupted !== false || after.engineVerified !== true || after.transportVerified !== true) refuse("SCHEMA_STATUS_UNEXPECTED");
    schema36Confirmed = true;
    await verifyPins(); await assertServiceStopped(); await closureBarrier(); phase = "video_initialization";
    const { createRuntimePool } = await import("./server/db/runtime.mjs");
    const { createChatStore } = await import("./server/chat/store.mjs");
    const { createVideoStore } = await import("./server/video/store.mjs");
    await emptyVideoRoot();
    pool = await createRuntimePool(environment);
    const videoStore = createVideoStore({pool,chatStore:createChatStore(pool),capacity:{...videoConfiguration.capacity,rootFingerprint:await videos.fingerprint()}});
    await videoStore.assertSchema(); const initial = await videoStore.status();
    if (initial.heldBytes !== 0 || initial.pendingBytes !== 0) refuse("VIDEO_INITIALIZATION");
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query("SELECT (SELECT COUNT(*) FROM video_assets) AS assets, (SELECT COUNT(*) FROM message_video) AS links, (SELECT COUNT(*) FROM video_storage_state) AS states");
      if (rows.length !== 1 || Number(rows[0].assets) !== 0 || Number(rows[0].links) !== 0 || ![0,1].includes(Number(rows[0].states))) refuse("VIDEO_INITIALIZATION");
    } finally { await connection.release(); }
    videoInitializationAttempted = true; await assertServiceStopped();
    const initialized = await videoStore.initialize({now:Date.now(),offline:true});
    if (initialized.ready !== true || initialized.heldBytes !== 0 || initialized.pendingBytes !== 0 || initialized.ownerBytes !== videoConfiguration.capacity.ownerBytes || initialized.totalBytes !== videoConfiguration.capacity.totalBytes) refuse("VIDEO_INITIALIZATION");
    await pool.end(); pool = null; await verifyPins(); await assertServiceStopped();
    process.stdout.write(JSON.stringify({status:"schema36_confirmed_before_prechecks",migration:result,schemaMigrations:36,upgradeAttempted,schema36Confirmed,videoStorageInitialized:true,completedReceipts,runtimeStarted:false,serviceStopOperatorAttested:true,serviceStopProcessAndPortVerified:true,targetSource:RELEASES[1].source}) + "\n");
  }
  crmKey.fill(0); clearRuntimeMessagingSecrets(environment);
} catch (error) {
  process.stdout.write(JSON.stringify({status:"release180_upgrade_not_confirmed",phase,code:permitted.has(error?.code)?error.code:"UNCLASSIFIED_FAILURE",upgradeAttempted,schema36Confirmed,videoInitializationAttempted,migrationApplied:upgradeAttempted?null:false,schemaState:upgradeAttempted||schema36Confirmed?"inspection_required":"not_confirmed",runtimeStarted:false,restart171Allowed:false,noAutomaticRetry:true}) + "\n"); process.exitCode = 1;
} finally {
  if (configuration) configuration.password = ""; password = ""; crmKey?.fill(0); videoConfiguration?.key.fill(0);
  if (environment) for (const name of Object.keys(environment)) if (/PASSWORD|KEY/.test(name)) environment[name] = "";
  try { await pool?.end(); }
  catch { process.stderr.write("{\"status\":\"release180_pool_close_not_confirmed\",\"schemaState\":\"inspection_required\",\"runtimeStarted\":false,\"noAutomaticRetry\":true}\n"); process.exitCode = 1; }
}
'
jm_phase=sql_status_or_upgrade
if printf '%s' "$jm_password" | "$jm_node" --input-type=module -e "$jm_common"$'\n'"$jm_code" -- "$jm_mode" "$jm_staging_sha" "$jm_bundle_sha" "$jm_migrator" 3<&-; then
  unset jm_password
else
  unset jm_password
  exit 1
fi
[[ "$jm_mode" != --status ]] || exit 0
# CHECK uniquement : les lanceurs epingles ajoutent aux journaux prives.
trap - ERR
jm_check172=/srv/customer/jessiemessage-private/check-primary-release172-6b3319a7.sh
jm_check180=/srv/customer/jessiemessage-private/check-primary-release180-fd6e53b1.sh
if ! timeout --kill-after=5s 60s bash "$jm_check172" >/dev/null 2>&1; then
  printf '%s\n' '{"status":"release180_precheck_failed","release":"1.7.2","schema36Confirmed":true,"runtimeStarted":false,"restart171Allowed":false,"noAutomaticRetry":true}'
  exit 1
fi
if ! timeout --kill-after=5s 60s bash "$jm_check180" >/dev/null 2>&1; then
  printf '%s\n' '{"status":"release180_precheck_failed","release":"1.8.0","schema36Confirmed":true,"rollback172HostedQualified":true,"runtimeStarted":false,"restart171Allowed":false,"noAutomaticRetry":true}'
  exit 1
fi
printf '%s\n' '{"status":"schema36_prechecks_passed","schemaMigrations":36,"schema36Confirmed":true,"rollback172HostedQualified":true,"release180PrecheckPassed":true,"runtimeStarted":false,"managerChanged":false,"checkpointChanged":false,"restart171Allowed":false,"targetVersion":"1.8.0","targetSource":"fd6e53b14b520231b0b307a2761331dd8c740a5b"}'
