import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createdMigrationTables } from "../server/db/migrations.mjs";
import { createBackupSnapshotStore, captureBackupSnapshot, assertBackupSnapshot } from "../server/backup/snapshot.mjs";
import { APPLICATION_COVERAGE, VIDEO_APPLICATION_COVERAGE, validateApplicationCoverage, validateVideoApplicationCoverage, assertApplicationTableInspection, assertVideoApplicationTableInspection } from "../server/backup/application-scope.mjs";
import { checkpointBackupProfile, photoBackupProfile, checkpointReceiptVersion, matchesCheckpointReceipt } from "../server/backup/profiles.mjs";
import { backupIdentity, assertCloneIdentity, createBackupManifest, verifyBackupManifest } from "../server/backup/manifest.mjs";
import { readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { videoStoredBytes, createVideoStorage } from "../server/video/storage.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";

const d = "2026-10-22 00:00:00.000000", later = "2026-10-22 00:01:00.000000";
const h = (digit, size = 32) => digit.repeat(size * 2);
const profile = "messaging-photos-notify-recovery-crm-broadcast-video-application";
const runtime = "photos-notify-recovery-crm-broadcast-video";
const keys = () => Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey", "notificationKey", "videoKey"].map((name, index) => [name, Buffer.alloc(32, index + 1)]));
const clone = value => structuredClone(value);
const base = path.resolve(new URL("../../audit/", import.meta.url).pathname);
const asset = (id, state = "committed") => ({ id: h(id, 16), owner_id: h("e", 16), owner_role: "admin", storage_key: h(id),
  reserve_token_hash: h("f"), content_digest: state === "reserved" ? null : h("a"), bytes: 300000,
  stored_bytes: videoStoredBytes(300000), mime: "video/mp4", state, created_at: d, updated_at: d, released_at: null });
function snapshot() {
  const assets = [asset("1"), asset("2", "reserved"), asset("3", "cleanup_pending")];
  return { version: 3, coverage: { ...VIDEO_APPLICATION_COVERAGE }, schemaDigest: h("7"), coreDigest: h("8"), counts: { tables: 36, rows: 9 },
    capacity: { ownerBytes: 1000000, totalBytes: 10000000, heldBytes: 0, rootFingerprint: h("4"), initializedAt: d }, objects: [], assets: [],
    video: { capacity: { ownerBytes: 1000000, totalBytes: 10000000, heldBytes: assets.reduce((sum, row) => sum + row.stored_bytes, 0), rootFingerprint: h("5"), initializedAt: d }, assets } };
}
const identity = () => ({ databaseTag: h("1"), rootPathTag: h("2"), rootPhysicalTag: h("3"), rootFingerprint: h("4"), rootAncestors: [h("6")],
  video: { databaseTag: h("1"), rootPathTag: h("7"), rootPhysicalTag: h("8"), rootFingerprint: h("5"), rootAncestors: [h("6")] } });

test("video application scope has an explicit profile and preserves historical versions and coverage", async () => {
  const selected = checkpointBackupProfile(runtime, true);
  assert.equal(selected.manifestProfile, profile); assert.equal(selected.manifestVersion, 11); assert.equal(selected.video, true);
  assert.equal(checkpointBackupProfile(runtime, false), null);
  assert.equal(checkpointReceiptVersion(selected), 11); assert.equal(checkpointReceiptVersion(selected, true), 12);
  const old = photoBackupProfile("photos-notify-recovery-crm-broadcast-application");
  assert.equal(old.manifestVersion, 10); assert.equal(checkpointReceiptVersion(old), 8); assert.equal(checkpointReceiptVersion(old, true), 10);
  assert.equal(old.video, undefined);
  assert.deepEqual(validateVideoApplicationCoverage(VIDEO_APPLICATION_COVERAGE), VIDEO_APPLICATION_COVERAGE);
  assert.throws(() => validateApplicationCoverage(VIDEO_APPLICATION_COVERAGE));
  for (const invalid of [APPLICATION_COVERAGE, { ...VIDEO_APPLICATION_COVERAGE, tables: 35 }, { ...VIDEO_APPLICATION_COVERAGE, completeDatabase: true }, { ...VIDEO_APPLICATION_COVERAGE, encryptedVideo: false }]) assert.throws(() => validateVideoApplicationCoverage(invalid));
  const migrations = await loadVideoMigrations(), names = [...createdMigrationTables(migrations), "schema_migrations"].sort();
  const queries = [], connection = { async query(sql) { queries.push(sql); return sql === "SELECT DATABASE() AS name" ? [{ name: "video_test" }] : names.map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB" })); } };
  assert.equal(await assertVideoApplicationTableInspection(connection, "video_test"), true); assert.equal(names.length, 36);
  assert.match(queries.at(-1), /LIMIT 37$/); assert.doesNotMatch(queries.join(" "), /TRIGGERS|EVENTS|ROUTINES/);
  await assert.rejects(assertApplicationTableInspection(connection, "video_test"), { code: "BACKUP_APPLICATION_SCOPE" });
});

async function captureFixture() {
  const migrations = await loadVideoMigrations(), names = [...createdMigrationTables(migrations), "schema_migrations"].sort();
  const definitions = migrations.filter(({ sql }) => /^CREATE\s+TABLE\s/i.test(sql.trim())).map(({ sql }) => ({
    name: /^CREATE\s+TABLE\s+([a-z_]+)/i.exec(sql.trim())[1], primary: /PRIMARY KEY\s*\(([a-z_, ]+)\)/i.exec(sql)[1].split(",").map(value => value.trim()),
  })).concat({ name: "schema_migrations", primary: ["version"] });
  const columns = definitions.flatMap(({ name, primary }) => primary.map((column, index) => ({ table_name: name, name: column,
    type: "varbinary(16)", nullable: "NO", default_value: null, extra: "", collation: null, position: index + 1 })));
  for (const table of ["media_storage_state", "video_storage_state"]) for (const [name, type] of [["owner_bytes", "bigint unsigned"], ["total_bytes", "bigint unsigned"], ["held_bytes", "bigint unsigned"], ["root_fingerprint", "varbinary(32)"], ["initialized_at", "datetime(6)"]]) columns.push({ table_name: table, name, type, nullable: "NO", default_value: null, extra: "", collation: null, position: columns.filter(row => row.table_name === table).length + 1 });
  const state = { snapshot: snapshot(), core: 1 }, queries = [];
  const connection = { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT DATABASE() AS name") return [{ name: "video_test" }];
    for (const table of ["media_storage_state", "video_storage_state"]) if (sql.includes(` FROM ${table} `)) {
      const c = table.startsWith("media") ? state.snapshot.capacity : state.snapshot.video.capacity;
      return [{ id: 1, owner_bytes: c.ownerBytes, total_bytes: c.totalBytes, held_bytes: c.heldBytes, root_fingerprint: Buffer.from(c.rootFingerprint, "hex"), initialized_at: c.initializedAt }];
    }
    if (sql.includes(" FROM video_assets ")) return state.snapshot.video.assets.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ["id", "owner_id", "storage_key", "reserve_token_hash", "content_digest"].includes(key) && value !== null ? Buffer.from(value, "hex") : value])));
    if (sql.includes(" FROM schema_migrations ")) return [{ version: state.core }];
    return [];
  }, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
  const inspection = { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT DATABASE() AS name") return [{ name: "video_test" }];
    if (sql.includes("information_schema.TABLES")) return names.map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB", collation: "utf8mb4_unicode_ci" }));
    if (sql.includes("information_schema.COLUMNS")) return columns;
    return [];
  }, release() {} };
  return { state, queries, store: createBackupSnapshotStore({ pool: { getConnection: async () => connection }, inspectionPool: { getConnection: async () => inspection }, coverage: "application-tables", video: true }) };
}

