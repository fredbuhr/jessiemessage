import { createAccountErasure } from "./erasure.mjs";
import { erasureBinding, failErasure } from "./erasure-state.mjs";
import { assertErasureContinuity } from "../backup/registry-continuity.mjs";

/** Read-only startup barrier. Never replay a completed erasure against restored
 * personal data, and never expose a partially processed identity to producers. */
export async function verifyClosureStartup({ store, batch, clock = Date.now, assertReady = async () => {} }) {
  let afterName = null, count = 0;
  do {
    await assertReady(); const page = await batch({ afterName, limit: 100 });
    for (const job of page.jobs) {
      if (++count > 10000) failErasure("ERASURE_LIMIT");
      if (job.phase !== "completed") failErasure("ERASURE_PENDING");
      await assertReady(); await store.withLease(job.clientId, scope => scope.verifyAbsent(clock()));
    }
    if (page.nextCursor !== null && (afterName !== null && page.nextCursor <= afterName || !/^erasure-[a-f0-9]{64}\.json$/.test(page.nextCursor))) failErasure("ERASURE_CHANGED");
    afterName = page.nextCursor;
  } while (afterName !== null);
  await assertReady(); return { verified: true, completedReceipts: count };
}

/** This component cannot activate itself. Production binding must supply both
 * a privileged executable-object inspection and preservation of the erasure
 * registry across restoration. A complete challenge/response inventory replaces
 * the old continuity boolean callback. No off-host production transport is
 * installed in 0.66; a second directory on the host is insufficient. */
export function createClosureOperations({ store, storage, journalFor, batch, inspectExecutableObjects, continuity, clock = Date.now }) {
  erasureBinding(store?.binding);
  if ([journalFor, batch, inspectExecutableObjects, clock].some(fn => typeof fn !== "function")) failErasure("ERASURE_INPUT");
  assertErasureContinuity(continuity, store.binding);
  async function preflight(assertReady) {
    await assertReady();
    if ((await inspectExecutableObjects()).verified !== true) failErasure("ERASURE_PREFLIGHT");
    await continuity.verify(assertReady);
    await assertReady();
  }
  return Object.freeze({
    async hasPending() {
      let afterName = null, count = 0;
      do {
        const page = await batch({ afterName, limit: 100 });
        for (const job of page.jobs) { if (++count > 10000) failErasure("ERASURE_LIMIT"); if (job.phase !== "completed") return true; }
        if (page.nextCursor !== null && (afterName !== null && page.nextCursor <= afterName || !/^erasure-[a-f0-9]{64}\.json$/.test(page.nextCursor))) failErasure("ERASURE_CHANGED");
        afterName = page.nextCursor;
      } while (afterName !== null);
      return false;
    },
    async preflight(assertReady) { await preflight(assertReady); },
    async run(assertQuiescent) {
      if (typeof assertQuiescent !== "function") failErasure("ERASURE_MAINTENANCE");
      await preflight(assertQuiescent);
      // Re-prove the complete, freshly witnessed inventory before each SQL/file
      // mutation. A journal published locally is not permission to erase data.
      const witnessed = async () => { await assertQuiescent(); await continuity.verify(assertQuiescent); await assertQuiescent(); };
      const witnessedJournal = (clientId, binding) => {
        const journal = journalFor(clientId, binding);
        return Object.freeze({
          async read() { const value = await journal.read(); await continuity.verifyJournal(clientId, value, assertQuiescent); return value; },
          async save(...args) { const value = await journal.save(...args); await continuity.verifyJournal(clientId, value, assertQuiescent); return value; },
          close: () => journal.close(),
        });
      };
      const engine = createAccountErasure({ store, storage, journalFor: witnessedJournal, clock,
        maintenance: { async withQuiescedProducers(work) { await witnessed(); return work(witnessed); } } });
      let afterName = null, passes = 0, completed = 0;
      do {
        await assertQuiescent(); const page = await batch({ afterName, limit: 100 });
        for (const job of page.jobs) {
          let result;
          do {
            if (++passes > 10000) failErasure("ERASURE_LIMIT");
            result = await engine.resume({ clientId: job.clientId, maxMedia: 100 });
          } while (!result.completed);
          completed++;
        }
        if (page.nextCursor !== null && (afterName !== null && page.nextCursor <= afterName || !/^erasure-[a-f0-9]{64}\.json$/.test(page.nextCursor))) failErasure("ERASURE_CHANGED");
        afterName = page.nextCursor;
      } while (afterName !== null);
      await witnessed();
      await verifyClosureStartup({ store, batch, clock, assertReady: witnessed });
      return { completedReceipts: completed };
    },
  });
}
