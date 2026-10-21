import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { sealPayload, campaignFingerprint } from "../server/broadcast/crypto.mjs";
import { sealNotes } from "../server/crm/crypto.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { backupIdentity, createBackupManifest, writeManifest, readManifest } from "../server/backup/manifest.mjs";
import { writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { writeOperationalCheckpoint } from "../server/backup/operational-checkpoint.mjs";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { makeTotpSecret, newToken, sealTotpSecret, tokenDigest } from "../server/auth/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { sealSubscription, endpointDigest } from "../server/notifications/crypto.mjs";
import { parseArguments, run, main, verifyApplicationCloneSnapshot } from "../scripts/verify-private-checkpoint.mjs";

const base = fileURLToPath(new URL("../../audit/", import.meta.url));
const key = number => Buffer.alloc(32, number).toString("base64url");
const id = number => Buffer.alloc(16, number);
const hash = value => createHash("sha256").update(value).digest("hex");
const snapshotVerified = () => ({ command: "verify", verified: true, prepared: false, restored: false, releasedCandidates: 0 });
const sql = Buffer.from("CREATE TABLE synthetic_checkpoint (id INT);\nINSERT INTO synthetic_checkpoint VALUES (1);\n");
const scopeFor = directory => ({ path: directory, file: name => join(directory, name),
  assertReady: () => lstat(directory, { bigint: true }), sync: async () => {} });
const neutral = code => error => {
  assert.equal(error.code, `PRIVATE_CHECKPOINT_VERIFY_${code}`); assert.equal(error.message, error.code);
  assert.doesNotMatch(JSON.stringify(error), /synthetic|example\.invalid|only_source|only_clone|runtime_user|inspection_user/);
  assert.equal(error.cause, undefined); return true;
};

async function fixture(t, { application = false, broadcast = false, crm = broadcast, recovery = crm, envelopeRecovery = recovery, schemaCount = 33 } = {}) {
  const origin = recovery ? "https://jessiemessage.com" : "https://recette.jessiemessage.com";
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "private-checkpoint-verify-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceDirectory = join(directory, "source"), sourceRoot = join(directory, "source-media"), checkpointDirectory = join(directory, "checkpoint"), mediaRoot = join(checkpointDirectory, "media");
  for (const path of [sourceDirectory, sourceRoot, checkpointDirectory, mediaRoot]) await mkdir(path, { mode: 0o700 });
  const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.alloc(32, 7));
  const bundle = () => ({
    database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306", database: "only_source", user: "runtime_user", password: "synthetic-runtime-password", privilegeProfile: "infomaniak-shared-pattern" },
    authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
    messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3), smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-password" },
    media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot: sourceRoot, ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "0" },
    notifications: { version: 1, origin, notificationKey: key(5), vapidPublicKey: curve.getPublicKey().toString("base64url"), vapidPrivateKey: curve.getPrivateKey().toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" },
    ...(crm ? { crm: { version: 1, origin, crmKey: key(6) } } : {}),
  });
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey", ...(crm ? ["crmKey"] : [])].map((name, index) => [name, Buffer.from(key(index + 1), "base64url")]));
  const sourceStorage = await createMediaStorage({ root: sourceRoot, key: keys.mediaKey, pathMode: "strict" });
  const full = Buffer.from("synthetic-private-photo"), thumbnail = Buffer.from("synthetic-private-thumbnail"), mediaId = id(6), storageKey = Buffer.alloc(32, 8);
  await sourceStorage.put({ assetId: mediaId, storageKey, full, thumbnail });
  const mediaFiles = [];
  for (const name of (await readdir(sourceRoot)).sort()) {
    await copyFile(join(sourceRoot, name), join(mediaRoot, name)); await chmod(join(mediaRoot, name), 0o600);
    const content = await readFile(join(mediaRoot, name)); mediaFiles.push({ name, bytes: content.length, sha256: hash(content) });
  }
  const identity = await backupIdentity({ databaseName: "only_source", rootPath: sourceRoot, storage: sourceStorage, mediaKey: keys.mediaKey });
  const profile = `messaging-photos-notify${envelopeRecovery ? "-recovery" : ""}${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}${application ? "-application" : ""}`;
  const manifest = createBackupManifest({ snapshot: { ...(application ? { version: 2, coverage: { ...APPLICATION_COVERAGE, tables: schemaCount } } : {}),
    counts: { tables: schemaCount, rows: 6 }, capacity: { rootFingerprint: identity.rootFingerprint } }, identity, keys, now: 1792200000000, profile });
  await writeManifest(join(checkpointDirectory, "manifest.json"), manifest, { pathMode: "strict" });
  const archive = gzipSync(sql); await writeFile(join(checkpointDirectory, "database.sql.gz"), archive, { mode: 0o600 });
  const receipt = { format: "jessiemessage-private-checkpoint", version: broadcast ? application ? 8 : 7 : crm ? application ? 6 : 5 : envelopeRecovery ? application ? 4 : 3 : application ? 2 : 1, profile,
    ...(application ? { coverage: { ...APPLICATION_COVERAGE, tables: schemaCount } } : {}), createdAt: 1792200000000,
    schema: { tables: schemaCount, migrations: schemaCount }, sql: { file: "database.sql.gz", bytes: archive.length, sha256: hash(archive), uncompressedBytes: sql.length, uncompressedSha256: hash(sql) },
    manifest: { file: "manifest.json", sha256: hash(await readFile(join(checkpointDirectory, "manifest.json"))) }, media: { files: mediaFiles, bytes: mediaFiles.reduce((total, file) => total + file.bytes, 0) } };
  await writeCheckpointReceipt(scopeFor(checkpointDirectory), receipt);
  const args = [application ? "verify-application" : "verify", "--private-directory", sourceDirectory, "--private-path-mode", "linux-dirfd", "--checkpoint-directory", checkpointDirectory,
    "--database", "only_clone", "--confirm-database", "only_clone", "--user", "inspection_user", ...(recovery ? ["--profile", `photos-notify-recovery${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}`] : [])];
  const selected = parseArguments(args), migrations = await loadMigrations(), tables = [...createdMigrationTables(migrations), "schema_migrations"];
  const admin = id(1), client = id(2), conversationId = id(3), messageId = id(4), mailId = id(5), token = newToken(), email = "synthetic@example.invalid", body = "Synthetic private text";
  const binding = { conversationId, messageId, senderId: admin }, subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-private-checkpoint", expirationTime: null,
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 9).toString("base64url") } };
  const notificationBinding = { subscriptionId: id(7), userId: client, generation: 1 };
  const rows = {
    ...(crm ? { crm_profiles: [{ id: Buffer.concat([admin, conversationId]), admin_id: admin, conversation_id: conversationId, notes_revision: 2, version: 3,
      encrypted: sealNotes("Synthetic restored CRM note", keys.crmKey, { adminId: admin, conversationId, version: "2" }) }],
      crm_labels: [{ id: id(12) }], crm_memberships: [{ id: id(13) }] } : {}),
    admin_mfa: [{ id: admin, encrypted: sealTotpSecret(makeTotpSecret(), keys.totpKey, admin) }],
    mail_outbox: [{ id: mailId, encrypted: sealVerificationPayload({ email, token }, keys.mailKey, mailId), recipient_user_id: client, challenge_user_id: client, token_hash: tokenDigest(token), recipient_email: email }],
    messages: [{ id: messageId, conversation_id: conversationId, sender_id: admin, sender_role: "admin", admin_id: admin, client_id: client,
      encrypted: encryptMessageBody(body, keys.messageKey, binding), body_fingerprint: messageFingerprint(body, keys.messageKey, binding), deleted_at: null, media_id: null, media_owner_id: null }],
    media_assets: [{ id: mediaId, owner_id: admin, storage_key: storageKey, content_digest: Buffer.from(hash(full), "hex"), full_bytes: full.length, thumbnail_bytes: thumbnail.length,
      journal_state: "registered", journal_asset_id: mediaId, journal_owner_id: admin }],
    push_subscriptions: [{ id: notificationBinding.subscriptionId, user_id: client, role: "client", user_role: "client", session_id: id(8), session_user_id: client,
      credential_version: 1, generation: 1, endpoint_digest: endpointDigest(subscription.endpoint, keys.notificationKey), encrypted: sealSubscription(subscription, keys.notificationKey, notificationBinding) }],
    push_outbox: [{ id: id(9), subscription_generation: 1, generation: 1, user_id: client, role: "client", sender_id: admin, sender_role: "admin", admin_id: admin, client_id: client }],
    ...(recovery ? {
      client_password_resets: [{ id: id(10) }],
      password_reset_outbox: [{ id: id(11), encrypted: sealResetPayload({ email, token }, keys.mailKey, id(11)),
        recipient_user_id: client, challenge_user_id: client, token_hash: tokenDigest(token), email_hash: Buffer.from(hash(email), "hex"), recipient_email: email }],
    } : {}),
  };
  if (broadcast) {
    const binding = { adminId: admin, campaignId: id(20) }, payload = { title: "Synthetic campaign", body: "Synthetic restored broadcast",
      mediaId: null, allowRepeatMedia: false, conversationIds: [conversationId.toString("hex")] };
    rows.broadcast_campaigns = [{ id: binding.campaignId, admin_id: admin, encrypted: sealPayload(payload, keys.messageKey, binding),
      request_fingerprint: campaignFingerprint(payload, keys.messageKey, binding), media_id: null, allow_repeat_media: 0 }];
    rows.broadcast_recipients = [{ conversation_id: conversationId }];
    rows.broadcast_preferences = [{ id: client }];
  }
  const calls = [], connected = [], events = [], environments = [], dumps = [];
  const connection = { async query(statement, parameters = []) {
    calls.push({ statement, parameters });
    if (/^(?:SET TRANSACTION|START TRANSACTION)/.test(statement)) return [];
    if (statement.startsWith("SELECT DATABASE()")) return [{ name: selected.database, version: "10.11.14-MariaDB" }];
    if (statement === "SHOW GRANTS") return [{ grant: "GRANT ALL PRIVILEGES ON `only\\_clone`.* TO `inspection_user`@`%`" }];
    if (statement.startsWith("SHOW SESSION")) return [{ Variable_name: "Ssl_cipher", Value: "TLS_AES_256_GCM_SHA384" }];
    if (/information_schema\.(?:TRIGGERS|EVENTS|ROUTINES)/.test(statement)) return [{ value: 0 }];
    if (statement.includes("information_schema.TABLES")) return tables.map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB" }));
    if (statement.includes("FROM schema_migrations")) return migrations.map(migration => ({ ...migration, state: "applied", attempts: 1 }));
    if (statement.includes("information_schema.KEY_COLUMN_USAGE")) return [{ parent_schema: selected.database }];
    const table = /\bFROM ([a-z_]+)/.exec(statement)?.[1];
    if (statement.startsWith("SELECT EXISTS")) return [{ present: rows[table]?.length ? 1 : 0 }];
    if (table) return (rows[table] ?? []).filter(row => parameters.length === 1 || Buffer.compare(row.id, parameters[0]) > 0).slice(0, table === "broadcast_recipients" ? 101 : parameters.at(-1));
    throw new Error("synthetic unexpected query");
  }, async rollback() { events.push("rollback"); }, async end() { events.push("end"); } };
  const dependencies = { inheritedEnv: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, execArgv: [],
    scopeOperation: async (directory, callback) => callback(scopeFor(directory)),
    loadEnvironment: async (_directory, parameters = {}) => {
      assert.deepEqual(parameters, Object.keys(parameters).length ? { port: "3000", ...(recovery ? { originProfile: "primary", recovery: true } : {}) } : {});
      const env = await (broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : loadRuntimeNotificationsEnvironment)(sourceDirectory, recovery ? { originProfile: "primary", recovery: true } : {}, { readBundle: async () => bundle() });
      environments.push(env); return env;
    },
    makeStorage: options => createMediaStorage({ ...options, pathMode: "strict" }),
    readBackupManifest: path => readManifest(path, { pathMode: "strict" }),
    inspectClient: async () => events.push("client"), readSecret: async () => { events.push("password"); return "synthetic inspection password"; },
    dump: async (_scope, selectedDump, configuration, password, options) => { events.push("dump"); dumps.push(options); assert.deepEqual(selectedDump, { database: "only_clone", user: "inspection_user" });
      assert.equal(configuration.host, "sql.example.invalid"); assert.equal(password, "synthetic inspection password"); return { sqlBytes: sql.length, sqlSha256: hash(sql) }; },
    connect: async env => { events.push("connect"); connected.push(env); return connection; },
    verifyApplicationSnapshot: async (env, selection, password) => {
      events.push("snapshot"); assert.equal(env.JESSIEMESSAGE_DB_NAME, "only_source");
      assert.equal(selection.database, "only_clone"); assert.equal(password, "synthetic inspection password");
      return snapshotVerified();
    },
  };
  return { directory, sourceDirectory, sourceRoot, checkpointDirectory, mediaRoot, args, selected, receipt, archive, manifest, keys, rows, calls, connected, events, environments, connection, dependencies, dumps, tables };
}