test("video snapshot captures both catalogues in one consistent read and separates recoverable video state from core SQL", async () => {
  const f = await captureFixture(), before = await captureBackupSnapshot({ store: f.store });
  assert.equal(before.version, 3); assert.equal(before.counts.tables, 36); assert.deepEqual(before.video, f.state.snapshot.video);
  assert.doesNotMatch(f.queries.join(" "), /FOR UPDATE|SHOW GRANTS|TRIGGERS|EVENTS|ROUTINES/);
  for (const row of f.state.snapshot.video.assets.slice(1)) { row.state = "released"; row.updated_at = later; row.released_at = later; }
  f.state.snapshot.video.capacity.heldBytes = f.state.snapshot.video.assets[0].stored_bytes;
  f.state.snapshot.video.capacity.rootFingerprint = h("9");
  const restored = await captureBackupSnapshot({ store: f.store });
  assert.equal(before.coreDigest, restored.coreDigest); assert.equal(before.schemaDigest, restored.schemaDigest);
  assert.equal(assertBackupSnapshot({ expected: before, actual: restored, mode: "recovery", targetVideoFingerprint: h("9") }).videoHeldBytes, restored.video.capacity.heldBytes);
  assert.throws(() => assertBackupSnapshot({ expected: before, actual: restored, mode: "exact" }));
  f.state.core++;
  assert.notEqual((await captureBackupSnapshot({ store: f.store })).coreDigest, before.coreDigest);
});

