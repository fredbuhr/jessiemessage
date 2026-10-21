import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { sealSubscription, endpointDigest } from "../server/notifications/crypto.mjs";
import { createBackupCryptoStore } from "../server/backup/crypto-store.mjs";
import { verifyBackupData, verifyTextBackupData, verifyPhotoBackupData, verifyPhotoNotificationBackupData, verifyFullNotificationBackupData } from "../server/backup/verify.mjs";
import { createBackupManifest, verifyBackupManifest } from "../server/backup/manifest.mjs";

const id = number => { const value = Buffer.alloc(16); value.writeUInt32BE(number, 12); return value; };
const names = ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey"];
function fixture() {
  const keys = Object.fromEntries(names.map(name => [name, randomBytes(32)]));
  const curve = createECDH("prime256v1"); curve.generateKeys();
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-private-restored-endpoint", expirationTime: null,
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  const binding = { subscriptionId: id(3), userId: id(2), generation: 2 };
  const rows = { push_subscriptions: [{ id: binding.subscriptionId, user_id: binding.userId, role: "client", user_role: "client",
    session_id: id(4), session_user_id: binding.userId, credential_version: 1, generation: binding.generation,
    endpoint_digest: endpointDigest(subscription.endpoint, keys.notificationKey), encrypted: sealSubscription(subscription, keys.notificationKey, binding) }],
  push_outbox: [{ id: id(5), subscription_generation: 1, generation: 2, user_id: id(2), role: "client",
    sender_id: id(1), sender_role: "admin", admin_id: id(1), client_id: id(2) }] };
  const calls = []; let released = 0;
  const pool = { getConnection: async () => ({ query: async (sql, parameters = []) => {
    assert.match(sql, /^SELECT\s/); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FOR UPDATE)\b/);
    calls.push({ sql, parameters }); const table = /\bFROM ([a-z_]+)/.exec(sql)?.[1];
    if (sql.startsWith("SELECT EXISTS")) return [{ present: rows[table]?.length ? 1 : 0 }];
    return (rows[table] ?? []).filter(row => parameters.length === 1 || Buffer.compare(row.id, parameters[0]) > 0).slice(0, parameters.at(-1));
  }, release() { released++; } }) };
  const storage = { async get() { assert.fail("this metadata-only fixture has no media to read"); } };
  return { keys, subscription, binding, rows, calls, pool, storage, options: { keys, pool, storage }, released: () => released };
}

test("notification backup authenticates encrypted subscriptions and obsolete delivery generations without workers or plaintext output", async () => {
  const f = fixture(), original = Buffer.from(f.keys.notificationKey), report = await verifyPhotoNotificationBackupData(f.options);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.equal(report.counts.notifications, 1); assert.equal(report.counts.notificationJobs, 1); assert.equal(report.counts.rows, 2);
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith("SELECT EXISTS")).length, 10);
  assert.equal(f.released(), 7); assert.deepEqual(f.keys.notificationKey, original);
  for (const value of [f.subscription.endpoint, f.subscription.keys.p256dh, f.subscription.keys.auth,
    f.rows.push_subscriptions[0].encrypted, ...Object.values(f.keys).map(key => key.toString("base64url"))]) assert.equal(JSON.stringify(report).includes(value), false);
});

test("wrong notification key, AAD, endpoint digest or session owner cannot authenticate a restored subscription", async () => {
  for (const change of ["key", "tag", "id", "owner", "generation", "digest", "session", "role"]) {
    const f = fixture(), row = f.rows.push_subscriptions[0];
    if (change === "key") f.options.keys = { ...f.keys, notificationKey: randomBytes(32) };
    if (change === "tag") { const parts = row.encrypted.split("."), tag = Buffer.from(parts[3], "base64url"); tag[0] ^= 1; parts[3] = tag.toString("base64url"); row.encrypted = parts.join("."); }
    if (change === "id") row.id = id(9);
    if (change === "owner") row.user_id = row.session_user_id = id(9);
    if (change === "generation") row.generation++;
    if (change === "digest") row.endpoint_digest = randomBytes(32);
    if (change === "session") row.session_user_id = id(9);
    if (change === "role") row.user_role = "admin";
    const report = await verifyPhotoNotificationBackupData(f.options);
    assert.equal(report.healthy, false, change); assert.ok(report.issues.some(issue => issue.purpose === "notifications"), change);
  }
});

