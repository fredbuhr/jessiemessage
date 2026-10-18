import test from "node:test";
import assert from "node:assert/strict";
import { CONTACT_EMAIL, createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession, parseReadinessSummary, acceptReadinessSummary, beginSmtpCheck, acceptSmtpProof, rejectSmtpCheck, parseOperations, queueCountText, queueDelayMinutes, formatOperationsReport } from "../public/readiness-model.js";

const now = 1800000000000;
const admin = (extra = {}) => ({ user: { id: "a".repeat(32), role: "admin", pseudonym: "Jessie" }, csrf: "x".repeat(43), expiresAt: now + 3600000, ...extra });
const summary = (extra = {}) => ({ contactEmail: CONTACT_EMAIL, mail: { configured: true, sender: CONTACT_EMAIL, replyTo: CONTACT_EMAIL },
  features: { clientAccess: true, chat: true, photos: false, clientFiles: true, passwordRecovery: true, broadcasts: true, notifications: false },
  checks: { admissionPolicy: "manual_invitation", ageAssurance: "not_integrated", smtpDelivery: "not_checked", deviceAcceptance: "pending" }, ...extra });
const proof = (extra = {}) => ({ status: "verified", checkedAt: now, scope: "smtp_authentication", delivery: "not_checked", ...extra });
function connected() {
  const state = createReadinessState(); const ticket = clearReadiness(state, { visible: true });
  assert.equal(acceptAdminSession(state, ticket, admin(), now), true);
  assert.equal(acceptReadinessSummary(state, readinessTicket(state), summary()), true);
  return state;
}

