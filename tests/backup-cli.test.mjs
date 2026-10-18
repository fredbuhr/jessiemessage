import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { main, parseArguments, BackupCliError } from "../scripts/backup.mjs";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { loadRuntimeCrmEnvironment, CRM_RUNTIME_OPTIONS } from "../server/config/runtime-crm.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { bundle as crmBundle } from "./fixtures/crm-private.mjs";

const manifestPath = "/private-backup/manifest.json";
const args = (command) => [command, "--offline", "--manifest", manifestPath];
const clone = (value) => JSON.parse(JSON.stringify(value));
const errorCode = (code) => (error) => error instanceof BackupCliError && error.code === code;
function fixture({ source = false } = {}) {
  const events = [], output = [], sourceFingerprint = "1".repeat(64), targetFingerprint = "2".repeat(64);
  const sourceIdentity = { databaseTag: "3".repeat(64), rootPathTag: "4".repeat(64), rootPhysicalTag: "5".repeat(64), rootFingerprint: sourceFingerprint, rootAncestors: ["6".repeat(64)] };
  const targetIdentity = { databaseTag: "7".repeat(64), rootPathTag: "8".repeat(64), rootPhysicalTag: "9".repeat(64), rootFingerprint: targetFingerprint, rootAncestors: ["6".repeat(64)] };
  const candidate = { id: "a".repeat(32), owner_id: "b".repeat(32), owner_role: "admin", storage_key: "c".repeat(64), content_digest: "d".repeat(64),
    full_bytes: 8, thumbnail_bytes: 4, stored_bytes: 92, asset_id: null, state: "reserved", created_at: "2026-10-15 00:00:00.000000", updated_at: "2026-10-15 00:00:00.000000", released_at: null };
  const original = { version: 1, schemaDigest: "e".repeat(64), coreDigest: "f".repeat(64), counts: { tables: 30, rows: 1 },
    capacity: { ownerBytes: 1000, totalBytes: 10000, heldBytes: 200, rootFingerprint: sourceFingerprint, initializedAt: "2026-10-15 00:00:00.000000" }, objects: [candidate], assets: [] };
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"].map((name) => [name, randomBytes(32)]));
  const state = { snapshot: clone(original), identity: source ? sourceIdentity : targetIdentity, cryptoHealthy: true, structuralHealthy: true,
    manifest: { version: 1, payload: { identity: sourceIdentity, snapshot: clone(original) }, signature: "signed-fixture" }, files: new Set([candidate.storage_key]), captures: 0, now: 1750000000000 };
  const config = { media: { enabled: true, root: "/synthetic/private-media", key: keys.mediaKey, capacity: { ownerBytes: 1000, totalBytes: 10000 }, minimumFreeBytes: 0 }, keys, databaseName: source ? "synthetic_source" : "synthetic_clone" };
  const pool = { end: async () => { events.push("pool-end"); } };
  const inspectionPool = { end: async () => { events.push("inspection-end"); } };
  const storage = { fingerprint: async () => Buffer.from(state.identity.rootFingerprint, "hex"), remove: async ({ storageKey }) => { events.push(["remove", storageKey.toString("hex")]); state.files.delete(storageKey.toString("hex")); } };
  const snapshots = {
    captureBackupSnapshot: async () => { events.push("capture"); state.captures++; return clone(state.snapshot); },
    assertBackupSnapshot: ({ expected, actual, mode, targetFingerprint: target }) => {
      events.push(["compare", mode]);
      if (mode === "exact" && JSON.stringify(expected) !== JSON.stringify(actual) || expected.coreDigest !== actual.coreDigest
        || ![expected.capacity.rootFingerprint, target].includes(actual.capacity.rootFingerprint)) throw new Error("private SQL snapshot drift");
      return { candidates: expected.objects.filter((row) => ["reserved", "cleanup_pending"].includes(row.state)), heldBytes: actual.capacity.heldBytes };
    },
    verifyBackupStorage: async () => { events.push("structural"); return { complete: true, healthy: state.structuralHealthy }; },
  };
  const manifests = {
    readManifest: async (file) => { events.push(["manifest-read", file]); return state.manifest; },
    verifyBackupManifest: ({ manifest }) => { events.push("manifest-verify"); return manifest.payload; },
    backupIdentity: async () => { events.push("identity"); return clone(state.identity); },
    assertCloneIdentity: (first, second) => { events.push("clone-check"); if (first.databaseTag === second.databaseTag || first.rootPathTag === second.rootPathTag || first.rootPhysicalTag === second.rootPhysicalTag) throw new Error("isolated clone required"); },
    createBackupManifest: ({ snapshot, identity, now }) => { events.push(["manifest-create", now]); return { version: 1, payload: { snapshot, identity }, signature: "signed-fixture" }; },
    writeManifest: async (file, manifest) => { events.push(["manifest-write", file]); state.manifest = manifest; },
    manifestHash: () => "0".repeat(64),
  };
  const recovery = {
    closeCandidate: async (command) => { events.push(["close", command]); state.snapshot.objects[0].state = "cleanup_pending"; return { closed: true, state: "cleanup_pending" }; },
    releaseCandidate: async (command) => { events.push(["release", command]); state.snapshot.objects[0].state = "released"; state.snapshot.capacity.heldBytes -= candidate.stored_bytes; return { released: true }; },
    rebind: async (command) => { events.push(["rebind", command]); state.snapshot.capacity.rootFingerprint = targetFingerprint; return { rebound: true }; },
  };
  const dependencies = { configure: () => config, createPool: async () => { events.push("pool"); return pool; }, makeStorage: async () => storage,
    createInspectionPool: async () => { events.push("inspection-pool"); return inspectionPool; },
    makeSchemaStore: () => ({ assertSchema: async () => { events.push("schema"); } }),
    makeSnapshotStore: (options) => { events.push(["snapshot-store", options]); return { databaseName: async () => config.databaseName }; }, makeCryptoStore: () => ({ synthetic: true }),
    makeCapacityStore: () => ({ status: async () => ({ ready: true, ...config.media.capacity, rootFingerprint: Buffer.from(sourceFingerprint, "hex") }) }),
    makeRecoveryStore: () => recovery, verifyBackupData: async (options) => { events.push(["crypto", options]); return { complete: true, healthy: state.cryptoHealthy }; },
    snapshots, manifests, clock: () => ++state.now, outputStream: { write: (value) => output.push(value) } };
  return { state, config, dependencies, events, output, pool, inspectionPool, storage, snapshots, manifests, recovery, original, sourceIdentity, targetIdentity };
}
const mutations = (f) => f.events.filter((item) => Array.isArray(item) && ["close", "remove", "release", "rebind"].includes(item[0]));