test("private checkpoint check verifies real gzip, five-key manifest and copied photo files without password or SQL", async t => {
  const f = await fixture(t), report = await run({ ...f.selected, command: "check" }, f.dependencies);
  assert.equal(report.status, "ready_for_input"); assert.equal(report.databaseConnected, false);
  assert.equal(report.tables, 33); assert.equal(report.migrations, 33); assert.equal(report.checkpointFilesMatched, true);
  assert.equal(report.independentMediaDirectory, true); assert.equal(report.capacityRebound, false);
  assert.deepEqual(f.events, ["client"]); assert.deepEqual(f.connected, []);
  assert.equal(f.environments[0].JESSIEMESSAGE_RUNTIME_DB_PASSWORD, ""); assert.equal(f.environments[0].JESSIEMESSAGE_VAPID_PRIVATE_KEY, "");
});

test("historical schema30/31/32 application checks preserve their identity and refuse current clone verification before password or SQL", async t => {
  for (const schemaCount of [30, 31, 32]) {
    const f = await fixture(t, { application: true, schemaCount });
    const report = await run({ ...f.selected, command: "check-application" }, f.dependencies);
    assert.equal(report.tables, schemaCount); assert.equal(report.migrations, schemaCount); assert.equal(report.coverage.tables, schemaCount);
    assert.equal(report.databaseConnected, false); assert.deepEqual(f.events, ["client"]);
    await assert.rejects(run(f.selected, f.dependencies), neutral("SCHEMA"));
    assert.deepEqual(f.events, ["client", "client"]); assert.deepEqual(f.connected, []);
  }
});

