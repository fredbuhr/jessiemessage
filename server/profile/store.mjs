import { ChatStoreError } from "../chat/store.mjs";
import { loadMigrations, migrationStatus } from "../db/migrations.mjs";
import { canonicalProfileName, isProfileVersion, MAX_PROFILE_VERSION, MAX_AVATAR_FULL_BYTES, MAX_AVATAR_THUMBNAIL_BYTES, MAX_AVATAR_SIDE } from "./validation.mjs";

export class ProfileStoreError extends ChatStoreError {
  constructor(code) { super(code, "Private profile persistence could not be completed."); this.name = "ProfileStoreError"; }
}
const fail = code => { throw new ProfileStoreError(code); };
const bytes = (value, length) => { if (!Buffer.isBuffer(value) || value.length !== length) fail("PROFILE_INPUT"); return value; };
const instant = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
function timestamp(value) {
  if (value instanceof Date) { const time = value.getTime(); if (instant(time)) return time; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) fail("PROFILE_DATABASE_STATE");
  const time = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!instant(time)) fail("PROFILE_DATABASE_STATE");
  return time;
}
function request(value) {
  if (!value || !["admin", "client"].includes(value.role) || !instant(value.now)) fail("PROFILE_INPUT");
  bytes(value.tokenHash, 32);
}
function storedVersion(value) {
  const version = String(value);
  if (!isProfileVersion(version, false)) fail("PROFILE_DATABASE_STATE");
  return version;
}
function name(value, stored = false) {
  try { const result = canonicalProfileName(value); if (stored && result !== value) throw new Error(); return result; }
  catch { fail(stored ? "PROFILE_DATABASE_STATE" : "PROFILE_INPUT"); }
}

