import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { planClosureReconciliation } from "../server/backup/closure-reconciliation.mjs";
import { operationalStateHash, planOperationalRestore } from "../server/backup/operational-checkpoint.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";
import { withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_reconcile_source", rootFingerprint: "b".repeat(64) };
const targetBinding = { database: "synthetic_reconcile_clone", rootFingerprint: "c".repeat(64) };
const clientId = "a".repeat(32), now = 1792350000000, allow = async () => {};
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = (tag, rootFingerprint) => ({ databaseTag: tag.repeat(64), rootPathTag: String(Number(tag) + 1).repeat(64),
  rootPhysicalTag: String(Number(tag) + 2).repeat(64), rootFingerprint, rootAncestors: ["f".repeat(64)] });
const sourceIdentity = identity("1", binding.rootFingerprint), targetIdentity = identity("4", targetBinding.rootFingerprint);
async function advance(f, phase = "requested", { id = clientId, cursor } = {}) {
  const journal = createErasureJournal({ directory: f.sourceDirectory, key, binding, clientId: id }, { withDirectory: withErasureDirectory });
  try {
    const previous = await journal.read(), at = now + previous.revision;
    const record = previous.record ? { ...previous.record, phase, updatedAt: at, ...(cursor === undefined ? {} : { cursor }) }
      : { version: 1, clientId: id, binding, phase, cursor: null, startedAt: at, updatedAt: at };
    await journal.save(record, previous.revision, allow);
  } finally { journal.close(); }
  await f.gate.verify(allow);
}
async function setup(t) {
  const f = await registryWitnessFixture(t, { key, binding }), challenges = [];
  const continuity = f.makeGate({ exchange: async request => { challenges.push(request.challenge); return f.witness.exchange(request); } });
  const backup = await f.readCurrent(), restored = planOperationalRestore({ backup, current: backup, targetBinding, key });
  const marker = { version: 1, status: "reconciliation_required", backupSha256: restored.backupSha256,
    currentSha256: restored.currentSha256, mergedSha256: restored.mergedSha256, sourceBinding: binding, targetBinding };
  const quarantine = { marker, state: restored.state, markerSha256: hash(`${JSON.stringify(marker)}\n`), stateSha256: restored.mergedSha256 };
  const parameters = async () => ({ key, backup, local: await f.readCurrent(), quarantine, sourceIdentity, targetIdentity,
    checkpointReceiptSha256: "d".repeat(64), contextSha256: "e".repeat(64), continuity, assertReady: allow });
  return { ...f, challenges, continuity, backup, quarantine, parameters };
}
async function files(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, (await readFile(path.join(directory, name))).toString("base64")] )));
}

