const TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function recoveryToken(fragment) {
  if (typeof fragment !== "string" || fragment.length !== 50 || !fragment.startsWith("#reset=")) return null;
  const token = fragment.slice(7);
  return token.length === 43 && TOKEN.test(token) ? token : null;
}

export function passwordProblem(password, confirmation) {
  if (typeof password !== "string" || typeof confirmation !== "string") return "invalid";
  if (password.length < 8) return "short";
  if (password.length > 128) return "long";
  for (let index = 0; index < password.length; index += 1) {
    const unit = password.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = password.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "invalid";
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return "invalid";
  }
  if (new TextEncoder().encode(password).byteLength > 512) return "long";
  return password === confirmation ? null : "mismatch";
}

export function createRecoveryState(fragment = "") {
  const token = recoveryToken(fragment);
  return { token, mode: token ? "reset" : "request", invalidLink: fragment !== "" && !token,
    generation: 0, pending: null, suspended: false, outcome: null };
}

export function beginRecoveryOperation(state, operation) {
  if (state.suspended || state.pending || !["request", "reset"].includes(operation) || state.mode !== operation || (operation === "reset" && !state.token)) return null;
  state.generation += 1; state.pending = operation; state.outcome = null;
  return { generation: state.generation, operation };
}

export function currentRecoveryOperation(state, ticket) {
  return Boolean(ticket) && !state.suspended && ticket.generation === state.generation && ticket.operation === state.pending;
}

// A lost acknowledgment leaves the token available for an explicit retry. Only
// a definitive success, invalid link or deliberate change of form discards it.
export function finishRecoveryOperation(state, ticket, outcome) {
  if (!currentRecoveryOperation(state, ticket)) return false;
  if (!["accepted", "changed", "invalid", "retry"].includes(outcome)
    || (ticket.operation === "request" && !["accepted", "retry"].includes(outcome))
    || (ticket.operation === "reset" && outcome === "accepted")) throw new TypeError("invalid_recovery_outcome");
  state.pending = null; state.outcome = outcome;
  if (outcome === "accepted") state.mode = "accepted";
  if (outcome === "changed") { state.token = null; state.mode = "complete"; state.invalidLink = false; }
  if (outcome === "invalid") { state.token = null; state.mode = "request"; state.invalidLink = true; }
  return true;
}

export function showRecoveryRequest(state) {
  state.generation += 1; state.pending = null; state.token = null; state.mode = "request"; state.outcome = null; state.invalidLink = false;
}
export function suspendRecovery(state) {
  state.generation += 1; state.pending = null; state.suspended = true;
}
export function resumeRecovery(state) { state.suspended = false; }
export function clearRecoveryState(state) {
  showRecoveryRequest(state); state.suspended = true;
}
