import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";
import { createMediaStore, MediaStoreError } from "../server/media/store.mjs";
import { createProfileStore } from "../server/profile/store.mjs";
import { createMediaCapacityStore } from "../server/media/capacity-store.mjs";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_OBJECTS } from "../server/media/backup-limits.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 15, 12);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (expected) => (error) => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;

test("real MariaDB private media ownership and delivery (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require separately provisioned runtime DML credentials");
  const migrations = await loadMigrations();
  const ownedTables = createdMigrationTables(migrations).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, fixtureNumber = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const capacity = { ownerBytes: 20000000, totalBytes: 80000000, rootFingerprint: digest() };
    const chat = createChatStore(pool), media = createMediaStore({ pool, chatStore: chat, capacity });
    const profiles = createProfileStore({ pool, chatStore: chat });
    const capacityStore = createMediaCapacityStore({ pool, capacity });
    async function user(role) {
      const result = { id: id(), sessionId: id(), tokenHash: digest(), role, pseudonym: `Synthetic ${role} ${fixtureNumber++}` };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [result.id, role, result.pseudonym, `media-${fixtureNumber}@example.invalid`, role === "client" ? sqlDate(now) : null,
        null, role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [result.id, sqlDate(now)]);
      else await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [result.id, sqlDate(now)]);
      if (role === "client") await consumeSyntheticInvitation(connection, result.id, now);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [result.sessionId, result.id, result.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [result.sessionId, sqlDate(now), sqlDate(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [result.sessionId, sqlDate(now)]);
      return result;
    }
    async function pair(admin = null) {
      const fixture = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [fixture.conversationId, fixture.client.id, fixture.admin.id, sqlDate(now)]);
      return fixture;
    }
    const actor = (fixture, role = "client", extra = {}) => ({ role, tokenHash: fixture[role].tokenHash, now, ...extra });
    const request = (fixture, role = "client", extra = {}) => ({ ...actor(fixture, role), conversationId: fixture.conversationId, ...extra });
    const asset = (extra = {}) => ({ id: id(), storageKey: digest(), digest: digest(), width: 1200, height: 800,
      thumbnailWidth: 480, thumbnailHeight: 320, fullBytes: 42000, thumbnailBytes: 7000, ...extra });
    const register = async (fixture, role = "client", value = asset(), extra = {}) => {
      const command = { ...actor(fixture, role, extra), asset: value };
      const reserved = await media.reserveAsset(command);
      return reserved.duplicate ? reserved : media.registerAsset(command);
    };
    const payload = (extra = {}) => ({ id: id(), clientMessageId: id(), bodyEncrypted: `v1.synthetic-${digest().toString("base64url")}`, bodyFingerprint: digest(), ...extra });
    const send = (fixture, role, mediaId, value = payload(), extra = {}) => chat.sendMessage({ ...request(fixture, role, extra), message: { ...value, mediaId } });
    const delivered = (fixture, role, messageId, extra = {}) => media.getMessageAsset({ ...request(fixture, role, extra), messageId });
    const remove = (fixture, role, assetId, extra = {}) => media.deleteAsset({ ...actor(fixture, role, extra), assetId });
    const counts = async (fixture) => ({
      messages: Number((await connection.query("SELECT COUNT(*) AS value FROM messages WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
      links: Number((await connection.query("SELECT COUNT(*) AS value FROM message_media WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
      events: Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
    });
    async function removeSeed(owner, prefix) {
      await connection.beginTransaction();
      try {
        await connection.query("SELECT id FROM media_storage_state WHERE id = 1 FOR UPDATE");
        const held = Number((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM media_storage_objects WHERE owner_id = ? AND LEFT(id, 8) = ? AND state <> 'released' FOR UPDATE", [owner.id, prefix]))[0].value);
        await connection.query("DELETE FROM media_storage_objects WHERE owner_id = ? AND LEFT(id, 8) = ?", [owner.id, prefix]);
        await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [held]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
    }

    await t.test("read-only schema checks reject dirty history, dimension type drift, lost ownership uniqueness and weaker CHECKs", async () => {
      assert.equal(await media.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = ?", [migrations.at(-1).version]);
      try { await assert.rejects(media.assertSchema(), code("CHAT_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [migrations.at(-1).version]); }
      await connection.query("ALTER TABLE media_assets MODIFY width SMALLINT NOT NULL");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_assets MODIFY width SMALLINT UNSIGNED NOT NULL"); }
      await connection.query("ALTER TABLE media_assets DROP INDEX media_assets_owner_digest");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_assets ADD UNIQUE KEY media_assets_owner_digest (owner_id, active_digest)"); }
      await connection.query("ALTER TABLE media_assets DROP CONSTRAINT media_assets_active_state");
      await connection.query("ALTER TABLE media_assets ADD CONSTRAINT media_assets_active_state CHECK (1)");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE media_assets DROP CONSTRAINT media_assets_active_state");
        await connection.query(`ALTER TABLE media_assets ADD CONSTRAINT media_assets_active_state CHECK (
          (deleted_at IS NULL AND active_digest IS NOT NULL AND active_digest = content_digest) OR
          (deleted_at IS NOT NULL AND active_digest IS NULL AND deleted_at >= created_at))`);
      }
      await connection.query("ALTER TABLE message_media DROP FOREIGN KEY message_media_asset_fk");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE message_media ADD CONSTRAINT message_media_asset_fk FOREIGN KEY (media_id) REFERENCES media_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await media.assertSchema(), true);
    });

    await t.test("capacity schema checks reject engine, counter type, nullable root, lost uniqueness, foreign keys and weaker byte accounting", async () => {
      await connection.query("ALTER TABLE media_storage_state ENGINE = MyISAM");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_storage_state ENGINE = InnoDB"); }
      await connection.query("ALTER TABLE media_storage_state MODIFY held_bytes BIGINT NOT NULL");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_storage_state MODIFY held_bytes BIGINT UNSIGNED NOT NULL"); }
      await connection.query("ALTER TABLE media_storage_state MODIFY root_fingerprint VARBINARY(32) NULL");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_storage_state MODIFY root_fingerprint VARBINARY(32) NOT NULL"); }
      await connection.query("ALTER TABLE media_storage_objects DROP INDEX media_storage_objects_key");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_storage_objects ADD UNIQUE KEY media_storage_objects_key (storage_key)"); }
      await connection.query("ALTER TABLE media_storage_objects DROP FOREIGN KEY media_storage_objects_asset_fk");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_storage_objects ADD CONSTRAINT media_storage_objects_asset_fk FOREIGN KEY (asset_id) REFERENCES media_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      await connection.query("ALTER TABLE media_storage_objects DROP CONSTRAINT media_storage_objects_bytes");
      await connection.query("ALTER TABLE media_storage_objects ADD CONSTRAINT media_storage_objects_bytes CHECK (full_bytes > 0)");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE media_storage_objects DROP CONSTRAINT media_storage_objects_bytes");
        await connection.query("ALTER TABLE media_storage_objects ADD CONSTRAINT media_storage_objects_bytes CHECK (full_bytes BETWEEN 1 AND 10485760 AND thumbnail_bytes BETWEEN 1 AND 524288 AND stored_bytes = full_bytes + thumbnail_bytes + 80)");
      }
      assert.equal(await media.assertSchema(), true);
    });

    await t.test("capacity remains unavailable before explicit offline initialization and binds root and both limits", async () => {
      const fixture = await pair(), value = asset();
      assert.equal((await capacityStore.status()).ready, false);
      assert.deepEqual(await capacityStore.listObjects(), { objects: [], nextCursor: null, hasMore: false });
      await assert.rejects(media.reserveAsset({ ...actor(fixture), asset: value }), code("MEDIA_CAPACITY_UNAVAILABLE"));
      await assert.rejects(capacityStore.initialize({ now, offline: false }), code("MEDIA_INPUT"));
      const empty = await capacityStore.initialize({ now, offline: true });
      assert.equal(empty.ready, true); assert.equal(empty.heldBytes, 0); assert.equal(empty.pendingBytes, 0);
      assert.deepEqual(await capacityStore.initialize({ now, offline: true }), empty);
      const readOnlyStore = createMediaStore({ pool, chatStore: chat });
      assert.deepEqual((await readOnlyStore.listAssets(actor(fixture))).assets, []);
      await assert.rejects(readOnlyStore.reserveAsset({ ...actor(fixture), asset: value }), code("MEDIA_CAPACITY_UNAVAILABLE"));
      for (const changed of [{ ...capacity, ownerBytes: capacity.ownerBytes - 1 }, { ...capacity, totalBytes: capacity.totalBytes + 1 }, { ...capacity, rootFingerprint: digest() }]) {
        const other = createMediaCapacityStore({ pool, capacity: changed });
        await assert.rejects(other.status(), code("MEDIA_CAPACITY_UNAVAILABLE"));
        await assert.rejects(other.initialize({ now, offline: true }), code("MEDIA_CAPACITY_UNAVAILABLE"));
        await assert.rejects(createMediaStore({ pool, chatStore: chat, capacity: changed }).reserveAsset({ ...actor(fixture), asset: value }), code("MEDIA_CAPACITY_UNAVAILABLE"));
      }
      assert.equal((await capacityStore.status()).heldBytes, 0);
    });

    await t.test("trusted actor callbacks recheck current SQL session, role, client gates and creator MFA and roll back failures", async () => {
      const fixture = await pair();
      assert.ok((await chat.withActor(actor(fixture), async (_connection, context) => context.actor.id)).equals(fixture.client.id));
      await assert.rejects(chat.withActor(actor(fixture, "client", { tokenHash: fixture.admin.tokenHash }), async () => true), code("CHAT_FORBIDDEN"));
      await assert.rejects(chat.withActor(actor(fixture, "client", { tokenHash: digest() }), async () => true), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(chat.withConversation(request(fixture), async (tx) => {
        await tx.query("UPDATE users SET pseudonym = 'Must roll back' WHERE id = ?", [fixture.client.id]);
        throw new MediaStoreError("MEDIA_INPUT");
      }), code("MEDIA_INPUT"));
      assert.equal((await connection.query("SELECT pseudonym FROM users WHERE id = ?", [fixture.client.id]))[0].pseudonym, fixture.client.pseudonym);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [fixture.client.id]);
      await assert.rejects(media.listAssets(actor(fixture)), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE admin_mfa SET enabled_at = NULL, last_totp_step = -1 WHERE user_id = ?", [fixture.admin.id]);
      await assert.rejects(register(fixture), code("CHAT_FORBIDDEN"));
    });

    await t.test("deduplication is private to the current owner and concurrent retries create one active asset", async () => {
      const fixture = await pair(), other = await pair(fixture.admin), value = asset();
      const results = await Promise.all([register(fixture, "client", value), register(fixture, "client", { ...value, id: id(), storageKey: digest() })]);
      assert.equal(results.filter((item) => item.duplicate).length, 1); assert.ok(results[0].asset.id.equals(results[1].asset.id));
      const separate = await register(other, "client", { ...value, id: id(), storageKey: digest() });
      assert.equal(separate.duplicate, false); assert.ok(!separate.asset.id.equals(results[0].asset.id));
      assert.equal((await media.listAssets(actor(fixture))).assets.length, 1);
      assert.equal((await media.listAssets(actor(other))).assets.length, 1);
      await assert.rejects(media.getOwnedAsset({ ...actor(other), assetId: results[0].asset.id }), code("MEDIA_NOT_FOUND"));
      await assert.rejects(remove(other, "client", results[0].asset.id), code("MEDIA_NOT_FOUND"));
      assert.ok(results[0].asset.ownerId.equals(fixture.client.id));
    });

    await t.test("metadata bounds and active/deleted state are enforced by both input validation and database checks", async () => {
      const fixture = await pair();
      for (const change of [{ width: 2049 }, { fullBytes: 10485761 }, { thumbnailBytes: 524289 }, { thumbnailWidth: 481 }, { width: 100 }]) {
        await assert.rejects(register(fixture, "client", asset(change)), code("MEDIA_INPUT"));
      }
      const saved = (await register(fixture)).asset;
      await assert.rejects(connection.query("UPDATE media_assets SET active_digest = NULL WHERE id = ?", [saved.id]));
      await assert.rejects(connection.query("UPDATE media_assets SET content_digest = ? WHERE id = ?", [digest(), saved.id]));
      await assert.rejects(connection.query("UPDATE media_assets SET mime = 'image/png' WHERE id = ?", [saved.id]));
      await assert.rejects(connection.query("UPDATE media_assets SET thumbnail_width = 481 WHERE id = ?", [saved.id]));
      assert.ok((await media.getOwnedAsset({ ...actor(fixture), assetId: saved.id })).id.equals(saved.id));
    });

    await t.test("a delivered image is available to the assigned parties while ownership URLs and reusable IDs stay private", async () => {
      const a = await pair(), b = await pair(a.admin), stranger = await pair();
      const image = (await register(a, "admin")).asset, sent = await send(a, "admin", image.id);
      assert.ok((await delivered(a, "client", sent.message.id)).id.equals(image.id));
      assert.ok((await delivered(a, "admin", sent.message.id)).id.equals(image.id));
      await assert.rejects(media.getOwnedAsset({ ...actor(a), assetId: image.id }), code("MEDIA_NOT_FOUND"));
      await assert.rejects(send(a, "client", image.id), code("CHAT_NOT_FOUND"));
      await assert.rejects(delivered(b, "client", sent.message.id, { conversationId: a.conversationId }), code("CHAT_NOT_FOUND"));
      await assert.rejects(delivered(stranger, "admin", sent.message.id, { conversationId: a.conversationId }), code("CHAT_NOT_FOUND"));
      await assert.rejects(delivered(b, "admin", sent.message.id), code("MEDIA_NOT_FOUND"));
      await assert.rejects(media.gallery({ ...request(b), conversationId: a.conversationId }), code("CHAT_NOT_FOUND"));
      const message = (await chat.readMessages(request(a))).messages[0];
      assert.deepEqual(message.media, { id: image.id, width: 1200, height: 800, thumbnailWidth: 480, thumbnailHeight: 320, fullBytes: 42000, thumbnailBytes: 7000 });
      for (const key of ["storageKey", "digest", "ownerId", "email"]) assert.equal(Object.hasOwn(message.media, key), false);
      assert.equal((await media.gallery(request(a))).items[0].sequence, sent.message.sequence);
    });

    await t.test("photo/text idempotency compares immutable attachment identity and allocates one atomic link and event", async () => {
      const fixture = await pair(), first = (await register(fixture)).asset, second = (await register(fixture)).asset, value = payload();
      const results = await Promise.all([send(fixture, "client", first.id, value), send(fixture, "client", first.id, { ...value, id: id() })]);
      assert.equal(results.filter((item) => item.duplicate).length, 1); assert.ok(results[0].message.id.equals(results[1].message.id));
      assert.deepEqual(await counts(fixture), { messages: 1, links: 1, events: 1 });
      await assert.rejects(send(fixture, "client", second.id, { ...value, id: id() }), code("CHAT_CONFLICT"));
      await assert.rejects(send(fixture, "client", null, { ...value, id: id() }), code("CHAT_CONFLICT"));
      await assert.rejects(send(fixture, "client", first.id, { ...value, id: id(), bodyFingerprint: digest() }), code("CHAT_CONFLICT"));
      const text = payload(); await send(fixture, "client", null, text);
      await assert.rejects(send(fixture, "client", first.id, { ...text, id: id() }), code("CHAT_CONFLICT"));
      assert.deepEqual(await counts(fixture), { messages: 2, links: 1, events: 2 });
    });

    await t.test("message/link/event creation rolls back completely when either the attachment or the event insert fails", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset;
      for (const table of ["message_media", "chat_events"]) {
        await connection.query(`CREATE TRIGGER synthetic_fail_media BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic media failure'`);
        try { await assert.rejects(send(fixture, "client", image.id), code("CHAT_DATABASE_OPERATION")); }
        finally { await connection.query("DROP TRIGGER synthetic_fail_media"); }
        assert.deepEqual(await counts(fixture), { messages: 0, links: 0, events: 0 });
      }
      assert.equal((await send(fixture, "client", image.id)).message.sequence, "1");
    });

    await t.test("composite foreign keys reject a cross-conversation attachment pointer", async () => {
      const fixture = await pair(), other = await pair(fixture.admin), image = (await register(fixture)).asset;
      const text = await send(fixture, "client", null);
      await assert.rejects(connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [text.message.id, other.conversationId, image.id, sqlDate(now)]));
      assert.deepEqual(await counts(fixture), { messages: 1, links: 0, events: 1 });
    });

    await t.test("sharedHere reflects only live deliveries in the explicitly authorized conversation", async () => {
      const a = await pair(), b = await pair(a.admin), image = (await register(a, "admin")).asset;
      assert.equal((await media.listAssets({ ...actor(a, "admin"), conversationId: a.conversationId })).assets[0].sharedHere, false);
      const sent = await send(a, "admin", image.id);
      assert.equal((await media.listAssets({ ...actor(a, "admin"), conversationId: a.conversationId })).assets[0].sharedHere, true);
      assert.equal((await media.listAssets({ ...actor(b, "admin"), conversationId: b.conversationId })).assets[0].sharedHere, false);
      assert.equal((await media.listAssets(actor(a, "admin"))).assets[0].sharedHere, false);
      await chat.deleteMessage({ ...request(a, "admin"), messageId: sent.message.id });
      assert.equal((await media.listAssets({ ...actor(a, "admin"), conversationId: a.conversationId })).assets[0].sharedHere, false);
    });

    await t.test("deleting a photo message revokes its URL and event payload without removing another delivery", async () => {
      const a = await pair(), b = await pair(a.admin), image = (await register(a, "admin")).asset;
      const value = payload(), first = await send(a, "admin", image.id, value), second = await send(b, "admin", image.id);
      await assert.rejects(remove(a, "admin", image.id), code("MEDIA_IN_USE"));
      await assert.rejects(chat.deleteMessage({ ...request(a), messageId: first.message.id }), code("CHAT_NOT_FOUND"));
      const tombstone = await chat.deleteMessage({ ...request(a, "admin"), messageId: first.message.id });
      assert.equal(tombstone.bodyEncrypted, null); assert.equal(tombstone.media, null);
      await assert.rejects(delivered(a, "client", first.message.id), code("MEDIA_NOT_FOUND"));
      assert.ok((await delivered(b, "client", second.message.id)).id.equals(image.id));
      assert.equal((await media.gallery(request(a))).items.length, 0); assert.equal((await media.gallery(request(b))).items.length, 1);
      assert.ok((await chat.readEvents(request(a))).events.every((event) => event.message.media === null && event.message.bodyEncrypted === null));
      const retry = await send(a, "admin", image.id, { ...value, id: id() });
      assert.equal(retry.duplicate, true); assert.equal(retry.message.media, null);
      await assert.rejects(remove(a, "admin", image.id), code("MEDIA_IN_USE"));
      await chat.deleteMessage({ ...request(b, "admin"), messageId: second.message.id });
      const removed = await remove(a, "admin", image.id); assert.equal(removed.deletedAt, now);
      assert.equal((await remove(a, "admin", image.id)).deletedAt, now, "owner may repeat file cleanup after a committed soft delete");
      await assert.rejects(media.getOwnedAsset({ ...actor(a, "admin"), assetId: image.id }), code("MEDIA_NOT_FOUND"));
      assert.equal((await media.listAssets(actor(a, "admin"))).assets.length, 0);
      const deletedRetry = await send(a, "admin", image.id, { ...value, id: id() });
      assert.equal(deletedRetry.duplicate, true); assert.equal(deletedRetry.message.media, null);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM message_media WHERE media_id = ?", [image.id]))[0].value), 2, "historical linkage survives tombstones");
    });

    await t.test("an active avatar blocks media deletion until its owner clears the profile; cleanup refunds the quota once", async () => {
      for (const role of ["client", "admin"]) {
        const fixture = await pair(), value = asset({ width: 256, height: 256, thumbnailWidth: 256, thumbnailHeight: 256 });
        const before = await capacityStore.status(), bytes = value.fullBytes + value.thumbnailBytes + 80;
        await register(fixture, role, value);
        await profiles.saveProfile({ ...actor(fixture, role), expectedVersion: "0", pseudonym: fixture[role].pseudonym, avatarId: value.id });
        await assert.rejects(remove(fixture, role, value.id), code("MEDIA_IN_USE"));
        assert.equal((await connection.query("SELECT deleted_at FROM media_assets WHERE id = ?", [value.id]))[0].deleted_at, null);
        assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
        await profiles.saveProfile({ ...actor(fixture, role), expectedVersion: "1", pseudonym: fixture[role].pseudonym, avatarId: null });
        await remove(fixture, role, value.id);
        assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes, "soft deletion alone does not refund encrypted files");
        await media.releaseStorageObject({ ...actor(fixture, role), objectId: value.id, storageKey: value.storageKey });
        await media.releaseStorageObject({ ...actor(fixture, role), objectId: value.id, storageKey: value.storageKey });
        assert.equal((await capacityStore.status()).heldBytes, before.heldBytes);
      }
    });

    await t.test("clearing an avatar does not make a photo still shared in a conversation deletable", async () => {
      const fixture = await pair(), value = asset({ width: 256, height: 256, thumbnailWidth: 256, thumbnailHeight: 256 });
      await register(fixture, "client", value);
      await profiles.saveProfile({ ...actor(fixture), expectedVersion: "0", pseudonym: fixture.client.pseudonym, avatarId: value.id });
      const sent = await send(fixture, "client", value.id);
      await profiles.saveProfile({ ...actor(fixture), expectedVersion: "1", pseudonym: fixture.client.pseudonym, avatarId: null });
      await assert.rejects(remove(fixture, "client", value.id), code("MEDIA_IN_USE"));
      assert.ok((await delivered(fixture, "admin", sent.message.id)).id.equals(value.id));
      await chat.deleteMessage({ ...request(fixture), messageId: sent.message.id });
      await remove(fixture, "client", value.id);
      await media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: value.storageKey });
    });

    await t.test("removal releases owner deduplication without making a deleted asset reusable", async () => {
      const fixture = await pair(), value = asset(), original = (await register(fixture, "client", value)).asset;
      await remove(fixture, "client", original.id);
      const recreated = await register(fixture, "client", { ...value, id: id(), storageKey: digest() });
      assert.equal(recreated.duplicate, false); assert.ok(!recreated.asset.id.equals(original.id));
      await assert.rejects(send(fixture, "client", original.id), code("CHAT_NOT_FOUND"));
      assert.ok((await send(fixture, "client", recreated.asset.id)).message.media.id.equals(recreated.asset.id));
    });

    await t.test("concurrent removal and delivery serialize on the current owner and cannot leave a live dangling delivery", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset;
      const results = await Promise.allSettled([remove(fixture, "client", image.id), send(fixture, "client", image.id)]);
      const row = (await connection.query("SELECT deleted_at FROM media_assets WHERE id = ?", [image.id]))[0];
      if (row.deleted_at !== null) {
        assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected"); assert.equal(results[1].reason.code, "CHAT_NOT_FOUND");
        assert.deepEqual(await counts(fixture), { messages: 0, links: 0, events: 0 });
      } else {
        assert.equal(results[0].status, "rejected"); assert.equal(results[0].reason.code, "MEDIA_IN_USE"); assert.equal(results[1].status, "fulfilled");
        assert.deepEqual(await counts(fixture), { messages: 1, links: 1, events: 1 });
      }
    });

    await t.test("library keyset pages and descending gallery cursors stay bounded and retain decimal sequences", async () => {
      const fixture = await pair(), imageIds = [];
      for (let index = 0; index < 4; index++) { const image = (await register(fixture)).asset; imageIds.push(image.id.toString("hex")); await send(fixture, "client", image.id); }
      const first = await media.listAssets({ ...actor(fixture), limit: 2 }); assert.equal(first.hasMore, true);
      const second = await media.listAssets({ ...actor(fixture), afterId: first.nextCursor, limit: 2 }); assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
      assert.deepEqual([...first.assets, ...second.assets].map((item) => item.id.toString("hex")), imageIds.sort());
      const gallery = await media.gallery({ ...request(fixture), limit: 2 }); assert.deepEqual(gallery.items.map((item) => item.sequence), ["4", "3"]); assert.equal(gallery.nextBefore, "3");
      const older = await media.gallery({ ...request(fixture), before: gallery.nextBefore, limit: 2 }); assert.deepEqual(older.items.map((item) => item.sequence), ["2", "1"]); assert.equal(older.nextBefore, null);
      for (const before of ["01", "-1", "18446744073709551616", 1, "1\n"]) await assert.rejects(media.gallery({ ...request(fixture), before }), code("MEDIA_INPUT"));
      for (const limit of [0, 101, 1.5]) await assert.rejects(media.listAssets({ ...actor(fixture), limit }), code("MEDIA_INPUT"));
    });

    await t.test("gallery pagination preserves full unsigned BIGINT values beyond JavaScript number precision", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset, first = await send(fixture, "client", image.id);
      await connection.query("UPDATE messages SET sequence_no = 9007199254740993 WHERE id = ?", [first.message.id]);
      const second = await send(fixture, "client", image.id);
      assert.equal(second.message.sequence, "9007199254740994");
      const latest = await media.gallery({ ...request(fixture), limit: 1 });
      assert.equal(latest.items[0].sequence, "9007199254740994"); assert.equal(latest.nextBefore, "9007199254740994");
      const older = await media.gallery({ ...request(fixture), before: latest.nextBefore, limit: 1 });
      assert.equal(older.items[0].sequence, "9007199254740993"); assert.equal(older.hasMore, false);
    });

    await t.test("removing a consumed invitation blocks client media without fabricating an age proof", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset, sent = await send(fixture, "client", image.id);
      assert.equal((await connection.query("SELECT age_assured_at FROM users WHERE id = ?", [fixture.client.id]))[0].age_assured_at, null);
      await connection.query("UPDATE invitations SET consumed_at = NULL, consumed_by_id = NULL WHERE consumed_by_id = ?", [fixture.client.id]);
      await assert.rejects(media.listAssets(actor(fixture)), code("CHAT_FORBIDDEN"));
      await assert.rejects(delivered(fixture, "client", sent.message.id), code("CHAT_FORBIDDEN"));
      assert.ok((await delivered(fixture, "admin", sent.message.id)).id.equals(image.id));
      await assert.rejects(send(fixture, "admin", image.id), code("CHAT_FORBIDDEN"));
    });

    await t.test("expiry/revocation revoke every client media operation while the assigned administrator retains history only", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset, sent = await send(fixture, "client", image.id);
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1000), fixture.client.id]);
      const later = now + 1000;
      for (const operation of [
        () => media.getOwnedAsset({ ...actor(fixture, "client", { now: later }), assetId: image.id }),
        () => media.listAssets(actor(fixture, "client", { now: later })),
        () => register(fixture, "client", asset(), { now: later }),
        () => remove(fixture, "client", image.id, { now: later }),
        () => delivered(fixture, "client", sent.message.id, { now: later }),
        () => media.gallery(request(fixture, "client", { now: later })),
      ]) await assert.rejects(operation(), code("CHAT_FORBIDDEN"));
      assert.ok((await delivered(fixture, "admin", sent.message.id, { now: later })).id.equals(image.id));
      assert.equal((await media.gallery(request(fixture, "admin", { now: later }))).items.length, 1);
      const adminImage = (await register(fixture, "admin", asset(), { now: later })).asset;
      await assert.rejects(send(fixture, "admin", adminImage.id, payload(), { now: later }), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(later), fixture.client.sessionId]);
      await assert.rejects(delivered(fixture, "client", sent.message.id, { now: later }), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE sessions SET revoked_at = NULL WHERE id = ?", [fixture.client.sessionId]);
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), fixture.conversationId]);
      assert.ok((await delivered(fixture, "client", sent.message.id)).id.equals(image.id), "closed conversations retain authorized history");
      await assert.rejects(send(fixture, "client", image.id), code("CHAT_FORBIDDEN"));
    });

    await t.test("durable reservations charge encrypted bytes before registration and reject forged allocations or foreign owners", async () => {
      const fixture = await pair(), other = await pair(fixture.admin), value = asset(), bytes = value.fullBytes + value.thumbnailBytes + 80;
      const before = await capacityStore.status(), command = { ...actor(fixture), asset: value };
      await assert.rejects(media.registerAsset(command), code("MEDIA_INPUT"));
      const reservation = await media.reserveAsset(command);
      assert.deepEqual({ id: reservation.reservation.id, storageKey: reservation.reservation.storageKey, bytes: reservation.reservation.bytes }, { id: value.id, storageKey: value.storageKey, bytes });
      assert.equal(reservation.reservation.pendingBytes, before.pendingBytes + bytes);
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
      assert.equal((await capacityStore.status()).pendingBytes, before.pendingBytes + bytes);
      await assert.rejects(media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: value.storageKey }), code("MEDIA_INPUT"));
      for (const patch of [{ id: id() }, { storageKey: digest() }, { digest: digest() }, { fullBytes: value.fullBytes + 1 }, { thumbnailBytes: value.thumbnailBytes + 1 }]) {
        await assert.rejects(media.registerAsset({ ...command, asset: { ...value, ...patch } }), code("MEDIA_INPUT"));
      }
      await assert.rejects(media.registerAsset({ ...actor(other), asset: value }), code("MEDIA_INPUT"));
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
      assert.equal((await media.registerAsset(command)).duplicate, false);
      const after = await capacityStore.status(); assert.equal(after.heldBytes, before.heldBytes + bytes); assert.equal(after.pendingBytes, before.pendingBytes);
      await assert.rejects(media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: value.storageKey }), code("MEDIA_INPUT"));
    });

    await t.test("early owner deduplication avoids reservation and late concurrent deduplication holds cleanup until release", async () => {
      const fixture = await pair(), first = asset(), second = { ...first, id: id(), storageKey: digest() }, bytes = first.fullBytes + first.thumbnailBytes + 80;
      const before = await capacityStore.status();
      assert.equal((await media.reserveAsset({ ...actor(fixture), asset: first })).duplicate, false);
      assert.equal((await media.reserveAsset({ ...actor(fixture), asset: second })).duplicate, false);
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + 2 * bytes);
      const saved = await media.registerAsset({ ...actor(fixture), asset: first });
      const duplicate = await media.registerAsset({ ...actor(fixture), asset: second });
      assert.equal(duplicate.duplicate, true); assert.ok(duplicate.asset.id.equals(saved.asset.id));
      assert.equal((await connection.query("SELECT state, asset_id FROM media_storage_objects WHERE id = ?", [second.id]))[0].state, "cleanup_pending");
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + 2 * bytes);
      const early = await media.reserveAsset({ ...actor(fixture), asset: { ...first, id: id(), storageKey: digest() } });
      assert.equal(early.duplicate, true); assert.ok(early.asset.id.equals(first.id));
      assert.equal((await media.reserveAsset({ ...actor(fixture), asset: first })).duplicate, true);
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + 2 * bytes);
      assert.deepEqual(await media.releaseStorageObject({ ...actor(fixture), objectId: second.id, storageKey: second.storageKey }), { released: true });
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
      await media.releaseStorageObject({ ...actor(fixture), objectId: second.id, storageKey: second.storageKey });
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
    });

    await t.test("tombstones keep capacity charged through failed erasure and release replay cannot refund twice", async () => {
      const fixture = await pair(), other = await pair(fixture.admin), value = asset(), bytes = value.fullBytes + value.thumbnailBytes + 80;
      const before = await capacityStore.status(); await register(fixture, "client", value);
      await remove(fixture, "client", value.id);
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
      assert.equal((await capacityStore.status()).pendingBytes, before.pendingBytes + bytes);
      assert.equal((await remove(fixture, "client", value.id)).deletedAt, now);
      await assert.rejects(media.releaseStorageObject({ ...actor(other), objectId: value.id, storageKey: value.storageKey }), code("MEDIA_NOT_FOUND"));
      await assert.rejects(media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: digest() }), code("MEDIA_NOT_FOUND"));
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1000), fixture.client.id]);
      await assert.rejects(media.releaseStorageObject({ ...actor(fixture, "client", { now: now + 1000 }), objectId: value.id, storageKey: value.storageKey }), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.client.id]);
      assert.equal((await capacityStore.status()).heldBytes, before.heldBytes + bytes);
      await media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: value.storageKey });
      await media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: value.storageKey });
      const after = await capacityStore.status(); assert.equal(after.heldBytes, before.heldBytes); assert.equal(after.pendingBytes, before.pendingBytes);
      assert.equal((await remove(fixture, "client", value.id)).deletedAt, now);
      assert.equal((await connection.query("SELECT state FROM media_storage_objects WHERE id = ?", [value.id]))[0].state, "released");
    });

    await t.test("owner and global ceilings serialize concurrent reservations without overshoot", async () => {
      const bytes = 1180, smallAsset = () => asset({ fullBytes: 1000, thumbnailBytes: 100 });
      for (const scope of ["owner", "global"]) {
        const fixture = await pair(), other = scope === "owner" ? fixture : await pair();
        const before = await capacityStore.status();
        const limited = { ...capacity, ownerBytes: bytes, totalBytes: scope === "owner" ? capacity.totalBytes : before.heldBytes + bytes };
        await connection.query("UPDATE media_storage_state SET owner_bytes = ?, total_bytes = ? WHERE id = 1", [limited.ownerBytes, limited.totalBytes]);
        try {
          const limitedStore = createMediaStore({ pool, chatStore: chat, capacity: limited });
          const results = await Promise.allSettled([
            limitedStore.reserveAsset({ ...actor(fixture), asset: smallAsset() }), limitedStore.reserveAsset({ ...actor(other), asset: smallAsset() }),
          ]);
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, scope);
          const rejected = results.find((result) => result.status === "rejected"); assert.equal(rejected.reason.code, "MEDIA_STORAGE_LIMIT", scope);
          const usage = await createMediaCapacityStore({ pool, capacity: limited }).status();
          assert.equal(usage.heldBytes, before.heldBytes + bytes); assert.equal(usage.pendingBytes, before.pendingBytes + bytes);
        } finally { await connection.query("UPDATE media_storage_state SET owner_bytes = ?, total_bytes = ? WHERE id = 1", [capacity.ownerBytes, capacity.totalBytes]); }
      }
    });

    await t.test("the backup byte ceiling serializes the final encrypted allocation while preserving larger persisted quotas", async () => {
      const fixture = await pair(), other = await pair(), canonical = asset({ fullBytes: 267, thumbnailBytes: 267 });
      await register(fixture, "client", canonical);
      const prefix = randomBytes(8), wide = { ...capacity, ownerBytes: 2 * BACKUP_MEDIA_MAX_BYTES, totalBytes: 10 * BACKUP_MEDIA_MAX_BYTES };
      const before = await capacityStore.status(), bytes = 614, fill = BACKUP_MEDIA_MAX_BYTES - before.heldBytes - bytes;
      const number = Math.ceil(fill / (10485760 + 81)), each = Math.floor(fill / number), remainder = fill % number;
      const parameters = [], values = [];
      for (let index = 0; index < number; index++) {
        const stored = each + (index < remainder ? 1 : 0), identifier = Buffer.concat([prefix, Buffer.alloc(8)]);
        identifier.writeBigUInt64BE(BigInt(index), 8);
        values.push("(?, ?, 'client', ?, ?, ?, 1, ?, 'reserved', ?, ?)");
        parameters.push(identifier, fixture.client.id, digest(), digest(), stored - 81, stored, sqlDate(now), sqlDate(now));
      }
      let seeded = false;
      try {
        await connection.beginTransaction();
        await connection.query("SELECT id FROM media_storage_state WHERE id = 1 FOR UPDATE");
        await connection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, created_at, updated_at) VALUES ${values.join(",")}`, parameters);
        await connection.query("UPDATE media_storage_state SET owner_bytes = ?, total_bytes = ?, held_bytes = held_bytes + ? WHERE id = 1", [wide.ownerBytes, wide.totalBytes, fill]);
        await connection.commit(); seeded = true;
        const limited = createMediaStore({ pool, chatStore: chat, capacity: wide });
        const proposals = [asset({ fullBytes: 267, thumbnailBytes: 267 }), asset({ fullBytes: 267, thumbnailBytes: 267 })];
        const actors = [fixture, other], results = await Promise.allSettled(proposals.map((value, index) => limited.reserveAsset({ ...actor(actors[index]), asset: value })));
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = results.findIndex((result) => result.status === "rejected"), accepted = 1 - rejected;
        assert.equal(results[rejected].reason.code, "MEDIA_STORAGE_LIMIT");
        assert.equal((await connection.query("SELECT id FROM media_storage_objects WHERE id = ?", [proposals[rejected].id])).length, 0);
        const status = await createMediaCapacityStore({ pool, capacity: wide }).status();
        assert.equal(status.heldBytes, BACKUP_MEDIA_MAX_BYTES); assert.equal(status.totalBytes, wide.totalBytes);
        assert.equal((await limited.reserveAsset({ ...actor(actors[accepted]), asset: proposals[accepted] })).duplicate, false, "an existing uncertain allocation remains retryable at the ceiling");
        assert.equal((await limited.reserveAsset({ ...actor(fixture), asset: { ...canonical, id: id(), storageKey: digest() } })).duplicate, true);
        assert.deepEqual(await createMediaCapacityStore({ pool, capacity: wide }).status(), status);
      } finally {
        try { await connection.rollback(); } catch {}
        if (seeded) await removeSeed(fixture.client, prefix);
        await connection.query("UPDATE media_storage_state SET owner_bytes = ?, total_bytes = ? WHERE id = 1", [capacity.ownerBytes, capacity.totalBytes]);
      }
    });

    await t.test("the backup object ceiling counts tiny reserved and cleanup objects until acknowledged release", async () => {
      const fixture = await pair(), other = await pair(), prefix = randomBytes(8);
      const current = Number((await connection.query("SELECT COUNT(*) AS value FROM media_storage_objects WHERE state <> 'released'"))[0].value);
      const fill = BACKUP_MEDIA_MAX_OBJECTS - current - 1, digits = "(SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
      assert.ok(fill > 0 && fill < BACKUP_MEDIA_MAX_OBJECTS);
      let seeded = false;
      try {
        await connection.beginTransaction();
        await connection.query("SELECT id FROM media_storage_state WHERE id = 1 FOR UPDATE");
        await connection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, created_at, updated_at)
          SELECT UNHEX(CONCAT(?, LPAD(HEX(n), 16, '0'))), ?, 'client', UNHEX(SHA2(CONCAT(?, ':storage:', n), 256)), UNHEX(SHA2(CONCAT(?, ':digest:', n), 256)),
            1, 1, 82, IF(MOD(n, 2) = 0, 'reserved', 'cleanup_pending'), ?, ?
          FROM (SELECT a.n + 10*b.n + 100*c.n + 1000*d.n + 10000*e.n AS n FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN ${digits} e) numbers WHERE n < ?`,
        [prefix.toString("hex"), fixture.client.id, prefix.toString("hex"), prefix.toString("hex"), sqlDate(now), sqlDate(now), fill]);
        await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes + ? WHERE id = 1", [fill * 82]);
        await connection.commit(); seeded = true;
        const proposals = [asset({ fullBytes: 1, thumbnailBytes: 1 }), asset({ fullBytes: 1, thumbnailBytes: 1 })];
        const actors = [fixture, other], results = await Promise.allSettled(proposals.map((value, index) => media.reserveAsset({ ...actor(actors[index]), asset: value })));
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = results.findIndex((result) => result.status === "rejected"), accepted = 1 - rejected;
        assert.equal(results[rejected].reason.code, "MEDIA_STORAGE_LIMIT");
        assert.equal((await connection.query("SELECT id FROM media_storage_objects WHERE id = ?", [proposals[rejected].id])).length, 0);
        assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM media_storage_objects WHERE state <> 'released'"))[0].value), BACKUP_MEDIA_MAX_OBJECTS);
        const status = await capacityStore.status(); assert.ok(status.heldBytes < BACKUP_MEDIA_MAX_BYTES);
        assert.equal((await media.reserveAsset({ ...actor(actors[accepted]), asset: proposals[accepted] })).duplicate, false);
        assert.deepEqual(await capacityStore.status(), status);
        const cleanupId = Buffer.concat([prefix, Buffer.alloc(8)]); cleanupId.writeBigUInt64BE(1n, 8);
        const cleanup = (await connection.query("SELECT storage_key FROM media_storage_objects WHERE id = ?", [cleanupId]))[0];
        await media.releaseStorageObject({ ...actor(fixture), objectId: cleanupId, storageKey: cleanup.storage_key });
        await media.reserveAsset({ ...actor(other), asset: asset({ fullBytes: 1, thumbnailBytes: 1 }) });
        const fullAgain = await capacityStore.status();
        await media.releaseStorageObject({ ...actor(fixture), objectId: cleanupId, storageKey: cleanup.storage_key });
        assert.deepEqual(await capacityStore.status(), fullAgain, "release replay cannot give back a second slot or byte charge");
        await assert.rejects(media.reserveAsset({ ...actor(other), asset: asset({ fullBytes: 1, thumbnailBytes: 1 }) }), code("MEDIA_STORAGE_LIMIT"));
      } finally { try { await connection.rollback(); } catch {} if (seeded) await removeSeed(fixture.client, prefix); }
    });

    await t.test("registration and cleanup transitions roll back journal and counters on metadata failure", async () => {
      const fixture = await pair(), value = asset(), command = { ...actor(fixture), asset: value };
      await media.reserveAsset(command); const before = await capacityStore.status();
      await connection.query("CREATE TRIGGER synthetic_fail_capacity BEFORE INSERT ON media_assets FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic capacity failure'");
      try { await assert.rejects(media.registerAsset(command), code("CHAT_DATABASE_OPERATION")); }
      finally { await connection.query("DROP TRIGGER synthetic_fail_capacity"); }
      assert.deepEqual(await capacityStore.status(), before);
      assert.equal((await connection.query("SELECT state FROM media_storage_objects WHERE id = ?", [value.id]))[0].state, "reserved");
      assert.equal((await connection.query("SELECT id FROM media_assets WHERE id = ?", [value.id])).length, 0);
      await media.registerAsset(command); await remove(fixture, "client", value.id);
      const cleanup = await capacityStore.status();
      await connection.query("CREATE TRIGGER synthetic_fail_capacity BEFORE UPDATE ON media_storage_state FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic capacity failure'");
      try { await assert.rejects(media.releaseStorageObject({ ...actor(fixture), objectId: value.id, storageKey: value.storageKey }), code("CHAT_DATABASE_OPERATION")); }
      finally { await connection.query("DROP TRIGGER synthetic_fail_capacity"); }
      assert.deepEqual(await capacityStore.status(), cleanup);
      assert.equal((await connection.query("SELECT state FROM media_storage_objects WHERE id = ?", [value.id]))[0].state, "cleanup_pending");
    });

    await t.test("offline initialization imports legacy active and deleted assets in bounded pages even above ceilings", async () => {
      const fixture = await pair(); let microsecondAssetId;
      for (let index = 0; index < 105; index++) {
        const value = asset({ fullBytes: 1000, thumbnailBytes: 100 });
        if (index === 0) microsecondAssetId = value.id;
        const createdAt = index === 0 ? "2026-10-15 12:00:01.123456" : sqlDate(now);
        const deletedAt = index === 0 ? "2026-10-15 12:00:01.124789" : index % 2 ? null : sqlDate(now);
        await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
          width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at, deleted_at)
          VALUES (?, ?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [value.id, fixture.client.id, value.storageKey, value.digest,
          index % 2 ? value.digest : null, value.width, value.height, value.thumbnailWidth, value.thumbnailHeight, value.fullBytes, value.thumbnailBytes, createdAt, deletedAt]);
      }
      // Synthetic fixture reset recreates the pre-capacity upgrade condition.
      await connection.query("DELETE FROM media_storage_state");
      assert.equal((await capacityStore.status()).ready, false);
      assert.ok((await capacityStore.listObjects({ limit: 1 })).objects.length);
      await assert.rejects(capacityStore.initialize({ now, offline: true }), code("MEDIA_DATABASE_STATE"));
      await connection.query("DELETE FROM media_storage_objects");
      const legacyCapacity = { ...capacity, ownerBytes: 82, totalBytes: 82 }, legacy = createMediaCapacityStore({ pool, capacity: legacyCapacity });
      const expected = (await connection.query("SELECT COUNT(*) AS count, SUM(full_bytes + thumbnail_bytes + 80) AS bytes FROM media_assets"))[0];
      // A prior fixture also created a photo at now + 1000. Future metadata
      // must refuse initialization atomically rather than weaken lifetime checks.
      await assert.rejects(legacy.initialize({ now, offline: true }), code("MEDIA_DATABASE_STATE"));
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM media_storage_state"))[0].count), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM media_storage_objects"))[0].count), 0);
      // Creation is already in the past here; a deletion 789 microseconds
      // ahead must still refuse the bootstrap without leaving partial rows.
      await assert.rejects(legacy.initialize({ now: now + 1124, offline: true }), code("MEDIA_DATABASE_STATE"));
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM media_storage_state"))[0].count), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM media_storage_objects"))[0].count), 0);
      const maximum = (await connection.query(`SELECT DATE_FORMAT(MAX(GREATEST(created_at, COALESCE(deleted_at, created_at))),
        '%Y-%m-%d %H:%i:%s.%f') AS value FROM media_assets`))[0].value;
      const initializedAt = Date.parse(maximum.slice(0, 23).replace(" ", "T") + "Z") + (maximum.slice(-3) === "000" ? 0 : 1);
      assert.ok(initializedAt > now);
      const initialized = await legacy.initialize({ now: initializedAt, offline: true });
      const preserved = (await connection.query("SELECT created_at, updated_at FROM media_storage_objects WHERE id = ?", [microsecondAssetId]))[0];
      assert.equal(preserved.created_at, "2026-10-15 12:00:01.123456"); assert.equal(preserved.updated_at, sqlDate(initializedAt));
      assert.equal(initialized.heldBytes, Number(expected.bytes)); assert.ok(initialized.heldBytes > legacyCapacity.totalBytes);
      const deleted = (await connection.query("SELECT COALESCE(SUM(full_bytes + thumbnail_bytes + 80), 0) AS bytes FROM media_assets WHERE deleted_at IS NOT NULL"))[0];
      assert.equal(initialized.pendingBytes, Number(deleted.bytes));
      let page = await legacy.listObjects({ limit: 37 }), collected = [...page.objects];
      while (page.hasMore) { page = await legacy.listObjects({ afterId: page.nextCursor, limit: 37 }); collected.push(...page.objects); }
      assert.equal(collected.length, Number(expected.count)); assert.ok(collected.length > 100);
      assert.equal(new Set(collected.map((row) => row.id.toString("hex"))).size, collected.length);
      assert.ok(collected.every((row) => row.storedBytes === row.fullBytes + row.thumbnailBytes + 80 && row.assetId.equals(row.id)));
      await assert.rejects(createMediaStore({ pool, chatStore: chat, capacity: legacyCapacity }).reserveAsset({ ...actor(fixture), asset: asset() }), code("MEDIA_STORAGE_LIMIT"));
      assert.equal((await legacy.status()).heldBytes, initialized.heldBytes);
    });
  } finally {
    if (pool) await pool.end();
    await reset(); await connection.end();
  }
});