test("the real CRM backup configuration forwards six actual keys and rejects inactive CRM or active broadcasts before opening SQL", async () => {
  const env = await loadRuntimeCrmEnvironment("/private/synthetic-crm", CRM_RUNTIME_OPTIONS, { readBundle: async () => crmBundle() });
  const f = fixture({ source: true });
  f.config.databaseName = env.JESSIEMESSAGE_DB_NAME;
  f.config.media.capacity = { ownerBytes: Number(env.JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES), totalBytes: Number(env.JESSIEMESSAGE_MEDIA_TOTAL_BYTES) };
  const create = f.manifests.createBackupManifest;
  f.manifests.createBackupManifest = value => ({ ...create(value), version: 7, profile: value.profile });
  assert.equal((await main([...args("prepare"), "--profile", "photos-notify-recovery-crm"], env, { ...f.dependencies, configure: undefined })).prepared, true);
  const crypto = f.events.find(event => Array.isArray(event) && event[0] === "crypto")[1];
  assert.deepEqual(Object.keys(crypto.keys).sort(), ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey", "crmKey"].sort());
  assert.equal(crypto.keys.crmKey.toString("base64url"), env.JESSIEMESSAGE_CRM_KEY); assert.equal(f.state.manifest.profile, "messaging-photos-notify-recovery-crm");
  for (const override of [{ JESSIEMESSAGE_ENABLE_CRM: "0" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "1" },
    { JESSIEMESSAGE_CRM_KEY: "" }, { JESSIEMESSAGE_CRM_KEY: env.JESSIEMESSAGE_MESSAGE_KEY }]) {
    let opened = false;
    await assert.rejects(main([...args("prepare"), "--profile", "photos-notify-recovery-crm"], { ...env, ...override }, {
      createPool: async () => { opened = true; assert.fail("Invalid profile cannot reach SQL"); },
    }));
    assert.equal(opened, false);
  }
});

test("backup commands require exact offline arguments and a canonical absolute manifest path", () => {
  for (const command of ["prepare", "verify", "restore"]) assert.deepEqual(parseArguments(args(command)), { command, offline: true, manifestPath });
  for (const values of [[], ["prepare", "--manifest", manifestPath], ["restore", "--force", "--manifest", manifestPath],
    args("unknown"), ["verify", "--offline", "--manifest", "relative.json"], ["restore", "--offline", "--manifest", "/private/../manifest.json"],
    [...args("restore"), "--cleanup-all"], ["prepare", "--offline", "--manifest", "/private/secret\nname"]]) assert.throws(() => parseArguments(values), errorCode("BACKUP_USAGE"));
});

test("photo CLI prepares and restores with four keys while retaining the shared clone and recovery guards", async () => {
  const source = fixture({ source: true }); delete source.config.keys.crmKey;
  const create = source.manifests.createBackupManifest;
  source.manifests.createBackupManifest = value => { assert.equal(value.profile, "messaging-photos"); return { ...create(value), version: 2, profile: value.profile }; };
  assert.equal((await main([...args("prepare"), "--profile", "photos"], {}, source.dependencies)).prepared, true);
  assert.equal(source.events.find(event => Array.isArray(event) && event[0] === "crypto")[1].pool, source.pool);
  const target = fixture(); delete target.config.keys.crmKey;
  Object.assign(target.state.manifest, { version: 2, profile: "messaging-photos" });
  assert.equal((await main([...args("restore"), "--profile", "photos"], {}, target.dependencies)).restored, true);
  assert.equal(mutations(target).filter(event => event[0] === "rebind").length, 1);
  const wrong = fixture();
  await assert.rejects(main([...args("verify"), "--profile", "photos"], {}, wrong.dependencies), errorCode("BACKUP_CONFIG"));
  assert.equal(wrong.events.length, 0);
});

test("photo CLI real configuration accepts disabled CRM/recovery/broadcast without a CRM key", async () => {
  const f = fixture({ source: true }); delete f.config.keys.crmKey;
  const env = { PORT: "3000", JESSIEMESSAGE_SITE_ORIGIN: "https://recette.jessiemessage.com",
    JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1", JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_MEDIA: "1",
    JESSIEMESSAGE_ENABLE_CRM: "0", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0", JESSIEMESSAGE_ENABLE_BROADCAST: "0",
    JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
    JESSIEMESSAGE_SMTP_USER: "synthetic-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-password",
    JESSIEMESSAGE_DB_HOST: "sql.example.invalid", JESSIEMESSAGE_DB_NAME: f.config.databaseName,
    JESSIEMESSAGE_APPLICATION_DATABASE: f.config.databaseName, JESSIEMESSAGE_RUNTIME_DB_USER: "synthetic_runtime", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-password",
    JESSIEMESSAGE_MFA_KEY: f.config.keys.totpKey.toString("base64url"), JESSIEMESSAGE_MAIL_KEY: f.config.keys.mailKey.toString("base64url"),
    JESSIEMESSAGE_MESSAGE_KEY: f.config.keys.messageKey.toString("base64url"), JESSIEMESSAGE_MEDIA_KEY: f.config.keys.mediaKey.toString("base64url"),
    JESSIEMESSAGE_MEDIA_ROOT: f.config.media.root, JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: String(f.config.media.capacity.ownerBytes),
    JESSIEMESSAGE_MEDIA_TOTAL_BYTES: String(f.config.media.capacity.totalBytes), JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0" };
  const deps = { ...f.dependencies }; delete deps.configure;
  assert.equal((await main([...args("prepare"), "--profile", "photos"], env, deps)).prepared, true);
  await assert.rejects(main([...args("prepare"), "--profile", "photos"], { ...env, JESSIEMESSAGE_ENABLE_CRM: "1" }, deps), errorCode("BACKUP_OPERATION"));
});

test("notification CLI uses an explicit v3 profile, five keys and the same offline clone guards", async () => {
  assert.deepEqual(parseArguments([...args("prepare"), "--profile", "photos-notify"]), { command: "prepare", offline: true, manifestPath, profile: "photos-notify" });
  const source = fixture({ source: true }); delete source.config.keys.crmKey; source.config.keys.notificationKey = randomBytes(32);
  const create = source.manifests.createBackupManifest;
  source.manifests.createBackupManifest = value => { assert.equal(value.profile, "messaging-photos-notify"); return { ...create(value), version: 3, profile: value.profile }; };
  assert.equal((await main([...args("prepare"), "--profile", "photos-notify"], {}, source.dependencies)).prepared, true);
  assert.equal(Object.keys(source.state.manifest).includes("profile"), true);
  assert.equal(source.events.find(event => Array.isArray(event) && event[0] === "crypto")[1].pool, source.pool);
  const target = fixture(); delete target.config.keys.crmKey; target.config.keys.notificationKey = randomBytes(32);
  Object.assign(target.state.manifest, { version: 3, profile: "messaging-photos-notify" });
  assert.equal((await main([...args("restore"), "--profile", "photos-notify"], {}, target.dependencies)).restored, true);
  assert.equal(mutations(target).filter(event => event[0] === "rebind").length, 1);
  for (const old of [{ version: 1 }, { version: 2, profile: "messaging-photos" }, { version: 3, profile: "full-notify" }]) {
    const f = fixture(); delete f.config.keys.crmKey; f.config.keys.notificationKey = randomBytes(32); Object.assign(f.state.manifest, old);
    await assert.rejects(main([...args("verify"), "--profile", "photos-notify"], {}, f.dependencies), errorCode("BACKUP_VERIFY"));
    assert.equal(f.events.includes("pool"), false);
  }
});

test("notification CLI real configuration requires VAPID and rejects choosing an older profile when notifications are enabled", async () => {
  const f = fixture({ source: true }); delete f.config.keys.crmKey;
  const curve = createECDH("prime256v1"); curve.generateKeys();
  const env = { JESSIEMESSAGE_SITE_ORIGIN: "https://recette.jessiemessage.com", JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1",
    JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_MEDIA: "1", JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
    JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-password",
    JESSIEMESSAGE_DB_HOST: "sql.example.invalid", JESSIEMESSAGE_DB_NAME: f.config.databaseName, JESSIEMESSAGE_APPLICATION_DATABASE: f.config.databaseName,
    JESSIEMESSAGE_RUNTIME_DB_USER: "synthetic_runtime", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-password",
    JESSIEMESSAGE_MFA_KEY: f.config.keys.totpKey.toString("base64url"), JESSIEMESSAGE_MAIL_KEY: f.config.keys.mailKey.toString("base64url"),
    JESSIEMESSAGE_MESSAGE_KEY: f.config.keys.messageKey.toString("base64url"), JESSIEMESSAGE_MEDIA_KEY: f.config.keys.mediaKey.toString("base64url"),
    JESSIEMESSAGE_MEDIA_ROOT: f.config.media.root, JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: "1000", JESSIEMESSAGE_MEDIA_TOTAL_BYTES: "10000", JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0",
    JESSIEMESSAGE_NOTIFICATIONS_KEY: randomBytes(32).toString("base64url"), JESSIEMESSAGE_VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"),
    JESSIEMESSAGE_VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), curve.getPrivateKey()]).subarray(-32).toString("base64url"), JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com" };
  const dependencies = { ...f.dependencies }; delete dependencies.configure;
  assert.equal((await main([...args("prepare"), "--profile", "photos-notify"], env, dependencies)).prepared, true);
  await assert.rejects(main([...args("prepare"), "--profile", "photos"], env, dependencies), errorCode("BACKUP_CONFIG"));
  await assert.rejects(main([...args("prepare"), "--profile", "photos-notify"], { ...env, JESSIEMESSAGE_VAPID_PRIVATE_KEY: undefined }, dependencies), errorCode("BACKUP_OPERATION"));
});