test("preparation starts without a session, configuration or SMTP proof", () => {
  const state = createReadinessState();
  assert.equal(state.visible, false); assert.equal(state.session, null); assert.equal(state.summary, null); assert.equal(state.proof, null);
  assert.equal(beginSmtpCheck(state, now), null);
});
test("a client role, malformed identity or expired session clears every private preparation result", () => {
  const invalid = [admin({ user: { id: "a".repeat(32), role: "client" } }), admin({ user: { id: "a".repeat(32) + "\n", role: "admin" } }),
    admin({ csrf: "x".repeat(43) + "\n" }), admin({ expiresAt: now }), admin({ expiresAt: "1800000000001" })];
  for (const input of invalid) {
    const state = connected(); const ticket = beginSmtpCheck(state, now); acceptSmtpProof(state, ticket, proof());
    assert.equal(acceptAdminSession(state, readinessTicket(state), input, now), false);
    assert.equal(state.session, null); assert.equal(state.summary, null); assert.equal(state.proof, null); assert.equal(state.visible, false);
    assert.equal(currentReadiness(state, ticket), false);
  }
});
test("session and summary models retain only safe fields from a larger server response", () => {
  const state = createReadinessState(); const ticket = clearReadiness(state, { visible: true });
  acceptAdminSession(state, ticket, admin({ password: "private", user: { id: "a".repeat(32), role: "admin", email: "private@example.invalid" } }), now);
  const data = summary({ hostname: "smtp.private.example", secret: "password" }); data.mail.password = "sensitive";
  acceptReadinessSummary(state, readinessTicket(state), data);
  assert.deepEqual(Object.keys(state.session).sort(), ["csrf", "expiresAt", "id"]);
  assert.equal(JSON.stringify(state.summary).includes("private"), false); assert.equal(Object.hasOwn(state.summary.mail, "password"), false);
  assert.equal(JSON.stringify(state.summary).includes("sensitive"), false); assert.equal(Object.hasOwn(state.summary, "secret"), false);
});
test("a late configuration response cannot populate a hidden page or a new session", () => {
  const state = connected(); const ticket = readinessTicket(state); clearReadiness(state);
  assert.equal(acceptReadinessSummary(state, ticket, summary()), false);
  const reopened = clearReadiness(state, { visible: true }); acceptAdminSession(state, reopened, admin(), now);
  assert.equal(acceptReadinessSummary(state, ticket, summary()), false); assert.equal(state.summary, null);
});
test("a different administrator invalidates the old session and its in-flight check", () => {
  const state = connected(); const checking = beginSmtpCheck(state, now);
  assert.equal(acceptAdminSession(state, checking, admin({ user: { id: "b".repeat(32), role: "admin" } }), now), false);
  assert.equal(state.session, null); assert.equal(state.summary, null); assert.equal(state.busy, false);
  assert.equal(acceptSmtpProof(state, checking, proof()), false); assert.equal(state.proof, null);
});
test("a new login for the same administrator also invalidates proof through its changed CSRF token", () => {
  const state = connected(); const ticket = beginSmtpCheck(state, now); acceptSmtpProof(state, ticket, proof());
  assert.equal(acceptAdminSession(state, readinessTicket(state), admin({ csrf: "y".repeat(43) }), now), false);
  assert.equal(state.proof, null); assert.equal(state.session, null); assert.equal(state.summary, null);
});
test("a final session check rejects pending SMTP proof after another tab changes the same administrator login", () => {
  const state = connected(); const checking = beginSmtpCheck(state, now); const networkResult = proof();
  assert.equal(acceptAdminSession(state, checking, admin({ csrf: "y".repeat(43) }), now), false);
  assert.equal(acceptSmtpProof(state, checking, networkResult), false); assert.equal(state.proof, null); assert.equal(state.busy, false);
  const refreshed = readinessTicket(state); acceptAdminSession(state, refreshed, admin({ csrf: "y".repeat(43) }), now); acceptReadinessSummary(state, readinessTicket(state), summary());
  assert.equal(state.busy, false, "refreshing the new login does not repeat the SMTP check"); assert.equal(state.proof, null);
  assert.ok(beginSmtpCheck(state, now), "a new explicit action can request a proof for the new login");
});
test("SMTP verification requires an enabled mail configuration and a live session", () => {
  const state = connected(); acceptReadinessSummary(state, readinessTicket(state), summary({ mail: { configured: false, sender: CONTACT_EMAIL, replyTo: CONTACT_EMAIL } }));
  assert.equal(beginSmtpCheck(state, now), null);
  acceptReadinessSummary(state, readinessTicket(state), summary()); assert.equal(beginSmtpCheck(state, now + 3600000), null);
  assert.equal(state.busy, false);
});
test("one explicit SMTP action is active at a time and clears the previous proof", () => {
  const state = connected(); const first = beginSmtpCheck(state, now);
  assert.ok(first); assert.equal(state.busy, true); assert.equal(beginSmtpCheck(state, now), null);
  acceptSmtpProof(state, first, proof()); assert.equal(state.busy, false); assert.ok(state.proof);
  assert.ok(beginSmtpCheck(state, now)); assert.equal(state.proof, null); assert.equal(state.busy, true);
});
test("SMTP authentication success never becomes a delivery or publication result", () => {
  const state = connected(); const ticket = beginSmtpCheck(state, now);
  assert.equal(acceptSmtpProof(state, ticket, proof({ hostname: "private", delivered: true, readyForProduction: true })), true);
  assert.deepEqual(state.proof, proof()); assert.equal(state.summary.checks.smtpDelivery, "not_checked");
  assert.equal(state.summary.checks.ageAssurance, "not_integrated"); assert.equal(state.summary.checks.deviceAcceptance, "pending");
});
test("incorrect or expanded SMTP proof scopes cannot render a success", () => {
  for (const input of [proof({ scope: "smtp_delivery" }), proof({ delivery: "delivered" }), proof({ status: "ready" }), proof({ checkedAt: NaN }), proof({ checkedAt: -1 }), proof({ checkedAt: "1800000000000" })]) {
    const state = connected(); const ticket = beginSmtpCheck(state, now);
    assert.throws(() => acceptSmtpProof(state, ticket, input), /invalid_smtp_proof/); assert.equal(state.proof, null);
    rejectSmtpCheck(state, ticket); assert.equal(state.busy, false);
  }
});
test("hiding or logging out clears proof and rejects network completion even after the same account returns", () => {
  const state = connected(); const oldCheck = beginSmtpCheck(state, now); clearReadiness(state);
  assert.equal(state.busy, false); assert.equal(state.proof, null); assert.equal(state.session, null); assert.equal(state.summary, null);
  assert.equal(acceptSmtpProof(state, oldCheck, proof()), false);
  const resumed = clearReadiness(state, { visible: true }); acceptAdminSession(state, resumed, admin(), now); acceptReadinessSummary(state, readinessTicket(state), summary());
  const newCheck = beginSmtpCheck(state, now); assert.equal(acceptSmtpProof(state, oldCheck, proof()), false);
  assert.equal(state.busy, true); assert.equal(state.proof, null); assert.equal(acceptSmtpProof(state, newCheck, proof()), true);
});
test("CSRF failure blocks automatic SMTP retry until the session is refreshed and the user clicks again", () => {
  const state = connected(); const ticket = beginSmtpCheck(state, now);
  assert.equal(rejectSmtpCheck(state, ticket, { csrfFailed: true }), true); assert.equal(state.busy, false); assert.equal(state.proof, null);
  assert.equal(beginSmtpCheck(state, now), null);
  const resumed = clearReadiness(state, { visible: true }); acceptAdminSession(state, resumed, admin(), now); acceptReadinessSummary(state, readinessTicket(state), summary());
  assert.equal(state.busy, false); assert.equal(state.proof, null, "refreshing the session never performs another check"); assert.ok(beginSmtpCheck(state, now));
});
test("a rejected old action cannot unlock a newer in-flight action", () => {
  const state = connected(); const old = beginSmtpCheck(state, now); const fresh = clearReadiness(state, { visible: true }); acceptAdminSession(state, fresh, admin(), now); acceptReadinessSummary(state, readinessTicket(state), summary());
  const current = beginSmtpCheck(state, now); assert.equal(rejectSmtpCheck(state, old), false); assert.equal(state.busy, true);
  assert.equal(rejectSmtpCheck(state, current), true); assert.equal(state.busy, false);
});
test("late completion of an earlier attempt cannot replace a retry in the same visible session", () => {
  const state = connected(); const first = beginSmtpCheck(state, now); rejectSmtpCheck(state, first);
  const retry = beginSmtpCheck(state, now);
  assert.equal(acceptSmtpProof(state, first, proof()), false); assert.equal(rejectSmtpCheck(state, first), false);
  assert.equal(state.busy, true); assert.equal(state.proof, null); assert.equal(acceptSmtpProof(state, retry, proof()), true);
});
test("summary rejects a changed contact identity, guessed readiness or malformed configuration", () => {
  const inputs = [summary({ contactEmail: "other@example.invalid" }), summary({ mail: { configured: true, sender: CONTACT_EMAIL, replyTo: "other@example.invalid" } }),
    summary({ mail: { configured: false, sender: "other@example.invalid", replyTo: "other@example.invalid" } }), summary({ mail: { configured: true, sender: CONTACT_EMAIL + "\n", replyTo: CONTACT_EMAIL + "\n" } }),
    summary({ checks: { ageAssurance: "verified", smtpDelivery: "delivered", deviceAcceptance: "passed" } }), summary({ features: { clientAccess: "true" } })];
  for (const input of inputs) assert.throws(() => parseReadinessSummary(input), /invalid_readiness_summary/);
  const parsed = parseReadinessSummary(summary()); assert.equal(parsed.features.photos, false); assert.equal(Object.hasOwn(parsed, "ready"), false);
});

