import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { BackupManifestError, createBackupManifest, verifyBackupManifest, manifestHash, readManifest, writeManifest } from "../server/backup/manifest.mjs";

const profile = "messaging-photos-notify-application";
const names = ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey"];
const keys = () => Object.fromEntries(names.map((name) => [name, randomBytes(32)]));
const snapshot = () => ({ version: 2, coverage: { ...APPLICATION_COVERAGE }, schemaDigest: "7".repeat(64), coreDigest: "8".repeat(64),
  counts: { tables: 33, rows: 0 }, objects: [], assets: [] });
const input = () => ({ profile, snapshot: snapshot(), now: 1792240000000, keys: keys(), identity: {
  databaseTag: "1".repeat(64), rootPathTag: "2".repeat(64), rootPhysicalTag: "3".repeat(64),
  rootFingerprint: "4".repeat(64), rootAncestors: ["5".repeat(64)] } });
const copy = (value) => JSON.parse(JSON.stringify(value));
const invalid = (error) => error instanceof BackupManifestError && error.code === "BACKUP_MANIFEST_INVALID"
  && error.message === "Private backup manifest operation failed." && error.cause === undefined;
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, sorted(value[name])])) : value;
function resign(manifest, key) {
  manifest.signature = createHmac("sha256", key).update("jessiemessage:backup-manifest-signature:v1:\0", "ascii")
    .update(JSON.stringify(sorted({ version: manifest.version, profile: manifest.profile, payload: manifest.payload }))).digest("hex");
  return manifest;
}

test("application manifests use a distinct v4 envelope and authenticate the exact limited coverage with all five keys", () => {
  const value = input(), manifest = createBackupManifest(value);
  assert.equal(manifest.version, 4); assert.equal(manifest.profile, profile);
  assert.deepEqual(verifyBackupManifest({ manifest, keys: value.keys }).snapshot, value.snapshot);
  assert.deepEqual(Object.keys(manifest.payload.canaries).sort(), [...names].sort());
  assert.equal(manifest.payload.snapshot.coverage.completeDatabase, false);
  assert.equal(manifest.payload.snapshot.coverage.executableInventory, "unproven");
  for (const name of names) {
    assert.throws(() => verifyBackupManifest({ manifest, keys: { ...value.keys, [name]: randomBytes(32) } }), invalid);
  }
  assert.throws(() => createBackupManifest({ ...value, keys: { ...value.keys, crmKey: randomBytes(32) } }), invalid);
  value.snapshot.coverage.completeDatabase = true;
  assert.equal(manifest.payload.snapshot.coverage.completeDatabase, false);
});

test("authenticated schema30 application manifests retain their historical coverage without becoming schema31", () => {
  const value = input(); value.snapshot.coverage.tables = 30; value.snapshot.counts.tables = 30;
  const manifest = createBackupManifest(value);
  assert.deepEqual(verifyBackupManifest({ manifest, keys: value.keys }).snapshot, value.snapshot);
  assert.equal(manifest.payload.snapshot.coverage.tables, 30);
  for (const count of [31, 32]) {
    value.snapshot.counts.tables = count;
    assert.throws(() => createBackupManifest(value), invalid);
  }
  value.snapshot.coverage.tables = 31; value.snapshot.counts.tables = 30;
  assert.throws(() => createBackupManifest(value), invalid);
});

test("authenticated schema31/32 application manifests retain their exact historical coverage after schema33", () => {
  for (const historical of [31, 32]) {
    const value = input(); value.snapshot.coverage.tables = historical; value.snapshot.counts.tables = historical;
    const manifest = createBackupManifest(value), original = copy(manifest);
    const restored = verifyBackupManifest({ manifest, keys: value.keys });
    assert.equal(restored.snapshot.coverage.tables, historical); assert.equal(restored.snapshot.counts.tables, historical);
    assert.deepEqual(manifest, original);
    value.snapshot.coverage.tables = 33;
    assert.throws(() => createBackupManifest(value), invalid, "the old snapshot cannot be relabeled with the current coverage");
  }
});

