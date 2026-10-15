export const CONTACT_EMAIL = "contact@jessiemessage.com";
export const featureNames = Object.freeze({ clientAccess: "Accès sur invitation", chat: "Messages privés", photos: "Photos privées", clientFiles: "Fiches clients", passwordRecovery: "Récupération du mot de passe", broadcasts: "Diffusions individuelles" });
const ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const email = (value) => typeof value === "string" && value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);

export function createReadinessState() { return { epoch: 0, checkEpoch: 0, visible: false, session: null, summary: null, proof: null, busy: false, csrfRefreshRequired: false }; }
export function clearReadiness(state, { visible = false } = {}) {
  state.epoch += 1; state.checkEpoch += 1; state.visible = visible; state.session = null; state.summary = null; state.proof = null; state.busy = false; state.csrfRefreshRequired = false;
  return readinessTicket(state);
}
export function readinessTicket(state) { return { epoch: state.epoch, adminId: state.session?.id ?? null }; }
export function currentReadiness(state, ticket) { return state.visible && ticket.epoch === state.epoch && (ticket.adminId === null || ticket.adminId === state.session?.id); }
export function acceptAdminSession(state, ticket, input, now = Date.now()) {
  if (!currentReadiness(state, ticket)) return false;
  const user = input?.user;
  if (user?.role !== "admin" || typeof user.id !== "string" || user.id.length !== 32 || !ID.test(user.id)
    || typeof input.csrf !== "string" || input.csrf.length !== 43 || !TOKEN.test(input.csrf) || !date(input.expiresAt) || input.expiresAt <= now) {
    clearReadiness(state); return false;
  }
  // A different account starts a new epoch; an outstanding check cannot become
  // a proof belonging to the new session even when the tab stayed visible.
  if (state.session && (state.session.id !== user.id || state.session.csrf !== input.csrf)) { clearReadiness(state, { visible: true }); return false; }
  state.session = { id: user.id, csrf: input.csrf, expiresAt: input.expiresAt };
  return true;
}
export function parseReadinessSummary(input) {
  if (input?.contactEmail !== CONTACT_EMAIL || typeof input.mail?.configured !== "boolean" || !email(input.mail.sender) || input.mail.replyTo !== input.mail.sender
    || (!input.mail.configured && input.mail.sender !== CONTACT_EMAIL)) throw new TypeError("invalid_readiness_summary");
  const features = {};
  for (const key of Object.keys(featureNames)) {
    if (typeof input.features?.[key] !== "boolean") throw new TypeError("invalid_readiness_summary");
    features[key] = input.features[key];
  }
  if (input.checks?.ageAssurance !== "pending" || input.checks?.smtpDelivery !== "not_checked" || input.checks?.deviceAcceptance !== "pending") throw new TypeError("invalid_readiness_summary");
  return { contactEmail: CONTACT_EMAIL, mail: { configured: input.mail.configured, sender: input.mail.sender, replyTo: input.mail.sender }, features,
    checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" } };
}
export function acceptReadinessSummary(state, ticket, input) {
  if (!currentReadiness(state, ticket) || !state.session) return false;
  state.summary = parseReadinessSummary(input); return true;
}
export function beginSmtpCheck(state, now = Date.now()) {
  if (!state.visible || !state.session || state.session.expiresAt <= now || !state.summary?.mail.configured || state.busy || state.csrfRefreshRequired) return null;
  state.checkEpoch += 1; state.busy = true; state.proof = null; return { ...readinessTicket(state), checkEpoch: state.checkEpoch };
}
export function acceptSmtpProof(state, ticket, input) {
  if (!currentReadiness(state, ticket) || ticket.checkEpoch !== state.checkEpoch || !state.busy || !state.session) return false;
  if (input?.status !== "verified" || input.scope !== "smtp_authentication" || input.delivery !== "not_checked" || !date(input.checkedAt)) throw new TypeError("invalid_smtp_proof");
  state.proof = { status: "verified", checkedAt: input.checkedAt, scope: "smtp_authentication", delivery: "not_checked" }; state.busy = false; return true;
}
export function rejectSmtpCheck(state, ticket, { csrfFailed = false } = {}) {
  if (!currentReadiness(state, ticket) || ticket.checkEpoch !== state.checkEpoch) return false;
  state.busy = false; state.proof = null; state.csrfRefreshRequired = csrfFailed; return true;
}
