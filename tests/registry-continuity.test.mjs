import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chmod, link, mkdir, readFile, readdir, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { createClosureOperations } from "../server/data/closure-operations.mjs";
import { createRegistryWitness } from "../server/backup/registry-witness.mjs";
import { assertErasureContinuity } from "../server/backup/registry-continuity.mjs";
import { registryHash, registryIdentity, snapshotErasureRegistry } from "../server/backup/registry-snapshot.mjs";
import { planOperationalRestore, restoreOperationalQuarantine, assertNoOperationalRestore } from "../server/backup/operational-checkpoint.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_registry", rootFingerprint: "b".repeat(64) };
const now = 1792350000000, clientId = "a".repeat(32), allow = async () => {};
const parameters = { key, binding }, snapshot = state => snapshotErasureRegistry(state, parameters);
function writer(f, id = clientId) { return createErasureJournal({ directory: f.sourceDirectory, key, binding, clientId: id }, { withDirectory: withErasureDirectory }); }
async function advance(f, phase = "requested", id = clientId) {
  const journal = writer(f, id);
  try {
    const previous = await journal.read(), at = now + previous.revision;
    await journal.save(previous.record ? { ...previous.record, phase, updatedAt: at } : { version: 1, clientId: id, binding, phase, cursor: null, startedAt: at, updatedAt: at }, previous.revision, allow);
  } finally { journal.close(); }
}
const request = (f, value, challenge = "e".repeat(64)) => ({ version: 1, registryId: f.registryId, challenge, snapshot: value });

