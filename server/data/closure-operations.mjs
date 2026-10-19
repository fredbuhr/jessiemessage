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

/** Local application maintenance. This owner makes no off-host freshness or
 * rollback claim: restoration stays an explicit operator-controlled process. */
export function createLocalClosureOperations({ store, storage, journalFor, batch, inspectApplicationSchema, clock = Date.now }) {
  erasureBinding(store?.binding);
  if ([store?.withLease, storage?.fingerprint, storage?.remove, journalFor, batch, inspectApplicationSchema, clock].some(fn => typeof fn !== "function")) failErasure("ERASURE_INPUT");
  const guarded = (assertReady, signal) => {
    if (typeof assertReady !== "function") failErasure("ERASURE_MAINTENANCE");
    return async () => { if (signal?.aborted) failErasure("ERASURE_ABORTED"); await assertReady(); if (signal?.aborted) failErasure("ERASURE_ABORTED"); };
  };
  async function preflight(assertReady, { signal } = {}) {
    const ready = guarded(assertReady, signal);
    await ready(); if ((await inspectApplicationSchema())?.verified !== true) failErasure("ERASURE_PREFLIGHT"); await ready();
  }
  async function verifyStartup(assertQuiescent, { signal } = {}) {
    const ready = guarded(assertQuiescent, signal), identities = new Set();
    await preflight(ready);
    const result = await verifyClosureStartup({ store, clock, assertReady: ready, batch: async page => {
      const value = await batch(page);
      for (const job of value.jobs) {
        if (identities.has(job.clientId)) failErasure("ERASURE_CHANGED");
        identities.add(job.clientId); const journal = journalFor(job.clientId, store.binding);
        try {
          const state = await journal.read();
          if (state.record === null || state.record.phase !== job.phase || state.revision !== job.revision
            || state.record.updatedAt !== job.updatedAt) failErasure("ERASURE_CHANGED");
        } finally { journal.close(); }
      }
      return value;
    } });
    await ready(); return { ...result, scope: "local_application" };
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
    preflight, verifyStartup,
    async run(assertQuiescent, { signal } = {}) {
      const ready = guarded(assertQuiescent, signal); await preflight(ready);
      // Only previously recorded intents are run. A disappearing journal cannot
      // turn discovery into a new deletion request after the process was drained.
      const existingJournal = (clientId, binding) => {
        const journal = journalFor(clientId, binding);
        return { async read() { const state = await journal.read(); if (state.record === null) failErasure("ERASURE_CHANGED"); return state; },
          save: (...args) => journal.save(...args), close: () => journal.close() };
      };
      const engine = createAccountErasure({ store, storage, journalFor: existingJournal, clock,
        maintenance: { async withQuiescedProducers(work) { await ready(); return work(ready, ready); } } });
      let afterName = null, passes = 0, completed = 0;
      do {
        await ready(); const page = await batch({ afterName, limit: 100 });
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
      const proof = await verifyStartup(ready);
      if (proof.completedReceipts !== completed) failErasure("ERASURE_CHANGED");
      return { completedReceipts: completed };
    },
  });
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
    /** A new challenge is mandatory on every managed opening, even when the
     * local discovery is empty. Bind each checked identity to the witnessed
     * journal; a different empty directory cannot borrow this gate's proof.
     * This read-only barrier never repairs or replays an erasure. */
    async verifyStartup(assertQuiescent, { signal } = {}) {
      if (typeof assertQuiescent !== "function") failErasure("ERASURE_MAINTENANCE");
      const initial = await continuity.verify(assertQuiescent, { signal });
      const identities = new Set();
      const unchanged = proof => {
        if (proof.registrySha256 !== initial.registrySha256 || proof.witnessRevision !== initial.witnessRevision
          || proof.receipts !== initial.receipts) failErasure("ERASURE_CHANGED");
      };
      const result = await verifyClosureStartup({ store, clock, assertReady: assertQuiescent,
        batch: async page => {
          const value = await batch(page);
          for (const job of value.jobs) {
            if (identities.has(job.clientId)) failErasure("ERASURE_CHANGED");
            identities.add(job.clientId);
            const journal = journalFor(job.clientId, store.binding);
            try {
              const state = await journal.read();
              if (state.record === null || state.record.phase !== job.phase || state.revision !== job.revision
                || state.record.updatedAt !== job.updatedAt) failErasure("ERASURE_CHANGED");
              unchanged(await continuity.verifyJournal(job.clientId, state, assertQuiescent, { signal }));
            } finally { journal.close(); }
          }
          return value;
        } });
      unchanged(await continuity.verify(assertQuiescent, { signal }));
      if (result.completedReceipts !== initial.receipts) failErasure("ERASURE_CHANGED");
      await assertQuiescent();
      return { ...result, registrySha256: initial.registrySha256, witnessRevision: initial.witnessRevision };
    },
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
        maintenance: { async withQuiescedProducers(work) { await witnessed(); return work(witnessed, assertQuiescent); } } });
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
