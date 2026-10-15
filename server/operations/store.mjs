const MAX_DATE = 253402300799999;
const SAMPLE_LIMIT = 1000;
const SOURCES = Object.freeze([
  { name: "verification", table: "mail_outbox", state: "status" },
  { name: "recovery", table: "password_reset_outbox", state: "status" },
  { name: "broadcasts", table: "broadcast_recipients", state: "state" },
]);

export class OperationsStoreError extends Error {
  constructor() {
    super("Private operational sampling is unavailable.");
    this.name = "OperationsStoreError";
    this.code = "OPERATIONS_STORE_UNAVAILABLE";
  }
}
const fail = () => { throw new OperationsStoreError(); };
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

function rows(value, field) {
  if (!Array.isArray(value) || value.length > SAMPLE_LIMIT + 1) fail();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || Object.keys(row).length !== 1 || !Object.hasOwn(row, field)) fail();
  }
  return value;
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) fail();
  const iso = `${value.slice(0, 23).replace(" ", "T")}Z`;
  const parsed = Date.parse(iso);
  if (!instant(parsed) || new Date(parsed).toISOString() !== iso) fail();
  return parsed;
}
const count = (value) => ({ count: Math.min(value.length, SAMPLE_LIMIT), truncated: value.length > SAMPLE_LIMIT });

/** Capped scheduling metadata only. It never claims work or verifies delivery eligibility. */
export function createOperationsStore({ pool, verification = true, recovery = false, broadcasts = false } = {}) {
  if (typeof pool?.getConnection !== "function"
    || [verification, recovery, broadcasts].some((value) => typeof value !== "boolean")) fail();
  const enabled = { verification, recovery, broadcasts };
  const sources = SOURCES.filter(({ name }) => enabled[name]);
  return Object.freeze({
    async sample({ now } = {}) {
      if (!instant(now)) fail();
      let connection;
      try {
        connection = await pool.getConnection();
        const proof = rows(await connection.query("SELECT 1 AS ready"), "ready");
        if (proof.length !== 1 || proof[0].ready !== 1) fail();
        const queues = [];
        for (const source of sources) {
          // Source names and states come exclusively from the fixed allowlist.
          // LIMIT bounds rows read from the existing state/available_at index,
          // rather than applying a result limit to an unbounded COUNT aggregate.
          const pending = rows(await connection.query(`SELECT available_at FROM ${source.table}
            WHERE ${source.state} = 'pending' ORDER BY available_at LIMIT 1001`), "available_at");
          let previous = null;
          for (const row of pending) {
            timestamp(row.available_at);
            if (previous !== null && row.available_at < previous) fail();
            previous = row.available_at;
          }
          const sending = rows(await connection.query(`SELECT 1 AS present FROM ${source.table}
            WHERE ${source.state} = 'sending' LIMIT 1001`), "present");
          const failed = rows(await connection.query(`SELECT 1 AS present FROM ${source.table}
            WHERE ${source.state} = 'failed' LIMIT 1001`), "present");
          if ([...sending, ...failed].some((row) => row.present !== 1)) fail();
          const first = pending[0]?.available_at;
          // Compare full microsecond SQL timestamps before returning milliseconds:
          // a +1 microsecond future candidate must not look due after truncation.
          const oldestDueAt = first !== undefined && first <= sqlDate(now) ? timestamp(first) : null;
          queues.push({ name: source.name, pending: count(pending), sending: count(sending), failed: count(failed), oldestDueAt });
        }
        return { database: true, queues };
      } catch {
        // Never forward driver errors, SQL, configuration or row content.
        fail();
      } finally {
        if (connection) {
          try { connection.release(); } catch { fail(); }
        }
      }
    },
  });
}
