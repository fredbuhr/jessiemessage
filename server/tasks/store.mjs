import { loadStoreMigrations } from "../db/store-migrations.mjs";
import { timingSafeEqual } from "node:crypto";
import { createSessionClock } from "../auth/session-policy.mjs";
import { ChatStoreError, normalizedCheckTree, authoredMigrationCheck } from "../chat/store.mjs";
import { migrationStatus } from "../db/migrations.mjs";
import { openTask, sealTask, taskFingerprint } from "./crypto.mjs";
import { TasksError, fail, id, instant, MAX_VERSION, validateList, validateSave, version } from "./validation.mjs";

const COLUMNS = "id, admin_id, admin_role, conversation_id, title_encrypted, due_at, done, version, request_fingerprint, created_at, updated_at";
const source = "FROM crm_tasks t JOIN conversations c ON c.id = t.conversation_id JOIN users u ON u.id = c.client_id AND u.role = 'client'";
const sqlDate = value => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
function bytes(value, length = 16) { if (!Buffer.isBuffer(value) || value.length !== length) fail(); return value; }
function timestamp(value) {
  if (value instanceof Date) return instant(value.getTime());
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}000$/.test(value)) fail();
  const iso = value.slice(0, 23).replace(" ", "T") + "Z", result = Date.parse(iso);
  if (new Date(instant(result)).toISOString() !== iso) fail(); return result;
}
function storedVersion(value) { return version(String(value), false); }
function flag(value) { if (![0, 1, 0n, 1n].includes(value)) fail(); return Number(value) === 1; }
const schema = {
  id: ["varbinary", false, 16], admin_id: ["varbinary", false, 16], admin_role: ["varchar", false, 8],
  conversation_id: ["varbinary", false, 16], title_encrypted: ["varchar", false, 4096], due_at: ["datetime", true],
  done: ["tinyint", false], version: ["int", false], request_fingerprint: ["varbinary", false, 32],
  created_at: ["datetime", false], updated_at: ["datetime", false],
};