test("readiness requires the explicit manual admission policy without inventing an integrated age provider", () => {
  const parsed = parseReadinessSummary(summary());
  assert.equal(parsed.checks.admissionPolicy, "manual_invitation"); assert.equal(parsed.checks.ageAssurance, "not_integrated");
  for (const changes of [{ admissionPolicy: undefined }, { admissionPolicy: "unknown" }, { ageAssurance: "pending" }, { ageAssurance: "verified" }]) {
    const input = summary(); Object.assign(input.checks, changes);
    assert.throws(() => parseReadinessSummary(input), /invalid_readiness_summary/);
  }
});

const operations = () => ({ status: "ready", database: { state: "ok", checkedAt: now },
  workers: [{ name: "verification", state: "idle", lastCompletedAt: now - 60000, lastErrorAt: null, consecutiveFailures: 0, processed: 3, failures: 0 }],
  queues: [{ name: "verification", pending: { count: 1000, truncated: true }, sending: { count: 2, truncated: false }, failed: { count: 0, truncated: false }, oldestDueAt: now - 120000 }], queuesCheckedAt: now });

test("operational measures remain optional and never complete delivery, age or device acceptance", () => {
  const legacy = parseReadinessSummary(summary()); assert.equal(Object.hasOwn(legacy, "operations"), false);
  const parsed = parseReadinessSummary(summary({ operations: operations() }));
  assert.deepEqual(parsed.operations, operations()); assert.deepEqual(parsed.checks, legacy.checks);
  assert.equal(parsed.checks.smtpDelivery, "not_checked"); assert.equal(Object.hasOwn(parsed, "readyForProduction"), false);
  const empty = operations(); empty.workers = []; empty.queues = []; empty.queuesCheckedAt = null; empty.database = { state: "starting", checkedAt: null }; empty.status = "unavailable";
  assert.deepEqual(parseReadinessSummary(summary({ operations: empty })).operations, empty);
  for (const input of [null, undefined, {}, [], false]) assert.throws(() => parseReadinessSummary(summary({ operations: input })), /invalid_readiness_operations/);
});

