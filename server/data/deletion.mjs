import { validateMigrationPlan, createdMigrationTables } from "../db/migrations.mjs";
import { DATA_POLICY } from "./policy.mjs";
import { DELETION_FACT_NAMES } from "./deletion-store.mjs";
import { inspectRollbackHistory } from "./rollback.mjs";

const MAX_DATE = 253402300799999;
const CAP = 10000;
const TABLES = new Map(DATA_POLICY.map((entry, index) => [entry.table, { scope: entry.scope, index }]));
const ALWAYS_BLOCKED = Object.freeze(["retention_undecided", "destructive_executor_unimplemented", "external_producers_unverified", "backup_retention_review"]);

export class DataDeletionError extends Error {
  constructor() {
    super("Private deletion simulation is unavailable.");
    this.name = "DataDeletionError";
    this.code = "DATA_DELETION_UNAVAILABLE";
  }
}
const fail = () => { throw new DataDeletionError(); };
function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(); return value; }
function boundedCount(value, truncated) {
  if (!Number.isSafeInteger(value) || value < 0 || value > CAP || typeof truncated !== "boolean" || truncated && value !== CAP) fail();
  return { count: value, truncated };
}

// validateMigrationPlan checks the SQL format and checksum first. Strip quoted
// values and ordinary comments before identifying structural SQL references:
// text inside a CHECK or comment cannot invent a dependency in the report.
function structuralSql(source) {
  let result = "", quote = null, comment = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (comment === "line") { if (char === "\n") { comment = null; result += "\n"; } continue; }
    if (comment === "block") { if (char === "*" && next === "/") { comment = null; index += 1; result += " "; } continue; }
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) { if (next === quote) index += 1; else quote = null; }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; result += "?"; continue; }
    if (char === "#" || char === "-" && next === "-" && /\s/.test(source[index + 2] ?? "")) {
      comment = "line"; if (char === "-") index += 1; result += " "; continue;
    }
    if (char === "/" && next === "*") { comment = "block"; index += 1; result += " "; continue; }
    result += char;
  }
  if (quote || comment === "block") fail();
  return result;
}
function columnList(value) {
  if (!/^[a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*$/i.test(value.trim())) fail();
  const columns = value.split(",").map((name) => name.trim().toLowerCase());
  if (new Set(columns).size !== columns.length) fail();
  return columns;
}
function schema(migrations) {
  validateMigrationPlan(migrations);
  if (migrations.length !== 33 || createdMigrationTables(migrations).length !== TABLES.size || TABLES.size !== 32) fail();
  const tables = new Map(), foreignKeys = [], constraintNames = new Set();
  for (const migration of migrations) {
    const sql = structuralSql(migration.sql), create = /^\s*CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(sql);
    if (!create) continue; // The validated CHECK-only ALTER changes no deletion graph.
    if ([...sql.matchAll(/\bCREATE\s+TABLE\b/gi)].length !== 1) fail();
    const table = create[1].toLowerCase();
    if (!TABLES.has(table) || tables.has(table)) fail();
    const columns = new Set([...sql.matchAll(/^\s*([a-z][a-z0-9_]*)\s+(?:VARBINARY|VARCHAR|TINYINT|SMALLINT|INT|BIGINT|DATETIME)\b/gmi)]
      .map((match) => match[1].toLowerCase()));
    if (!columns.size) fail();
    tables.set(table, columns);
    const parsed = [...sql.matchAll(/\bCONSTRAINT\s+([a-z][a-z0-9_]*)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([a-z][a-z0-9_]*)\s*\(([^)]+)\)\s+ON\s+UPDATE\s+RESTRICT\s+ON\s+DELETE\s+RESTRICT\b/gi)];
    const count = parsed.length;
    if ([...sql.matchAll(/\bFOREIGN\s+KEY\b/gi)].length !== count || [...sql.matchAll(/\bREFERENCES\b/gi)].length !== count
      // Column ON UPDATE CURRENT_TIMESTAMP is not a foreign-key rule.
      || [...sql.matchAll(/\bON\s+UPDATE\s+(?:RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION|SET\s+DEFAULT)\b/gi)].length !== count
      || [...sql.matchAll(/\bON\s+DELETE\b/gi)].length !== count) fail();
    for (const match of parsed) {
      const name = match[1].toLowerCase(), childColumns = columnList(match[2]), parent = match[3].toLowerCase(), parentColumns = columnList(match[4]);
      if (constraintNames.has(name) || !TABLES.has(parent) || childColumns.length !== parentColumns.length
        || childColumns.some((column) => !columns.has(column))) fail();
      constraintNames.add(name); foreignKeys.push({ child: table, parent, parentColumns });
    }
  }
  if (tables.size !== TABLES.size) fail();
  for (const relation of foreignKeys) if (relation.parentColumns.some((column) => !tables.get(relation.parent)?.has(column))) fail();
  const unique = new Map(foreignKeys.map(({ child, parent }) => [`${child}:${parent}`, { child, parent }]));
  const dependencies = [...unique.values()].sort((left, right) => TABLES.get(left.child).index - TABLES.get(right.child).index
    || TABLES.get(left.parent).index - TABLES.get(right.parent).index);
  // Check the complete schema too: preserved shared categories cannot conceal
  // a dependency cycle in a plan presented as an ordered diagnostic.
  function childrenFirst(names) {
    const selected = new Set(names), incoming = new Map(names.map((name) => [name, 0]));
    for (const { child, parent } of dependencies) if (selected.has(child) && selected.has(parent)) incoming.set(parent, incoming.get(parent) + 1);
    const ready = names.filter((name) => incoming.get(name) === 0), ordered = [];
    const sort = () => ready.sort((left, right) => TABLES.get(left).index - TABLES.get(right).index);
    sort();
    while (ready.length) {
      const child = ready.shift(); ordered.push(child);
      for (const relation of dependencies) if (relation.child === child && selected.has(relation.parent)) {
        const remaining = incoming.get(relation.parent) - 1; incoming.set(relation.parent, remaining);
        if (remaining === 0) { ready.push(relation.parent); sort(); }
      }
    }
    if (ordered.length !== names.length) fail();
    return ordered;
  }
  childrenFirst([...TABLES.keys()]);
  return { dependencies, candidateOrder: childrenFirst(DATA_POLICY.filter((entry) => entry.scope === "subject").map((entry) => entry.table)) };
}
function inventoryRows(value) {
  if (!Array.isArray(value) || value.length !== TABLES.size) fail();
  const rows = new Map();
  for (const item of value) {
    object(item);
    if (!TABLES.has(item.table) || rows.has(item.table) || item.scope !== TABLES.get(item.table).scope) fail();
    if (item.scope === "subject") rows.set(item.table, boundedCount(item.count, item.truncated));
    else { if (item.count !== null || item.truncated !== false) fail(); rows.set(item.table, { count: null, truncated: false }); }
  }
  return DATA_POLICY.map(({ table, scope }) => ({ table, scope, ...rows.get(table), handling: scope === "subject" ? "review_subject_rows" : "preserve_shared" }));
}
function observations(value) {
  if (!Array.isArray(value) || value.length !== DELETION_FACT_NAMES.length) fail();
  const rows = new Map();
  for (const item of value) {
    object(item);
    if (!DELETION_FACT_NAMES.includes(item.name) || rows.has(item.name)) fail();
    rows.set(item.name, boundedCount(item.count, item.truncated));
  }
  return DELETION_FACT_NAMES.map((name) => ({ name, ...rows.get(name) }));
}
function rollbackExamples(migrations) {
  const older = migrations.slice(0, 25);
  const ledger = (plan) => plan.map(({ version, name, checksum }) => ({ version, name, checksum, state: "applied" }));
  return { basis: "synthetic_applied_ledgers_from_migrations",
    cases: [[older, older], [older, migrations], [migrations, older], [migrations, migrations]]
      .map(([code, database]) => ({ ...inspectRollbackHistory({ migrations: code, rows: ledger(database) }) })) };
}

