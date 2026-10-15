import { createHash } from "node:crypto";
import { loadMigrations } from "../db/migrations.mjs";
import { assertBackupInspection } from "./inspection.mjs";

export class BackupSnapshotError extends Error {
  constructor(code = "BACKUP_SNAPSHOT_STATE") { super("The private backup could not be verified."); this.name = "BackupSnapshotError"; this.code = code; }
}
const fail = (code) => { throw new BackupSnapshotError(code); };
const hex = (value, size) => typeof value === "string" && new RegExp(`^[a-f0-9]{${size * 2}}$`).test(value);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const date = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) return false;
  const iso = `${value.slice(0, 23).replace(" ", "T")}Z`, instant = Date.parse(iso);
  return Number.isSafeInteger(instant) && instant >= 0 && new Date(instant).toISOString() === iso;
};
const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
const json = (value) => JSON.stringify(ordered(value));
const same = (left, right) => json(left) === json(right);
function checkSignal(signal) { if (signal?.aborted) fail("BACKUP_SNAPSHOT_ABORTED"); }
function budget(limits = {}) {
  const maxRows = limits.maxRows ?? 100000, maxEntries = limits.maxEntries ?? 100000, maxIssues = limits.maxIssues ?? 100;
  if (!integer(maxRows, 1) || maxRows > 100000 || !integer(maxEntries, 1) || maxEntries > 100000 || !integer(maxIssues, 1) || maxIssues > 100) fail("BACKUP_SNAPSHOT_INPUT");
  return { maxRows, maxEntries, maxIssues };
}
function number(value) { const result = Number(value); if (!integer(result)) fail(); return result; }
function bytes(value, size) { if (!Buffer.isBuffer(value) || value.length !== size) fail(); return value.toString("hex"); }
function cell(value) {
  if (value === null) return ["null"];
  if (Buffer.isBuffer(value)) return ["bytes", value.toString("hex")];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number" && Number.isSafeInteger(value)) return ["integer", String(value)];
  if (typeof value === "string") return ["text", value];
  fail();
}
function objectRow(row) {
  return { id: bytes(row.id, 16), owner_id: bytes(row.owner_id, 16), owner_role: row.owner_role,
    storage_key: bytes(row.storage_key, 32), content_digest: bytes(row.content_digest, 32), full_bytes: number(row.full_bytes),
    thumbnail_bytes: number(row.thumbnail_bytes), stored_bytes: number(row.stored_bytes), state: row.state,
    asset_id: row.asset_id === null ? null : bytes(row.asset_id, 16), created_at: row.created_at,
    updated_at: row.updated_at, released_at: row.released_at };
}
function assetRow(row) {
  return { id: bytes(row.id, 16), owner_id: bytes(row.owner_id, 16), storage_key: bytes(row.storage_key, 32),
    content_digest: bytes(row.content_digest, 32), full_bytes: number(row.full_bytes), thumbnail_bytes: number(row.thumbnail_bytes), deleted_at: row.deleted_at };
}

