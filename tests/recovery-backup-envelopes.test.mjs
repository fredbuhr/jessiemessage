import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { BackupManifestError, createBackupManifest, verifyBackupManifest, manifestHash, readManifest, writeManifest } from "../server/backup/manifest.mjs";
import { CheckpointReceiptError, readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";

const names = ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey"];
const profiles = [
  { profile: "messaging-photos-notify-recovery-crm-broadcast", version: 9, receiptVersion: 7, legacyVersion: 7, legacyProfile: "messaging-photos-notify-recovery-crm", application: false, crm: true, broadcast: true },
  { profile: "messaging-photos-notify-recovery-crm-broadcast-application", version: 10, receiptVersion: 8, legacyVersion: 8, legacyProfile: "messaging-photos-notify-recovery-crm-application", application: true, crm: true, broadcast: true },
  { profile: "messaging-photos-notify-recovery", version: 5, receiptVersion: 3, legacyVersion: 3, legacyProfile: "messaging-photos-notify", application: false },
  { profile: "messaging-photos-notify-recovery-application", version: 6, receiptVersion: 4, legacyVersion: 4, legacyProfile: "messaging-photos-notify-application", application: true },
  { profile: "messaging-photos-notify-recovery-crm", version: 7, receiptVersion: 5, legacyVersion: 5, legacyProfile: "messaging-photos-notify-recovery", application: false, crm: true },
  { profile: "messaging-photos-notify-recovery-crm-application", version: 8, receiptVersion: 6, legacyVersion: 6, legacyProfile: "messaging-photos-notify-recovery-application", application: true, crm: true },
];
const keyNames = spec => [...names, ...(spec.crm ? ["crmKey"] : [])];
const copy = (value) => JSON.parse(JSON.stringify(value));
const invalidManifest = (error) => error instanceof BackupManifestError && error.code === "BACKUP_MANIFEST_INVALID";
const invalidReceipt = (error) => error instanceof CheckpointReceiptError && error.code === "CHECKPOINT_RECEIPT_INVALID";
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, sorted(value[name])])) : value;
function resign(manifest, key) {
  manifest.signature = createHmac("sha256", key).update("jessiemessage:backup-manifest-signature:v1:\0", "ascii")
    .update(JSON.stringify(sorted({ version: manifest.version, profile: manifest.profile, payload: manifest.payload }))).digest("hex");
  return manifest;
}
function input(spec) {
  return { profile: spec.profile, now: 1792240000000, keys: Object.fromEntries(keyNames(spec).map((name) => [name, randomBytes(32)])),
    identity: { databaseTag: "1".repeat(64), rootPathTag: "2".repeat(64), rootPhysicalTag: "3".repeat(64), rootFingerprint: "4".repeat(64), rootAncestors: ["5".repeat(64)] },
    snapshot: { version: spec.application ? 2 : 1, ...(spec.application ? { coverage: { ...APPLICATION_COVERAGE } } : {}),
      schemaDigest: "7".repeat(64), coreDigest: "8".repeat(64), counts: { tables: 31, rows: 0 }, objects: [], assets: [] } };
}
async function fixture(t) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "recovery-envelope-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, filename: join(directory, "manifest.json"), scope: { file: (name) => join(directory, name), assertReady: async () => lstat(directory), sync: async () => {} } };
}