test("operational receipts authenticate their capsule before password input and preserve the separate restoration prerequisite", async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { application, broadcast: true });
    const scope = scopeFor(f.checkpointDirectory), selected = { ...f.receipt, version: application ? 10 : 9 };
    const value = { version: 1, binding: { database: "only_source", rootFingerprint: f.manifest.payload.identity.rootFingerprint }, files: [] };
    selected.operations = await writeOperationalCheckpoint(scope, value, selected, f.keys.crmKey);
    await unlink(join(f.checkpointDirectory, "receipt.json")); await writeCheckpointReceipt(scope, selected);
    const report = await run({ ...f.selected, command: application ? "check-application" : "check" }, f.dependencies);
    assert.equal(report.operationsCovered, true); assert.equal(report.operationalFiles, 0); assert.equal(report.operationalRestorationPending, true);
    assert.equal(report.externalRegistryContinuityVerified, false); assert.equal(report.version, selected.version);
    assert.deepEqual(f.events, ["client"]);
    const before = f.events.length;
    await writeFile(join(f.checkpointDirectory, "operations.enc.json"), "tampered", { mode: 0o600 });
    await assert.rejects(run(f.selected, f.dependencies)); assert.equal(f.events.length, before);
    assert.deepEqual(f.connected, []);
  }
});