const recoveryProfiles = [
  { cli: "photos-notify-recovery", profile: "messaging-photos-notify-recovery", version: 5, application: false },
  { cli: "photos-notify-recovery-application", profile: "messaging-photos-notify-recovery-application", version: 6, application: true },
];
function recoveryFixture(spec, options) {
  const f = fixture(options); delete f.config.keys.crmKey; f.config.keys.notificationKey = randomBytes(32);
  Object.assign(f.state.manifest, { version: spec.version, profile: spec.profile });
  if (spec.application) {
    f.state.snapshot.version = 2; f.state.snapshot.coverage = { ...APPLICATION_COVERAGE };
    f.state.manifest.payload.snapshot.version = 2; f.state.manifest.payload.snapshot.coverage = { ...APPLICATION_COVERAGE };
  }
  const create = f.manifests.createBackupManifest;
  f.manifests.createBackupManifest = value => {
    assert.equal(value.profile, spec.profile);
    return { ...create(value), version: spec.version, profile: value.profile };
  };
  return f;
}
function recoveryEnvironment(f) {
  const curve = createECDH("prime256v1"); curve.generateKeys();
  return { JESSIEMESSAGE_SITE_ORIGIN: "https://jessiemessage.com", JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1",
    JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_MEDIA: "1", JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
    JESSIEMESSAGE_ENABLE_CRM: "0", JESSIEMESSAGE_ENABLE_BROADCAST: "0", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1",
    JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-password",
    JESSIEMESSAGE_DB_HOST: "sql.example.invalid", JESSIEMESSAGE_DB_NAME: f.config.databaseName, JESSIEMESSAGE_APPLICATION_DATABASE: f.config.databaseName,
    JESSIEMESSAGE_RUNTIME_DB_USER: "synthetic_runtime", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-password",
    JESSIEMESSAGE_MFA_KEY: f.config.keys.totpKey.toString("base64url"), JESSIEMESSAGE_MAIL_KEY: f.config.keys.mailKey.toString("base64url"),
    JESSIEMESSAGE_MESSAGE_KEY: f.config.keys.messageKey.toString("base64url"), JESSIEMESSAGE_MEDIA_KEY: f.config.keys.mediaKey.toString("base64url"),
    JESSIEMESSAGE_MEDIA_ROOT: f.config.media.root, JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: "1000", JESSIEMESSAGE_MEDIA_TOTAL_BYTES: "10000", JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0",
    JESSIEMESSAGE_NOTIFICATIONS_KEY: f.config.keys.notificationKey.toString("base64url"), JESSIEMESSAGE_VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"),
    JESSIEMESSAGE_VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), curve.getPrivateKey()]).subarray(-32).toString("base64url"),
    JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com" };
}