export function createProfileStore({ pool, chatStore }) {
  if (typeof pool?.getConnection !== "function" || typeof chatStore?.withActor !== "function" || typeof chatStore?.withConversation !== "function") fail("PROFILE_CONFIG");
  async function selected(connection, user, now) {
    const row = (await connection.query("SELECT user_id, avatar_media_id, version, created_at, updated_at FROM user_profiles WHERE user_id = ? FOR UPDATE", [user.id]))[0];
    const pseudonym = name(user.pseudonym, true);
    if (!row) return { userId: Buffer.from(user.id), pseudonym, version: "0", avatarId: null };
    if (!Buffer.isBuffer(row.user_id) || !row.user_id.equals(user.id)) fail("PROFILE_DATABASE_STATE");
    const createdAt = timestamp(row.created_at), updatedAt = timestamp(row.updated_at);
    if (createdAt > now || updatedAt < createdAt || updatedAt > now) fail("PROFILE_DATABASE_STATE");
    if (row.avatar_media_id !== null) bytes(row.avatar_media_id, 16);
    return { userId: Buffer.from(user.id), pseudonym, version: storedVersion(row.version), avatarId: row.avatar_media_id === null ? null : Buffer.from(row.avatar_media_id) };
  }
  async function avatar(connection, user, profile, now) {
    if (profile.avatarId === null) fail("PROFILE_NOT_FOUND");
    const row = (await connection.query(`SELECT id, owner_id, owner_role, storage_key, width, height, thumbnail_width, thumbnail_height,
      full_bytes, thumbnail_bytes, created_at, deleted_at FROM media_assets WHERE id = ? AND owner_id = ? FOR UPDATE`, [profile.avatarId, user.id]))[0];
    if (!row || row.deleted_at !== null || !Buffer.isBuffer(row.id) || !row.id.equals(profile.avatarId)
      || !Buffer.isBuffer(row.owner_id) || !row.owner_id.equals(user.id) || row.owner_role !== user.role || timestamp(row.created_at) > now) fail("PROFILE_NOT_FOUND");
    const width = Number(row.width), height = Number(row.height), fullBytes = Number(row.full_bytes), thumbnailBytes = Number(row.thumbnail_bytes);
    if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= MAX_AVATAR_SIDE)
      || ![Number(row.thumbnail_width), Number(row.thumbnail_height)].every(value => Number.isInteger(value) && value >= 1 && value <= MAX_AVATAR_SIDE)
      || Number(row.thumbnail_width) > width || Number(row.thumbnail_height) > height
      || !Number.isSafeInteger(fullBytes) || fullBytes < 1 || fullBytes > MAX_AVATAR_FULL_BYTES
      || !Number.isSafeInteger(thumbnailBytes) || thumbnailBytes < 1 || thumbnailBytes > MAX_AVATAR_THUMBNAIL_BYTES) fail("PROFILE_AVATAR");
    bytes(row.storage_key, 32);
    return { userId: Buffer.from(user.id), version: profile.version, assetId: Buffer.from(row.id), storageKey: Buffer.from(row.storage_key), thumbnailBytes };
  }
  return Object.freeze({
    async assertSchema() {
      let connection;
      try {
        connection = await pool.getConnection();
        const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checks"))[0];
        if (typeof database !== "string" || Number(enforcement?.foreignKeys) !== 1 || Number(enforcement?.checks) !== 1) fail("PROFILE_DATABASE_STATE");
        const migrations = await loadMigrations();
        const history = await migrationStatus(connection, { database, migrations });
        if (migrations.length < 31 || !/^CREATE\s+TABLE\s+user_profiles\s*\(/i.test(migrations[30].sql.trim()) || history.some(value => value.state !== "applied")) fail("PROFILE_DATABASE_STATE");
        const tables = await connection.query("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_profiles'", [database]);
        if (tables.length !== 1 || tables[0].engine !== "InnoDB") fail("PROFILE_DATABASE_STATE");
        const columns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
          CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue, COLUMN_TYPE AS columnType
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_profiles'`, [database]);
        const expected = { user_id: ["varbinary", false, 16], avatar_media_id: ["varbinary", true, 16], version: ["int", false], created_at: ["datetime", false], updated_at: ["datetime", false] };
        if (columns.length !== Object.keys(expected).length) fail("PROFILE_DATABASE_STATE");
        for (const [field, [type, nullable, length]] of Object.entries(expected)) {
          const column = columns.find(value => value.name === field);
          if (!column || column.type !== type || (column.nullable === "YES") !== nullable || length !== undefined && Number(column.length) !== length
            || type === "datetime" && Number(column.precisionValue) !== 6 || type === "int" && !column.columnType.includes("unsigned")) fail("PROFILE_DATABASE_STATE");
        }
        const indexes = await connection.query(`SELECT INDEX_NAME AS name, COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique,
          SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_profiles'`, [database]);
        for (const [index, column, nonUnique] of [["PRIMARY", "user_id", 0], ["user_profiles_avatar", "avatar_media_id", 1]]) {
          const found = indexes.filter(value => value.name === index);
          if (found.length !== 1 || found[0].columnName !== column || Number(found[0].nonUnique) !== nonUnique || Number(found[0].positionValue) !== 1 || found[0].prefixLength !== null) fail("PROFILE_DATABASE_STATE");
        }
        const foreign = await connection.query(`SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName, REFERENCED_TABLE_SCHEMA AS parentSchema,
          REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn, ORDINAL_POSITION AS positionValue
          FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_profiles' AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const rules = await connection.query("SELECT CONSTRAINT_NAME AS name, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'user_profiles'", [database]);
        if (foreign.length !== 2 || rules.length !== 2) fail("PROFILE_DATABASE_STATE");
        for (const [constraint, column, parent] of [["user_profiles_user_fk", "user_id", "users"], ["user_profiles_avatar_fk", "avatar_media_id", "media_assets"]]) {
          if (!foreign.some(value => value.name === constraint && value.columnName === column && value.parentSchema === database && value.parentTable === parent && value.parentColumn === "id" && Number(value.positionValue) === 1)
            || !rules.some(value => value.name === constraint && value.updateRule === "RESTRICT" && value.deleteRule === "RESTRICT")) fail("PROFILE_DATABASE_STATE");
        }
        const checks = await connection.query("SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'user_profiles'", [database]);
        const normalize = value => value.toLowerCase().replace(/[`\s()]/g, "");
        const expectedChecks = { user_profiles_user_size: "octet_length(user_id) = 16", user_profiles_avatar_size: "avatar_media_id IS NULL OR octet_length(avatar_media_id) = 16", user_profiles_version: "version >= 1", user_profiles_lifetime: "updated_at >= created_at" };
        for (const [constraint, clause] of Object.entries(expectedChecks)) if (!checks.some(value => value.name === constraint && normalize(value.clause) === normalize(clause))) fail("PROFILE_DATABASE_STATE");
        await connection.query("SELECT user_id, avatar_media_id, version, created_at, updated_at FROM user_profiles WHERE 1 = 0");
        return true;
      } catch { fail("PROFILE_DATABASE_STATE"); }
      finally { connection?.release(); }
    },
    async getProfile(options) {
      request(options);
      return chatStore.withActor(options, (connection, context) => selected(connection, context.actor, context.now));
    },
    async saveProfile(options) {
      request(options);
      const pseudonym = name(options.pseudonym);
      if (!isProfileVersion(options.expectedVersion)) fail("PROFILE_INPUT");
      if (options.avatarId !== null) bytes(options.avatarId, 16);
      return chatStore.withActor(options, async (connection, context) => {
        const current = await selected(connection, context.actor, context.now);
        if (current.version !== options.expectedVersion) fail("PROFILE_CONFLICT");
        if (BigInt(current.version) === MAX_PROFILE_VERSION) fail("PROFILE_CONFLICT");
        if (options.avatarId !== null) await avatar(connection, context.actor, { ...current, avatarId: options.avatarId }, context.now);
        const nextVersion = String(BigInt(current.version) + 1n);
        await connection.query("UPDATE users SET pseudonym = ?, updated_at = GREATEST(updated_at, ?) WHERE id = ? AND role = ?", [pseudonym, sqlDate(context.now), context.actor.id, context.actor.role]);
        if (current.version === "0") await connection.query("INSERT INTO user_profiles (user_id, avatar_media_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [context.actor.id, options.avatarId, nextVersion, sqlDate(context.now), sqlDate(context.now)]);
        else await connection.query("UPDATE user_profiles SET avatar_media_id = ?, version = ?, updated_at = ? WHERE user_id = ?", [options.avatarId, nextVersion, sqlDate(context.now), context.actor.id]);
        return { userId: Buffer.from(context.actor.id), pseudonym, version: nextVersion, avatarId: options.avatarId === null ? null : Buffer.from(options.avatarId) };
      });
    },
    async getAvatar(options) {
      request(options); if (!isProfileVersion(options.version, false)) fail("PROFILE_INPUT");
      return chatStore.withActor(options, async (connection, context) => {
        const current = await selected(connection, context.actor, context.now);
        if (current.version !== options.version) fail("PROFILE_NOT_FOUND");
        return avatar(connection, context.actor, current, context.now);
      });
    },
    async getPeerAvatar(options) {
      request(options); bytes(options.conversationId, 16); if (!isProfileVersion(options.version, false)) fail("PROFILE_INPUT");
      return chatStore.withConversation(options, async (connection, context) => {
        const peer = context.actor.role === "admin" ? context.client : context.admin;
        const current = await selected(connection, peer, context.now);
        if (current.version !== options.version) fail("PROFILE_NOT_FOUND");
        return avatar(connection, peer, current, context.now);
      });
    },
  });
}
