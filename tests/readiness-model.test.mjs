import test from "node:test";
import assert from "node:assert/strict";
import { CONTACT_EMAIL, createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession, parseReadinessSummary, acceptReadinessSummary, beginSmtpCheck, acceptSmtpProof, rejectSmtpCheck } from "../public/readiness-model.js";

const now = 1800000000000;
const admin = (extra = {}) => ({ user: { id: "a".repeat(32), role: "admin", pseudonym: "Jessie" }, csrf: "x".repeat(43), expiresAt: now + 3600000, ...extra });
const summary = (extra = {}) => ({ contactEmail: CONTACT_EMAIL, mail: { configured: true, sender: CONTACT_EMAIL, replyTo: CONTACT_EMAIL },
  features: { clientAccess: true, chat: true, photos: false, clientFiles: true, passwordRecovery: true, broadcasts: true },
  checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" }, ...extra });
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
  assert.equal(state.summary.checks.ageAssurance, "pending"); assert.equal(state.summary.checks.deviceAcceptance, "pending");
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