test("an older quarantine plans every newer authenticated completed receipt with exact original bytes", async t => {
  const f = await setup(t);
  for (const phase of ["requested", "prepared", "files_erased", "completed"]) await advance(f, phase);
  const before = await files(f.sourceDirectory), witnessBefore = await files(f.witnessDirectory);
  const result = await planClosureReconciliation(await f.parameters());
  assert.equal(result.plan.jobs.length, 1);
  assert.deepEqual(result.plan.jobs[0], { name: (await f.readCurrent()).files[0].name,
    sourceEnvelopeSha256: hash(Buffer.from((await f.readCurrent()).files[0].content, "base64url")),
    sourceRevision: 4, sourcePhase: "completed", action: "replay_from_start" });
  assert.deepEqual(result.plan.state.files, (await f.readCurrent()).files);
  assert.equal(result.plan.state.binding.database, binding.database);
  assert.equal(result.planSha256, operationalStateHash(result.plan));
  assert.deepEqual(result.summary, { status: "closure_reconciliation_planned", planSha256: result.planSha256,
    registrySha256: result.plan.registrySha256, witnessRevision: 5, receipts: 1, completedReceipts: 1,
    pendingReceipts: 0, replayFromStartReceipts: 1, reconciliationRequired: true,
    sqlMutationAuthorized: false, targetAbsenceVerified: false, started: false });
  assert.equal(f.challenges.length, 2); assert.equal(new Set(f.challenges).size, 2);
  assert.deepEqual(await files(f.sourceDirectory), before); assert.deepEqual(await files(f.witnessDirectory), witnessBefore);
  assert.deepEqual(key, Buffer.alloc(32, 7));
  const publicText = JSON.stringify(result.summary);
  for (const value of [clientId, binding.database, targetBinding.database, result.plan.jobs[0].name, "completed\""]) assert.equal(publicText.includes(value), false);
  assert.equal(Object.isFrozen(result.plan.state.files[0]), true);
});
test("pending source phases and a high source cursor never become target progress", async t => {
  const f = await setup(t); await advance(f); await advance(f, "prepared");
  await advance(f, "prepared", { cursor: "f".repeat(32) });
  await advance(f, "requested", { id: "d".repeat(32) });
  const result = await planClosureReconciliation(await f.parameters());
  assert.equal(result.summary.pendingReceipts, 2);
  assert.deepEqual(result.plan.jobs.map(job => job.action), ["replay_from_start", "replay_from_start"]);
  assert.equal(result.plan.jobs.some(job => Object.hasOwn(job, "cursor") || Object.hasOwn(job, "clientId")), false);
  const second = await planClosureReconciliation(await f.parameters());
  assert.equal(second.planSha256, result.planSha256); assert.equal(f.challenges.length, 4);
  assert.equal(new Set(f.challenges).size, 4);
});
test("an empty authenticated registry remains a blocked plan, including after a new gate is constructed", async t => {
  const f = await setup(t), parameters = await f.parameters();
  const first = await planClosureReconciliation(parameters), challenges = [];
  const restarted = f.makeGate({ exchange: async request => { challenges.push(request.challenge); return f.witness.exchange(request); } });
  const second = await planClosureReconciliation({ ...parameters, continuity: restarted });
  assert.equal(second.planSha256, first.planSha256); assert.deepEqual(second.plan.jobs, []);
  assert.equal(second.summary.receipts, 0); assert.equal(second.summary.targetAbsenceVerified, false);
  assert.equal(second.summary.sqlMutationAuthorized, false); assert.equal(second.summary.reconciliationRequired, true);
  assert.equal(second.summary.started, false); assert.equal(challenges.length, 2);
  assert.equal(new Set([...f.challenges, ...challenges]).size, 4);
  assert.notEqual((await planClosureReconciliation({ ...parameters, contextSha256: "f".repeat(64) })).planSha256, first.planSha256);
});
test("an old witness response cannot satisfy the next recovery challenge", async t => {
  const f = await setup(t); let saved;
  const continuity = f.makeGate({ exchange: async request => {
    if (saved) return saved;
    saved = await f.witness.exchange(request); return saved;
  } });
  await assert.rejects(planClosureReconciliation({ ...await f.parameters(), continuity }), { code: "ERASURE_CONTINUITY_PROOF" });
});
test("a locally newer receipt missing from the PC cannot borrow an older quarantine's agreement", async t => {
  const f = await setup(t), journal = createErasureJournal({ directory: f.sourceDirectory, key, binding, clientId }, { withDirectory: withErasureDirectory });
  try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, allow); }
  finally { journal.close(); }
  await assert.rejects(planClosureReconciliation(await f.parameters()), { code: "OPERATIONS_REGISTRY_ROLLBACK" });
});
test("a fresh PC change during planning refuses success", async t => {
  const f = await setup(t); let calls = 0;
  const continuity = f.makeGate({ exchange: async request => {
    if (++calls === 2) await advance(f);
    return f.witness.exchange(request);
  } });
  await assert.rejects(planClosureReconciliation({ ...await f.parameters(), continuity }), { code: "CLOSURE_RECONCILIATION_CHANGED" });
});
test("forged or differently bound gates cannot substitute a persisted success flag", async t => {
  const f = await setup(t);
  for (const continuity of [{ recover: async () => ({ verified: true }) }, f.makeGate({ binding: targetBinding })])
    await assert.rejects(planClosureReconciliation({ ...await f.parameters(), continuity }), { code: "ERASURE_CONTINUITY_INPUT" });
  assert.equal(f.challenges.length, 0);
});
test("source/target aliases, changed quarantine hashes and changed private context are rejected", async t => {
  const f = await setup(t), original = await f.parameters();
  for (const change of [
    { targetIdentity: sourceIdentity },
    { targetIdentity: { ...targetIdentity, rootFingerprint: binding.rootFingerprint } },
    { contextSha256: "bad" }, { checkpointReceiptSha256: "bad" },
    { quarantine: { ...f.quarantine, markerSha256: "0".repeat(64) } },
    { quarantine: { ...f.quarantine, stateSha256: "0".repeat(64) } },
    { quarantine: { ...f.quarantine, marker: { ...f.quarantine.marker, backupSha256: "0".repeat(64) } } },
  ]) await assert.rejects(planClosureReconciliation({ ...original, ...change }));
  assert.equal(f.challenges.length, 0);
});
test("a receipt present in quarantine cannot disappear from the fresh source", async t => {
  const f = await setup(t); await advance(f);
  const newer = await f.readCurrent(), merged = planOperationalRestore({ backup: f.backup, current: newer, targetBinding, key });
  const marker = { ...f.quarantine.marker, currentSha256: merged.currentSha256, mergedSha256: merged.mergedSha256 };
  const quarantine = { marker, state: newer, markerSha256: hash(`${JSON.stringify(marker)}\n`), stateSha256: operationalStateHash(newer) };
  const old = await setup(t);
  await assert.rejects(planClosureReconciliation({ ...await old.parameters(), quarantine }), { code: "OPERATIONS_REGISTRY_ROLLBACK" });
});
test("cancellation before or between proofs and resource changes cannot produce a successful plan", async t => {
  for (const mode of ["before", "between", "resource"]) {
    const f = await setup(t), controller = new AbortController(); let checks = 0;
    if (mode === "before") controller.abort();
    await assert.rejects(planClosureReconciliation({ ...await f.parameters(), signal: controller.signal,
      assertReady: async () => { if (++checks === 5) { if (mode === "between") controller.abort(); else if (mode === "resource") throw new Error("Changed private path"); } } }));
  }
});