test("a capsule cannot be concealed by lowering its receipt to an old SQL-only version", async t => {
  const f = await fixture(t, { application: true, broadcast: true });
  await writeFile(join(f.checkpointDirectory, "operations.enc.json"), "untrusted extra file", { mode: 0o600 });
  await assert.rejects(run({ ...f.selected, command: "check-application" }, f.dependencies));
  assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
});

test("CRM checkpoint verification authenticates the populated notes and recovery outbox while keeping SQL and files read-only", async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { application, crm: true }), before = structuredClone(f.rows);
    const report = await run(f.selected, { ...f.dependencies,
      verify: () => assert.fail("Legacy verifier cannot accept CRM data"), verifyRecovery: () => assert.fail("Five-key verifier cannot accept CRM data"),
    });
    assert.equal(report.status, "verified"); assert.equal(report.version, application ? 6 : 5);
    assert.equal(report.profile, `messaging-photos-notify-recovery-crm${application ? "-application" : ""}`);
    assert.equal(report.counts.crm, 1); assert.equal(report.counts.reset, 1); assert.equal(report.workersStarted, false);
    assert.equal(report.capacityRebound, false); assert.equal(report.httpStarted, false); assert.equal(report.smtpStarted, false);
    assert.deepEqual(structuredClone(f.rows), before);
    for (const env of f.environments) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
    assert.doesNotMatch(JSON.stringify(report), /Synthetic restored CRM note|synthetic inspection password/);
    const corrupted = await fixture(t, { application, crm: true });
    corrupted.rows.crm_profiles[0].notes_revision = 3;
    await assert.rejects(run(corrupted.selected, corrupted.dependencies), neutral("CRYPTO"));
    assert.equal(corrupted.environments[0].JESSIEMESSAGE_CRM_KEY, "");
  }
});

test("the CRM application snapshot check forwards six keys only to an isolated clone and preserves its source envelope", async t => {
  const f = await fixture(t, { application: true, crm: true });
  const env = await f.dependencies.loadEnvironment(f.sourceDirectory), before = structuredClone(env);
  await verifyApplicationCloneSnapshot(env, f.selected, "synthetic inspection password", { backup: async (args, clone) => {
    assert.equal(args.at(-1), "photos-notify-recovery-crm-application");
    assert.equal(clone.JESSIEMESSAGE_CRM_KEY, key(6)); assert.equal(clone.JESSIEMESSAGE_ENABLE_CRM, "1");
    assert.equal(clone.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "1"); assert.equal(clone.JESSIEMESSAGE_ENABLE_BROADCAST, "0");
    assert.equal(clone.JESSIEMESSAGE_DB_NAME, "only_clone"); assert.equal(clone.JESSIEMESSAGE_RUNTIME_DB_USER, "inspection_user");
    assert.equal(clone.JESSIEMESSAGE_MEDIA_ROOT, f.mediaRoot); return snapshotVerified();
  } });
  assert.deepEqual(env, before);
});

test("recovery verification authenticates a populated reset outbox with five existing keys and no enabled runtime", async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { application, recovery: true });
    const verifyRecovery = (await import("../server/backup/verify.mjs")).verifyPhotoNotificationRecoveryBackupData;
    const report = await run(f.selected, { ...f.dependencies,
      verify: () => assert.fail("legacy verifier must not receive a recovery backup"),
      verifyRecovery: options => {
        assert.deepEqual(Object.keys(options.keys).sort(), ["mailKey", "mediaKey", "messageKey", "notificationKey", "totpKey"]);
        assert.equal(f.environments[0].JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "0");
        return verifyRecovery(options);
      },
    });
    assert.equal(report.status, "verified"); assert.equal(report.profile, `messaging-photos-notify-recovery${application ? "-application" : ""}`);
    assert.equal(report.version, application ? 4 : 3); assert.equal(report.counts.reset, 1); assert.equal(report.counts.rows, 7);
    for (const field of ["httpStarted", "smtpStarted", "workersStarted", "capacityRebound"]) assert.equal(report[field], false);
    if (application) { assert.equal(report.applicationSnapshotMatched, true); assert.deepEqual(report.coverage, APPLICATION_COVERAGE); }
    assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, ""); assert.equal(f.environments[0].JESSIEMESSAGE_MAIL_KEY, "");
  }
});