export function createTasksStore({ pool, chatStore, key, clock } = {}) {
  if (typeof pool?.getConnection !== "function" || ["withActor", "withConversation"].some(name => typeof chatStore?.[name] !== "function")
    || !Buffer.isBuffer(key) || key.length !== 32) fail("TASKS_CONFIG");
  key = Buffer.from(key);
  const columns = COLUMNS + (chatStore.replyEnabled === true ? ", reply_kind" : "");
  const projection = columns.split(", ").map(name => `t.${name}`).join(", ") + ", u.pseudonym AS client_name, c.admin_id AS conversation_admin_id";
  const readTime = createSessionClock(clock), nowAt = previous => Math.max(instant(previous), readTime(previous));
  async function authorized(request, operation) {
    bytes(request.tokenHash, 32); instant(request.now); if (request.conversationId !== undefined) bytes(request.conversationId);
    let ownFailure;
    try {
      const method = request.conversationId === undefined ? "withActor" : "withConversation";
      return await chatStore[method]({ ...request, role: "admin" }, async (connection, context) => {
        try { return await operation(connection, context); }
        catch (error) { if (error instanceof TasksError) ownFailure = error; throw error; }
      });
    } catch (error) {
      if (ownFailure) throw ownFailure;
      if (error instanceof TasksError || error instanceof ChatStoreError) throw error;
      fail();
    }
  }
  function decoded(row, adminId, now) {
    try {
      if (!row || !bytes(row.admin_id).equals(bytes(adminId)) || row.admin_role !== "admin"
        || row.conversation_admin_id !== undefined && !bytes(row.conversation_admin_id).equals(adminId)) fail();
      const taskId = bytes(row.id), conversationId = bytes(row.conversation_id), currentVersion = storedVersion(row.version);
      bytes(row.request_fingerprint, 32);
      const dueAt = row.due_at === null ? null : timestamp(row.due_at), done = flag(row.done), createdAt = timestamp(row.created_at), updatedAt = timestamp(row.updated_at);
      if (updatedAt < createdAt || updatedAt > now || typeof row.client_name !== "string" || row.client_name.length < 1
        || row.client_name.length > 64 || !row.client_name.isWellFormed()) fail();
      const title = openTask(row.title_encrypted, key, { adminId, conversationId, taskId, version: currentVersion, dueAt, done });
      return { id: taskId.toString("hex"), conversationId: conversationId.toString("hex"), clientName: row.client_name,
        title, dueAt, done, version: currentVersion, createdAt, updatedAt, ...(row.reply_kind === "reply" ? { reply: true } : {}) };
    } catch { fail(); }
  }
  async function ownedTask(connection, adminId, taskId, now) {
    const row = (await connection.query(`SELECT ${projection} ${source} WHERE t.admin_id = ? AND c.admin_id = ? AND t.id = ? FOR UPDATE`, [adminId, adminId, taskId]))[0];
    if (!row) fail("TASKS_NOT_FOUND"); return decoded(row, adminId, now);
  }
  return Object.freeze({
    async assertSchema(options = {}) {
      let connection;
      try {
        connection = await pool.getConnection();
        const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
        const migrations = await loadStoreMigrations(options), history = await migrationStatus(connection, { database, migrations });
        const expectedSchema = { ...schema, ...(options.experience === true ? { reply_kind: ["varchar", true, 8], reply_through: ["bigint", true], reply_reopened: ["tinyint", false] } : {}) };
        if (migrations.length !== (options.experience === true ? 38 : options.video === true ? 36 : 33) || history.length !== migrations.length || history.some(row => row.state !== "applied")) fail();
        const table = (await connection.query("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'crm_tasks'", [database]))[0];
        if (table?.engine !== "InnoDB") fail();
        const columns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
          CHARACTER_MAXIMUM_LENGTH AS length_value, DATETIME_PRECISION AS precision_value, COLUMN_TYPE AS definition,
          COLLATION_NAME AS collation_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'crm_tasks'`, [database]);
        if (columns.length !== Object.keys(expectedSchema).length) fail();
        for (const [name, [type, nullable, length]] of Object.entries(expectedSchema)) {
          const actual = columns.find(row => row.name === name);
          if (!actual || actual.type !== type || (actual.nullable === "YES") !== nullable || length !== undefined && Number(actual.length_value) !== length
            || type === "datetime" && Number(actual.precision_value) !== 6 || ["int", "tinyint", "bigint"].includes(type) && !actual.definition.includes("unsigned")
            || type === "varchar" && actual.collation_name !== "ascii_bin") fail();
        }
        const indexes = await connection.query("SELECT INDEX_NAME AS name, COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS position, SUB_PART AS prefix_length FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'crm_tasks'", [database]);
        for (const [name, unique, names] of [["PRIMARY", true, ["id"]], ["crm_tasks_due", false, ["admin_id", "done", "due_at", "id"]], ["crm_tasks_conversation", false, ["admin_id", "conversation_id", "id"]]]) {
          const actual = indexes.filter(row => row.name === name).sort((a, b) => Number(a.position) - Number(b.position));
          if (actual.length !== names.length || actual.some((row, index) => row.column_name !== names[index] || Number(row.position) !== index + 1
            || Number(row.non_unique) !== Number(!unique) || row.prefix_length !== null)) fail();
        }
        const migration = migrations.find(row => /^CREATE\s+TABLE\s+crm_tasks\s*\(/i.test(row.sql.trim()));
        if (!migration) fail();
        const checks = await connection.query("SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'crm_tasks'", [database]);
        const authored = [...migration.sql.matchAll(/CONSTRAINT\s+([a-z_]+)\s+CHECK\s*\(/gi)];
        if (checks.length !== authored.length + Number(options.experience === true)) fail();
        if (options.experience === true) {
          const extra = migrations.find(item => item.name === "0038_reply_tracking.sql");
          const check = checks.find(item => item.name === "crm_tasks_reply_state");
          if (!extra || !check || normalizedCheckTree(check.clause) !== normalizedCheckTree(authoredMigrationCheck(extra.sql, "crm_tasks_reply_state"))) fail();
          const unique = indexes.filter(item => item.name === "crm_tasks_reply").sort((a,b) => Number(a.position)-Number(b.position));
          if (unique.length !== 3 || unique.some((item,index) => item.column_name !== ["admin_id","conversation_id","reply_kind"][index] || Number(item.non_unique) !== 0)) fail();
        }
        for (const match of authored) {
          const actual = checks.find(row => row.name === match[1]);
          if (!actual || normalizedCheckTree(actual.clause) !== normalizedCheckTree(authoredMigrationCheck(migration.sql, match[1]))) fail();
        }
        const keys = await connection.query(`SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS child, k.REFERENCED_TABLE_NAME AS parent,
          k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_COLUMN_NAME AS parent_column, k.ORDINAL_POSITION AS position,
          r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k
          JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
          WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = 'crm_tasks' AND k.REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const expected = [["crm_tasks_admin_fk", "admin_id", "users", "id", 1], ["crm_tasks_admin_fk", "admin_role", "users", "role", 2], ["crm_tasks_conversation_fk", "conversation_id", "conversations", "id", 1]];
        if (keys.length !== expected.length || expected.some(([name, child, parent, parentColumn, position]) => !keys.some(row => row.name === name && row.child === child
          && row.parent === parent && row.parent_column === parentColumn && row.parent_schema === database && Number(row.position) === position
          && row.update_rule === "RESTRICT" && row.delete_rule === "RESTRICT"))) fail();
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.check_constraint_checks AS ck"))[0];
        if (Number(enforcement?.fk) !== 1 || Number(enforcement?.ck) !== 1) fail();
        await connection.query(`SELECT ${COLUMNS} FROM crm_tasks WHERE 1 = 0`); return true;
      } catch { fail(); }
      finally { connection?.release(); }
    },
    list({ tokenHash, now, filter = "open", conversationId = null, afterId = null, limit = 50 }) {
      const options = validateList({ filter, conversationId: conversationId === null ? null : bytes(conversationId).toString("hex"),
        afterId: afterId === null ? null : bytes(afterId).toString("hex"), limit });
      return authorized({ tokenHash, now, ...(conversationId === null ? {} : { conversationId }) }, async (connection, context) => {
        now = nowAt(context.now);
        const where = ["t.admin_id = ?", "c.admin_id = ?", "t.done = ?"], parameters = [context.actor.id, context.actor.id, Number(options.filter === "done")];
        if (filter === "due") { where.push("t.due_at <= ?"); parameters.push(sqlDate(now)); }
        if (conversationId !== null) { where.push("t.conversation_id = ?"); parameters.push(conversationId); }
        if (afterId !== null) { where.push("t.id > ?"); parameters.push(afterId); }
        const rows = await connection.query(`SELECT ${projection} ${source} WHERE ${where.join(" AND ")} ORDER BY t.id ASC LIMIT ?`, [...parameters, limit + 1]);
        if (!Array.isArray(rows) || rows.length > limit + 1) fail();
        const tasks = rows.slice(0, limit).map(row => decoded(row, context.actor.id, now));
        let previous = options.afterId;
        for (const task of tasks) {
          if (previous !== null && task.id <= previous || conversationId !== null && task.conversationId !== options.conversationId
            || task.done !== (filter === "done") || filter === "due" && (task.dueAt === null || task.dueAt > now)) fail(); previous = task.id;
        }
        const hasMore = rows.length > limit;
        return { tasks, hasMore, nextCursor: hasMore ? tasks.at(-1).id : null, serverTime: now };
      });
    },
    summary({ tokenHash, now }) {
      return authorized({ tokenHash, now }, async (connection, context) => {
        now = nowAt(context.now);
        const rows = await connection.query(`SELECT COUNT(*) AS due_count ${source} WHERE t.admin_id = ? AND c.admin_id = ? AND t.done = 0 AND t.due_at <= ?`,
          [context.actor.id, context.actor.id, sqlDate(now)]);
        const dueCount = Number(rows?.[0]?.due_count);
        if (!Array.isArray(rows) || rows.length !== 1 || !Number.isSafeInteger(dueCount) || dueCount < 0) fail();
        return { dueCount, serverTime: now };
      });
    },
    get({ tokenHash, now, taskId }) {
      bytes(taskId);
      return authorized({ tokenHash, now }, async (connection, context) => {
        now = nowAt(context.now); return { task: await ownedTask(connection, context.actor.id, taskId, now), serverTime: now };
      });
    },
    save({ tokenHash, now, taskId, input }) {
      bytes(taskId); input = validateSave(input);
      const conversationId = Buffer.from(id(input.conversationId), "hex");
      return authorized({ tokenHash, now, conversationId }, async (connection, context) => {
        now = nowAt(context.now);
        const row = (await connection.query(`SELECT * FROM crm_tasks WHERE id = ? FOR UPDATE`, [taskId]))[0] ?? null;
        if (row && (!bytes(row.admin_id).equals(context.actor.id) || !bytes(row.conversation_id).equals(conversationId))) fail("TASKS_NOT_FOUND");
        if (row) decoded({ ...row, client_name: context.client.pseudonym }, context.actor.id, now);
        // The generic editor cannot bypass the reply watermark.
        if (row?.reply_kind === "reply") fail("TASKS_CONFLICT");
        const fingerprint = taskFingerprint(input, key, { adminId: context.actor.id, taskId });
        const previousVersion = row === null ? "0" : storedVersion(row.version);
        if (row && BigInt(previousVersion) === BigInt(input.expectedVersion) + 1n && timingSafeEqual(bytes(row.request_fingerprint, 32), fingerprint)) {
          return { task: decoded({ ...row, client_name: context.client.pseudonym }, context.actor.id, now), duplicate: true };
        }
        if (previousVersion !== input.expectedVersion) fail("TASKS_CONFLICT");
        if (BigInt(input.expectedVersion) >= MAX_VERSION) fail("TASKS_LIMIT");
        const next = String(BigInt(previousVersion) + 1n), completedAt = nowAt(now);
        const encrypted = sealTask(input.title, key, { adminId: context.actor.id, conversationId, taskId, version: next, dueAt: input.dueAt, done: input.done });
        if (row) await connection.query(`UPDATE crm_tasks SET title_encrypted = ?, due_at = ?, done = ?, version = ?, request_fingerprint = ?, updated_at = ?
          WHERE id = ? AND admin_id = ? AND conversation_id = ?`, [encrypted, input.dueAt === null ? null : sqlDate(input.dueAt), Number(input.done), next,
          fingerprint, sqlDate(completedAt), taskId, context.actor.id, conversationId]);
        else await connection.query(`INSERT INTO crm_tasks (id, admin_id, conversation_id, title_encrypted, due_at, done, version, request_fingerprint, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [taskId, context.actor.id, conversationId, encrypted, input.dueAt === null ? null : sqlDate(input.dueAt),
          Number(input.done), next, fingerprint, sqlDate(now), sqlDate(completedAt)]);
        return { task: await ownedTask(connection, context.actor.id, taskId, nowAt(completedAt)), duplicate: false };
      });
    },
  });
}