/** A bounded consistent read of every application row, including tombstones and outboxes. */
export function createBackupSnapshotStore({ pool, inspectionPool }) {
  if (typeof pool?.getConnection !== "function") fail("BACKUP_SNAPSHOT_INPUT");
  async function read(operation, transaction = false) {
    let connection, inspection, begun = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); await connection.beginTransaction(); begun = true; }
      if (transaction) {
        if (typeof inspectionPool?.getConnection !== "function") fail("BACKUP_SNAPSHOT_INPUT");
        inspection = await inspectionPool.getConnection();
      }
      const result = await operation(connection, inspection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof BackupSnapshotError) throw error;
      fail("BACKUP_SNAPSHOT_DATABASE");
    } finally { try { inspection?.release(); } catch {} try { connection?.release(); } catch {} }
  }
  return Object.freeze({
    databaseName: () => read(async (connection) => {
      const name = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
      if (typeof name !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(name)) fail();
      return name;
    }),
    capture: ({ signal, limits } = {}) => read(async (connection, inspection) => {
      const { maxRows } = budget(limits); checkSignal(signal);
      const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
      if (typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) fail();
      await assertBackupInspection(inspection, database);
      const migrations = await loadMigrations();
      const definitions = migrations.map(({ sql }) => {
        const name = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(sql.trim())?.[1];
        const primary = /PRIMARY KEY\s*\(([a-z_, ]+)\)/i.exec(sql)?.[1].split(",").map((key) => key.trim());
        if (!name || !primary?.length || primary.some((key) => !/^[a-z_]+$/.test(key))) fail();
        return { name, primary };
      });
      definitions.push({ name: "schema_migrations", primary: ["version"] }); definitions.sort((a, b) => a.name.localeCompare(b.name, "en"));
      const tables = await inspection.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [database]);
      if (tables.length !== definitions.length || tables.some((row, i) => row.name !== definitions[i].name || row.kind !== "BASE TABLE" || row.engine !== "InnoDB")) fail();
      const columns = await inspection.query(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, COLUMN_TYPE AS type,
        IS_NULLABLE AS nullable, COLUMN_DEFAULT AS default_value, EXTRA AS extra, COLLATION_NAME AS collation,
        ORDINAL_POSITION AS position FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [database]);
      const indexes = await inspection.query(`SELECT TABLE_NAME AS table_name, INDEX_NAME AS name, NON_UNIQUE AS non_unique,
        SEQ_IN_INDEX AS position, COLUMN_NAME AS column_name, SUB_PART AS prefix_length, INDEX_TYPE AS type
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [database]);
      const foreignKeys = await inspection.query(`SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS column_name,
        k.ORDINAL_POSITION AS position, k.REFERENCED_TABLE_SCHEMA AS reference_schema, k.REFERENCED_TABLE_NAME AS reference_table, k.REFERENCED_COLUMN_NAME AS reference_column,
        r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.CONSTRAINT_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [database]);
      // A restored schema must remain self-contained. Hashing only the table
      // name would hide a foreign key that still points at the source database.
      if (foreignKeys.some((row) => row.reference_schema !== database)) fail();
      for (const row of foreignKeys) delete row.reference_schema;
      const checks = await inspection.query(`SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause
        FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? ORDER BY TABLE_NAME, CONSTRAINT_NAME`, [database]);
      const schemaDigest = createHash("sha256").update(json([tables.map((row) => [row.name, row.kind, row.engine, row.collation]),
        ...[columns, indexes, foreignKeys, checks].map((rows) => rows.map((row) => Object.values(row).map(cell)))])).digest("hex");
      const core = createHash("sha256").update("jessiemessage:backup-core:v1\0"), objects = [], assets = [];
      let rowsRead = 0, capacity = null;
      for (const table of definitions) {
        checkSignal(signal);
        const tableColumns = columns.filter((column) => column.table_name === table.name);
        if (!tableColumns.length || table.primary.some((name) => !tableColumns.some((column) => column.name === name))) fail();
        const select = tableColumns.map(({ name, type }) => /^datetime/i.test(type) ? `DATE_FORMAT(${name}, '%Y-%m-%d %H:%i:%s.%f') AS ${name}` : name).join(", ");
        if (tableColumns.some(({ name }) => !/^[a-z_]+$/.test(name))) fail();
        let after = null;
        const isCore = !["media_storage_state", "media_storage_objects"].includes(table.name);
        if (isCore) core.update(json(["table", table.name, tableColumns.map(({ name }) => name)]));
        while (true) {
          checkSignal(signal);
          const predicate = after === null ? "" : `WHERE (${table.primary.join(", ")}) > (${table.primary.map(() => "?").join(", ")})`;
          const rows = await connection.query(`SELECT ${select} FROM ${table.name} ${predicate} ORDER BY ${table.primary.join(", ")} LIMIT 100`, after ?? []);
          if (rowsRead + rows.length > maxRows) fail("BACKUP_SNAPSHOT_LIMIT"); rowsRead += rows.length;
          for (const row of rows) {
            if (isCore) core.update(json(tableColumns.map(({ name }) => cell(row[name]))));
            if (table.name === "media_storage_objects") objects.push(objectRow(row));
            if (table.name === "media_assets") assets.push(assetRow(row));
            if (table.name === "media_storage_state") {
              if (capacity !== null || number(row.id) !== 1) fail();
              capacity = { ownerBytes: number(row.owner_bytes), totalBytes: number(row.total_bytes), heldBytes: number(row.held_bytes),
                rootFingerprint: bytes(row.root_fingerprint, 32), initializedAt: row.initialized_at };
            }
          }
          if (rows.length < 100) break;
          after = table.primary.map((name) => rows.at(-1)[name]);
        }
      }
      const snapshot = { version: 1, schemaDigest, coreDigest: core.digest("hex"), counts: { tables: definitions.length, rows: rowsRead }, capacity, objects, assets };
      validateSnapshot(snapshot); return snapshot;
    }, true),
  });
}