test("recovery and legacy checkpoint selections cannot substitute their receipts or manifests", async t => {
  for (const application of [false, true]) for (const recovery of [false, true]) {
    const f = await fixture(t, { application, recovery, envelopeRecovery: !recovery });
    await assert.rejects(run(f.selected, f.dependencies), neutral("CHECKPOINT"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
  for (const application of [false, true]) {
    const f = await fixture(t, { application, recovery: true });
    await assert.rejects(run(f.selected, { ...f.dependencies, readBackupManifest: async () => ({ ...f.manifest,
      version: application ? 4 : 3, profile: `messaging-photos-notify${application ? "-application" : ""}` }) }), neutral("CHECKPOINT"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
});

test("recovery verification flags reject duplicate, unknown and application-suffixed profile values", async t => {
  const f = await fixture(t);
  assert.equal(Object.hasOwn(f.selected, "profile"), false);
  for (const profile of ["photos-notify", "photos-notify-recovery-application", "full", undefined])
    assert.throws(() => parseArguments([...f.args, "--profile", profile]), neutral("USAGE"));
  assert.throws(() => parseArguments([...f.args, "--profile", "photos-notify-recovery", "--profile", "photos-notify-recovery"]), neutral("USAGE"));
});

test("recovery snapshot comparison preserves an enabled or disabled source flag and selects only the recovery application verifier", async t => {
  for (const flag of ["0", "1"]) {
    const f = await fixture(t, { application: true, recovery: true }), source = await f.dependencies.loadEnvironment();
    source.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY = flag;
    const before = { ...source }; let observed;
    await verifyApplicationCloneSnapshot(source, f.selected, "synthetic inspection password", {
      backup: async (args, environment) => {
        observed = environment;
        assert.deepEqual(args, ["verify", "--offline", "--manifest", join(f.checkpointDirectory, "manifest.json"), "--profile", "photos-notify-recovery-application"]);
        assert.equal(environment.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, flag);
        assert.equal(environment.JESSIEMESSAGE_DB_NAME, "only_clone");
        assert.equal(environment.JESSIEMESSAGE_MEDIA_ROOT, f.mediaRoot);
        return snapshotVerified();
      },
    });
    assert.deepEqual(source, before); assert.equal(observed.JESSIEMESSAGE_MAIL_KEY, ""); assert.equal(observed.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  }
});

test("a read-only TLS clone verification authenticates all five domains and notifications, then rolls back and wipes secrets", async t => {
  const f = await fixture(t), before = await readFile(join(f.mediaRoot, f.receipt.media.files[0].name)), report = await run(f.selected, f.dependencies);
  assert.equal(report.status, "verified"); assert.equal(report.databaseConnected, true);
  assert.deepEqual(report.counts, { rows: 6, mfa: 1, mail: 1, reset: 0, messages: 1, crm: 0, tasks: 0, broadcast: 0, broadcastRecipients: 0, announcements: 0, media: 1, mediaFiles: 2, notifications: 1, notificationJobs: 1 });
  for (const field of ["httpStarted", "smtpStarted", "workersStarted", "capacityRebound"]) assert.equal(report[field], false);
  assert.deepEqual(f.events, ["client", "password", "dump", "connect", "rollback", "end"]);
  assert.equal(f.connected.length, 1); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  assert.equal(f.connected[0].JESSIEMESSAGE_DB_TLS_CA_PATH, "/etc/ssl/certs/ca-certificates.crt");
  assert.deepEqual(await readFile(join(f.mediaRoot, f.receipt.media.files[0].name)), before);
  assert.ok(f.calls.every(({ statement }) => /^(?:SELECT|SHOW GRANTS|SHOW SESSION|SET TRANSACTION|START TRANSACTION)/.test(statement)));
  assert.doesNotMatch(JSON.stringify(report), /synthetic|example\.invalid|only_clone|only_source|user|private-photo/);
});

test("unconfirmed targets, runtime identity, source database aliases and ambient settings fail before SQL or password", async t => {
  const f = await fixture(t);
  for (const selection of [{ ...f.selected, database: "only_source", confirmation: "only_source" }, { ...f.selected, database: "ONLY_SOURCE", confirmation: "ONLY_SOURCE" }, { ...f.selected, user: "runtime_user" }])
    await assert.rejects(run(selection, f.dependencies), neutral("CONFIGURATION"));
  await assert.rejects(run({ ...f.selected, confirmation: "other" }, f.dependencies), neutral("USAGE"));
  await assert.rejects(run(f.selected, { ...f.dependencies, inheritedEnv: { ...f.dependencies.inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" } }), neutral("ENVIRONMENT"));
  assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
});

test("closed command arguments reject extras, repository paths and accessor records without executing getters", async t => {
  const f = await fixture(t);
  for (const args of [f.args.slice(0, -2), [...f.args, "--offline"], f.args.map(value => value === "linux-dirfd" ? "strict" : value), f.args.map(value => value === f.sourceDirectory ? fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "") : value)])
    assert.throws(() => parseArguments(args), neutral("USAGE"));
  let invoked = false; const selected = { ...f.selected };
  Object.defineProperty(selected, "database", { get() { invoked = true; throw new Error("synthetic private getter"); } });
  await assert.rejects(run(selected, f.dependencies), neutral("USAGE")); assert.equal(invoked, false);
});

test("receipt, gzip and photo tampering are refused before a password or database connection", async t => {
  for (const target of ["receipt", "sql", "manifest", "media"]) {
    const f = await fixture(t);
    const path = target === "media" ? join(f.mediaRoot, f.receipt.media.files[0].name)
      : join(f.checkpointDirectory, target === "receipt" ? "receipt.json" : target === "sql" ? "database.sql.gz" : "manifest.json");
    const bytes = await readFile(path); bytes[bytes.length - 1] ^= 1; await writeFile(path, bytes);
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
});

test("a wrong source notification key or source-media identity rejects the manifest before password input", async t => {
  for (const alteration of ["key", "root"]) {
    const f = await fixture(t), originalLoad = f.dependencies.loadEnvironment;
    f.dependencies.loadEnvironment = async (...args) => {
      const env = await originalLoad(...args);
      if (alteration === "key") env.JESSIEMESSAGE_NOTIFICATIONS_KEY = key(10);
      else { const other = join(f.directory, "other-media"); await mkdir(other, { mode: 0o700 }); env.JESSIEMESSAGE_MEDIA_ROOT = other; }
      return env;
    };
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
});

test("an aliased or nested media directory cannot become an independent checkpoint clone", async t => {
  for (const alteration of ["alias", "nested"]) {
    const f = await fixture(t);
    if (alteration === "alias") {
      await rm(f.mediaRoot, { recursive: true }); await symlink(f.sourceRoot, f.mediaRoot);
    } else {
      const originalLoad = f.dependencies.loadEnvironment;
      f.dependencies.loadEnvironment = async (...args) => { const env = await originalLoad(...args); env.JESSIEMESSAGE_MEDIA_ROOT = f.checkpointDirectory; return env; };
    }
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
});

test("a frozen dump mismatch prevents the crypto connection and emits no success output", async t => {
  const f = await fixture(t); let output = "";
  await assert.rejects(main(f.args, { ...f.dependencies, outputStream: { write(value) { output += value; } },
    dump: async () => ({ sqlBytes: sql.length, sqlSha256: "0".repeat(64) }) }), neutral("DUMP_MISMATCH"));
  assert.equal(output, ""); assert.deepEqual(f.connected, []);
});

test("global, wildcard and insufficient SQL inspection rights fail and still roll back the clone", async t => {
  for (const grant of ["GRANT ALL PRIVILEGES ON *.* TO `inspection_user`@`%`", "GRANT ALL PRIVILEGES ON `only_clone`.* TO `inspection_user`@`%`", "GRANT SELECT ON `only\\_clone`.* TO `inspection_user`@`%`"]) {
    const f = await fixture(t), original = f.connection.query;
    f.connection.query = (statement, parameters) => statement === "SHOW GRANTS" ? [{ grant }] : original(statement, parameters);
    await assert.rejects(run(f.selected, f.dependencies), neutral("OPERATION"));
    assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  }
});

test("TLS, migration history and foreign schema mismatches refuse an otherwise matching imported SQL dump", async t => {
  for (const failure of ["tls", "ledger", "foreign"]) {
    const f = await fixture(t), original = f.connection.query;
    f.connection.query = async (statement, parameters) => {
      const rows = await original(statement, parameters);
      if (failure === "tls" && statement.startsWith("SHOW SESSION")) return [{ Variable_name: "Ssl_cipher", Value: "" }];
      if (failure === "ledger" && statement.includes("FROM schema_migrations")) rows[29].checksum = "0".repeat(64);
      if (failure === "foreign" && statement.includes("KEY_COLUMN_USAGE")) return [{ parent_schema: "only_source" }];
      return rows;
    };
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  }
});

test("crypto binding failures and checkpoint changes after SQL checks suppress success and close the connection", async t => {
  for (const failure of ["crypto", "drift"]) {
    const f = await fixture(t);
    if (failure === "crypto") f.rows.push_subscriptions[0].session_user_id = id(11);
    else {
      const { verifyPhotoNotificationBackupData } = await import("../server/backup/verify.mjs");
      f.dependencies.verify = async options => { const report = await verifyPhotoNotificationBackupData(options);
        const path = join(f.mediaRoot, f.receipt.media.files[0].name), bytes = await readFile(path); bytes[bytes.length - 1] ^= 1; await writeFile(path, bytes); return report; };
    }
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  }
});

test("the crypto facade rejects writes and locking reads; cleanup failures wipe keys and suppress success", async t => {
  const f = await fixture(t); let keys;
  f.connection.rollback = async () => { f.events.push("rollback"); throw new Error("synthetic rollback error"); };
  await assert.rejects(run(f.selected, { ...f.dependencies, verify: async options => {
    keys = options.keys; const reader = await options.pool.getConnection();
    for (const sql of ["UPDATE users SET status = status", "SELECT 1 FOR UPDATE", "SELECT 1 INTO OUTFILE '/tmp/synthetic'"])
      assert.throws(() => reader.query(sql), neutral("DATABASE"));
    const { verifyPhotoNotificationBackupData } = await import("../server/backup/verify.mjs"); return verifyPhotoNotificationBackupData(options);
  } }), neutral("CLEANUP"));
  assert.deepEqual(f.events.slice(-2), ["rollback", "end"]);
  assert.ok(Object.values(keys).every(bytes => bytes.every(byte => byte === 0))); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
});

test("aborted and failed native-client prerequisites never request a password", async t => {
  const f = await fixture(t), cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(run(f.selected, { ...f.dependencies, signal: cancellation.signal }), neutral("CANCELLED"));
  await assert.rejects(run(f.selected, { ...f.dependencies, inspectClient: async () => { throw new Error("synthetic client error"); } }), neutral("CLIENT"));
  assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
});

test("cancellation during crypto verification still rolls back, closes the connection and wipes keys", async t => {
  const f = await fixture(t), cancellation = new AbortController(); let keys;
  await assert.rejects(run(f.selected, { ...f.dependencies, signal: cancellation.signal, verify: async options => {
    keys = options.keys; cancellation.abort(); return { complete: false, healthy: false, issues: [] };
  } }), neutral("CANCELLED"));
  assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  assert.ok(Object.values(keys).every(bytes => bytes.every(byte => byte === 0)));
});

test("application checkpoint commands retain the same closed six flags and expose their limited coverage before SQL", async t => {
  const f = await fixture(t, { application: true });
  assert.equal(parseArguments(f.args).command, "verify-application");
  assert.equal(parseArguments(["check-application", ...f.args.slice(1)]).command, "check-application");
  for (const command of ["application", "verify-all", "check-application-all"])
    assert.throws(() => parseArguments([command, ...f.args.slice(1)]), neutral("USAGE"));
  const report = await run({ ...f.selected, command: "check-application" }, f.dependencies);
  assert.equal(report.status, "ready_for_input"); assert.equal(report.databaseConnected, false);
  assert.equal(report.version, 2); assert.equal(report.profile, "messaging-photos-notify-application");
  assert.deepEqual(report.coverage, APPLICATION_COVERAGE); assert.equal(report.completeDatabase, false);
  assert.equal(report.capacityRebound, false); assert.equal(report.checkpointFilesMatched, true);
  assert.deepEqual(f.events, ["client"]); assert.deepEqual(f.connected, []); assert.deepEqual(f.dumps, []);
});

test("application clone verifies five domains and two exact table-only dumps without claiming executable-object coverage", async t => {
  const f = await fixture(t, { application: true }), original = f.connection.query;
  f.connection.query = (statement, parameters) => {
    assert.doesNotMatch(statement, /SHOW GRANTS|information_schema\.(?:TRIGGERS|EVENTS|ROUTINES)/i);
    return original(statement, parameters);
  };
  const report = await run(f.selected, f.dependencies);
  assert.equal(report.status, "verified"); assert.equal(report.databaseConnected, true);
  assert.equal(report.version, 2); assert.equal(report.profile, "messaging-photos-notify-application");
  assert.deepEqual(report.coverage, APPLICATION_COVERAGE); assert.equal(report.completeDatabase, false);
  assert.deepEqual(report.counts, { rows: 6, mfa: 1, mail: 1, reset: 0, messages: 1, crm: 0, tasks: 0, broadcast: 0,
    broadcastRecipients: 0, announcements: 0, media: 1, mediaFiles: 2, notifications: 1, notificationJobs: 1 });
  assert.equal(f.dumps.length, 2);
  for (const options of f.dumps) assert.deepEqual(options.tables, [...f.tables].sort());
  assert.notEqual(f.dumps[0].tables, f.dumps[1].tables);
  assert.deepEqual(f.events, ["client", "password", "dump", "connect", "dump", "rollback", "end", "snapshot"]);
  assert.equal(report.applicationSnapshotMatched, true);
  assert.ok(f.calls.some(({ statement }) => statement === "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT"));
  assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  for (const field of ["httpStarted", "smtpStarted", "workersStarted", "capacityRebound"]) assert.equal(report[field], false);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|example\.invalid|only_clone|only_source|inspection_user/);
});

test("strict and application receipts and manifests cannot be mixed before password or connection", async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { application });
    await assert.rejects(run({ ...f.selected, command: application ? "verify" : "verify-application" }, f.dependencies), neutral("CHECKPOINT"));
    await assert.rejects(run(f.selected, { ...f.dependencies, readBackupManifest: async () => ({ ...f.manifest,
      version: application ? 3 : 4, profile: application ? "messaging-photos-notify" : "messaging-photos-notify-application" }) }), neutral("CHECKPOINT"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
});

test("application snapshot coverage remains authenticated even when an altered raw manifest hash is rewritten into the receipt", async t => {
  for (const alteration of ["coverage", "signature", "snapshot-version"]) {
    const f = await fixture(t, { application: true }), manifest = structuredClone(f.manifest);
    if (alteration === "coverage") manifest.payload.snapshot.coverage.completeDatabase = true;
    if (alteration === "signature") manifest.signature = `${manifest.signature[0] === "0" ? "1" : "0"}${manifest.signature.slice(1)}`;
    if (alteration === "snapshot-version") manifest.payload.snapshot.version = 1;
    const content = Buffer.from(`${JSON.stringify(manifest)}\n`);
    await writeFile(join(f.checkpointDirectory, "manifest.json"), content);
    await writeFile(join(f.checkpointDirectory, "receipt.json"), `${JSON.stringify({ ...f.receipt,
      manifest: { ...f.receipt.manifest, sha256: hash(content) } })}\n`);
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
  }
});

test("application clone dump drift before or after crypto suppresses success and cleans up the read-only connection", async t => {
  for (const mismatch of [1, 2]) {
    const f = await fixture(t, { application: true }), original = f.dependencies.dump; let dumps = 0, output = "";
    await assert.rejects(main(f.args, { ...f.dependencies, outputStream: { write(value) { output += value; } },
      dump: async (...args) => { const report = await original(...args); return ++dumps === mismatch ? { ...report, sqlSha256: "0".repeat(64) } : report; } }), neutral("DUMP_MISMATCH"));
    assert.equal(output, ""); assert.equal(dumps, mismatch);
    if (mismatch === 1) assert.deepEqual(f.connected, []);
    else { assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, ""); }
  }
});

test("application clone still rejects changed physical tables, ledger and TLS despite matching SQL hashes", async t => {
  for (const failure of ["tables", "ledger", "tls"]) {
    const f = await fixture(t, { application: true }), original = f.connection.query;
    f.connection.query = async (statement, parameters) => {
      const rows = await original(statement, parameters);
      if (failure === "tables" && statement.includes("information_schema.TABLES")) rows[0].kind = "VIEW";
      if (failure === "ledger" && statement.includes("FROM schema_migrations")) rows[29].checksum = "0".repeat(64);
      if (failure === "tls" && statement.startsWith("SHOW SESSION")) rows[0].Value = "";
      return rows;
    };
    await assert.rejects(run(f.selected, f.dependencies), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
    assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.dumps.length, 1);
    assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  }
});

test("application snapshot verification uses a separate ephemeral clone identity and wipes its credentials without modifying the source", async t => {
  const f = await fixture(t, { application: true }), source = await f.dependencies.loadEnvironment();
  const before = { ...source }, cancellation = new AbortController(); let observedEnv;
  const report = await verifyApplicationCloneSnapshot(source, f.selected, "synthetic inspection password", {
    signal: cancellation.signal, backup: async (args, env, options) => {
      observedEnv = env; assert.notEqual(env, source);
      assert.deepEqual(args, ["verify", "--offline", "--manifest", join(f.checkpointDirectory, "manifest.json"), "--profile", "photos-notify-application"]);
      assert.equal(env.JESSIEMESSAGE_DB_NAME, "only_clone"); assert.equal(env.JESSIEMESSAGE_APPLICATION_DATABASE, "only_clone");
      assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_USER, "inspection_user"); assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "synthetic inspection password");
      assert.equal(env.JESSIEMESSAGE_MEDIA_ROOT, f.mediaRoot); assert.equal(env.JESSIEMESSAGE_DB_TLS_CA_PATH, "/etc/ssl/certs/ca-certificates.crt");
      for (const name of ["JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE", "JESSIEMESSAGE_DB_USER", "JESSIEMESSAGE_DB_PASSWORD"]) assert.equal(Object.hasOwn(env, name), false);
      assert.equal(options.signal, cancellation.signal); assert.equal(typeof options.outputStream.write, "function");
      options.outputStream.write("synthetic private backup output");
      return snapshotVerified();
    },
  });
  assert.deepEqual(report, snapshotVerified()); assert.deepEqual(source, before);
  assert.equal(source.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE, "infomaniak-shared-pattern");
  for (const name of ["JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MESSAGE_KEY",
    "JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_NOTIFICATIONS_KEY", "JESSIEMESSAGE_VAPID_PRIVATE_KEY", "JESSIEMESSAGE_SMTP_PASSWORD"]) assert.equal(observedEnv[name], "");
});

test("application snapshot comparison must succeed after rollback and close before a success report is emitted", async t => {
  for (const report of [undefined, { ...snapshotVerified(), verified: false }, { ...snapshotVerified(), restored: true },
    { ...snapshotVerified(), prepared: true }, { ...snapshotVerified(), releasedCandidates: 1 }, { ...snapshotVerified(), command: "restore" }]) {
    const f = await fixture(t, { application: true }); let output = "";
    await assert.rejects(main(f.args, { ...f.dependencies, outputStream: { write(value) { output += value; } },
      verifyApplicationSnapshot: async () => { assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); return report; } }), neutral("SNAPSHOT"));
    assert.equal(output, ""); assert.deepEqual(f.events.slice(-2), ["rollback", "end"]);
    assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  }
});

test("application snapshot failures wipe their copied environment and file changes after comparison prevent success", async t => {
  const f = await fixture(t, { application: true }), source = await f.dependencies.loadEnvironment(); let clone;
  await assert.rejects(verifyApplicationCloneSnapshot(source, f.selected, "synthetic inspection password", {
    backup: async (_args, env) => { clone = env; throw new Error("synthetic private snapshot failure"); },
  }), neutral("SNAPSHOT"));
  assert.equal(clone.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, ""); assert.equal(clone.JESSIEMESSAGE_MEDIA_KEY, "");
  let output = "";
  await assert.rejects(main(f.args, { ...f.dependencies, outputStream: { write(value) { output += value; } },
    verifyApplicationSnapshot: async () => {
      assert.deepEqual(f.events.slice(-2), ["rollback", "end"]);
      const path = join(f.mediaRoot, f.receipt.media.files[0].name), bytes = await readFile(path); bytes[bytes.length - 1] ^= 1;
      await writeFile(path, bytes); return snapshotVerified();
    },
  }), error => error.code.startsWith("PRIVATE_CHECKPOINT_VERIFY_"));
  assert.equal(output, ""); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
});

test("Broadcast checkpoint verification authenticates the populated notes and recovery outbox while keeping SQL and files read-only", async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { application, broadcast: true }), before = structuredClone(f.rows);
    const report = await run(f.selected, { ...f.dependencies,
      verify: () => assert.fail("Legacy verifier cannot accept CRM data"), verifyRecovery: () => assert.fail("Five-key verifier cannot accept CRM data"),
    });
    assert.equal(report.status, "verified"); assert.equal(report.version, application ? 8 : 7);
    assert.equal(report.profile, `messaging-photos-notify-recovery-crm-broadcast${application ? "-application" : ""}`);
    assert.equal(report.counts.broadcast, 1); assert.equal(report.counts.broadcastRecipients, 1); assert.equal(report.counts.crm, 1); assert.equal(report.counts.reset, 1); assert.equal(report.workersStarted, false);
    assert.equal(report.capacityRebound, false); assert.equal(report.httpStarted, false); assert.equal(report.smtpStarted, false);
    assert.deepEqual(structuredClone(f.rows), before);
    for (const env of f.environments) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
    assert.doesNotMatch(JSON.stringify(report), /Synthetic restored CRM note|synthetic inspection password/);
    const corrupted = await fixture(t, { application, broadcast: true });
    corrupted.rows.crm_profiles[0].notes_revision = 3;
    await assert.rejects(run(corrupted.selected, corrupted.dependencies), neutral("CRYPTO"));
    assert.equal(corrupted.environments[0].JESSIEMESSAGE_CRM_KEY, "");
  }
});
