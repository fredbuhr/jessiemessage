import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";
import { createMediaStore } from "../server/media/store.mjs";
import { createMediaCapacityStore } from "../server/media/capacity-store.mjs";
import { BACKUP_MEDIA_MAX_BYTES } from "../server/media/backup-limits.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), digest = () => randomBytes(32);
const MiB = 1024 * 1024, GiB = 1024 * MiB;
const now = Date.UTC(2026, 9, 22, 12);
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = expected => error => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;
const videoAsset = bytes => ({ id: id(), storageKey: digest(), bytes, storedBytes: videoStoredBytes(bytes), mime: "video/mp4" });
const photoAsset = bytes => ({ id: id(), storageKey: digest(), digest: digest(), width: 1200, height: 800,
  thumbnailWidth: 480, thumbnailHeight: 320, fullBytes: bytes - 1080, thumbnailBytes: 1000 });

test("real MariaDB photo and video admission share the existing backup envelope without rewriting historical quotas", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require a separately provisioned DML-only runtime account");
  assert.notEqual(process.env.JESSIEMESSAGE_RUNTIME_DB_USER, options.user);
  const base = await loadMigrations(), migrations = await loadVideoMigrations();
  assert.equal(base.length, 33); assert.equal(migrations.length, 36);
  assert.deepEqual(migrations.slice(0, base.length), base);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowedTables.includes(row.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function owner() {
    const value = { id: id(), role: "admin", tokenHash: digest(), sessionId: id() }, created = sqlDate(now - 1000);
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at)
      VALUES (?, 'admin', 'active', 'Synthetic backup owner', ?, 'synthetic-not-a-password', ?, ?)`,
    [value.id, `${value.id.toString("hex")}@example.invalid`, created, created]);
    await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [value.id, created]);
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      [value.sessionId, value.id, value.tokenHash, created, sqlDate(now + 8 * 3600000)]);
    await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)",
      [value.sessionId, created, created]);
    return value;
  }
  const actor = value => ({ role: value.role, tokenHash: value.tokenHash, now });
  async function fresh() {
    // These fixtures never create messages or files. Clear only their catalogues
    // between cases; the outer guarded reset owns the disposable schema.
    for (const table of ["media_storage_objects", "media_assets", "video_assets", "media_storage_state", "video_storage_state"])
      await connection.query(`DELETE FROM ${table}`);
    const photoCapacity = { ownerBytes: GiB, totalBytes: 10 * GiB, rootFingerprint: digest() };
    const videoCapacity = { ownerBytes: GiB, totalBytes: 10 * GiB, rootFingerprint: digest() };
    const chat = createChatStore(pool, { clock: () => now });
    const media = createMediaStore({ pool, chatStore: chat, capacity: photoCapacity, video: true });
    const photos = createMediaCapacityStore({ pool, capacity: photoCapacity });
    const videos = createVideoStore({ pool, chatStore: chat, capacity: videoCapacity });
    await photos.initialize({ now, offline: true });
    await videos.initialize({ now, offline: true });
    return { owners: [await owner(), await owner()], media, photos, videos, photoCapacity, videoCapacity };
  }
  async function totals() {
    const photo = (await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0];
    const video = (await connection.query("SELECT held_bytes FROM video_storage_state WHERE id = 1"))[0];
    const photoRows = (await connection.query("SELECT COUNT(*) AS count, COALESCE(SUM(stored_bytes), 0) AS held FROM media_storage_objects WHERE state <> 'released'"))[0];
    const videoRows = (await connection.query("SELECT COUNT(*) AS count, COALESCE(SUM(stored_bytes), 0) AS held FROM video_assets WHERE state <> 'released'"))[0];
    assert.equal(Number(photo.held_bytes), Number(photoRows.held));
    assert.equal(Number(video.held_bytes), Number(videoRows.held));
    return { photoHeld: Number(photo.held_bytes), videoHeld: Number(video.held_bytes),
      photoObjects: Number(photoRows.count), videoObjects: Number(videoRows.count), held: Number(photo.held_bytes) + Number(video.held_bytes) };
  }
  async function reserveTen(fixture) {
    const values = Array.from({ length: 10 }, () => videoAsset(100 * MiB));
    for (const [index, asset] of values.entries())
      await fixture.videos.reserve({ ...actor(fixture.owners[index % 2]), asset });
    return values;
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    assert.equal(BACKUP_MEDIA_MAX_BYTES, GiB);

    await t.test("ten 100 MiB reservations fit across owners, the eleventh rolls back, and an exact replay spends nothing", async () => {
      const fixture = await fresh(), values = await reserveTen(fixture);
      const expected = 10 * videoStoredBytes(100 * MiB), before = await totals();
      assert.equal(before.held, expected); assert.equal(before.videoObjects, 10);
      assert.ok(expected <= GiB); assert.ok(expected + videoStoredBytes(100 * MiB) > GiB);
      const refused = videoAsset(100 * MiB);
      await assert.rejects(fixture.videos.reserve({ ...actor(fixture.owners[0]), asset: refused }), code("VIDEO_STORAGE_LIMIT"));
      assert.deepEqual(await totals(), before);
      assert.equal((await connection.query("SELECT id FROM video_assets WHERE id = ?", [refused.id])).length, 0);
      const replay = await fixture.videos.reserve({ ...actor(fixture.owners[0]), asset: values[0] });
      assert.ok(replay.reservation.id.equals(values[0].id));
      assert.equal(replay.reservation.storedBytes, values[0].storedBytes);
      assert.equal(replay.reservation.pendingBytes, expected);
      assert.deepEqual(await totals(), before);
      const status = await fixture.videos.status();
      assert.equal(status.heldBytes, expected); assert.equal(status.pendingBytes, expected);
      assert.equal(status.ownerBytes, GiB); assert.equal(status.totalBytes, 10 * GiB);
    });

    await t.test("independent owners racing photo and video reservations cannot jointly exceed the shared envelope", async () => {
      const fixture = await fresh(); await reserveTen(fixture);
      const before = await totals(), photo = photoAsset(10 * MiB), video = videoAsset(20 * MiB);
      assert.ok(before.held + 10 * MiB <= GiB && before.held + video.storedBytes <= GiB);
      assert.ok(before.held + 10 * MiB + video.storedBytes > GiB);
      let arrivals = 0, releaseBarrier, rejectBarrier, timer;
      const barrier = new Promise((resolve, reject) => { releaseBarrier = resolve; rejectBarrier = reject; });
      void barrier.catch(() => {});
      const racingPool = { getConnection: async () => {
        const native = await pool.getConnection();
        return { ...native, query: async (...arguments_) => {
          if (arguments_[0] === "SELECT held_bytes FROM video_storage_state WHERE id = 1 FOR UPDATE") {
            arrivals += 1;
            if (arrivals === 1) timer = setTimeout(() => rejectBarrier(new Error("Both independent upload transactions must reach the shared lock.")), 5000);
            if (arrivals === 2) { clearTimeout(timer); releaseBarrier(); }
            await barrier;
          }
          return native.query(...arguments_);
        } };
      } };
      const racingChat = createChatStore(racingPool, { clock: () => now });
      const media = createMediaStore({ pool: racingPool, chatStore: racingChat, capacity: fixture.photoCapacity, video: true });
      const videos = createVideoStore({ pool: racingPool, chatStore: racingChat, capacity: fixture.videoCapacity });
      let results;
      try {
        results = await Promise.allSettled([
          media.reserveAsset({ ...actor(fixture.owners[0]), asset: photo }),
          videos.reserve({ ...actor(fixture.owners[1]), asset: video }),
        ]);
      } finally { clearTimeout(timer); releaseBarrier(); }
      assert.equal(arrivals, 2, "separate owner locks must not serialize the uploads before admission");
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejectedIndex = results.findIndex(result => result.status === "rejected");
      assert.ok(code(rejectedIndex === 0 ? "MEDIA_STORAGE_LIMIT" : "VIDEO_STORAGE_LIMIT")(results[rejectedIndex].reason));
      const after = await totals(), photoWon = results[0].status === "fulfilled";
      assert.equal(after.held, before.held + (photoWon ? 10 * MiB : video.storedBytes));
      assert.ok(after.held <= GiB);
      assert.equal(after.photoObjects, photoWon ? 1 : 0); assert.equal(after.videoObjects, photoWon ? 10 : 11);
      assert.equal((await connection.query("SELECT id FROM media_storage_objects WHERE id = ?", [photo.id])).length, Number(photoWon));
      assert.equal((await connection.query("SELECT id FROM video_assets WHERE id = ?", [video.id])).length, Number(!photoWon));
    });

    await t.test("historical allocations above the envelope stay readable with their bindings and replay identities intact", async () => {
      const fixture = await fresh(), photo = photoAsset(10 * MiB);
      await fixture.media.reserveAsset({ ...actor(fixture.owners[0]), asset: photo });
      await fixture.media.registerAsset({ ...actor(fixture.owners[0]), asset: photo });
      const values = Array.from({ length: 11 }, () => videoAsset(100 * MiB)), contentDigest = digest();
      await connection.beginTransaction();
      try {
        for (const [index, asset] of values.entries()) {
          const owner = fixture.owners[index % 2];
          await connection.query(`INSERT INTO video_assets (id, owner_id, owner_role, storage_key, reserve_token_hash,
            content_digest, bytes, stored_bytes, mime, state, created_at, updated_at)
            VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 'video/mp4', ?, ?, ?)`,
          [asset.id, owner.id, asset.storageKey, owner.tokenHash, index === 0 ? contentDigest : null,
            asset.bytes, asset.storedBytes, index === 0 ? "committed" : "reserved", sqlDate(now), sqlDate(now)]);
        }
        await connection.query("UPDATE video_storage_state SET held_bytes = ? WHERE id = 1", [11 * videoStoredBytes(100 * MiB)]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      const before = await totals(); assert.ok(before.held > GiB);
      const bindings = async () => ({
        photo: (await connection.query("SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at FROM media_storage_state WHERE id = 1"))[0],
        video: (await connection.query("SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at FROM video_storage_state WHERE id = 1"))[0],
      });
      const originalBindings = await bindings();
      assert.equal((await fixture.videos.status()).heldBytes, before.videoHeld);
      assert.equal((await fixture.photos.status()).heldBytes, before.photoHeld);
      assert.equal((await fixture.videos.initialize({ now, offline: true })).totalBytes, 10 * GiB);
      assert.equal((await fixture.photos.initialize({ now, offline: true })).totalBytes, 10 * GiB);
      const owned = await fixture.videos.getOwned({ ...actor(fixture.owners[0]), assetId: values[0].id });
      assert.ok(owned.digest.equals(contentDigest)); assert.equal(owned.bytes, 100 * MiB);
      assert.ok((await fixture.videos.listOwned(actor(fixture.owners[0]))).assets.some(asset => asset.id.equals(values[0].id)));
      assert.ok((await fixture.media.getOwnedAsset({ ...actor(fixture.owners[0]), assetId: photo.id })).id.equals(photo.id));
      const replay = await fixture.videos.reserve({ ...actor(fixture.owners[1]), asset: values[1] });
      assert.ok(replay.reservation.id.equals(values[1].id));
      const photoReplay = await fixture.media.reserveAsset({ ...actor(fixture.owners[0]), asset: photo });
      assert.equal(photoReplay.duplicate, true); assert.ok(photoReplay.asset.id.equals(photo.id));
      await assert.rejects(fixture.videos.reserve({ ...actor(fixture.owners[1]), asset: videoAsset(1024) }), code("VIDEO_STORAGE_LIMIT"));
      await assert.rejects(fixture.media.reserveAsset({ ...actor(fixture.owners[0]), asset: photoAsset(2048) }), code("MEDIA_STORAGE_LIMIT"));
      assert.deepEqual(await totals(), before);
      assert.deepEqual(await bindings(), originalBindings);
    });
  } finally {
    await pool?.end(); try { await reset(); } finally { await connection.end(); }
  }
});
