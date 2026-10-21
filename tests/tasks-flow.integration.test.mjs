// Loopback disposable SQL and synthetic identities only. Tasks are private
// application reminders: no message, e-mail or Push transport runs here.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createTasksStore } from "../server/tasks/store.mjs";
import { createTasksService } from "../server/tasks/service.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), hex = value => value.toString("hex");
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const conflict = error => error?.code === "TASKS_CONFLICT";
test("real MariaDB private tasks persist, retry, page and serialize simultaneous administrators", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(); assert.equal(migrations.length, 33);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(table => allowedTables.includes(table.name)), "refuse cleanup of unrelated tables");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    let now = Date.now(); const clock = () => now, created = sql(now - 1000), key = randomBytes(32), actors = new Map();
    async function user(role) {
      const value = { id: id(), sessionId: id(), token: newToken(), role, pseudonym: `Task ${role}` };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [value.id, role, value.pseudonym, `${hex(value.id)}@example.invalid`, created, created, created, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [value.id, created]);
      else { await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, created]); await consumeSyntheticInvitation(connection, value.id, now - 1000); }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [value.sessionId, value.id, tokenDigest(value.token), created, sql(now + 8 * 3600000)]);
      await connection.query(role === "admin" ? "INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)"
        : "INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", role === "admin" ? [value.sessionId, created, created] : [value.sessionId, created]);
      actors.set(value.token, { user: { id: hex(value.id), role, pseudonym: value.pseudonym }, csrf: newToken(), expiresAt: now + 8 * 3600000 }); return value;
    }
    const admin = await user("admin"), other = await user("admin"), first = await user("client"), second = await user("client"), foreign = await user("client");
    for (const [owner, client] of [[admin, first], [admin, second], [other, foreign]]) {
      client.conversationId = id(); await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?)", [client.conversationId, owner.id, client.id, created]);
    }
    const authService = { session: async token => actors.get(token) ?? null };
    async function runtime(selectedPool = pool) {
      const authStore = createAuthStore(selectedPool), chatStore = createChatStore(selectedPool, { clock });
      const store = createTasksStore({ pool: selectedPool, chatStore, key, clock });
      return { store, service: await createTasksService({ store, authService, authStore, key, clock }) };
    }
    const { store, service } = await runtime();
    const input = (client = first, changes = {}) => ({ conversationId: hex(client.conversationId), expectedVersion: "0", title: "Envoyer les photos promises 💋", dueAt: now + 1000, done: false, ...changes });
    const savedIds = [];
    await t.test("schema and empty lists are current, private and do not create tasks", async () => {
      assert.equal(await store.assertSchema(), true);
      assert.deepEqual(await service.list(admin.token, {}), { tasks: [], hasMore: false, nextCursor: null, serverTime: now });
      assert.deepEqual(await service.summary(admin.token), { dueCount: 0, serverTime: now });
      await assert.rejects(service.list(first.token, {}));
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM crm_tasks"))[0].value), 0);
    });
    await t.test("multiple encrypted tasks survive a runtime restart and an acknowledged retry is not duplicated", async () => {
      const taskId = hex(id()), request = input(), saved = await service.save(admin.token, taskId, request); savedIds.push(taskId);
      assert.equal(saved.duplicate, false); assert.equal(saved.task.version, "1"); assert.equal(saved.task.title, request.title);
      assert.equal(saved.task.clientName, first.pseudonym);
      const secondId = hex(id()); savedIds.push(secondId); await service.save(admin.token, secondId, input(first, { title: "Préparer la vidéo", dueAt: null }));
      const otherId = hex(id()); savedIds.push(otherId); await service.save(admin.token, otherId, input(second));
      const raw = (await connection.query("SELECT title_encrypted FROM crm_tasks WHERE id = ?", [Buffer.from(taskId, "hex")]))[0].title_encrypted;
      assert.ok(!raw.includes(request.title));
      const restarted = await runtime(); assert.equal((await restarted.service.get(admin.token, taskId)).task.title, request.title);
      assert.equal((await restarted.service.save(admin.token, taskId, request)).duplicate, true);
      await assert.rejects(service.save(admin.token, taskId, { ...request, title: "Changed after lost response" }), conflict);
      assert.equal((await service.list(admin.token, { conversationId: hex(first.conversationId) })).tasks.length, 2);
    });
    await t.test("owner and conversation isolation apply to reads, edits, summary and creation", async () => {
      assert.equal((await service.list(other.token, {})).tasks.length, 0);
      await assert.rejects(service.get(admin.token, hex(id())), error => error.code === "TASKS_NOT_FOUND");
      await assert.rejects(service.get(other.token, savedIds[0]), error => error.code === "TASKS_NOT_FOUND");
      await assert.rejects(service.save(other.token, savedIds[0], input(foreign)), error => ["TASKS_NOT_FOUND", "CHAT_NOT_FOUND"].includes(error.code));
      await assert.rejects(service.save(admin.token, hex(id()), input(foreign)), error => ["TASKS_NOT_FOUND", "CHAT_NOT_FOUND", "TASKS_FORBIDDEN"].includes(error.code));
      await assert.rejects(service.save(admin.token, savedIds[0], input(second, { expectedVersion: "1" })), error => error.code === "TASKS_NOT_FOUND");
      assert.equal((await service.summary(other.token)).dueCount, 0);
    });
    await t.test("deadline boundary, completion, reopening and postponement update only the selected task", async () => {
      assert.equal((await service.summary(admin.token)).dueCount, 0); now += 1000;
      assert.equal((await service.summary(admin.token)).dueCount, 2);
      assert.equal((await service.list(admin.token, { filter: "due" })).tasks.length, 2);
      const previous = (await service.get(admin.token, savedIds[0])).task;
      const done = await service.save(admin.token, previous.id, input(first, { expectedVersion: previous.version, done: true, dueAt: previous.dueAt }));
      assert.equal(done.task.version, "2"); assert.equal((await service.summary(admin.token)).dueCount, 1);
      assert.deepEqual((await service.list(admin.token, { filter: "done" })).tasks.map(task => task.id), [previous.id]);
      const reopened = await service.save(admin.token, previous.id, input(first, { expectedVersion: "2", dueAt: now + 60000 }));
      assert.equal(reopened.task.done, false); assert.equal((await service.summary(admin.token)).dueCount, 1);
    });
    await t.test("pagination is bounded and monotonic across clients without leaking another owner", async () => {
      const seen = []; let afterId = null;
      do {
        const page = await service.list(admin.token, { limit: 1, afterId });
        assert.ok(page.tasks.length <= 1); seen.push(...page.tasks.map(task => task.id)); afterId = page.nextCursor;
        assert.equal(page.hasMore, afterId !== null);
      } while (afterId !== null);
      assert.deepEqual(seen, [...savedIds].sort()); assert.equal(new Set(seen).size, savedIds.length);
    });
    await t.test("two devices cannot overwrite one revision, and a failed write rolls back completely", async () => {
      const simultaneousId = hex(id()), newTask = input();
      const created = await Promise.allSettled([service.save(admin.token, simultaneousId, { ...newTask, title: "Create on first device" }),
        service.save(admin.token, simultaneousId, { ...newTask, title: "Create on second device" })]);
      assert.equal(created.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(created.filter(result => result.status === "rejected" && conflict(result.reason)).length, 1);
      const task = (await service.get(admin.token, savedIds[0])).task;
      const base = input(first, { expectedVersion: task.version, dueAt: task.dueAt });
      const settled = await Promise.allSettled([service.save(admin.token, task.id, { ...base, title: "First device" }), service.save(admin.token, task.id, { ...base, title: "Second device" })]);
      assert.equal(settled.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(settled.filter(result => result.status === "rejected" && conflict(result.reason)).length, 1);
      const before = (await service.get(admin.token, task.id)).task;
      const interruptedPool = { async getConnection() {
        const current = await pool.getConnection();
        return new Proxy(current, { get(target, name) {
          if (name === "query") return async (statement, ...args) => {
            const result = await target.query(statement, ...args);
            if (/^UPDATE crm_tasks SET/u.test(statement)) throw new Error("synthetic private task interruption"); return result;
          };
          const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
        } });
      } };
      const interrupted = await runtime(interruptedPool);
      await assert.rejects(interrupted.service.save(admin.token, task.id, input(first, { expectedVersion: before.version, title: "Must roll back" })), error => !error.message.includes("synthetic private task interruption"));
      assert.deepEqual((await service.get(admin.token, task.id)).task, before);
    });
    await t.test("changed ciphertext or scheduling metadata is rejected, including sub-millisecond SQL aliases", async () => {
      const taskId = Buffer.from(savedIds[0], "hex"), raw = (await connection.query("SELECT title_encrypted, due_at FROM crm_tasks WHERE id = ?", [taskId]))[0];
      await connection.query("UPDATE crm_tasks SET done = 1 WHERE id = ?", [taskId]);
      try { await assert.rejects(service.get(admin.token, savedIds[0]), error => error.code === "TASKS_UNAVAILABLE"); }
      finally { await connection.query("UPDATE crm_tasks SET done = 0 WHERE id = ?", [taskId]); }
      const dueAt = String(raw.due_at).replace(/000$/, "001");
      await connection.query("UPDATE crm_tasks SET due_at = ? WHERE id = ?", [dueAt, taskId]);
      try { await assert.rejects(service.get(admin.token, savedIds[0]), error => error.code === "TASKS_UNAVAILABLE"); }
      finally { await connection.query("UPDATE crm_tasks SET due_at = ? WHERE id = ?", [raw.due_at, taskId]); }
      await connection.query("UPDATE crm_tasks SET title_encrypted = ? WHERE id = ?", [raw.title_encrypted.slice(0, -2), taskId]);
      try { await assert.rejects(service.get(admin.token, savedIds[0]), error => error.code === "TASKS_UNAVAILABLE"); }
      finally { await connection.query("UPDATE crm_tasks SET title_encrypted = ? WHERE id = ?", [raw.title_encrypted, taskId]); }
    });
    await t.test("live SQL authorization rejects a revoked session despite a stale service session", async () => {
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sql(now), admin.sessionId]);
      await assert.rejects(service.list(admin.token, {}), error => error.code === "TASKS_UNAUTHORIZED");
      await assert.rejects(service.summary(admin.token), error => error.code === "TASKS_UNAUTHORIZED");
      await assert.rejects(service.save(admin.token, hex(id()), input()), error => error.code === "TASKS_UNAUTHORIZED");
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM messages"))[0].value), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM push_outbox"))[0].value), 0);
    });
  } finally {
    await pool?.end(); try { await reset(); } finally { await connection.end(); }
  }
});