test("recovery backup profiles prepare, verify and restore with five keys, exact envelopes and the existing clone guards", async () => {
  for (const spec of recoveryProfiles) for (const command of ["prepare", "verify", "restore"]) {
    assert.deepEqual(parseArguments([...args(command), "--profile", spec.cli]), { command, offline: true, manifestPath, profile: spec.cli });
    const f = recoveryFixture(spec, { source: command === "prepare" });
    const result = await main([...args(command), "--profile", spec.cli], {}, f.dependencies);
    assert.equal(result.verified, true); assert.equal(result.prepared, command === "prepare"); assert.equal(result.restored, command === "restore");
    assert.equal(f.events.find(event => Array.isArray(event) && event[0] === "crypto")[1].pool, f.pool);
    assert.equal(f.events.find(event => Array.isArray(event) && event[0] === "snapshot-store")[1].coverage, spec.application ? "application-tables" : undefined);
    assert.equal(mutations(f).some(event => event[0] === "rebind"), command === "restore");
  }
  for (const cli of ["photos-recovery", "photos-notify-recovery-application-extra", "full-recovery"]) {
    assert.throws(() => parseArguments([...args("prepare"), "--profile", cli]), errorCode("BACKUP_USAGE"));
  }
});

test("recovery backup commands reject every other envelope before opening SQL and refuse a CRM key", async () => {
  const envelopes = [
    { version: 2, profile: "messaging-photos" }, { version: 3, profile: "messaging-photos-notify" },
    { version: 4, profile: "messaging-photos-notify-application" },
    ...recoveryProfiles.map(({ version, profile }) => ({ version, profile })),
  ];
  for (const spec of recoveryProfiles) {
    for (const envelope of envelopes.filter(item => item.version !== spec.version)) {
      const f = recoveryFixture(spec); Object.assign(f.state.manifest, envelope);
      await assert.rejects(main([...args("verify"), "--profile", spec.cli], {}, f.dependencies), errorCode("BACKUP_VERIFY"));
      assert.equal(f.events.includes("pool"), false);
    }
    const f = recoveryFixture(spec); f.config.keys.crmKey = randomBytes(32);
    await assert.rejects(main([...args("verify"), "--profile", spec.cli], {}, f.dependencies), errorCode("BACKUP_CONFIG"));
    assert.deepEqual(f.events, []);
  }
  for (const [cli, version, profile] of [["photos-notify", 5, "messaging-photos-notify-recovery"], ["photos-notify-application", 6, "messaging-photos-notify-recovery-application"]]) {
    const f = recoveryFixture(recoveryProfiles.find(spec => spec.version === version));
    Object.assign(f.state.manifest, { version, profile });
    await assert.rejects(main([...args("verify"), "--profile", cli], {}, f.dependencies), errorCode("BACKUP_VERIFY"));
    assert.equal(f.events.includes("pool"), false);
  }
});