test("application manifests refuse absent, overstated or incomplete coverage and any unsupported or mismatched schema coverage", () => {
  const mutations = [
    (s) => { s.version = 1; }, (s) => { s.counts.tables = 29; }, (s) => { delete s.counts; },
    (s) => { delete s.coverage; }, (s) => { s.coverage.tables = 29; },
    (s) => { s.coverage.completeDatabase = true; }, (s) => { s.coverage.executableObjects = "included"; },
    (s) => { s.coverage.executableInventory = "proven"; }, (s) => { s.coverage.encryptedMedia = false; },
    (s) => { s.coverage.scope = "database"; }, (s) => { s.coverage.extra = true; },
  ];
  for (const mutate of mutations) {
    const value = input(); mutate(value.snapshot);
    assert.throws(() => createBackupManifest(value), invalid);
  }
  let getterRead = false;
  const value = input(); Object.defineProperty(value.snapshot.coverage, "completeDatabase", {
    enumerable: true, get() { getterRead = true; return false; } });
  assert.throws(() => createBackupManifest(value), invalid); assert.equal(getterRead, false);
});

test("limited snapshots cannot be labeled with a legacy complete-backup profile", () => {
  const value = input();
  for (const oldProfile of ["full", "messaging-photos", "messaging-photos-notify", "full-notify"]) {
    const oldKeys = oldProfile === "messaging-photos" ? Object.fromEntries(Object.entries(value.keys).filter(([name]) => name !== "notificationKey"))
      : oldProfile === "full" ? { ...Object.fromEntries(Object.entries(value.keys).filter(([name]) => name !== "notificationKey")), crmKey: randomBytes(32) }
        : oldProfile === "full-notify" ? { ...value.keys, crmKey: randomBytes(32) } : value.keys;
    assert.throws(() => createBackupManifest({ ...value, profile: oldProfile, keys: oldKeys }), invalid);
    const withOldVersion = copy(value.snapshot); withOldVersion.version = 1;
    assert.throws(() => createBackupManifest({ ...value, profile: oldProfile, keys: oldKeys, snapshot: withOldVersion }), invalid);
  }
});

test("profile or coverage downgrades fail even when the media signing key can recompute the outer signature", () => {
  const value = input(), manifest = createBackupManifest(value);
  for (const mutate of [
    (m) => { m.version = 3; }, (m) => { m.profile = "messaging-photos-notify"; },
    (m) => { m.version = 3; m.profile = "messaging-photos-notify"; },
    (m) => { m.payload.snapshot.coverage.completeDatabase = true; },
    (m) => { m.payload.snapshot.counts.rows = 1; },
    (m) => { m.version = 3; m.profile = "messaging-photos-notify"; m.payload.snapshot.version = 1; delete m.payload.snapshot.coverage; },
  ]) {
    const changed = copy(manifest); mutate(changed);
    assert.throws(() => verifyBackupManifest({ manifest: changed, keys: value.keys }), invalid);
    assert.throws(() => verifyBackupManifest({ manifest: resign(changed, value.keys.mediaKey), keys: value.keys }), invalid);
  }
  const oldSnapshot = copy(value.snapshot); oldSnapshot.version = 1; delete oldSnapshot.coverage;
  const old = createBackupManifest({ ...value, profile: "messaging-photos-notify", snapshot: oldSnapshot });
  assert.equal(old.version, 3); assert.deepEqual(verifyBackupManifest({ manifest: old, keys: value.keys }).snapshot, oldSnapshot);
  old.version = 4; old.profile = profile; old.payload.snapshot = snapshot();
  assert.throws(() => verifyBackupManifest({ manifest: resign(old, value.keys.mediaKey), keys: value.keys }), invalid);
});

test("v4 manifests retain exclusive private canonical publication and stable authenticated readback", async (t) => {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "application-manifest-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const value = input(), manifest = createBackupManifest(value), filename = join(directory, "manifest.json");
  await writeManifest(filename, manifest);
  const loaded = await readManifest(filename);
  assert.equal(manifestHash(loaded), manifestHash(manifest));
  assert.deepEqual(verifyBackupManifest({ manifest: loaded, keys: value.keys }).snapshot.coverage, APPLICATION_COVERAGE);
  await assert.rejects(writeManifest(filename, manifest), { code: "BACKUP_MANIFEST_UNAVAILABLE" });
});
