import test from "node:test";
import assert from "node:assert/strict";
import { buildDeletionPlan, DataDeletionError } from "../server/data/deletion.mjs";
import { DATA_POLICY } from "../server/data/policy.mjs";
import { DELETION_FACT_NAMES } from "../server/data/deletion-store.mjs";
import { checksumSql, loadMigrations } from "../server/db/migrations.mjs";

const NOW = Date.parse("2026-10-15T14:00:00.123Z");
const migrations = await loadMigrations();
const subjectNames = DATA_POLICY.filter((entry) => entry.scope === "subject").map((entry) => entry.table);
const always = ["retention_undecided", "destructive_executor_unimplemented", "external_producers_unverified", "backup_retention_review"];
const unavailable = (error) => error instanceof DataDeletionError && error.code === "DATA_DELETION_UNAVAILABLE"
  && error.cause === undefined && error.details === undefined && !/secret|example\.invalid|SQL|storage|password/.test(error.message);
function fixture() {
  return { now: NOW, migrations: structuredClone(migrations),
    inventory: DATA_POLICY.map(({ table, scope }) => ({ table, scope, count: scope === "subject" ? 0 : null, truncated: false })),
    facts: DELETION_FACT_NAMES.map((name) => ({ name, count: 0, truncated: false })) };
}
const category = (input, name) => input.inventory.find((entry) => entry.table === name);
const fact = (input, name) => input.facts.find((entry) => entry.name === name);
function changeMigration(input, index, change) {
  const value = input.migrations[index]; value.sql = change(value.sql); value.checksum = checksumSql(value.sql);
}

test("deletion plan covers all 32 policy categories and remains blocked even when the selected inventory is empty", () => {
  const input = fixture(), before = structuredClone(input), plan = buildDeletionPlan(input);
  assert.deepEqual(input, before, "the pure builder leaves every input and migration unchanged");
  assert.deepEqual(Object.keys(plan), ["format", "version", "generatedAt", "simulationOnly", "executable", "retentionDecided", "affectedCategories",
    "categories", "candidateOrder", "dependencies", "observations", "blockers", "rollback"]);
  assert.equal(plan.format, "jessiemessage-deletion-simulation"); assert.equal(plan.version, 1); assert.equal(plan.generatedAt, "2026-10-15T14:00:00.123Z");
  assert.equal(plan.simulationOnly, true); assert.equal(plan.executable, false); assert.equal(plan.retentionDecided, false); assert.equal(plan.affectedCategories, 0);
  assert.equal(plan.categories.length, 32); assert.deepEqual(plan.categories.map((entry) => entry.table), DATA_POLICY.map((entry) => entry.table));
  for (const entry of plan.categories) {
    assert.deepEqual(Object.keys(entry), ["table", "scope", "count", "truncated", "handling"]);
    assert.equal(entry.handling, entry.scope === "subject" ? "review_subject_rows" : "preserve_shared");
    assert.equal(entry.count, entry.scope === "subject" ? 0 : null); assert.equal(entry.truncated, false);
  }
  assert.deepEqual(plan.blockers, always);
  assert.deepEqual(plan.rollback, { sameHistoryRequired: true, codeOnlyRollbackCertified: false, schemaDowngradeSupported: false,
    cloneRestoreRequiredForSchemaChange: true, noWorkersDuringCloneChecks: true, historyExamples: {
      basis: "synthetic_applied_ledgers_from_migrations", cases: [
        { codeMigrationCount: 25, recordedMigrationCount: 25, canStart: true, reason: "matching_history" },
        { codeMigrationCount: 25, recordedMigrationCount: 33, canStart: false, reason: "database_ahead" },
        { codeMigrationCount: 33, recordedMigrationCount: 25, canStart: false, reason: "migrations_pending" },
        { codeMigrationCount: 33, recordedMigrationCount: 33, canStart: true, reason: "matching_history" },
      ],
    } });
});