/** A metadata-only review aid. It contains no row selectors, destructive SQL,
 * approved retention periods or executable actions; every candidate is blocked. */
export function buildDeletionPlan(input = {}) {
  try {
    object(input);
    const { now } = input;
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE) fail();
    const categories = inventoryRows(input.inventory), facts = observations(input.facts), graph = schema(input.migrations);
    const byName = new Map(facts.map((item) => [item.name, item]));
    const present = (...names) => names.some((name) => byName.get(name).count > 0);
    const categoryCount = (table) => categories.find((item) => item.table === table).count;
    const blockers = [...ALWAYS_BLOCKED];
    if ([...categories, ...facts].some((item) => item.truncated)) blockers.push("capped_observations");
    if (present("activeSessions")) blockers.push("active_sessions_require_revocation");
    if (present("verificationSending", "recoverySending", "broadcastSending", "pushSending")) blockers.push("jobs_in_flight");
    if (present("verificationPending", "recoveryPending", "broadcastPending", "pushPending")) blockers.push("pending_deliveries_review");
    if (present("notificationSubscriptionsEnabled")) blockers.push("notification_subscriptions_require_revocation");
    if (categoryCount("media_storage_objects") > 0 || present("mediaReserved", "mediaRegistered", "mediaCleanupPending", "mediaReleased")) blockers.push("media_protocol_required");
    if (present("ownedMediaOutsideConversationLinks", "ownedMediaCampaignLinks")) blockers.push("external_media_references");
    if (present("sharedPeerMediaLinks")) blockers.push("shared_peer_media_preserved");
    if (present("foreignMessageBindings", "foreignReceiptBindings", "foreignBroadcastBindings", "foreignAdministratorSessionState", "foreignMediaJournalBindings", "foreignPushBindings", "foreignProfileBindings", "foreignTaskBindings")) blockers.push("inconsistent_bindings");
    if (categoryCount("broadcast_recipients") > 0) blockers.push("campaign_audience_review");
    return { format: "jessiemessage-deletion-simulation", version: 1, generatedAt: new Date(now).toISOString(),
      simulationOnly: true, executable: false, retentionDecided: false,
      affectedCategories: categories.filter((entry) => entry.scope === "subject" && entry.count > 0).length,
      categories, candidateOrder: graph.candidateOrder.map((table) => ({ table, proposedAction: "review", blocked: true })),
      dependencies: graph.dependencies, observations: facts, blockers,
      rollback: { sameHistoryRequired: true, codeOnlyRollbackCertified: false, schemaDowngradeSupported: false,
        cloneRestoreRequiredForSchemaChange: true, noWorkersDuringCloneChecks: true, historyExamples: rollbackExamples(input.migrations) } };
  } catch { throw new DataDeletionError(); }
}