for (const spec of profiles) {
  test(`recovery manifest v${spec.version} authenticates exactly ${keyNames(spec).length} keys and preserves its snapshot scope`, () => {
    const value = input(spec), manifest = createBackupManifest(value);
    assert.equal(manifest.version, spec.version); assert.equal(manifest.profile, spec.profile);
    assert.deepEqual(verifyBackupManifest({ manifest, keys: value.keys }).snapshot, value.snapshot);
    assert.deepEqual(Object.keys(manifest.payload.canaries).sort(), keyNames(spec).sort());
    for (const name of keyNames(spec)) {
      assert.throws(() => verifyBackupManifest({ manifest, keys: { ...value.keys, [name]: randomBytes(32) } }), invalidManifest);
    }
    assert.throws(() => createBackupManifest({ ...value, keys: { ...value.keys, unrelatedKey: randomBytes(32) } }), invalidManifest);
    const wrongScope = { ...value.keys };
    if (spec.crm) delete wrongScope.crmKey; else wrongScope.crmKey = randomBytes(32);
    assert.throws(() => createBackupManifest({ ...value, keys: wrongScope }), invalidManifest);
    const missingMail = { ...value.keys }; delete missingMail.mailKey;
    assert.throws(() => createBackupManifest({ ...value, keys: missingMail }), invalidManifest);
    if (spec.application) {
      assert.deepEqual(manifest.payload.snapshot.coverage, APPLICATION_COVERAGE);
      for (const change of [s => { delete s.coverage; }, s => { s.coverage.completeDatabase = true; }, s => { s.counts.tables = 29; }, s => { s.version = 1; }]) {
        const changed = copy(value.snapshot); change(changed);
        assert.throws(() => createBackupManifest({ ...value, snapshot: changed }), invalidManifest);
      }
    } else {
      const changed = { ...value.snapshot, version: 2, coverage: { ...APPLICATION_COVERAGE } };
      assert.throws(() => createBackupManifest({ ...value, snapshot: changed }), invalidManifest);
    }
  });

  test(`recovery v${spec.version} and legacy v${spec.legacyVersion} cannot be relabeled, including with the media signing key`, () => {
    const value = input(spec), recovery = createBackupManifest(value);
    const legacyKeys = Object.fromEntries(Object.entries(value.keys).filter(([name]) => spec.broadcast || name !== "crmKey"));
    const legacy = createBackupManifest({ ...value, keys: legacyKeys, profile: spec.legacyProfile });
    assert.equal(legacy.version, spec.legacyVersion);
    for (const [original, version, profile] of [[recovery, spec.legacyVersion, spec.legacyProfile], [legacy, spec.version, spec.profile]]) {
      for (const change of [{ version }, { profile }, { version, profile }]) {
        const changed = { ...copy(original), ...change };
        assert.throws(() => verifyBackupManifest({ manifest: changed, keys: value.keys }), invalidManifest);
        assert.throws(() => verifyBackupManifest({ manifest: resign(changed, value.keys.mediaKey), keys: value.keys }), invalidManifest);
      }
    }
    const changed = copy(recovery); changed.payload.canaries.mailKey = legacy.payload.canaries.mailKey;
    assert.throws(() => verifyBackupManifest({ manifest: resign(changed, value.keys.mediaKey), keys: value.keys }), invalidManifest);
    assert.deepEqual(verifyBackupManifest({ manifest: legacy, keys: legacyKeys }).snapshot, value.snapshot);
  });

  test(`recovery manifest v${spec.version} and receipt v${spec.receiptVersion} publish exact private canonical bytes`, async (t) => {
    const f = await fixture(t), value = input(spec), manifest = createBackupManifest(value);
    await writeManifest(f.filename, manifest);
    const loaded = await readManifest(f.filename);
    assert.equal(manifestHash(loaded), manifestHash(manifest));
    assert.deepEqual(verifyBackupManifest({ manifest: loaded, keys: value.keys }).snapshot, value.snapshot);
    const raw = await readFile(f.filename);
    const receipt = { format: "jessiemessage-private-checkpoint", version: spec.receiptVersion, profile: spec.profile,
      ...(spec.application ? { coverage: { ...APPLICATION_COVERAGE } } : {}), createdAt: value.now,
      schema: { tables: 31, migrations: 31 },
      sql: { file: "database.sql.gz", bytes: 120, sha256: "b".repeat(64), uncompressedBytes: 700, uncompressedSha256: "c".repeat(64) },
      manifest: { file: "manifest.json", sha256: createHash("sha256").update(raw).digest("hex") }, media: { files: [], bytes: 0 } };
    assert.deepEqual(await writeCheckpointReceipt(f.scope, receipt), receipt);
    assert.deepEqual(await readCheckpointReceipt(f.scope), receipt);
    assert.equal(await readFile(join(f.directory, "receipt.json"), "utf8"), `${JSON.stringify(receipt)}\n`);
    assert.equal((await lstat(join(f.directory, "receipt.json"))).mode & 0o7777, 0o600);
    await writeFile(f.filename, `${raw.toString("utf8")} `, { mode: 0o600 });
    await assert.rejects(readCheckpointReceipt(f.scope), invalidReceipt);
  });

  test(`recovery receipt v${spec.receiptVersion} rejects ambiguous versions, profiles and coverage`, async (t) => {
    const f = await fixture(t); await writeFile(f.filename, "synthetic", { mode: 0o600 });
    const receipt = { format: "jessiemessage-private-checkpoint", version: spec.receiptVersion, profile: spec.profile,
      ...(spec.application ? { coverage: { ...APPLICATION_COVERAGE } } : {}), createdAt: 1792240000000,
      schema: { tables: 31, migrations: 31 }, sql: { file: "database.sql.gz", bytes: 120, sha256: "b".repeat(64), uncompressedBytes: 700, uncompressedSha256: "c".repeat(64) },
      manifest: { file: "manifest.json", sha256: createHash("sha256").update("synthetic").digest("hex") }, media: { files: [], bytes: 0 } };
    for (const change of [v => { v.version = spec.application ? 2 : 1; }, v => { v.profile = spec.legacyProfile; },
      v => { v.version = 99; }, v => { v.extra = true; }, v => { v.schema.tables = 29; },
      v => { if (spec.application) delete v.coverage; else v.coverage = { ...APPLICATION_COVERAGE }; },
      v => { if (spec.application) v.coverage.executableInventory = "proven"; else v.version = 4; }]) {
      const changed = copy(receipt); change(changed);
      await assert.rejects(writeCheckpointReceipt(f.scope, changed), invalidReceipt);
    }
  });
}