export async function captureBackupSnapshot({ store, signal, limits } = {}) {
  if (typeof store?.capture !== "function") fail("BACKUP_SNAPSHOT_INPUT");
  const result = await store.capture({ signal, limits }); validateSnapshot(result); return result;
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !hex(snapshot.schemaDigest, 32) || !hex(snapshot.coreDigest, 32)
    || !snapshot.counts || !integer(snapshot.counts.tables, 1) || !integer(snapshot.counts.rows)
    || !Array.isArray(snapshot.objects) || !Array.isArray(snapshot.assets) || snapshot.objects.length + snapshot.assets.length > 100000) fail();
  const capacity = snapshot.capacity;
  if (!capacity || !integer(capacity.ownerBytes, 1) || !integer(capacity.totalBytes, capacity.ownerBytes) || !integer(capacity.heldBytes)
    || !hex(capacity.rootFingerprint, 32) || !date(capacity.initializedAt)) fail();
  const ids = new Set(), keys = new Set(); let held = 0;
  for (const object of snapshot.objects) {
    if (!object || !hex(object.id, 16) || !hex(object.owner_id, 16) || !["admin", "client"].includes(object.owner_role)
      || !hex(object.storage_key, 32) || !hex(object.content_digest, 32) || !integer(object.full_bytes, 1) || object.full_bytes > 10485760
      || !integer(object.thumbnail_bytes, 1) || object.thumbnail_bytes > 524288 || object.stored_bytes !== object.full_bytes + object.thumbnail_bytes + 80
      || !["reserved", "registered", "cleanup_pending", "released"].includes(object.state)
      || !(object.asset_id === null || object.asset_id === object.id) || !date(object.created_at) || !date(object.updated_at) || object.updated_at < object.created_at
      || !(object.released_at === null || date(object.released_at) && object.released_at >= object.created_at && object.released_at <= object.updated_at)
      || (object.state === "released") !== (object.released_at !== null) || object.state === "registered" && object.asset_id === null
      || object.state === "reserved" && object.asset_id !== null || ids.has(object.id) || keys.has(object.storage_key)) fail();
    ids.add(object.id); keys.add(object.storage_key);
    if (object.state !== "released") held += object.stored_bytes;
    if (!integer(held)) fail();
  }
  if (held !== capacity.heldBytes) fail();
  const assetIds = new Set(), assetKeys = new Set(), byKey = new Map(snapshot.objects.map((object) => [object.storage_key, object]));
  for (const asset of snapshot.assets) {
    if (!asset || !hex(asset.id, 16) || !hex(asset.owner_id, 16) || !hex(asset.storage_key, 32) || !hex(asset.content_digest, 32)
      || !integer(asset.full_bytes, 1) || asset.full_bytes > 10485760 || !integer(asset.thumbnail_bytes, 1) || asset.thumbnail_bytes > 524288
      || !(asset.deleted_at === null || date(asset.deleted_at)) || assetIds.has(asset.id) || assetKeys.has(asset.storage_key)) fail();
    assetIds.add(asset.id); assetKeys.add(asset.storage_key);
    const object = byKey.get(asset.storage_key);
    if (!object || object.id !== asset.id || object.asset_id !== asset.id || object.owner_id !== asset.owner_id || object.content_digest !== asset.content_digest
      || object.full_bytes !== asset.full_bytes || object.thumbnail_bytes !== asset.thumbnail_bytes
      || (asset.deleted_at === null ? object.state !== "registered" : !["cleanup_pending", "released"].includes(object.state))) fail();
  }
  for (const object of snapshot.objects) if (object.asset_id !== null && !assetIds.has(object.asset_id)) fail();
}