test("video recovery rejects active mutation, invalid refunds, changed reservations and premature root rebind", () => {
  const expected = snapshot();
  assert.equal(assertBackupSnapshot({ expected, actual: clone(expected), mode: "recovery" }).videoCandidates.length, 2);
  for (const change of [s => { s.video.assets[0].content_digest = h("b"); }, s => { s.video.assets[1].reserve_token_hash = h("b"); },
    s => { s.video.capacity.heldBytes--; }, s => { s.video.capacity.rootFingerprint = h("9"); }, s => { s.video.assets[1].state = "committed"; s.video.assets[1].content_digest = h("c"); },
    s => { s.video.assets[2].state = "reserved"; s.video.assets[2].content_digest = null; }, s => { s.video.assets.pop(); }, s => { s.coverage.tables = 35; }]) {
    const changed = clone(expected); change(changed);
    assert.throws(() => assertBackupSnapshot({ expected, actual: changed, mode: "recovery", targetVideoFingerprint: h("9") }));
  }
  assert.throws(() => createBackupSnapshotStore({ pool: { getConnection() {} }, video: true }));
});

test("video manifests bind seven independent keys and both roots without accepting the new scope under an old profile", () => {
  const input = { keys: keys(), identity: identity(), snapshot: snapshot(), now: 1792627200000, profile };
  const manifest = createBackupManifest(input), payload = verifyBackupManifest({ manifest, keys: input.keys });
  assert.equal(manifest.version, 11); assert.deepEqual(Object.keys(payload.canaries).sort(), Object.keys(input.keys).sort());
  assert.deepEqual(payload.identity, input.identity); assert.deepEqual(payload.snapshot, input.snapshot);
  for (const name of Object.keys(input.keys)) assert.throws(() => verifyBackupManifest({ manifest, keys: { ...input.keys, [name]: Buffer.alloc(32, 12) } }));
  const six = { ...input.keys }; delete six.videoKey;
  assert.throws(() => createBackupManifest({ ...input, keys: six }));
  assert.throws(() => createBackupManifest({ ...input, keys: { ...input.keys, videoKey: input.keys.mediaKey } }));
  for (const change of [m => { m.payload.identity.video.rootFingerprint = h("b"); }, m => { m.payload.snapshot.video.assets[0].bytes++; }, m => { m.version = 10; }, m => { delete m.payload.identity.video; }]) {
    const altered = clone(manifest); change(altered); assert.throws(() => verifyBackupManifest({ manifest: altered, keys: input.keys }));
  }
  assert.throws(() => createBackupManifest({ ...input, profile: "messaging-photos-notify-recovery-crm-broadcast-application", keys: six }));
});

async function directories(t) {
  await mkdir(base, { recursive: true, mode: 0o700 }); const root = await mkdtemp(path.join(base, "video-backup-formats-"));
  await chmod(root, 0o700); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, async directory(name) { const value = path.join(root, name); await mkdir(value, { mode: 0o700 }); return value; } };
}

