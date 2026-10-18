import { createAccountErasure } from "./erasure.mjs";
import { erasureBinding, failErasure } from "./erasure-state.mjs";

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
 * registry across restoration. Neither a DML metadata query nor a boolean is a
 * substitute. No such production binding is shipped in 0.64. */
export function createClosureOperations({ store, storage, journalFor, batch, inspectExecutableObjects, verifyRegistryContinuity, clock = Date.now }) {
  erasureBinding(store?.binding);
  if ([journalFor, batch, inspectExecutableObjects, verifyRegistryContinuity, clock].some(fn => typeof fn !== "function")) failErasure("ERASURE_INPUT");
  async function preflight(assertReady) {
    await assertReady();
    if ((await inspectExecutableObjects()).verified !== true || (await verifyRegistryContinuity()).verified !== true) failErasure("ERASURE_PREFLIGHT");
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
      const engine = createAccountErasure({ store, storage, journalFor, clock,
        maintenance: { async withQuiescedProducers(work) { await assertQuiescent(); return work(assertQuiescent); } } });
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
      await verifyClosureStartup({ store, batch, clock, assertReady: assertQuiescent });
      return { completedReceipts: completed };
    },
  });
}