test("rollback examples use real migration checksums in synthetic 25/33 ledgers without certifying a live database", () => {
  const input = fixture(), plan = buildDeletionPlan(input), examples = plan.rollback.historyExamples;
  assert.equal(examples.basis, "synthetic_applied_ledgers_from_migrations");
  assert.deepEqual(examples.cases.map((entry) => [entry.codeMigrationCount, entry.recordedMigrationCount, entry.canStart]),
    [[25, 25, true], [25, 33, false], [33, 25, false], [33, 33, true]]);
  for (const entry of examples.cases) assert.deepEqual(Object.keys(entry), ["codeMigrationCount", "recordedMigrationCount", "canStart", "reason"]);
  assert.equal(plan.rollback.codeOnlyRollbackCertified, false); assert.equal(plan.executable, false);
  assert.doesNotMatch(JSON.stringify(examples), /checksum|\.sql|CREATE TABLE|password|email|observedDatabase|currentDatabase/);
  input.migrations[24].checksum = "0".repeat(64);
  assert.throws(() => buildDeletionPlan(input), unavailable, "the examples cannot use a drifted actual source checksum");
});

test("candidate review order derives the actual FK graph, includes every subject table once and puts children before parents", () => {
  const plan = buildDeletionPlan(fixture());
  assert.equal(subjectNames.length, 24); assert.equal(plan.candidateOrder.length, 24);
  assert.deepEqual([...plan.candidateOrder.map((entry) => entry.table)].sort(), [...subjectNames].sort());
  const positions = new Map(plan.candidateOrder.map((entry, index) => [entry.table, index]));
  for (const entry of plan.candidateOrder) assert.deepEqual(entry, { table: entry.table, proposedAction: "review", blocked: true });
  const actual = new Set(); let foreignKeys = 0;
  for (const migration of migrations) {
    const table = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)/i.exec(migration.sql.trim())?.[1];
    if (!table) continue; // The reviewed admission CHECK ALTER adds no FK edge.
    for (const match of migration.sql.matchAll(/FOREIGN\s+KEY\s*\([^)]+\)\s+REFERENCES\s+([a-z][a-z0-9_]*)\s*\([^)]+\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/gi)) {
      foreignKeys += 1; actual.add(`${table}:${match[1]}`);
    }
  }
  assert.equal(foreignKeys, 46); assert.equal(actual.size, 44); assert.equal(plan.dependencies.length, 44);
  assert.deepEqual(new Set(plan.dependencies.map(({ child, parent }) => `${child}:${parent}`)), actual);
  for (const relation of plan.dependencies) {
    assert.deepEqual(Object.keys(relation), ["child", "parent"]);
    if (positions.has(relation.child) && positions.has(relation.parent)) {
      assert.ok(positions.get(relation.child) < positions.get(relation.parent), `${relation.child} must be reviewed before ${relation.parent}`);
    }
  }
  assert.ok(positions.get("broadcast_recipients") < positions.get("messages"));
  assert.ok(positions.get("media_storage_objects") < positions.get("media_assets"));
  assert.ok(positions.get("user_profiles") < positions.get("media_assets"));
  assert.ok(positions.get("user_profiles") < positions.get("users"));
  assert.ok(positions.get("crm_memberships") < positions.get("crm_profiles"));
  assert.ok(positions.get("push_outbox") < positions.get("push_subscriptions"));
  assert.ok(positions.get("push_outbox") < positions.get("messages"));
  assert.ok(positions.get("push_subscriptions") < positions.get("sessions"));
});