test("recovery backup real configuration accepts enabled or disabled recovery, requires photos and notifications, and keeps CRM and broadcast inactive", async () => {
  for (const spec of recoveryProfiles) {
    for (const flag of [undefined, "0", "1"]) {
      const f = recoveryFixture(spec, { source: true }), env = recoveryEnvironment(f), dependencies = { ...f.dependencies };
      env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY = flag; delete dependencies.configure;
      assert.equal((await main([...args("prepare"), "--profile", spec.cli], env, dependencies)).prepared, true);
      assert.equal(Object.hasOwn(env, "JESSIEMESSAGE_CRM_KEY"), false);
    }
    for (const mutation of [
      { JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "true" }, { JESSIEMESSAGE_ENABLE_CRM: "1" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "1" },
      { JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "0" }, { JESSIEMESSAGE_ENABLE_MEDIA: "0" }, { JESSIEMESSAGE_NOTIFICATIONS_KEY: undefined },
    ]) {
      const f = recoveryFixture(spec, { source: true }), env = { ...recoveryEnvironment(f), ...mutation }, dependencies = { ...f.dependencies };
      delete dependencies.configure;
      await assert.rejects(main([...args("prepare"), "--profile", spec.cli], env, dependencies), error => error instanceof BackupCliError);
      assert.equal(f.events.includes("pool"), false);
    }
  }
  for (const cli of ["photos", "photos-notify", "photos-notify-application"]) {
    const f = recoveryFixture(recoveryProfiles[0], { source: true }), env = recoveryEnvironment(f), dependencies = { ...f.dependencies };
    if (cli === "photos") env.JESSIEMESSAGE_ENABLE_NOTIFICATIONS = "0";
    delete dependencies.configure;
    await assert.rejects(main([...args("prepare"), "--profile", cli], env, dependencies), errorCode("BACKUP_CONFIG"));
    assert.equal(f.events.includes("pool"), false);
  }
});

