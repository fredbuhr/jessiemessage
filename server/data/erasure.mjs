import { AccountErasureError, erasureBinding, erasureId, erasureRecord, erasureTime, failErasure } from "./erasure-state.mjs";

/** No HTTP route, worker or production maintenance adapter is installed here.
 * withQuiescedProducers must hold an external exclusion/drain of ALL writers,
 * uploads, SMTP/Push deliveries and captures for the entire callback. A SQL
 * snapshot, a claimed offline boolean or the eraser advisory lock is insufficient. */
export function createAccountErasure({ store, storage, journalFor, maintenance, clock = Date.now }) {
  if (typeof store?.withLease !== "function" || typeof storage?.fingerprint !== "function" || typeof storage?.remove !== "function"
    || typeof journalFor !== "function" || typeof maintenance?.withQuiescedProducers !== "function" || typeof clock !== "function") failErasure("ERASURE_INPUT");
  const binding = erasureBinding(store.binding);
  const view = (record, processedMedia) => Object.freeze({ phase: record.phase, completed: record.phase === "completed", processedMedia,
    scope: "active_database_and_client_owned_media", backupCopies: "separate_not_erased", externalCopies: "not_checked" });
  return Object.freeze({
    async resume(input) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["clientId", "maxMedia"].includes(key))) failErasure("ERASURE_INPUT");
      const clientId = erasureId(input.clientId), maxMedia = input.maxMedia ?? 25;
      if (!Number.isSafeInteger(maxMedia) || maxMedia < 1 || maxMedia > 100) failErasure("ERASURE_INPUT");
      try {
        return await maintenance.withQuiescedProducers(async assertQuiescent => {
          if (typeof assertQuiescent !== "function") failErasure("ERASURE_MAINTENANCE");
          let current;
          const now = () => {
            const value = erasureTime(clock());
            if (current?.record && value < current.record.updatedAt) failErasure("ERASURE_CLOCK"); return value;
          };
          const guard = async () => {
            await assertQuiescent();
            const root = await storage.fingerprint();
            if (!Buffer.isBuffer(root) || root.length !== 32 || root.toString("hex") !== binding.rootFingerprint) failErasure("ERASURE_BINDING");
          };
          await guard();
          return store.withLease(clientId, async scope => {
            if (JSON.stringify(erasureBinding(scope.binding)) !== JSON.stringify(binding)) failErasure("ERASURE_BINDING");
            const journal = journalFor(clientId, binding);
            if (["read", "save", "close"].some(name => typeof journal?.[name] !== "function")) failErasure("ERASURE_INPUT");
            let processedMedia = 0;
            function checked(value) {
              if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) failErasure();
              const record = value.record === null ? null : erasureRecord(value.record);
              if (record === null ? value.revision !== 0 : value.revision < 1 || record.clientId !== clientId || JSON.stringify(record.binding) !== JSON.stringify(binding)) failErasure("ERASURE_BINDING");
              return { revision: value.revision, record };
            }
            async function save(record) {
              await guard();
              const saved = checked(await journal.save(record, current.revision, guard));
              if (saved.revision !== current.revision + 1 || JSON.stringify(saved.record) !== JSON.stringify(record)) failErasure("ERASURE_CHANGED");
              current = saved;
            }
            const advance = phase => save({ ...current.record, phase, updatedAt: now() });
            try {
              current = checked(await journal.read());
              if (current.record === null) {
                await guard(); await scope.inspect(now());
                const at = now(); await save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: at, updatedAt: at });
              }
              if (current.record.phase === "completed") {
                // A restored account is a blocker, never silently reported as erased.
                await guard(); await scope.verifyAbsent(now()); return view(current.record, 0);
              }
              if (current.record.phase === "requested") {
                await guard(); const result = await scope.prepare(now());
                if (result?.prepared !== true) failErasure();
                await advance("prepared");
              }
              if (current.record.phase === "prepared") {
                for (;;) {
                  await guard(); const object = await scope.nextMedia(current.record.cursor, now());
                  if (object === null) break;
                  erasureId(object?.id);
                  if (current.record.cursor !== null && object.id <= current.record.cursor || !Buffer.isBuffer(object.storageKey) || object.storageKey.length !== 32) failErasure("ERASURE_BINDINGS");
                  if (processedMedia >= maxMedia) return view(current.record, processedMedia);
                  await guard(); await storage.remove({ storageKey: object.storageKey });
                  await guard(); const released = await scope.releaseMedia(object.id, object.storageKey, now());
                  if (released?.released !== true) failErasure();
                  await save({ ...current.record, cursor: object.id, updatedAt: now() }); processedMedia++;
                }
                await advance("files_erased");
              }
              if (current.record.phase === "files_erased") {
                await guard(); const result = await scope.finish(now());
                if (result?.completed !== true) failErasure();
                await guard(); await scope.verifyAbsent(now()); await advance("completed");
              }
              return view(current.record, processedMedia);
            } finally { journal.close(); }
          });
        });
      } catch (error) { if (error instanceof AccountErasureError) throw error; failErasure(); }
    },
  });
}