test("operational measures retain only whitelisted aggregate fields and detach every nested reference", () => {
  const expected = operations(), input = operations();
  input.secret = "private-secret"; input.path = "/private/storage"; input.database.connectionString = "private-database";
  input.workers[0].lastError = "private-email-and-error"; input.workers[0].userId = "private-client-id";
  input.queues[0].recipients = ["private@example.invalid"]; input.queues[0].pending.message = "private-message";
  const parsed = parseReadinessSummary(summary({ operations: input })).operations;
  assert.deepEqual(parsed, expected); assert.doesNotMatch(JSON.stringify(parsed), /private/);
  input.database.state = "unavailable"; input.workers[0].processed = 20; input.queues[0].pending.count = 0;
  assert.deepEqual(parsed, expected);
});

test("operational worker and queue names are bounded, unique and fixed rather than arbitrary text", () => {
  const inputs = [];
  for (const key of ["workers", "queues"]) {
    for (const name of ["__proto__", "constructor", "smtp-hostname", "verification\n", "<script>", null, 0, {}, ["verification"], { toString: null }]) {
      const value = operations(); value[key][0].name = name; inputs.push(value);
    }
    for (const list of [null, {}, "verification", new Array(1)]) { const value = operations(); value[key] = list; inputs.push(value); }
    const duplicate = operations(); duplicate[key].push(structuredClone(duplicate[key][0])); inputs.push(duplicate);
    const many = operations(); many[key] = ["verification", "recovery", "broadcasts", "verification"].map((name) => ({ ...structuredClone(many[key][0]), name })); inputs.push(many);
  }
  for (const value of inputs) assert.throws(() => parseOperations(value), /invalid_readiness_operations/);
  const all = operations();
  for (const key of ["workers", "queues"]) all[key] = ["verification", "recovery", "broadcasts", "notifications"].map((name) => ({ ...structuredClone(all[key][0]), name }));
  assert.deepEqual(parseOperations(all), all);
  for (const key of ["workers", "queues"]) { const tooMany = structuredClone(all); tooMany[key].push(structuredClone(tooMany[key][0])); assert.throws(() => parseOperations(tooMany), /invalid_readiness_operations/); }
});

test("operator diagnostic exports only validated aggregates, marks capped counts and dates without accepting raw provider fields", () => {
  const input = operations(); input.private = "secret-report-marker"; input.database.hostname = "secret-report-marker";
  input.workers[0].error = "secret-report-marker"; input.queues[0].endpoint = "secret-report-marker";
  input.queues[0].pending = { count: 1000, truncated: true, payload: "secret-report-marker" };
  const output = formatOperationsReport(input, { now });
  assert.match(output, /JessieMessage — État du service/); assert.ok(output.includes(new Date(now).toISOString()));
  assert.match(output, /En attente : au moins 1000/); assert.match(output, /Ces mesures ne certifient pas/);
  assert.doesNotMatch(output, /secret-report-marker|hostname|endpoint|payload/);
  assert.throws(() => formatOperationsReport({ ...input, status: "production" }, { now }), /invalid_readiness_operations/);
  assert.throws(() => formatOperationsReport(input, { now: NaN }), /invalid_operations_report/);
});