test("recovery CLI dispatches the real recovery crypto verifier for populated reset mail without starting workers or writing SQL", async () => {
  for (const spec of recoveryProfiles) {
    const f = recoveryFixture(spec, { source: true }), queries = [], jobId = Buffer.alloc(16, 6), clientId = Buffer.alloc(16, 2);
    const email = "synthetic-backup@example.invalid", token = randomBytes(32).toString("base64url");
    const resetRow = { id: jobId, encrypted: sealResetPayload({ email, token }, f.config.keys.mailKey, jobId),
      recipient_user_id: clientId, challenge_user_id: clientId, token_hash: tokenDigest(token),
      email_hash: createHash("sha256").update(email, "utf8").digest(), recipient_email: email };
    f.pool.getConnection = async () => ({ query: async (sql) => {
      assert.match(sql, /^SELECT\s/); queries.push(sql);
      if (sql.startsWith("SELECT EXISTS")) return [{ present: /FROM (?:client_password_resets|password_reset_outbox)\b/.test(sql) ? 1 : 0 }];
      return /FROM password_reset_outbox o\b/.test(sql) ? [resetRow] : [];
    }, release() {} });
    f.storage.get = async () => assert.fail("no media exists in this synthetic fixture");
    delete f.dependencies.verifyBackupData;
    const result = await main([...args("prepare"), "--profile", spec.cli], {}, f.dependencies);
    assert.equal(result.prepared, true);
    assert.ok(queries.some(sql => sql.includes("FROM password_reset_outbox o")));
    assert.equal(queries.some(sql => /^SELECT EXISTS.*FROM (?:client_password_resets|password_reset_outbox)\b/.test(sql)), false);
    assert.deepEqual(mutations(f), []);
  }
});

test("prepare authenticates and verifies the stable source before writing the exclusive manifest, without recovery mutations", async () => {
  const f = fixture({ source: true }), result = await main(args("prepare"), {}, f.dependencies);
  assert.equal(result.prepared, true); assert.equal(result.verified, true); assert.equal(result.restored, false);
  assert.deepEqual(mutations(f), []); assert.equal(f.state.captures, 2);
  assert.ok(f.events.indexOf("schema") < f.events.indexOf("capture"));
  const write = f.events.findIndex((item) => item[0] === "manifest-write");
  assert.ok(write > f.events.lastIndexOf("identity")); assert.ok(write > f.events.findIndex((item) => item[0] === "crypto"));
  assert.ok(f.events.includes("pool-end")); assert.ok(f.events.includes("inspection-end"));
  assert.deepEqual(Object.keys(JSON.parse(f.output[0])).sort(), ["command", "manifestHash", "prepared", "releasedCandidates", "restored", "verified"]);
  assert.doesNotMatch(f.output[0], /synthetic|private-media|storage_key|payload|signature|rootFingerprint/);
});

test("verify is read only on an isolated clone and accepts its original source binding", async () => {
  const f = fixture(), result = await main(args("verify"), {}, f.dependencies);
  assert.equal(result.verified, true); assert.equal(result.restored, false); assert.deepEqual(mutations(f), []);
  assert.equal(f.state.snapshot.capacity.rootFingerprint, f.sourceIdentity.rootFingerprint);
  assert.ok(f.events.indexOf("manifest-verify") < f.events.indexOf("pool"));
  assert.ok(f.events.indexOf("clone-check") < f.events.indexOf("capture"));
});

test("verification and restoration reject source identity collisions before private reads or mutations", async () => {
  for (const command of ["verify", "restore"]) for (const key of ["databaseTag", "rootPathTag", "rootPhysicalTag"]) {
    const f = fixture(); f.state.identity[key] = f.sourceIdentity[key];
    await assert.rejects(main(args(command), {}, f.dependencies), errorCode("BACKUP_OPERATION"));
    assert.deepEqual(mutations(f), []); assert.equal(f.state.captures, 0); assert.equal(f.output.length, 0);
  }
});

test("restore closes its signed candidate before file removal, releases using fresh time, then verifies and rebinds", async () => {
  const f = fixture(), result = await main(args("restore"), {}, f.dependencies), actions = mutations(f);
  assert.deepEqual(actions.map((item) => item[0]), ["close", "remove", "release", "rebind"]);
  assert.equal(result.restored, true); assert.equal(result.releasedCandidates, 1); assert.equal(f.state.files.size, 0);
  assert.ok(actions[2][1].now > actions[0][1].now); assert.ok(actions[3][1].now > actions[2][1].now);
  assert.deepEqual(Object.keys(actions[0][1].candidate).sort(), ["asset_id", "content_digest", "created_at", "full_bytes", "id", "owner_id", "owner_role", "state", "storage_key", "stored_bytes", "thumbnail_bytes"]);
  assert.equal(actions[0][1].targetDatabaseName, "synthetic_clone");
  assert.equal(actions[3][1].expectedHeldBytes, 108);
  const rebind = f.events.findIndex((item) => item[0] === "rebind"), release = f.events.findIndex((item) => item[0] === "release");
  assert.ok(f.events.findLastIndex((item) => item[0] === "crypto") > release); assert.ok(rebind > f.events.lastIndexOf("identity"));
});

