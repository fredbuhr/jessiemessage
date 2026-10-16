const NAMES = new Set(["verification", "recovery", "broadcasts", "notifications"]);
const MAX_DATE = 253402300799999;
const fail = () => { throw new TypeError("Invalid operations snapshot."); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const date = (value) => value === null || Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
function names(values) {
  if (!Array.isArray(values) || values.length > NAMES.size || values.some((item) => !object(item) || !NAMES.has(item.name))
    || new Set(values.map((item) => item.name)).size !== values.length) fail();
}
function depth(value) {
  if (!object(value) || !count(value.count) || value.count > 1000 || typeof value.truncated !== "boolean"
    || value.truncated && value.count !== 1000) fail();
  return { count: value.count, truncated: value.truncated };
}

/** A private administrator receives aggregate metadata, never raw probe data. */
export function safeOperationsSnapshot(value) {
  if (!object(value) || !["ready", "unavailable"].includes(value.status) || !object(value.database)
    || !["starting", "ok", "unavailable", "stale"].includes(value.database.state) || !date(value.database.checkedAt)
    || !date(value.queuesCheckedAt)) fail();
  names(value.workers); names(value.queues);
  const workers = value.workers.map((worker) => {
    if (!["starting", "running", "idle", "error", "stopping", "stopped", "stale"].includes(worker.state)
      || !date(worker.lastCompletedAt) || !date(worker.lastErrorAt)
      || ![worker.consecutiveFailures, worker.processed, worker.failures].every(count)) fail();
    return { name: worker.name, state: worker.state, lastCompletedAt: worker.lastCompletedAt, lastErrorAt: worker.lastErrorAt,
      consecutiveFailures: worker.consecutiveFailures, processed: worker.processed, failures: worker.failures };
  });
  const queues = value.queues.map((queue) => {
    if (!date(queue.oldestDueAt)) fail();
    return { name: queue.name, pending: depth(queue.pending), sending: depth(queue.sending), failed: depth(queue.failed), oldestDueAt: queue.oldestDueAt };
  });
  if (value.database.state === "ok" && value.database.checkedAt === null || queues.length && value.queuesCheckedAt === null
    || value.status === "ready" && (value.database.state !== "ok" || workers.some((worker) => !["idle", "running"].includes(worker.state)
      || worker.lastCompletedAt === null || worker.consecutiveFailures !== 0))) fail();
  return { status: value.status, database: { state: value.database.state, checkedAt: value.database.checkedAt },
    workers, queues, queuesCheckedAt: value.queuesCheckedAt };
}
