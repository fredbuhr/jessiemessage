import { createErasureJournal, readErasureJournalBatch } from "./erasure-journal.mjs";
import { erasureBinding, erasureFields, erasureId, erasureTime, failErasure } from "./erasure-state.mjs";

const statuses = ["active", "pending", "revoked", "suspended", "deleted"];
export function closureTarget(value, clientId) {
  if (!value || value.id !== erasureId(clientId) || !statuses.includes(value.status)
    || typeof value.pseudonym !== "string" || !value.pseudonym.length || value.pseudonym.length > 64 || !value.pseudonym.isWellFormed()) failErasure("ERASURE_TARGET");
  return { id: clientId, pseudonym: value.pseudonym, status: value.status };
}
export function createClosureTargets(pool) {
  return async clientId => {
    erasureId(clientId); let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query("SELECT LOWER(HEX(id)) AS id, pseudonym, status FROM users WHERE id = UNHEX(?) AND role = 'client'", [clientId]);
      if (rows.length !== 1) failErasure("ERASURE_TARGET");
      return closureTarget(rows[0], clientId);
    } finally { await connection?.release(); }
  };
}
const view = (clientId, record) => ({ clientId, phase: record?.phase ?? "none", updatedAt: record?.updatedAt ?? null,
  scope: "active_database_and_client_owned_media", backupCopies: "separate_not_erased", externalCopies: "not_checked" });

/** An explicit admin action writes only the encrypted requested intent. The
 * managed parent, after a complete process drain, is the sole destructive owner. */
export function createClosureService({ directory, key, store, target, clock = Date.now }, internal = {}) {
  const binding = erasureBinding(store?.binding), ownedKey = Buffer.from(key ?? []);
  if (ownedKey.length !== 32 || typeof target !== "function" || typeof store?.withLease !== "function" || typeof clock !== "function") failErasure("ERASURE_INPUT");
  const journalFor = internal.journalFor ?? (clientId => createErasureJournal({ directory, key: ownedKey, binding, clientId }));
  const batch = internal.batch ?? (options => readErasureJournalBatch({ directory, key: ownedKey, binding, ...options }));
  let closed = false;
  const available = () => { if (closed) failErasure(); };
  return Object.freeze({
    async list({ afterName = null } = {}) {
      available(); const result = await batch({ afterName, limit: 25 }); available();
      return { version: 1, enabled: true, jobs: result.jobs.map(job => view(job.clientId, job)), nextCursor: result.nextCursor };
    },
    async preview(clientId) {
      available(); erasureId(clientId); const journal = journalFor(clientId);
      try {
        const { record } = await journal.read(); available();
        // A completed receipt remains readable after its SQL identity is gone.
        const client = record?.phase === "completed" ? null : closureTarget(await target(clientId), clientId);
        available(); return { version: 1, client, closure: view(clientId, record) };
      } finally { journal.close(); }
    },
    async request(clientId, body, authorize) {
      available(); erasureId(clientId); erasureFields(body, ["confirmation", "expectedPseudonym"]);
      if (body.confirmation !== "FERMER" || typeof body.expectedPseudonym !== "string" || !body.expectedPseudonym.length
        || body.expectedPseudonym.length > 64 || !body.expectedPseudonym.isWellFormed() || typeof authorize !== "function") failErasure("ERASURE_INPUT");
      const journal = journalFor(clientId);
      try {
        const { record } = await journal.read();
        await authorize(); available();
        if (record) return { version: 1, accepted: true, closure: view(clientId, record) };
        const checkTarget = async () => {
          const client = closureTarget(await target(clientId), clientId);
          if (client.pseudonym !== body.expectedPseudonym || client.status === "deleted") failErasure("ERASURE_CHANGED");
        };
        await checkTarget();
        return await store.withLease(clientId, async scope => {
          const now = erasureTime(clock()); await scope.inspect(now);
          const requested = { version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now };
          await journal.save(requested, 0, async () => { available(); await checkTarget(); await authorize(); available(); });
          return { version: 1, accepted: true, closure: view(clientId, requested) };
        });
      } finally { journal.close(); }
    },
    close() { closed = true; ownedKey.fill(0); },
  });
}
