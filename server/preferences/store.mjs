import { failPreferences, ownerId, preferenceVersion, MAX_PREFERENCES_ENVELOPE_BYTES } from "./validation.mjs";
const bytes = value => { if (!Buffer.isBuffer(value) || value.length !== 16) failPreferences(); return value; };
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
function request(value) {
  if (!value || !["admin", "client"].includes(value.role) || !Buffer.isBuffer(value.tokenHash) || value.tokenHash.length !== 32 || !Number.isSafeInteger(value.now) || value.now < 0 || value.now > 253402300799999) failPreferences("PREFERENCES_INPUT");
}
function rowValue(row, owner) {
  bytes(owner);
  if (!row) return { userId: Buffer.from(owner), version: "0", encrypted: null };
  if (!bytes(row.user_id).equals(owner) || !preferenceVersion(String(row.version)) || String(row.version) === "0" || typeof row.selection_encrypted !== "string" || Buffer.byteLength(row.selection_encrypted) > MAX_PREFERENCES_ENVELOPE_BYTES) failPreferences();
  return { userId: Buffer.from(owner), version: String(row.version), encrypted: row.selection_encrypted };
}
export function createPreferencesStore({ pool, chatStore }) {
  if (typeof pool?.getConnection !== "function" || typeof chatStore?.withActor !== "function" || typeof chatStore?.withConversation !== "function") throw new TypeError("A private preferences store is required.");
  async function selected(connection, owner) {
    const rows = await connection.query("SELECT user_id, version, selection_encrypted FROM profile_preferences WHERE user_id = ? FOR UPDATE", [owner]);
    if (rows.length > 1) failPreferences();
    return rowValue(rows[0], owner);
  }
  return Object.freeze({
    async assertSchema() {
      const connection = await pool.getConnection();
      try {
        const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
        if (typeof database !== "string") failPreferences();
        const columns = await connection.query("SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'profile_preferences'", [database]);
        const expected = { user_id: "varbinary", version: "int", selection_encrypted: "mediumtext", created_at: "datetime", updated_at: "datetime" };
        if (columns.length !== 5 || columns.some(column => column.nullable !== "NO" || expected[column.name] !== column.type)) failPreferences();
        await connection.query("SELECT user_id, version, selection_encrypted, created_at, updated_at FROM profile_preferences WHERE 1 = 0");
        return true;
      } finally { connection.release(); }
    },
    async read(options) {
      request(options);
      return chatStore.withActor(options, (connection, context) => selected(connection, context.actor.id));
    },
    async peer(options) {
      request(options); if (options.role !== "admin") failPreferences("PREFERENCES_FORBIDDEN"); bytes(options.conversationId);
      return chatStore.withConversation(options, (connection, context) => {
        if (context.actor.role !== "admin") failPreferences("PREFERENCES_FORBIDDEN");
        return selected(connection, context.client.id);
      });
    },
    async save(options) {
      request(options);
      if (!preferenceVersion(options.expectedVersion) || options.expectedVersion === "4294967295" || typeof options.encrypt !== "function" || typeof options.same !== "function") failPreferences("PREFERENCES_INPUT");
      return chatStore.withActor(options, async (connection, context) => {
        const owner = ownerId(bytes(context.actor.id).toString("hex")), current = await selected(connection, context.actor.id);
        if (current.version !== options.expectedVersion) {
          if (BigInt(current.version) === BigInt(options.expectedVersion) + 1n && await options.same(current)) return current;
          failPreferences("PREFERENCES_CONFLICT");
        }
        const version = String(BigInt(current.version) + 1n), encrypted = await options.encrypt(owner, version);
        if (typeof encrypted !== "string" || encrypted.length < 1 || Buffer.byteLength(encrypted) > MAX_PREFERENCES_ENVELOPE_BYTES) failPreferences();
        if (current.version === "0") await connection.query("INSERT INTO profile_preferences (user_id, version, selection_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [context.actor.id, version, encrypted, sqlDate(context.now), sqlDate(context.now)]);
        else await connection.query("UPDATE profile_preferences SET version = ?, selection_encrypted = ?, updated_at = ? WHERE user_id = ? AND version = ?", [version, encrypted, sqlDate(context.now), context.actor.id, current.version]);
        return { userId: Buffer.from(context.actor.id), version, encrypted };
      });
    },
  });
}