test("delivery references must target the opposite conversation participant and never a future subscription generation", async () => {
  for (const change of [{ subscription_generation: 3 }, { user_id: id(9) }, { role: "admin" }, { sender_id: id(9) }, { client_id: id(9) }]) {
    const f = fixture(); Object.assign(f.rows.push_outbox[0], change);
    const report = await verifyPhotoNotificationBackupData(f.options);
    assert.equal(report.healthy, false); assert.ok(report.issues.some(issue => issue.purpose === "notificationJobs" && issue.code === "binding_mismatch"));
  }
});

test("every older profile refuses either populated notification table instead of silently omitting its encryption domain", async () => {
  for (const table of ["push_subscriptions", "push_outbox"]) {
    for (const profile of ["text", "photos", "full"]) {
      const f = fixture(); for (const other of ["push_subscriptions", "push_outbox"]) if (other !== table) f.rows[other] = [];
      const keys = { ...f.keys }; delete keys.notificationKey;
      const report = profile === "text" ? await verifyTextBackupData({ pool: f.pool, keys: Object.fromEntries(Object.entries(keys).slice(0, 3)) })
        : profile === "photos" ? await verifyPhotoBackupData({ ...f.options, keys })
          : await verifyBackupData({ store: createBackupCryptoStore({ pool: f.pool }), storage: f.storage, keys: { ...keys, crmKey: randomBytes(32) } });
      assert.equal(report.healthy, false, `${profile}/${table}`);
      assert.ok(report.issues.some(issue => issue.code === "inactive_domain_populated"), `${profile}/${table}`);
    }
  }
});

test("notification verification preserves bounded keyset traversal and stops at the cumulative row limit", async () => {
  const f = fixture(), prototype = f.rows.push_subscriptions[0]; f.rows.push_outbox = [];
  f.rows.push_subscriptions = Array.from({ length: 105 }, (_, index) => {
    const subscriptionId = id(index + 100), subscription = { ...f.subscription, endpoint: `${f.subscription.endpoint}-${index}` };
    return { ...prototype, id: subscriptionId, endpoint_digest: endpointDigest(subscription.endpoint, f.keys.notificationKey),
      encrypted: sealSubscription(subscription, f.keys.notificationKey, { ...f.binding, subscriptionId }) };
  });
  const report = await verifyPhotoNotificationBackupData(f.options);
  assert.equal(report.healthy, true); assert.equal(report.counts.notifications, 105);
  const pages = f.calls.filter(({ sql }) => sql.includes("FROM push_subscriptions p")); assert.equal(pages.length, 3);
  assert.deepEqual(pages[1].parameters, [id(149), 51]); assert.deepEqual(pages[2].parameters, [id(199), 51]);
  const limited = await verifyPhotoNotificationBackupData({ ...f.options, limits: { maxRows: 1 } });
  assert.equal(limited.complete, false); assert.equal(limited.counts.rows, 1); assert.ok(limited.issues.some(issue => issue.code === "row_limit"));
});

test("manifest v3 explicitly binds five photo notification keys or six full notification keys", async () => {
  const f = fixture(), snapshot = { counts: { tables: 30, rows: 2 } }, identity = { databaseTag: "1".repeat(64), rootPathTag: "2".repeat(64),
    rootPhysicalTag: "3".repeat(64), rootFingerprint: "4".repeat(64), rootAncestors: ["5".repeat(64)] };
  for (const profile of ["messaging-photos-notify", "full-notify"]) {
    const keys = { ...f.keys, ...(profile === "full-notify" ? { crmKey: randomBytes(32) } : {}) };
    const manifest = createBackupManifest({ snapshot, identity, keys, now: 1792140000000, profile });
    assert.equal(manifest.version, 3); assert.equal(manifest.profile, profile);
    assert.deepEqual(Object.keys(verifyBackupManifest({ manifest, keys }).canaries).sort(), Object.keys(keys).sort());
    for (const name of Object.keys(keys)) assert.throws(() => verifyBackupManifest({ manifest, keys: { ...keys, [name]: randomBytes(32) } }));
    for (const change of [{ version: 2 }, { version: 1 }, { profile: "messaging-photos" }, { profile: profile === "full-notify" ? "messaging-photos-notify" : "full-notify" }]) {
      assert.throws(() => verifyBackupManifest({ manifest: { ...manifest, ...change }, keys }));
    }
    const { notificationKey, ...olderKeys } = keys; assert.throws(() => verifyBackupManifest({ manifest, keys: olderKeys }));
    if (profile === "full-notify") {
      const report = await verifyFullNotificationBackupData({ store: createBackupCryptoStore({ pool: f.pool }), storage: f.storage, keys });
      assert.equal(report.healthy, true); assert.equal(report.counts.notifications, 1);
    }
  }
});