test("category counts are review observations rather than deletion totals, with input order normalized and no identifiers echoed", () => {
  const input = fixture();
  for (const entry of input.inventory) {
    entry.clientId = "private-client-identifier"; entry.email = "secret@example.invalid"; entry.sql = "DELETE private SQL";
    if (entry.scope === "subject") entry.count = 1;
  }
  for (const entry of input.facts) { entry.ciphertext = "private cipher"; entry.storageKey = "private file locator"; }
  for (const entry of input.migrations) entry.path = "/private/secret.sql";
  input.inventory.reverse(); input.facts.reverse(); input.clientId = "private-client-identifier"; input.password = "secret";
  const plan = buildDeletionPlan(input);
  assert.equal(plan.affectedCategories, 24);
  assert.deepEqual(plan.observations.map((entry) => entry.name), [...DELETION_FACT_NAMES]);
  for (const entry of plan.observations) assert.deepEqual(Object.keys(entry), ["name", "count", "truncated"]);
  assert.doesNotMatch(JSON.stringify(plan), /private|secret|example\.invalid|ciphertext|storageKey|clientId|\/private\/|DELETE|SELECT|INSERT|UPDATE|DROP/);
  plan.categories[0].count = 99; plan.observations[0].count = 99; plan.dependencies[0].child = "changed";
  assert.equal(category(input, "users").count, 1); assert.equal(fact(input, "activeSessions").count, 0);
  assert.notEqual(buildDeletionPlan(input).dependencies[0].child, "changed");
});

test("all 25 fact names project exact bounded counts without attributing active sessions to full authentication proof", () => {
  const input = fixture(); fact(input, "activeSessions").count = 10;
  const plan = buildDeletionPlan(input);
  assert.equal(plan.observations.length, 25); assert.deepEqual(plan.observations[0], { name: "activeSessions", count: 10, truncated: false });
  assert.deepEqual(plan.blockers, [...always, "active_sessions_require_revocation"]);
});

test("pending and sending work each raises its fixed review blocker without disclosing jobs or treating completed recipients as pending", () => {
  for (const name of ["verificationSending", "recoverySending", "broadcastSending", "pushSending"]) {
    const input = fixture(); fact(input, name).count = 1;
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "jobs_in_flight"]);
  }
  for (const name of ["verificationPending", "recoveryPending", "broadcastPending", "pushPending"]) {
    const input = fixture(); fact(input, name).count = 1;
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "pending_deliveries_review"]);
  }
  const delivered = fixture(); category(delivered, "broadcast_recipients").count = 1;
  assert.deepEqual(buildDeletionPlan(delivered).blockers, [...always, "campaign_audience_review"]);
});

test("every owned media journal state requires its protocol, including already released objects", () => {
  for (const name of ["mediaReserved", "mediaRegistered", "mediaCleanupPending", "mediaReleased"]) {
    const input = fixture(); fact(input, name).count = 1;
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "media_protocol_required"]);
  }
  const observed = fixture(); category(observed, "media_storage_objects").count = 1;
  assert.deepEqual(buildDeletionPlan(observed).blockers, [...always, "media_protocol_required"]);
});

test("enabled notification subscriptions require explicit revocation before any future deletion executor", () => {
  const input = fixture(); fact(input, "notificationSubscriptionsEnabled").count = 2;
  assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "notification_subscriptions_require_revocation"]);
  assert.equal(buildDeletionPlan(input).executable, false);
});

test("foreign media links, shared peer media and each inconsistent binding receive independent fixed blockers", () => {
  for (const name of ["ownedMediaOutsideConversationLinks", "ownedMediaCampaignLinks"]) {
    const input = fixture(); fact(input, name).count = 1;
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "external_media_references"]);
  }
  const shared = fixture(); fact(shared, "sharedPeerMediaLinks").count = 2;
  assert.deepEqual(buildDeletionPlan(shared).blockers, [...always, "shared_peer_media_preserved"]);
  for (const name of ["foreignMessageBindings", "foreignReceiptBindings", "foreignBroadcastBindings", "foreignAdministratorSessionState", "foreignMediaJournalBindings", "foreignPushBindings", "foreignProfileBindings", "foreignTaskBindings"]) {
    const input = fixture(); fact(input, name).count = 1;
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "inconsistent_bindings"]);
  }
});

