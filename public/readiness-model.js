export const CONTACT_EMAIL = "contact@jessiemessage.com";
export const featureNames = Object.freeze({ clientAccess: "Accès sur invitation", chat: "Messages privés", photos: "Photos privées", clientFiles: "Fiches clients", passwordRecovery: "Récupération du mot de passe", broadcasts: "Diffusions individuelles", notifications: "Notifications sur les appareils" });
export const operationNames = Object.freeze({ verification: "Vérification des e-mails", recovery: "Récupération des accès", broadcasts: "Diffusions individuelles", notifications: "Notifications sur les appareils" });
export const databaseStateNames = Object.freeze({ starting: "Démarrage", ok: "Connexion disponible", unavailable: "Indisponible", stale: "Mesure ancienne" });
export const workerStateNames = Object.freeze({ starting: "Démarrage", running: "En cours", idle: "En attente", error: "Erreur", stopping: "Arrêt en cours", stopped: "Arrêté", stale: "Mesure ancienne" });
const ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const email = (value) => typeof value === "string" && value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
const nullableDate = (value) => value === null || date(value);
const counter = (value) => Number.isSafeInteger(value) && value >= 0;

export function parseRelease(input) {
  if (!input || !(input.version === null || typeof input.version === "string" && input.version.length <= 64 && input.version.trim() === input.version
    && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(input.version))
    || !(input.commit === null || typeof input.commit === "string" && /^[a-f0-9]{40}$/.test(input.commit) && input.commit.length === 40)
    || typeof input.nodeVersion !== "string" || input.nodeVersion.length > 64 || input.nodeVersion.trim() !== input.nodeVersion || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(input.nodeVersion)
    || !date(input.startedAt)) throw new TypeError("invalid_release_identity");
  return { version: input.version, commit: input.commit, nodeVersion: input.nodeVersion, startedAt: input.startedAt };
}

export function parseOperations(input) {
  const invalid = () => { throw new TypeError("invalid_readiness_operations"); };
  if (!input || !["ready", "unavailable"].includes(input.status) || typeof input.database?.state !== "string" || !Object.hasOwn(databaseStateNames, input.database.state)
    || !nullableDate(input.database.checkedAt) || input.database.state === "ok" && input.database.checkedAt === null || !nullableDate(input.queuesCheckedAt)) invalid();
  function list(items, parse) {
    if (!Array.isArray(items) || items.length > Object.keys(operationNames).length) invalid();
    const names = new Set();
    return Array.from(items, (item) => {
      if (!item || typeof item.name !== "string" || !Object.hasOwn(operationNames, item.name) || names.has(item.name)) invalid();
      names.add(item.name); return parse(item);
    });
  }
  const workers = list(input.workers, (item) => {
    if (typeof item.state !== "string" || !Object.hasOwn(workerStateNames, item.state) || !nullableDate(item.lastCompletedAt) || !nullableDate(item.lastErrorAt)
      || !counter(item.consecutiveFailures) || !counter(item.processed) || !counter(item.failures)) invalid();
    return { name: item.name, state: item.state, lastCompletedAt: item.lastCompletedAt, lastErrorAt: item.lastErrorAt,
      consecutiveFailures: item.consecutiveFailures, processed: item.processed, failures: item.failures };
  });
  const queues = list(input.queues, (item) => {
    const counts = {};
    for (const key of ["pending", "sending", "failed"]) {
      const value = item[key];
      if (!value || !counter(value.count) || value.count > 1000 || typeof value.truncated !== "boolean" || value.truncated && value.count !== 1000) invalid();
      counts[key] = { count: value.count, truncated: value.truncated };
    }
    if (!nullableDate(item.oldestDueAt)) invalid();
    return { name: item.name, ...counts, oldestDueAt: item.oldestDueAt };
  });
  if (queues.length > 0 && input.queuesCheckedAt === null || input.status === "ready" && (input.database.state !== "ok"
    || workers.some((worker) => !["idle", "running"].includes(worker.state) || worker.lastCompletedAt === null || worker.consecutiveFailures !== 0))) invalid();
  return { status: input.status, database: { state: input.database.state, checkedAt: input.database.checkedAt }, workers, queues, queuesCheckedAt: input.queuesCheckedAt };
}
export function queueDelayMinutes(oldestDueAt, measuredAt) {
  return oldestDueAt === null || measuredAt === null ? null : Math.max(0, Math.floor((measuredAt - oldestDueAt) / 60000));
}

/** Explicit operator download: fixed aggregate fields, never the raw summary. */
export function formatOperationsReport(input, { now = Date.now(), translate = (source, values = {}) => source.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(values[name] ?? "")) } = {}) {
  if (!date(now) || typeof translate !== "function") throw new TypeError("invalid_operations_report");
  const operations = parseOperations(input);
  const timestamp = value => value === null ? translate("aucune mesure disponible") : new Date(value).toISOString();
  const field = (name, value) => `${translate(name)} : ${value}`;
  const lines = [translate("JessieMessage — État du service"), field("Diagnostic créé", timestamp(now)), translate("Les dates du diagnostic sont en UTC."), "",
    translate(operations.status === "ready" ? "Signal de service : disponible." : "Signal de service : indisponible."),
    field("Base de données", translate(databaseStateNames[operations.database.state])), field("Dernier contrôle de la base", timestamp(operations.database.checkedAt)),
    field("Mesure des files", timestamp(operations.queuesCheckedAt)), "", translate("Traitements")];
  if (!operations.workers.length) lines.push(translate("Aucun traitement suivi dans cette mesure."));
  for (const worker of operations.workers) lines.push(`${translate(operationNames[worker.name])} — ${translate(workerStateNames[worker.state])}`,
    field("Traités", worker.processed), field("Échecs", worker.failures), field("Échecs consécutifs", worker.consecutiveFailures),
    field("Dernier cycle terminé", timestamp(worker.lastCompletedAt)), field("Dernière erreur", timestamp(worker.lastErrorAt)), "");
  lines.push("", translate("Files d’attente"));
  if (!operations.queues.length) lines.push(translate("Aucune file suivie dans cette mesure."));
  for (const queue of operations.queues) {
    lines.push(translate(operationNames[queue.name]));
    for (const [key, name] of [["pending", "En attente"], ["sending", "En traitement"], ["failed", "En échec"]]) {
      const value = queue[key]; lines.push(field(name, value.truncated ? translate("au moins {count}", { count: value.count }) : value.count));
    }
    lines.push(field("Plus ancienne échéance en attente", timestamp(queue.oldestDueAt)), "");
  }
  lines.push(translate("Instantané global de ce processus serveur. Les compteurs de traitement repartent à zéro à son redémarrage. Ces mesures ne certifient pas la mise en production ni la réception des messages."));
  return `${lines.join("\n")}\n`;
}

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
  if (input.checks?.admissionPolicy !== "manual_invitation" || input.checks?.ageAssurance !== "not_integrated"
    || input.checks?.smtpDelivery !== "not_checked" || input.checks?.deviceAcceptance !== "pending") throw new TypeError("invalid_readiness_summary");
  const summary = { contactEmail: CONTACT_EMAIL, mail: { configured: input.mail.configured, sender: input.mail.sender, replyTo: input.mail.sender }, features,
    checks: { admissionPolicy: "manual_invitation", ageAssurance: "not_integrated", smtpDelivery: "not_checked", deviceAcceptance: "pending" } };
  if (Object.hasOwn(input, "operations")) summary.operations = parseOperations(input.operations);
  if (Object.hasOwn(input, "release")) summary.release = parseRelease(input.release);
  return summary;
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