test("no candidate file is removed unless SQL close gives a positive acknowledgement", async () => {
  for (const closed of [undefined, false, {}, { closed: false, state: "cleanup_pending" }, { closed: true, state: "reserved" }]) {
    const f = fixture(); f.recovery.closeCandidate = async () => { f.events.push(["close"]); return closed; };
    await assert.rejects(main(args("restore"), {}, f.dependencies), errorCode("BACKUP_VERIFY"));
    assert.deepEqual(mutations(f).map((item) => item[0]), ["close"]); assert.equal(f.state.files.size, 1);
  }
});

test("a failed unlink never releases capacity or rebinds and a resumed restore completes safely", async () => {
  const f = fixture(), originalRemove = f.storage.remove;
  f.storage.remove = async () => { f.events.push(["remove-failed"]); throw new Error("private file failure"); };
  await assert.rejects(main(args("restore"), {}, f.dependencies), errorCode("BACKUP_OPERATION"));
  assert.deepEqual(mutations(f).map((item) => item[0]), ["close"]); assert.equal(f.state.snapshot.objects[0].state, "cleanup_pending");
  assert.equal(f.state.snapshot.capacity.heldBytes, 200);
  f.storage.remove = originalRemove; f.events.length = 0;
  const result = await main(args("restore"), {}, f.dependencies); assert.equal(result.restored, true);
  assert.deepEqual(mutations(f).map((item) => item[0]), ["close", "remove", "release", "rebind"]);
});

test("completed target binding skips every candidate close, unlink and release on restore replay", async () => {
  const f = fixture(); await main(args("restore"), {}, f.dependencies); f.events.length = 0;
  const result = await main(args("restore"), {}, f.dependencies);
  assert.deepEqual(mutations(f).map((item) => item[0]), ["rebind"]); assert.equal(result.releasedCandidates, 0);
});

test("lost acknowledgements after durable close, release or final rebind resume without unsafe repeated deletion", async () => {
  for (const phase of ["closeCandidate", "releaseCandidate", "rebind"]) {
    const f = fixture(), operation = f.recovery[phase];
    f.recovery[phase] = async (command) => { await operation(command); throw new Error("connection lost after durable commit"); };
    await assert.rejects(main(args("restore"), {}, f.dependencies), errorCode("BACKUP_OPERATION"));
    assert.deepEqual(f.output, []);
    if (phase === "closeCandidate") { assert.equal(f.state.files.size, 1); assert.equal(f.state.snapshot.capacity.heldBytes, 200); }
    else { assert.equal(f.state.files.size, 0); assert.equal(f.state.snapshot.capacity.heldBytes, 108); }
    f.recovery[phase] = operation; f.events.length = 0;
    const result = await main(args("restore"), {}, f.dependencies); assert.equal(result.restored, true);
    const actions = mutations(f).map((item) => item[0]);
    assert.deepEqual(actions, phase === "closeCandidate" ? ["close", "remove", "release", "rebind"] : ["rebind"]);
  }
});

test("preflight crypto, structural, capacity and snapshot failures prevent every destructive action", async () => {
  for (const change of ["crypto", "structural", "capacity", "snapshot", "schema"]) {
    const f = fixture();
    if (change === "crypto") f.state.cryptoHealthy = false;
    if (change === "structural") f.state.structuralHealthy = false;
    if (change === "capacity") f.config.media.capacity.ownerBytes++;
    if (change === "snapshot") f.state.snapshot.coreDigest = "0".repeat(64);
    if (change === "schema") f.dependencies.makeSchemaStore = () => ({ assertSchema: async () => { throw new Error("private schema mismatch"); } });
    await assert.rejects(main(args("restore"), {}, f.dependencies), (error) => error instanceof BackupCliError);
    assert.deepEqual(mutations(f), []); assert.deepEqual(f.output, []);
  }
});

test("snapshot drift during verification prevents a manifest or any recovery mutation", async () => {
  for (const command of ["prepare", "restore"]) {
    const f = fixture({ source: command === "prepare" }), capture = f.snapshots.captureBackupSnapshot;
    f.snapshots.captureBackupSnapshot = async () => { if (f.state.captures === 1) f.state.snapshot.coreDigest = "0".repeat(64); return capture(); };
    await assert.rejects(main(args(command), {}, f.dependencies), errorCode("BACKUP_OPERATION"));
    assert.deepEqual(mutations(f), []); assert.equal(f.events.some((item) => item[0] === "manifest-write"), false);
  }
});

test("manifest verification and authoritative database identity failures precede operations", async () => {
  const f = fixture(); f.manifests.verifyBackupManifest = () => { throw new Error("wrong private key"); };
  await assert.rejects(main(args("restore"), {}, f.dependencies), errorCode("BACKUP_OPERATION")); assert.equal(f.events.includes("pool"), false);
  const other = fixture(); other.dependencies.makeSnapshotStore = () => ({ databaseName: async () => "unexpected_database" });
  await assert.rejects(main(args("restore"), {}, other.dependencies), errorCode("BACKUP_CONFIG")); assert.deepEqual(mutations(other), []);
});