test("missing witness storage is never automatically initialized or acknowledged", async t => {
  const directory = await erasureDirectory(t), registryId = registryIdentity(key, binding);
  const witness = createRegistryWitness({ directory, registryId }, { withDirectory: withErasureDirectory });
  await assert.rejects(witness.exchange({ version: 1, registryId, challenge: "e".repeat(64), snapshot: null }), { code: "ERASURE_CONTINUITY_UNINITIALIZED" });
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await witness.initializeEmpty()).revision, 1);
  await assert.rejects(witness.initializeEmpty(), { code: "ERASURE_CONTINUITY_NOT_EMPTY" });
});
test("fresh encrypted inventories are durable, opaque, idempotent and usable by a new witness process", async t => {
  const f = await registryWitnessFixture(t, parameters), challenges = [];
  const gate = f.makeGate({ exchange: async value => { challenges.push(value.challenge); return f.witness.exchange(value); } });
  assert.equal((await gate.verify(allow)).witnessRevision, 1);
  await advance(f); assert.equal((await gate.verify(allow)).witnessRevision, 2);
  assert.equal((await gate.verify(allow)).witnessRevision, 2);
  for (const phase of ["prepared", "files_erased", "completed"]) { await advance(f, phase); await gate.verify(allow); }
  const reopened = createRegistryWitness({ directory: f.witnessDirectory, registryId: f.registryId }, { withDirectory: withErasureDirectory });
  assert.equal((await f.makeGate({ exchange: value => reopened.exchange(value) }).verify(allow)).witnessRevision, 5);
  assert.equal(new Set(challenges).size, challenges.length);
  for (const name of await readdir(f.witnessDirectory)) {
    const bytes = await readFile(path.join(f.witnessDirectory, name));
    for (const secret of [clientId, binding.database, binding.rootFingerprint, "requested", key.toString("base64url")]) assert.equal(bytes.includes(secret), false);
  }
  assert.deepEqual(key, Buffer.alloc(32, 7));
});
test("an empty source, an older revision and conflicting equal-revision bytes cannot roll back the witness", async t => {
  const f = await registryWitnessFixture(t, parameters), empty = snapshot(await f.readCurrent());
  await advance(f); const old = snapshot(await f.readCurrent()); await f.gate.verify(allow);
  await advance(f, "prepared"); const current = snapshot(await f.readCurrent()); await f.gate.verify(allow);
  for (const value of [empty, old]) await assert.rejects(f.witness.exchange(request(f, value)), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  const conflict = structuredClone(current), envelope = JSON.parse(Buffer.from(conflict.files[0].content, "base64url"));
  envelope.envelope.tag = Buffer.alloc(16, 2).toString("base64url"); conflict.files[0].content = Buffer.from(JSON.stringify(envelope) + "\n").toString("base64url");
  await assert.rejects(f.witness.exchange(request(f, conflict)), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  assert.equal((await f.gate.verify(allow)).witnessRevision, 3);
});
test("missing or rolled-back witness heads cannot hide immutable later publications", async t => {
  for (const mode of ["missing", "old", "gap", "duplicate"]) {
    const f = await registryWitnessFixture(t, parameters), filename = path.join(f.witnessDirectory, "registry-head.json"), genesis = await readFile(filename);
    await advance(f); await f.gate.verify(allow); await advance(f, "prepared"); await f.gate.verify(allow);
    if (mode === "missing") await unlink(filename);
    if (mode === "old") await writeFile(filename, genesis);
    const names = (await readdir(f.witnessDirectory)).filter(name => name.startsWith("registry-000"));
    if (mode === "gap") await unlink(path.join(f.witnessDirectory, names.sort()[0]));
    if (mode === "duplicate") await writeFile(path.join(f.witnessDirectory, names.sort()[1].replace(/([a-f0-9]{64})\.json$/, "f".repeat(64) + ".json")), await readFile(path.join(f.witnessDirectory, names[1])), { mode: 0o600 });
    await assert.rejects(f.makeGate().verify(allow));
    if (mode === "old") assert.deepEqual(await readFile(filename), genesis);
  }
});
test("a publication without a head acknowledgement durably fences out the older proposal", async t => {
  const f = await registryWitnessFixture(t, parameters); await advance(f);
  const value = snapshot(await f.readCurrent()), sha256 = registryHash(value);
  await writeFile(path.join(f.witnessDirectory, `registry-0000000000000002-${sha256}.json`), JSON.stringify(value) + "\n", { mode: 0o600 });
  assert.equal((await f.witness.exchange(request(f, null))).revision, 2);
  await assert.rejects(f.witness.exchange(request(f, { ...value, files: [] })), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  assert.equal((await f.gate.verify(allow)).witnessRevision, 2);
  assert.equal((await f.gate.verify(allow)).witnessRevision, 2);
});
test("unsafe snapshot paths, files, active locks and unrelated entries never produce a witness acknowledgement", async t => {
  for (const mode of ["permissions", "symlink", "hardlink", "lock", "unknown", "corrupt"]) {
    const f = await registryWitnessFixture(t, parameters), name = (await readdir(f.witnessDirectory)).find(name => name.startsWith("registry-000")), filename = path.join(f.witnessDirectory, name);
    if (mode === "permissions") await chmod(filename, 0o644);
    if (mode === "symlink") { await unlink(filename); await symlink("missing", filename); }
    if (mode === "hardlink") await link(filename, path.join(f.root, "alias"));
    if (mode === "lock") await writeFile(path.join(f.witnessDirectory, "registry-head.lock"), "", { mode: 0o600 });
    if (mode === "unknown") await writeFile(path.join(f.witnessDirectory, "unrelated.json"), "{}", { mode: 0o600 });
    if (mode === "corrupt") await writeFile(filename, "{}\n");
    await assert.rejects(f.gate.verify(allow));
  }
});
test("replayed, forged, downgraded or accessor-bearing responses cannot authorize continuity", async t => {
  const f = await registryWitnessFixture(t, parameters); let previous;
  await f.makeGate({ exchange: async value => previous = await f.witness.exchange(value) }).verify(allow);
  await assert.rejects(f.makeGate({ exchange: async () => previous }).verify(allow), { code: "ERASURE_CONTINUITY_PROOF" });
  for (const change of [v => v.sha256 = "f".repeat(64), v => v.registryId = "f".repeat(64), v => v.revision = 0,
    v => v.verified = true, v => { v.snapshot.files = [{ name: `erasure-${"a".repeat(64)}.json`, content: Buffer.from("{}\n").toString("base64url") }]; }]) {
    await assert.rejects(f.makeGate({ exchange: async value => { const response = await f.witness.exchange(value); change(response); return response; } }).verify(allow));
  }
  let invoked = false;
  await assert.rejects(f.makeGate({ exchange: async value => {
    const response = await f.witness.exchange(value); Object.defineProperty(response, "snapshot", { get() { invoked = true; return {}; } }); return response;
  } }).verify(allow)); assert.equal(invoked, false);
  assert.throws(() => assertErasureContinuity({ verify: async () => ({ verified: true }) }, binding));
});
test("a source publication during the exchange invalidates that proof and requires a new complete exchange", async t => {
  const f = await registryWitnessFixture(t, parameters); await advance(f); let changed = false;
  const gate = f.makeGate({ exchange: async value => { const result = await f.witness.exchange(value); if (!changed) { changed = true; await advance(f, "requested", "c".repeat(32)); } return result; } });
  await assert.rejects(gate.verify(allow), { code: "ERASURE_CONTINUITY_CHANGED" });
  assert.equal((await gate.verify(allow)).receipts, 2);
});
test("lost acknowledgement is uncertain; only a fresh challenge and a durable reread resolve it", async t => {
  const f = await registryWitnessFixture(t, parameters); await advance(f); let lose = true;
  const gate = f.makeGate({ exchange: async value => { const result = await f.witness.exchange(value); if (lose && value.snapshot !== null) throw Object.assign(new Error("Synthetic secret and host details"), { continuityCode: "Synthetic private error property" }); return result; } });
  await assert.rejects(gate.verify(allow), error => { assert.equal(error.code, "ERASURE_CONTINUITY_UNAVAILABLE"); assert.doesNotMatch(error.message, /secret|host|synthetic_registry/); return true; });
  lose = false; assert.equal((await gate.verify(allow)).witnessRevision, 2);
});
test("timeouts, cancellation, closure and overlapping proofs cannot succeed from a late reply", async t => {
  const f = await registryWitnessFixture(t, parameters); let started, release;
  const entered = new Promise(resolve => started = resolve), held = new Promise(resolve => release = resolve);
  const gate = f.makeGate({ timeoutMs: 40, exchange: async value => { started(); await held; return f.witness.exchange(value); } });
  const first = gate.verify(allow); await entered;
  await assert.rejects(gate.verify(allow), { code: "ERASURE_CONTINUITY_BUSY" });
  await assert.rejects(first, { code: "ERASURE_CONTINUITY_TIMEOUT" }); release();
  let enteredTransport; const inFlight = new Promise(resolve => enteredTransport = resolve);
  const controller = new AbortController(), waiting = f.makeGate({ exchange: async (_value, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Synthetic cancelled transport")), { once: true }); enteredTransport();
  }) });
  const task = waiting.verify(allow, { signal: controller.signal }); await inFlight; controller.abort(); await assert.rejects(task, { code: "ERASURE_CONTINUITY_ABORTED" });
  const closed = f.makeGate(); closed.close(); await assert.rejects(closed.verify(allow)); assert.throws(() => assertErasureContinuity(closed, binding));
});
test("a fresh application process authenticates the previous remote record before publishing a higher revision", async t => {
  const f = await registryWitnessFixture(t, parameters); await advance(f); await f.gate.verify(allow);
  const old = await f.readCurrent(), alternate = path.join(f.root, "alternate"); await mkdir(alternate, { mode: 0o700 });
  const journal = createErasureJournal({ directory: alternate, key, binding, clientId }, { withDirectory: withErasureDirectory });
  try {
    let revision = 0; const value = { version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now + 100, updatedAt: now + 100 };
    for (const phase of ["requested", "prepared", "files_erased", "completed"]) revision = (await journal.save({ ...value, phase }, revision, allow)).revision;
  } finally { journal.close(); }
  const name = old.files[0].name;
  await writeFile(path.join(f.sourceDirectory, name), await readFile(path.join(alternate, name)));
  await assert.rejects(f.makeGate().verify(allow), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  assert.deepEqual((await f.makeGate().recover(allow)).state, old);
});
test("a journal first observed after preparation or completion cannot be retroactively certified", async t => {
  const f = await registryWitnessFixture(t, parameters); await advance(f); await advance(f, "prepared");
  await assert.rejects(f.gate.verify(allow), { code: "ERASURE_CONTINUITY_UNWITNESSED" });
  assert.deepEqual((await f.makeGate().recover(allow)).state.files, []);
});
test("a journal outside the observed directory, or at a different phase, never borrows an empty registry proof", async t => {
  const f = await registryWitnessFixture(t, parameters), empty = { revision: 0, record: null };
  await f.gate.verifyJournal(clientId, empty, allow);
  const other = path.join(f.root, "other"); await mkdir(other, { mode: 0o700 });
  const alternate = { ...f, sourceDirectory: other }; await advance(alternate);
  const journal = writer(alternate); let state;
  try { state = await journal.read(); } finally { journal.close(); }
  await assert.rejects(f.gate.verifyJournal(clientId, state, allow), { code: "ERASURE_CONTINUITY_JOURNAL" });
  await advance(f); await f.gate.verifyJournal(clientId, state, allow);
  await advance(f, "prepared");
  await assert.rejects(f.gate.verifyJournal(clientId, state, allow), { code: "ERASURE_CONTINUITY_JOURNAL" });
});
test("the actual journal lock keeps its maintenance/root authorization without recapturing a locked registry", async t => {
  const f = await registryWitnessFixture(t, parameters); await advance(f); const mutations = [];
  let stopped = true, rootChecks = 0, rootsUnderLock = 0, driftDuringCommit = false;
  const secondId = "c".repeat(32);
  const guard = async () => { assert.equal(stopped, true); };
  const store = { binding, async withLease(id, work) { assert.ok([clientId, secondId].includes(id)); return work({ binding,
    async prepare() { mutations.push("prepare"); return { prepared: true }; },
    async nextMedia() { return null; }, async finish() { mutations.push("finish"); return { completed: true }; }, async verifyAbsent() {},
  }); } };
  const continuity = f.makeGate({ exchange: async value => {
    assert.equal((await readdir(f.sourceDirectory)).some(name => name.startsWith("erasure-") && name.endsWith(".lock")), false);
    return f.witness.exchange(value);
  } });
  const operations = createClosureOperations({ store, continuity, storage: { async fingerprint() {
    rootChecks++; const locked = (await readdir(f.sourceDirectory)).some(name => name.startsWith("erasure-") && name.endsWith(".lock"));
    if (locked) rootsUnderLock++;
    return locked && driftDuringCommit ? Buffer.alloc(32, 1) : Buffer.from(binding.rootFingerprint, "hex");
  }, async remove() { assert.fail("No media in this fixture"); } },
    journalFor: id => writer(f, id), batch: args => readErasureJournalBatch({ directory: f.sourceDirectory, key, binding, ...args }, { withDirectory: withErasureDirectory }),
    inspectExecutableObjects: async () => ({ verified: true }), clock: () => now + 1 });
  assert.deepEqual(await operations.run(guard), { completedReceipts: 1 });
  assert.deepEqual(mutations, ["prepare", "finish"]); assert.ok(rootChecks > 6); assert.equal(rootsUnderLock, 3);
  const journal = writer(f); try { assert.equal((await journal.read()).record.phase, "completed"); } finally { journal.close(); }
  assert.equal((await continuity.recover(guard)).state.files.length, 1);
  await advance(f, "requested", secondId); driftDuringCommit = true;
  await assert.rejects(operations.run(guard), { code: "ERASURE_BINDING" });
  const second = writer(f, secondId); try { assert.equal((await second.read()).record.phase, "requested"); } finally { second.close(); }
  assert.deepEqual(mutations, ["prepare", "finish", "prepare"]);
  stopped = false; await assert.rejects(operations.run(guard));
});
test("a fresh witness recovery preserves receipts newer than an old SQL capture after the local registry is lost", async t => {
  const f = await registryWitnessFixture(t, parameters), backup = await f.readCurrent();
  await advance(f); await f.gate.verify(allow);
  for (const phase of ["prepared", "files_erased", "completed"]) { await advance(f, phase); await f.gate.verify(allow); }
  const expected = await f.readCurrent();
  for (const file of expected.files) await unlink(path.join(f.sourceDirectory, file.name));
  const fresh = f.makeGate(); await assert.rejects(fresh.verify(allow), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  const recovered = await fresh.recover(allow); assert.deepEqual(recovered.state, expected); assert.equal(recovered.started, false);
  const targetBinding = { database: "synthetic_clone", rootFingerprint: "d".repeat(64) };
  const plan = planOperationalRestore({ backup, current: recovered.state, targetBinding, key });
  assert.equal(plan.completedReceipts, 1); assert.equal(plan.externalContinuityVerified, false);
  const target = path.join(f.root, "quarantine"); await mkdir(target, { mode: 0o700 });
  await withErasureDirectory(target, scope => restoreOperationalQuarantine(scope, { backup, current: recovered.state, targetBinding, key,
    expectedCurrentSha256: plan.currentSha256, assertCurrent: async () => assert.deepEqual((await fresh.recover(allow)).state, expected) }));
  await assert.rejects(withErasureDirectory(target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
  assert.deepEqual(await readdir(f.sourceDirectory), []);
});

let procfs = false; try { procfs = (await statfs("/proc/self/fd", { bigint: true })).type === 0x9fa0n; } catch {}
test("native descriptor-anchored witness storage survives reopening and rejects an absent head", { skip: !procfs }, async t => {
  const f = await registryWitnessFixture(t, { ...parameters, withDirectory: withPrivateDirectory });
  // Journal writes use the same native path implementation in Linux CI.
  const journal = createErasureJournal({ directory: f.sourceDirectory, key, binding, clientId });
  try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, allow); } finally { journal.close(); }
  assert.equal((await f.gate.verify(allow)).receipts, 1);
  await unlink(path.join(f.witnessDirectory, "registry-head.json"));
  await assert.rejects(f.makeGate().verify(allow), { code: "ERASURE_CONTINUITY_UNINITIALIZED" });
});
test("Linux CI exercises native witness paths", { skip: !["true", "1"].includes(process.env.CI) }, () => assert.equal(procfs, true));