test("capped observations explicitly remain lower bounds while an exact count at the cap stays distinguishable", () => {
  for (const target of ["inventory", "facts"]) {
    const input = fixture(), entry = target === "inventory" ? category(input, "users") : fact(input, "activeSessions");
    entry.count = 10000;
    const active = target === "facts" ? ["active_sessions_require_revocation"] : [];
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, ...active]);
    entry.truncated = true;
    assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "capped_observations", ...active]);
    const plan = buildDeletionPlan(input), projected = target === "inventory" ? plan.categories[0] : plan.observations[0];
    assert.equal(projected.count, 10000); assert.equal(projected.truncated, true);
  }
  const input = fixture();
  for (const entry of input.facts) { entry.count = 10000; entry.truncated = true; }
  category(input, "broadcast_recipients").count = 1;
  assert.deepEqual(buildDeletionPlan(input).blockers, [...always, "capped_observations", "active_sessions_require_revocation", "jobs_in_flight", "pending_deliveries_review", "notification_subscriptions_require_revocation", "media_protocol_required",
    "external_media_references", "shared_peer_media_preserved", "inconsistent_bindings", "campaign_audience_review"]);
});

test("inventory rejects missing, duplicate, unknown or wrong-scope categories and all malformed counts", () => {
  for (const mutation of ["missing", "extra", "duplicate", "unknown", "scope", "subject-null", "shared-count", "shared-truncated", "array", "null"]) {
    const input = fixture();
    if (mutation === "missing") input.inventory.pop();
    if (mutation === "extra") input.inventory.push(input.inventory[0]);
    if (mutation === "duplicate") input.inventory[1] = input.inventory[0];
    if (mutation === "unknown") input.inventory[0].table = "schema_migrations";
    if (mutation === "scope") input.inventory[0].scope = "administrator";
    if (mutation === "subject-null") input.inventory[0].count = null;
    if (mutation === "shared-count") category(input, "admin_mfa").count = 0;
    if (mutation === "shared-truncated") category(input, "auth_rate_limits").truncated = true;
    if (mutation === "array") input.inventory[0] = [];
    if (mutation === "null") input.inventory = null;
    assert.throws(() => buildDeletionPlan(input), unavailable);
  }
  for (const count of [-1, NaN, Infinity, 10001, 1.5, 1n, "1", undefined]) {
    const input = fixture(); input.inventory[0].count = count; assert.throws(() => buildDeletionPlan(input), unavailable);
  }
  for (const truncated of [null, 0, "false", undefined]) {
    const input = fixture(); input.inventory[0].truncated = truncated; assert.throws(() => buildDeletionPlan(input), unavailable);
  }
  const lower = fixture(); lower.inventory[0].count = 9999; lower.inventory[0].truncated = true;
  assert.throws(() => buildDeletionPlan(lower), unavailable);
});

test("facts reject missing, duplicate, unknown or malformed observations rather than supplying guessed zeroes", () => {
  for (const mutation of ["missing", "extra", "duplicate", "unknown", "array", "null", "truncated-low"]) {
    const input = fixture();
    if (mutation === "missing") input.facts.pop();
    if (mutation === "extra") input.facts.push(input.facts[0]);
    if (mutation === "duplicate") input.facts[1] = input.facts[0];
    if (mutation === "unknown") input.facts[0].name = "secret_client_id";
    if (mutation === "array") input.facts[0] = [];
    if (mutation === "null") input.facts = null;
    if (mutation === "truncated-low") { input.facts[0].count = 9999; input.facts[0].truncated = true; }
    assert.throws(() => buildDeletionPlan(input), unavailable);
  }
  for (const count of [-1, NaN, Infinity, 10001, 1.5, 1n, "1", null, undefined]) {
    const input = fixture(); input.facts[0].count = count; assert.throws(() => buildDeletionPlan(input), unavailable);
  }
});