test("abort, invalid final clock and pool close failure reject neutrally without success output", async () => {
  const controller = new AbortController(); controller.abort(); const aborted = fixture(); aborted.dependencies.signal = controller.signal;
  await assert.rejects(main(args("restore"), {}, aborted.dependencies), errorCode("BACKUP_ABORTED")); assert.deepEqual(aborted.events, []);
  const invalid = fixture(); invalid.dependencies.clock = () => NaN;
  await assert.rejects(main(args("restore"), {}, invalid.dependencies), errorCode("BACKUP_CONFIG")); assert.deepEqual(mutations(invalid), []);
  const failed = fixture(); failed.pool.end = async () => { throw new Error("SQL password private@example.invalid /private/path"); };
  await assert.rejects(main(args("verify"), {}, failed.dependencies), (error) => {
    assert.ok(errorCode("BACKUP_OPERATION")(error)); assert.doesNotMatch(error.message, /password|private@example|\/private\/path|SQL/); assert.equal(error.cause, undefined); return true;
  });
  assert.deepEqual(failed.output, []);
});

test("shared inventory limits are projected to the crypto verifier's supported limit names", async () => {
  const f = fixture(); f.dependencies.limits = { maxRows: 500, maxEntries: 600, maxIssues: 20 };
  await main(args("verify"), {}, f.dependencies);
  const options = f.events.find((item) => item[0] === "crypto")[1]; assert.deepEqual(options.limits, { maxRows: 500, maxIssues: 20 });
});

test("schema inspection uses its separate pool and closes both pools even if one closure fails", async () => {
  const f = fixture(); await main(args("verify"), {}, f.dependencies);
  assert.ok(f.events.indexOf("inspection-pool") > f.events.indexOf("schema"));
  const options = f.events.find((item) => item[0] === "snapshot-store")[1];
  assert.equal(options.pool, f.pool); assert.equal(options.inspectionPool, f.inspectionPool); assert.notEqual(options.pool, options.inspectionPool);
  const failed = fixture(); failed.inspectionPool.end = async () => { failed.events.push("inspection-end-failed"); throw new Error("private inspection password"); };
  await assert.rejects(main(args("verify"), {}, failed.dependencies), errorCode("BACKUP_OPERATION"));
  assert.ok(failed.events.includes("pool-end")); assert.ok(failed.events.includes("inspection-end-failed")); assert.deepEqual(failed.output, []);
  const shared = fixture(); shared.dependencies.createInspectionPool = async () => shared.pool;
  await assert.rejects(main(args("verify"), {}, shared.dependencies), errorCode("BACKUP_CONFIG"));
  assert.equal(shared.state.captures, 0); assert.equal(shared.events.filter((item) => item === "pool-end").length, 1);
});

test("the real broadcast backup configuration forwards the same six keys and refuses disabled broadcasts before opening SQL", async () => {
  const env = await loadRuntimeBroadcastEnvironment("/private/synthetic-crm", CRM_RUNTIME_OPTIONS, { readBundle: async () => crmBundle() });
  const f = fixture({ source: true });
  f.config.databaseName = env.JESSIEMESSAGE_DB_NAME;
  f.config.media.capacity = { ownerBytes: Number(env.JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES), totalBytes: Number(env.JESSIEMESSAGE_MEDIA_TOTAL_BYTES) };
  const create = f.manifests.createBackupManifest;
  f.manifests.createBackupManifest = value => ({ ...create(value), version: 9, profile: value.profile });
  assert.equal((await main([...args("prepare"), "--profile", "photos-notify-recovery-crm-broadcast"], env, { ...f.dependencies, configure: undefined })).prepared, true);
  const crypto = f.events.find(event => Array.isArray(event) && event[0] === "crypto")[1];
  assert.deepEqual(Object.keys(crypto.keys).sort(), ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey", "crmKey"].sort());
  assert.equal(crypto.keys.crmKey.toString("base64url"), env.JESSIEMESSAGE_CRM_KEY); assert.equal(f.state.manifest.profile, "messaging-photos-notify-recovery-crm-broadcast");
  for (const override of [{ JESSIEMESSAGE_ENABLE_CRM: "0" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "0" },
    { JESSIEMESSAGE_CRM_KEY: "" }, { JESSIEMESSAGE_CRM_KEY: env.JESSIEMESSAGE_MESSAGE_KEY }]) {
    let opened = false;
    await assert.rejects(main([...args("prepare"), "--profile", "photos-notify-recovery-crm-broadcast"], { ...env, ...override }, {
      createPool: async () => { opened = true; assert.fail("Invalid profile cannot reach SQL"); },
    }));
    assert.equal(opened, false);
  }
});