test("video clone identity checks all four physical roots and rejects aliases and nested crossings", async t => {
  const f = await directories(t), secrets = keys(), paths = await Promise.all(["source-photo", "source-video", "target-photo", "target-video"].map(name => f.directory(name)));
  const [sourcePhoto, targetPhoto] = await Promise.all([paths[0], paths[2]].map(root => createMediaStorage({ root, key: secrets.mediaKey, pathMode: "strict" })));
  const [sourceVideo, targetVideo] = await Promise.all([paths[1], paths[3]].map(root => createVideoStorage({ root, key: secrets.videoKey, pathMode: "strict" })));
  const source = await backupIdentity({ databaseName: "source_test", rootPath: paths[0], storage: sourcePhoto, mediaKey: secrets.mediaKey, videoRootPath: paths[1], videoStorage: sourceVideo });
  const target = await backupIdentity({ databaseName: "target_test", rootPath: paths[2], storage: targetPhoto, mediaKey: secrets.mediaKey, videoRootPath: paths[3], videoStorage: targetVideo });
  assert.doesNotThrow(() => assertCloneIdentity(source, target));
  const sourceVideoStats = await lstat(paths[1], { bigint: true });
  assert.equal(source.video.rootPhysicalTag, createHmac("sha256", secrets.mediaKey).update("jessiemessage:media-root-physical:v1:\0", "ascii").update(sourceVideoStats.dev.toString()).update("\0").update(sourceVideoStats.ino.toString()).digest("hex"));
  for (const change of [s => { s.video.rootPhysicalTag = source.rootPhysicalTag; }, s => { s.rootPathTag = source.video.rootPathTag; },
    s => { s.video.rootAncestors = [source.rootPathTag]; }, s => { s.video.rootPathTag = source.rootAncestors[0]; }]) {
    const bad = clone(target); change(bad); assert.throws(() => assertCloneIdentity(source, bad));
  }
  await assert.rejects(backupIdentity({ databaseName: "source_test", rootPath: paths[0], storage: sourcePhoto, mediaKey: secrets.mediaKey, videoRootPath: paths[0], videoStorage: sourceVideo }));
});

test("video receipts publish the exact video inventory in versions11/12 and retain strict historical boundaries", async t => {
  const f = await directories(t), metadata = Buffer.from("synthetic signed video manifest"), hash = createHash("sha256").update(metadata).digest("hex");
  const value = { format: "jessiemessage-private-checkpoint", version: 11, profile, coverage: { ...VIDEO_APPLICATION_COVERAGE }, createdAt: 1792627200000,
    schema: { tables: 36, migrations: 36 }, sql: { file: "database.sql.gz", bytes: 100, sha256: h("a"), uncompressedBytes: 1000, uncompressedSha256: h("b") },
    manifest: { file: "manifest.json", sha256: hash }, media: { files: [], bytes: 0 }, video: { files: [{ name: `${h("c")}.video.enc`, bytes: videoStoredBytes(300000), sha256: h("d") }], bytes: videoStoredBytes(300000) } };
  const scopeFor = async name => { const root = await f.directory(name); await writeFile(path.join(root, "manifest.json"), metadata, { mode: 0o600 });
    return { root, file: name => path.join(root, name), assertReady: () => lstat(root, { bigint: true }), sync: async () => {} }; };
  const scope = await scopeFor("capture"); await writeCheckpointReceipt(scope, value);
  assert.deepEqual(await readCheckpointReceipt(scope), value); assert.equal(await readFile(scope.file("receipt.json"), "utf8"), JSON.stringify(value) + "\n");
  const operational = { ...value, version: 12, operations: { file: "operations.enc.json", bytes: 42, sha256: h("e") } };
  assert.deepEqual(await writeCheckpointReceipt(await scopeFor("operational"), operational), operational);
  assert.equal(matchesCheckpointReceipt(photoBackupProfile(runtime + "-application"), operational), true);
  const invalidScope = await scopeFor("invalid");
  for (const change of [r => { r.version = 10; }, r => { r.schema.tables = 33; r.schema.migrations = 33; }, r => { r.video.files[0].name = `${h("c")}.full.enc`; },
    r => { r.video.bytes++; }, r => { r.video.files[0].bytes = videoStoredBytes(104857600) + 1; r.video.bytes = r.video.files[0].bytes; },
    r => { r.video.files.push(r.video.files[0]); r.video.bytes *= 2; }, r => { r.version = 12; }, r => { r.coverage.encryptedVideo = false; }]) {
    const altered = clone(value); change(altered); await assert.rejects(writeCheckpointReceipt(invalidScope, altered), { code: "CHECKPOINT_RECEIPT_INVALID" });
  }
  assert.deepEqual(await readdir(invalidScope.root), ["manifest.json"]);
});