test("schema rejects dirty plans, changed delete rules, unsupported references, duplicate tables and cycles with one neutral error", () => {
  for (const mutation of ["missing", "extra", "order", "checksum", "duplicate-table", "unknown-table", "cascade", "set-null", "missing-update", "unknown-parent", "unknown-child-column", "unknown-parent-column", "arity", "cycle", "duplicate-constraint"]) {
    const input = fixture();
    if (mutation === "missing") input.migrations.pop();
    if (mutation === "extra") input.migrations.push(input.migrations.at(-1));
    if (mutation === "order") [input.migrations[0], input.migrations[1]] = [input.migrations[1], input.migrations[0]];
    if (mutation === "checksum") input.migrations[0].checksum = "private bad checksum";
    if (mutation === "duplicate-table") changeMigration(input, 2, (sql) => sql.replace("CREATE TABLE sessions", "CREATE TABLE users"));
    if (mutation === "unknown-table") changeMigration(input, 0, (sql) => sql.replace("CREATE TABLE users", "CREATE TABLE private_clients"));
    if (mutation === "cascade") changeMigration(input, 2, (sql) => sql.replace("ON DELETE RESTRICT", "ON DELETE CASCADE"));
    if (mutation === "set-null") changeMigration(input, 2, (sql) => sql.replace("ON DELETE RESTRICT", "ON DELETE SET NULL"));
    if (mutation === "missing-update") changeMigration(input, 2, (sql) => sql.replace("ON UPDATE RESTRICT ", ""));
    if (mutation === "unknown-parent") changeMigration(input, 2, (sql) => sql.replace("REFERENCES users", "REFERENCES private_unknown"));
    if (mutation === "unknown-child-column") changeMigration(input, 2, (sql) => sql.replace("FOREIGN KEY (user_id)", "FOREIGN KEY (private_unknown)"));
    if (mutation === "unknown-parent-column") changeMigration(input, 2, (sql) => sql.replace("REFERENCES users (id)", "REFERENCES users (private_unknown)"));
    if (mutation === "arity") changeMigration(input, 2, (sql) => sql.replace("REFERENCES users (id)", "REFERENCES users (id, role)"));
    if (mutation === "cycle") changeMigration(input, 0, (sql) => sql.replace("\n) ENGINE", ",\n  CONSTRAINT deletion_cycle FOREIGN KEY (id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT\n) ENGINE"));
    if (mutation === "duplicate-constraint") changeMigration(input, 2, (sql) => sql.replace("CONSTRAINT sessions_user FOREIGN", "CONSTRAINT invitations_consumer FOREIGN"));
    assert.throws(() => buildDeletionPlan(input), unavailable, mutation);
  }
});

test("commented fake dependencies never enter the actual schema graph or output", () => {
  const input = fixture();
  changeMigration(input, 0, (sql) => "-- FOREIGN KEY (secret) REFERENCES private_unknown (secret) ON UPDATE CASCADE ON DELETE CASCADE\n" + sql);
  changeMigration(input, 1, (sql) => "/* REFERENCES private_unknown (secret) ON DELETE CASCADE */\n" + sql);
  assert.deepEqual(buildDeletionPlan(input), buildDeletionPlan(fixture()));
});

test("invalid clocks and throwing foreign properties remain sanitized without any I/O capability being called", () => {
  for (const now of [-1, NaN, Infinity, 253402300800000, "date", null, undefined]) {
    const input = fixture(); input.now = now; assert.throws(() => buildDeletionPlan(input), unavailable);
  }
  const input = fixture(); let called = false;
  input.connection = { query() { called = true; throw new Error("private SQL"); } }; input.writer = { json() { called = true; } };
  buildDeletionPlan(input); assert.equal(called, false);
  Object.defineProperty(input.inventory[0], "table", { get() { throw new Error("private client@example.invalid password SQL"); } });
  assert.throws(() => buildDeletionPlan(input), unavailable);
  for (const value of [null, [], false]) assert.throws(() => buildDeletionPlan(value), unavailable);
});
