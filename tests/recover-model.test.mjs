import test from "node:test";
import assert from "node:assert/strict";
import { recoveryToken, passwordProblem, createRecoveryState, beginRecoveryOperation, currentRecoveryOperation,
  finishRecoveryOperation, showRecoveryRequest, suspendRecovery, resumeRecovery, clearRecoveryState } from "../public/recover-model.js";

const token = "a".repeat(42) + "A";
const fragment = `#reset=${token}`;

test("only a single literal reset fragment with a canonical 32-byte token is accepted", () => {
  assert.equal(recoveryToken(fragment), token);
  for (const value of ["", token, `reset=${token}`, `#reset=${token}&reset=${token}`, `#reset=${token}&other=1`,
    `#other=${token}`, `#RESET=${token}`, `#reset=${token}\n`, `#reset=${token}\r\n`, `#reset=${token} `,
    `#reset=${"a".repeat(42)}B`, `#reset=${"a".repeat(42)}-`, `#reset=${token.slice(1)}`, `#reset=${token}A`,
    `#reset=%61${token.slice(1)}`, `#reset=${"é".repeat(43)}`, `#reset=${"a".repeat(42)}=`, null, 7]) assert.equal(recoveryToken(value), null);
});
test("all canonical final base64url digits are accepted without accepting alias padding bits", () => {
  for (const final of "AEIMQUYcgkosw048") assert.equal(recoveryToken(`#reset=${"-".repeat(42)}${final}`), "-".repeat(42) + final);
  for (const final of "BCDFGHJKNOPRSTVWXZabdefhij l m n p q r t u v x y z 1 2 3 5 6 7 9 _".replaceAll(" ", "")) assert.equal(recoveryToken(`#reset=${"a".repeat(42)}${final}`), null);
});
test("opening a link or an ordinary recovery page never begins a reset operation", () => {
  const linked = createRecoveryState(fragment); const ordinary = createRecoveryState();
  assert.equal(linked.mode, "reset"); assert.equal(linked.token, token); assert.equal(linked.pending, null);
  assert.equal(linked.outcome, null); assert.equal(ordinary.mode, "request"); assert.equal(ordinary.token, null);
  assert.equal(beginRecoveryOperation(ordinary, "reset"), null);
});
test("a malformed fragment requests a replacement and never becomes a usable token", () => {
  const state = createRecoveryState(`#reset=${token}&extra=value`);
  assert.equal(state.mode, "request"); assert.equal(state.invalidLink, true); assert.equal(state.token, null);
  assert.equal(beginRecoveryOperation(state, "reset"), null);
});
test("password validation preserves exact whitespace, accents and composition", () => {
  const exact = "  e\u0301té confidentiel  ";
  assert.equal(passwordProblem(exact, exact), null);
  assert.equal(passwordProblem(exact, exact.trim()), "mismatch");
  assert.equal(passwordProblem(exact, exact.normalize("NFC")), "mismatch");
  assert.equal(passwordProblem(" ".repeat(14), " ".repeat(14)), null);
});
test("password limits match server UTF-16 length, accept valid emoji and reject malformed Unicode", () => {
  for (const length of [14, 128]) assert.equal(passwordProblem("é".repeat(length), "é".repeat(length)), null);
  assert.equal(passwordProblem("a".repeat(13), "a".repeat(13)), "short");
  assert.equal(passwordProblem("a".repeat(129), "a".repeat(129)), "long");
  assert.equal(passwordProblem("🔒".repeat(7), "🔒".repeat(7)), null);
  assert.equal(passwordProblem("🔒".repeat(64), "🔒".repeat(64)), null);
  for (const value of ["a".repeat(13) + "\ud800", "\udc00" + "a".repeat(13), "a".repeat(12) + "\ud800a"])
    assert.equal(passwordProblem(value, value), "invalid");
  assert.equal(passwordProblem(null, "a".repeat(14)), "invalid");
  assert.equal(passwordProblem("a".repeat(14), null), "invalid");
});
test("one explicit submission starts one operation and duplicate clicks cannot start another", () => {
  const state = createRecoveryState(fragment); const ticket = beginRecoveryOperation(state, "reset");
  assert.equal(currentRecoveryOperation(state, ticket), true);
  assert.equal(beginRecoveryOperation(state, "reset"), null);
  assert.equal(beginRecoveryOperation(state, "request"), null);
  assert.equal(beginRecoveryOperation(state, "inspect"), null);
});
test("a lost reset acknowledgment allows an explicit retry with the same in-memory token", () => {
  const state = createRecoveryState(fragment); const first = beginRecoveryOperation(state, "reset");
  assert.equal(finishRecoveryOperation(state, first, "retry"), true);
  assert.equal(state.token, token); assert.equal(state.mode, "reset"); assert.equal(state.pending, null);
  const retry = beginRecoveryOperation(state, "reset");
  assert.notEqual(retry.generation, first.generation);
  assert.equal(currentRecoveryOperation(state, first), false);
  assert.equal(finishRecoveryOperation(state, first, "changed"), false);
  assert.equal(state.token, token);
  assert.equal(finishRecoveryOperation(state, retry, "changed"), true);
  assert.equal(state.mode, "complete"); assert.equal(state.token, null);
});
test("a definitive invalid or already-used link is discarded instead of retried automatically", () => {
  const state = createRecoveryState(fragment); const ticket = beginRecoveryOperation(state, "reset");
  finishRecoveryOperation(state, ticket, "invalid");
  assert.equal(state.token, null); assert.equal(state.mode, "request"); assert.equal(state.invalidLink, true);
  assert.equal(state.pending, null); assert.equal(beginRecoveryOperation(state, "reset"), null);
  const request = beginRecoveryOperation(state, "request"); assert.equal(request.operation, "request");
});
test("successful reset retires its token and leaves sign-in as a separate user action", () => {
  const state = createRecoveryState(fragment); const ticket = beginRecoveryOperation(state, "reset");
  finishRecoveryOperation(state, ticket, "changed");
  assert.equal(state.token, null); assert.equal(state.mode, "complete"); assert.equal(state.pending, null);
  assert.equal(beginRecoveryOperation(state, "reset"), null);
  assert.equal(beginRecoveryOperation(state, "request"), null);
  assert.equal(Object.hasOwn(state, "session"), false);
});
test("request acknowledgment uses the same neutral accepted state without account identity", () => {
  const state = createRecoveryState(); const ticket = beginRecoveryOperation(state, "request");
  assert.equal(finishRecoveryOperation(state, ticket, "accepted"), true);
  assert.equal(state.mode, "accepted"); assert.equal(state.token, null); assert.equal(state.pending, null);
  showRecoveryRequest(state); assert.equal(state.mode, "request");
  assert.notEqual(beginRecoveryOperation(state, "request").generation, ticket.generation);
});
test("switching to a new request discards the link and rejects a late successful reset acknowledgment", () => {
  const state = createRecoveryState(fragment); const resetting = beginRecoveryOperation(state, "reset");
  showRecoveryRequest(state); const requesting = beginRecoveryOperation(state, "request");
  assert.equal(state.token, null); assert.equal(finishRecoveryOperation(state, resetting, "changed"), false);
  assert.equal(state.mode, "request"); assert.equal(currentRecoveryOperation(state, requesting), true);
  assert.equal(finishRecoveryOperation(state, requesting, "accepted"), true);
});
test("a late request acknowledgment cannot replace a freshly opened replacement form", () => {
  const state = createRecoveryState(); const ticket = beginRecoveryOperation(state, "request");
  showRecoveryRequest(state);
  assert.equal(finishRecoveryOperation(state, ticket, "accepted"), false);
  assert.equal(state.mode, "request"); assert.equal(state.outcome, null);
});
test("hiding the page invalidates in-flight work and resuming requires an explicit retry", () => {
  const state = createRecoveryState(fragment); const ticket = beginRecoveryOperation(state, "reset");
  suspendRecovery(state);
  assert.equal(finishRecoveryOperation(state, ticket, "changed"), false);
  assert.equal(beginRecoveryOperation(state, "reset"), null);
  assert.equal(state.token, token);
  resumeRecovery(state);
  assert.equal(state.pending, null); assert.equal(currentRecoveryOperation(state, ticket), false);
  const retry = beginRecoveryOperation(state, "reset"); assert.equal(currentRecoveryOperation(state, retry), true);
});
test("page disposal erases the token and permanently rejects earlier acknowledgments", () => {
  const state = createRecoveryState(fragment); const ticket = beginRecoveryOperation(state, "reset");
  clearRecoveryState(state);
  assert.equal(state.token, null); assert.equal(state.mode, "request"); assert.equal(state.pending, null);
  assert.equal(state.suspended, true); assert.equal(finishRecoveryOperation(state, ticket, "changed"), false);
  resumeRecovery(state); assert.equal(beginRecoveryOperation(state, "reset"), null);
  assert.equal(finishRecoveryOperation(state, ticket, "invalid"), false);
});
test("reloading the clean URL does not recover a token from another page state", () => {
  const previous = createRecoveryState(fragment); const reloaded = createRecoveryState();
  assert.equal(previous.token, token); assert.equal(reloaded.token, null); assert.equal(reloaded.mode, "request");
  assert.equal(beginRecoveryOperation(reloaded, "reset"), null);
});
test("incompatible operation outcomes fail without consuming the token or accepting the request", () => {
  const state = createRecoveryState(fragment); const ticket = beginRecoveryOperation(state, "reset");
  assert.throws(() => finishRecoveryOperation(state, ticket, "accepted"), /invalid_recovery_outcome/);
  assert.equal(state.token, token); assert.equal(currentRecoveryOperation(state, ticket), true);
  showRecoveryRequest(state); const request = beginRecoveryOperation(state, "request");
  assert.throws(() => finishRecoveryOperation(state, request, "changed"), /invalid_recovery_outcome/);
  assert.equal(state.mode, "request"); assert.equal(currentRecoveryOperation(state, request), true);
});
