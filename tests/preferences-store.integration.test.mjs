import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations } from "../server/db/migrations.mjs";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createPreferencesStore } from "../server/preferences/store.mjs";
import { createPreferencesService } from "../server/preferences/service.mjs";
import { preferencesIndex, PREFERENCES_CATALOGUE_VERSION } from "../server/preferences/validation.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", id = () => randomBytes(16), sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
test("real MariaDB preferences: owner-only encrypted selections, cross-device CAS, authorised peer view and safe clearing", { skip: enabled ? false : "Requires explicit loopback disposable MariaDB database.", timeout: 120000 }, async t => {
  const options = databaseOptions(); assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host)); assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  const migrations = await loadExperienceMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, service;
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(table => allowed.includes(table.name)), "refuse cleanup of unrelated tables");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations }); pool = await createRuntimePool(process.env);
    const now = Date.now(), created = sql(now - 1000), byToken = new Map();
    async function user(role) {
      const value = { id: id(), sessionId: id(), role, token: newToken() };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at, access_approved_at, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`, [value.id, role, `Synthetic ${role}`, `${value.id.toString("hex")}@example.invalid`, created, created, created, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [value.id, created]);
      else { await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, created]); await consumeSyntheticInvitation(connection, value.id, now - 1000); }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [value.sessionId, value.id, tokenDigest(value.token), created, sql(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [value.sessionId, created, created]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [value.sessionId, created]);
      byToken.set(value.token, value); return value;
    }
    const admin = await user("admin"), foreignAdmin = await user("admin"), client = await user("client"), other = await user("client"), conversation = id(), otherConversation = id();
    await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)", [conversation, admin.id, client.id, created, otherConversation, admin.id, other.id, created]);
    const store = createPreferencesStore({ pool, chatStore: createChatStore(pool) });
    service = createPreferencesService({ store, key: Buffer.alloc(32, 19), clock: () => now,
      chatService: { async actor(role, token) { const actor = byToken.get(token); if (!actor || actor.role !== role) throw { code: "CHAT_UNAUTHORIZED" }; return { user: { id: actor.id.toString("hex"), role }, csrf: token }; } },
      authStore: { async consumeRateLimit() { return { allowed: true }; } },
    });
    const choices = [...preferencesIndex.keys()].slice(0, 4), input = (selectedIds, expectedVersion = "0") => ({ selectedIds, expectedVersion, catalogueVersion: PREFERENCES_CATALOGUE_VERSION });
    await t.test("empty optional preferences create no row and schema is exact", async () => {
      assert.equal(await store.assertSchema(), true); assert.deepEqual((await service.read("client", client.token)).selectedIds, []);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM profile_preferences"))[0].value), 0);
    });
    await t.test("own selections encrypt at rest, remain independent and can be read from another authenticated session", async () => {
      for (const actor of [admin, client]) { const value = await service.save(actor.role, actor.token, input(choices)); assert.equal(value.version, "1"); assert.deepEqual((await service.read(actor.role, actor.token)).selectedIds, choices); }
      const secondToken = newToken(), secondSession = id();
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [secondSession, client.id, tokenDigest(secondToken), created, sql(now + 8 * 3600000)]);
      await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [secondSession, created]);
      byToken.set(secondToken, client);
      assert.deepEqual((await service.read("client", secondToken)).selectedIds, choices);
      const row = (await connection.query("SELECT selection_encrypted FROM profile_preferences WHERE user_id = ?", [client.id]))[0];
      assert.equal(choices.some(choice => row.selection_encrypted.includes(choice)), false);
      assert.deepEqual((await service.read("client", other.token)).selectedIds, []);
    });
    await t.test("CAS serialises different saves and exact replays do not create another version", async () => {
      const result = await Promise.allSettled([choices.slice(0, 1), choices.slice(1, 2)].map(value => service.save("client", client.token, input(value, "1"))));
      assert.equal(result.filter(value => value.status === "fulfilled").length, 1); assert.equal(result.filter(value => value.status === "rejected" && value.reason.code === "PREFERENCES_CONFLICT").length, 1);
      const saved = result.find(value => value.status === "fulfilled").value;
      assert.deepEqual(await service.save("client", client.token, input(saved.selectedIds, "1")), saved);
    });
    await t.test("only its conversation administrator reads a client's selections; all writes remain owner-only", async () => {
      assert.deepEqual(await service.peer("admin", admin.token, conversation.toString("hex")), await service.read("client", client.token));
      await assert.rejects(service.peer("admin", foreignAdmin.token, conversation.toString("hex")), error => error.code === "PREFERENCES_NOT_FOUND");
      await assert.rejects(service.peer("client", other.token, conversation.toString("hex")), error => error.code === "PREFERENCES_FORBIDDEN");
      await assert.rejects(service.save("client", other.token, { ...input([]), userId: client.id.toString("hex") }), error => error.code === "PREFERENCES_INPUT");
    });
    await t.test("clearing preserves messages, avatar profile, users and other owners; revoked sessions stop reading", async () => {
      await service.save("client", client.token, input([], "2")); assert.deepEqual((await service.read("client", client.token)).selectedIds, []);
      assert.equal((await service.read("admin", admin.token)).selectedIds.length, choices.length);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM users"))[0].value), 4);
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sql(now), client.sessionId]);
      await assert.rejects(service.read("client", client.token), error => error.code === "PREFERENCES_UNAUTHORIZED");
    });
  } finally { service?.close(); try { await pool?.end(); } finally { try { await cleanup(); } finally { await connection.end(); } } }
});