test("operational states and dates reject malformed snapshots and accept the documented boundaries", () => {
  for (const value of ["ok", "production", true, null]) { const input = operations(); input.status = value; assert.throws(() => parseOperations(input), /invalid_readiness_operations/); }
  for (const value of ["ready", "__proto__", "error text", null, {}, ["ok"], { toString: null }]) { const input = operations(); input.database.state = value; assert.throws(() => parseOperations(input), /invalid_readiness_operations/); }
  for (const value of ["ok", "__proto__", "private-error", null, {}, ["idle"], { toString: null }]) { const input = operations(); input.workers[0].state = value; assert.throws(() => parseOperations(input), /invalid_readiness_operations/); }
  const dates = [(input, value) => { input.database.checkedAt = value; }, (input, value) => { input.queuesCheckedAt = value; },
    (input, value) => { input.workers[0].lastCompletedAt = value; }, (input, value) => { input.workers[0].lastErrorAt = value; }, (input, value) => { input.queues[0].oldestDueAt = value; }];
  for (const set of dates) {
    for (const value of [-1, NaN, Infinity, now + 0.5, String(now), undefined, 253402300800000]) {
      const input = operations(); set(input, value); assert.throws(() => parseOperations(input), /invalid_readiness_operations/);
    }
    for (const value of [null, 0, 253402300799999]) {
      const input = operations(); input.status = "unavailable"; set(input, value);
      if (input.database.checkedAt === null) input.database.state = "starting";
      if (input.queuesCheckedAt === null) input.queues = [];
      assert.deepEqual(parseOperations(input), input);
    }
  }
  for (const value of ["starting", "ok", "unavailable", "stale"]) { const input = operations(); input.status = "unavailable"; input.database.state = value; assert.equal(parseOperations(input).database.state, value); }
  for (const value of ["starting", "running", "idle", "error", "stopping", "stopped", "stale"]) { const input = operations(); input.status = "unavailable"; input.workers[0].state = value; assert.equal(parseOperations(input).workers[0].state, value); }
  const inconsistent = [];
  const noDatabaseDate = operations(); noDatabaseDate.status = "unavailable"; noDatabaseDate.database.checkedAt = null; inconsistent.push(noDatabaseDate);
  const noQueueDate = operations(); noQueueDate.status = "unavailable"; noQueueDate.queuesCheckedAt = null; inconsistent.push(noQueueDate);
  for (const state of ["starting", "unavailable", "stale"]) { const input = operations(); input.database.state = state; inconsistent.push(input); }
  for (const state of ["starting", "error", "stopping", "stopped", "stale"]) { const input = operations(); input.workers[0].state = state; inconsistent.push(input); }
  const noCompletedCycle = operations(); noCompletedCycle.workers[0].lastCompletedAt = null; inconsistent.push(noCompletedCycle);
  const currentFailure = operations(); currentFailure.workers[0].consecutiveFailures = 1; inconsistent.push(currentFailure);
  for (const input of inconsistent) assert.throws(() => parseOperations(input), /invalid_readiness_operations/);
});

test("operational counters preserve safe totals and refuse invalid numbers or queue counts beyond the cap", () => {
  for (const key of ["consecutiveFailures", "processed", "failures"]) {
    for (const value of [-1, 1.5, NaN, Infinity, "1", undefined, Number.MAX_SAFE_INTEGER + 1]) {
      const input = operations(); input.workers[0][key] = value; assert.throws(() => parseOperations(input), /invalid_readiness_operations/);
    }
    const input = operations(); input.status = "unavailable"; input.workers[0][key] = Number.MAX_SAFE_INTEGER; assert.deepEqual(parseOperations(input), input);
  }
  for (const key of ["pending", "sending", "failed"]) {
    for (const value of [-1, 0.5, NaN, Infinity, "1", undefined, 1001]) { const input = operations(); input.queues[0][key].count = value; assert.throws(() => parseOperations(input), /invalid_readiness_operations/); }
    for (const value of [0, "false", null, undefined]) { const input = operations(); input.queues[0][key].truncated = value; assert.throws(() => parseOperations(input), /invalid_readiness_operations/); }
    for (const count of [0, 1, 999]) { const input = operations(); input.queues[0][key] = { count, truncated: true }; assert.throws(() => parseOperations(input), /invalid_readiness_operations/); }
    const input = operations(); input.queues[0][key] = { count: 1000, truncated: false }; assert.deepEqual(parseOperations(input), input);
  }
});

test("queue presentation distinguishes capped counts and scheduling age at the sample from delivery", () => {
  assert.equal(queueCountText({ count: 0, truncated: false }), "0");
  assert.equal(queueCountText({ count: 1000, truncated: false }), (1000).toLocaleString("fr-FR"));
  assert.equal(queueCountText({ count: 1000, truncated: true }), `au moins ${(1000).toLocaleString("fr-FR")}`);
  assert.equal(queueDelayMinutes(now - 150000, now), 2);
  assert.equal(queueDelayMinutes(now + 60000, now), 0);
  assert.equal(queueDelayMinutes(null, now), null); assert.equal(queueDelayMinutes(now, null), null);
});

test("clearing the private preparation also clears operations and rejects their late response", () => {
  const state = connected(), ticket = readinessTicket(state);
  acceptReadinessSummary(state, ticket, summary({ operations: operations() })); assert.ok(state.summary.operations);
  clearReadiness(state); assert.equal(state.summary, null);
  assert.equal(acceptReadinessSummary(state, ticket, summary({ operations: operations() })), false);
  assert.equal(state.summary, null);
});
