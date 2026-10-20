import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createProfileStore, ProfileStoreError } from "../server/profile/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", id = () => randomBytes(16), digest = () => randomBytes(32);
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const rejects = code => error => error instanceof ProfileStoreError && error.code === code;

test("real MariaDB own profiles, bounded private avatars and simultaneous updates (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  assert.equal(migrations.length, 31);
  const connection = await connectDatabase(); let pool;
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(value => allowed.includes(value.name)), "refuse cleanup of unrelated tables");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations }); pool = await createRuntimePool(process.env);
    const now = Date.now(), created = sql(now - 1000);
    async function user(role) {
      const value = { id: id(), tokenHash: digest(), sessionId: id(), role };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [value.id, role, `Synthetic ${role}`, `${value.id.toString("hex")}@example.invalid`, created, created, created, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [value.id, created]);
      else { await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, created]); await consumeSyntheticInvitation(connection, value.id, now - 1000); }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [value.sessionId, value.id, value.tokenHash, created, sql(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [value.sessionId, created, created]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [value.sessionId, created]);
      return value;
    }
    const admin = await user("admin"), first = await user("client"), second = await user("client"), conversationId = id(), otherConversationId = id();
    await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)", [conversationId, admin.id, first.id, created, otherConversationId, admin.id, second.id, created]);
    const chatStore = createChatStore(pool), store = createProfileStore({ pool, chatStore });
    const request = actor => ({ role: actor.role, tokenHash: actor.tokenHash, now });
    async function asset(owner, width = 256, fullBytes = 7) {
      const assetId = id(), content = digest();
      // Only bounded metadata is needed to exercise transactional ownership;
      // this fixture does not create or decode any private media file.
      await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
        width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 7, ?)`,
      [assetId, owner.id, owner.role, digest(), content, content, width, width, Math.min(480, width), Math.min(480, width), fullBytes, created]);
      return assetId;
    }
    const own = await asset(first), foreign = await asset(second), adminAvatar = await asset(admin), tooLarge = await asset(first, 513), tooHeavy = await asset(first, 256, 262145);
    await t.test("schema and absent own profiles are readable without materializing rows", async () => {
      assert.equal(await store.assertSchema(), true);
      for (const actor of [admin, first]) {
        const value = await store.getProfile(request(actor));
        assert.equal(value.version, "0"); assert.equal(value.avatarId, null); assert.ok(value.userId.equals(actor.id));
      }
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM user_profiles"))[0].value), 0);
    });
    await t.test("own name and avatar update together; peer access stays within the conversation", async () => {
      const value = await store.saveProfile({ ...request(first), expectedVersion: "0", pseudonym: "Changed client", avatarId: own });
      assert.equal(value.version, "1"); assert.ok(value.avatarId.equals(own));
      const peer = await store.getPeerAvatar({ ...request(admin), conversationId, version: "1" }); assert.ok(peer.assetId.equals(own));
      const chat = await chatStore.readMessages({ ...request(admin), conversationId });
      assert.equal(chat.conversation.peerPseudonym, "Changed client"); assert.equal(chat.conversation.peerAvatarVersion, "1");
      await assert.rejects(store.getPeerAvatar({ ...request(second), conversationId, version: "1" }), error => error.code === "CHAT_NOT_FOUND");
      await store.saveProfile({ ...request(admin), expectedVersion: "0", pseudonym: "Changed Jessie", avatarId: adminAvatar });
      assert.ok((await store.getPeerAvatar({ ...request(first), conversationId, version: "1" })).assetId.equals(adminAvatar));
      assert.equal((await chatStore.getClientConversation({ tokenHash: first.tokenHash, now })).peerAvatarVersion, "1");
    });
    await t.test("foreign, deleted and oversized avatar attempts never partially rename the owner", async () => {
      for (const [avatarId, code] of [[foreign, "PROFILE_NOT_FOUND"], [tooLarge, "PROFILE_AVATAR"], [tooHeavy, "PROFILE_AVATAR"]]) {
        await assert.rejects(store.saveProfile({ ...request(first), expectedVersion: "1", pseudonym: "Must not be saved", avatarId }), rejects(code));
        const value = await store.getProfile(request(first)); assert.equal(value.pseudonym, "Changed client"); assert.equal(value.version, "1"); assert.ok(value.avatarId.equals(own));
      }
      await connection.query("UPDATE media_assets SET deleted_at = ?, active_digest = NULL WHERE id = ?", [sql(now), own]);
      await assert.rejects(store.saveProfile({ ...request(first), expectedVersion: "1", pseudonym: "Must not be saved", avatarId: own }), rejects("PROFILE_NOT_FOUND"));
      const content = (await connection.query("SELECT content_digest FROM media_assets WHERE id = ?", [own]))[0].content_digest;
      await connection.query("UPDATE media_assets SET deleted_at = NULL, active_digest = ? WHERE id = ?", [content, own]);
    });
    await t.test("simultaneous saves serialize on the current account and stale versions conflict", async () => {
      const saves = await Promise.allSettled(["First", "Second"].map(pseudonym => store.saveProfile({ ...request(first), expectedVersion: "1", pseudonym, avatarId: own })));
      assert.equal(saves.filter(value => value.status === "fulfilled").length, 1);
      assert.equal(saves.filter(value => value.status === "rejected" && value.reason.code === "PROFILE_CONFLICT").length, 1);
      const value = await store.getProfile(request(first)); assert.equal(value.version, "2");
      await assert.rejects(store.getAvatar({ ...request(first), version: "1" }), rejects("PROFILE_NOT_FOUND"));
      assert.ok((await store.getAvatar({ ...request(first), version: "2" })).assetId.equals(own));
    });
    await t.test("removing an avatar preserves the uploaded asset and ordinary sessions", async () => {
      await store.saveProfile({ ...request(first), expectedVersion: "2", pseudonym: "Without avatar", avatarId: null });
      assert.equal((await store.getProfile(request(first))).avatarId, null);
      assert.equal((await connection.query("SELECT deleted_at FROM media_assets WHERE id = ?", [own]))[0].deleted_at, null);
      assert.equal((await chatStore.getClientConversation({ tokenHash: first.tokenHash, now })).peerPseudonym, "Changed Jessie");
      const adminConversation = await chatStore.readMessages({ ...request(admin), conversationId });
      assert.equal(Object.hasOwn(adminConversation.conversation, "peerAvatarVersion"), false);
    });
  } finally { try { await pool?.end(); } finally { try { await cleanup(); } finally { await connection.end(); } } }
});