/** The signed original journal is the durable repair plan; only its pending rows may progress. */
export function assertBackupSnapshot({ expected, actual, mode, targetFingerprint } = {}) {
  validateSnapshot(expected); validateSnapshot(actual);
  if (!["exact", "recovery"].includes(mode)) fail("BACKUP_SNAPSHOT_INPUT");
  if (mode === "exact") { if (!same(expected, actual)) fail("BACKUP_SNAPSHOT_DRIFT"); }
  else {
    if (expected.schemaDigest !== actual.schemaDigest || expected.coreDigest !== actual.coreDigest || !same(expected.counts, actual.counts)
      || !same(expected.assets, actual.assets) || expected.objects.length !== actual.objects.length
      || expected.capacity.ownerBytes !== actual.capacity.ownerBytes || expected.capacity.totalBytes !== actual.capacity.totalBytes
      || expected.capacity.initializedAt !== actual.capacity.initializedAt
      || !(actual.capacity.rootFingerprint === expected.capacity.rootFingerprint || hex(targetFingerprint, 32) && actual.capacity.rootFingerprint === targetFingerprint)) fail("BACKUP_SNAPSHOT_DRIFT");
    for (let index = 0; index < expected.objects.length; index++) {
      const before = expected.objects[index], after = actual.objects[index];
      if (!["reserved", "cleanup_pending"].includes(before.state)) { if (!same(before, after)) fail("BACKUP_SNAPSHOT_DRIFT"); continue; }
      const { state: originalState, updated_at: originalUpdated, released_at: originalReleased, ...immutableBefore } = before;
      const { state, updated_at, released_at, ...immutableAfter } = after;
      if (!same(immutableBefore, immutableAfter) || ![originalState, "cleanup_pending", "released"].includes(state)
        || updated_at < originalUpdated || originalReleased !== null || state === originalState && (updated_at !== originalUpdated || released_at !== null)) fail("BACKUP_SNAPSHOT_DRIFT");
    }
    if (actual.capacity.rootFingerprint !== expected.capacity.rootFingerprint && actual.objects.some((object) => ["reserved", "cleanup_pending"].includes(object.state))) fail("BACKUP_SNAPSHOT_DRIFT");
  }
  return { candidates: expected.objects.filter((object) => ["reserved", "cleanup_pending"].includes(object.state)).map((object) => ({ ...object })), heldBytes: actual.capacity.heldBytes };
}

/** Structural scan only: GCM authentication is performed by verifyBackupData. */
export async function verifyBackupStorage({ snapshot, storage, signal, limits } = {}) {
  validateSnapshot(snapshot); const { maxEntries, maxIssues } = budget(limits);
  if (typeof storage?.inspectEntry !== "function" || typeof storage?.scanEntries !== "function") fail("BACKUP_SNAPSHOT_INPUT");
  const issues = [], expected = new Map(), seen = new Set(); let entries = 0, healthy = true;
  const issue = (code) => { healthy = false; if (issues.length < maxIssues) issues.push({ code }); };
  for (const object of snapshot.objects) for (const variant of ["full", "thumb"]) {
    checkSignal(signal);
    const key = `${object.storage_key}:${variant}`, size = (variant === "full" ? object.full_bytes : object.thumbnail_bytes) + 40;
    expected.set(key, { object, size });
    const entry = await storage.inspectEntry({ storageKey: Buffer.from(object.storage_key, "hex"), variant });
    if (!entry || typeof entry.exists !== "boolean") fail();
    if (!entry.exists) { if (object.state === "registered") issue("ACTIVE_FILE_MISSING"); continue; }
    if (object.state === "released") issue("RELEASED_FILE_PRESENT");
    if (entry.status !== "structural_ok" || entry.kind !== "published" || entry.encryptedBytes !== BigInt(size)) issue("FILE_INVALID");
    seen.add(key);
  }
  const observed = new Set();
  for await (const entry of storage.scanEntries({ maxEntries, signal })) {
    checkSignal(signal); if (++entries > maxEntries) fail("BACKUP_SNAPSHOT_LIMIT");
    if (entry.kind !== "published" || entry.status !== "structural_ok" || !Buffer.isBuffer(entry.storageKey) || entry.storageKey.length !== 32 || !["full", "thumb"].includes(entry.variant)) { issue("UNRECOGNIZED_FILE"); continue; }
    const key = `${entry.storageKey.toString("hex")}:${entry.variant}`, known = expected.get(key);
    if (!known || observed.has(key) || known.object.state === "released" || entry.encryptedBytes !== BigInt(known.size)) issue("UNACCOUNTED_FILE");
    observed.add(key);
  }
  if (seen.size !== observed.size || [...seen].some((key) => !observed.has(key))) issue("FILES_CHANGED");
  return { complete: true, healthy, entries, issues, issuesTruncated: !healthy && issues.length === maxIssues };
}
