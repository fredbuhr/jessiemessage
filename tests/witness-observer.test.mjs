import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createConfiguredWitnessObserver } from "../server/backup/witness-observer.mjs";
import { WitnessEnrollmentError } from "../server/backup/witness-enrollment.mjs";
import { registryHash, registryIdentity } from "../server/backup/registry-snapshot.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const binding = { database: "synthetic_observer", rootFingerprint: "b".repeat(64) }, sourceKey = Buffer.alloc(32, 7);
const registryId = registryIdentity(sourceKey, binding), emptyHash = registryHash({ version: 1, registryId, files: [] });
const contract = { version: 1, origin: "https://jessiemessage.com", contractId: "a".repeat(64), createdAt: 1792407600000,
  binding, sourceIdentity: { dev: "1", ino: "2" }, registryId,
  destination: { destinationId: "a".repeat(32), pairedAt: 1792407500000, pairingFingerprint: "e".repeat(64) }, initialSnapshotSha256: emptyHash };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, changes = {}) {
  const root = await erasureDirectory(t), dirs = Object.fromEntries(["operations", "operator", "runtime", "private", "media"].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(dirs)) await mkdir(directory, { mode: 0o700 });
  await mkdir(path.join(dirs.operator, "contract"), { mode: 0o700 }); await mkdir(path.join(dirs.operator, "enrollment"), { mode: 0o700 });
  const events = [], notices = [], keys = [], parameters = {};
  let localUnavailable = false, original = true, authority = { ready: true, spent: false }, enrollmentMissing = false, enrollmentFailure = null, offline = false, pendingProbe = null, enrollmentOptions;
  const proof = { verified: true, registrySha256: emptyHash, witnessRevision: 1, receipts: 0 };
  const source = async () => { if (!original) throw new Error("Synthetic original runtime/source drift"); };
  const enrollmentHandler = async request => { events.push("enrollment-http"); return request.url === "/enrollment-fixture"; };
  enrollmentHandler.close = () => events.push("enrollment-http-close");
  const internals = { source, withDirectory: withErasureDirectory, clock: () => 1792410000000,
    withOrigin: async (_options, _settings, work) => {
      const key = Buffer.from(sourceKey); keys.push(key);
      try { return await work({ key, binding, mediaRoot: dirs.media, configurationFingerprint: "9".repeat(64), assertReady: source }); }
      finally { key.fill(0); }
    },
    readGenesis: async () => ({ ...contract, destination: { ...contract.destination }, binding: { ...binding }, sourceIdentity: { ...contract.sourceIdentity } }),
    captureState: async () => { if (localUnavailable) throw new Error("Synthetic local registry unavailable"); return { version: 1, binding: { ...binding }, files: [] }; },
    makeCopyService: () => ({ authorizeWitness: async () => ({ ...contract.destination }) }),
    makeRecoveryControl: async value => { parameters.control = value; return { close() { events.push("control-close"); } }; },
    makeTransport: value => { parameters.transport = value; return { exchange: async () => {},
      handler: async () => { events.push("transport-http"); return true; }, close: () => events.push("transport-close") }; },
    makeEnrollment: value => {
      enrollmentOptions = value; parameters.enrollment = value;
      return { async check() { if (enrollmentMissing) throw new Error("Synthetic missing enrollment state"); if (enrollmentFailure) throw enrollmentFailure; return { ...authority }; },
        async initialize() { return value.withMaintenance(async assertQuiescent => { await assertQuiescent(); await value.assertOriginal(); authority = { ready: true, spent: false }; return authority; }); },
        async readRecoveryAuthority() { if (enrollmentMissing || !authority.spent) throw new Error("Synthetic unspent authority"); await value.assertProvenance(); return { ...authority }; },
        async reserve() { throw new Error("Unexpected HTTP fixture reserve"); }, close: () => events.push("enrollment-close") };
    },
    makeEnrollmentHandler: () => enrollmentHandler,
    makeContinuity: value => { parameters.continuity = { ...value, key: Buffer.from(value.key) }; return {
      async recover(assertReady) {
        events.push("recover"); await assertReady();
        if (pendingProbe) { pendingProbe.started.resolve(); await pendingProbe.promise; }
        if (offline) throw new Error("Synthetic PC is offline");
        return { witnessRevision: 1, registrySha256: emptyHash, state: { version: 1, binding: { ...binding }, files: [] } };
      },
      async verify(assertReady) { events.push("verify"); await assertReady(); return proof; },
      close() { events.push("gate-close"); pendingProbe?.reject(new Error("Synthetic probe cancelled")); },
    }; }, ...changes };
  const options = { runtimeDirectory: dirs.runtime, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40), privateDirectory: dirs.private,
    operationsDirectory: dirs.operations, witnessOperatorDirectory: dirs.operator, witnessContractSha256: "f".repeat(64) };
  const observer = await createConfiguredWitnessObserver(options, { emit: value => notices.push(value) }, internals); t.after(() => observer.close());
  const attach = () => observer.attachMaintenance(async (work, assertOriginal) => {
    await assertOriginal(); events.push("stop");
    const result = await work(async () => { events.push("quiescent"); });
    await assertOriginal(); events.push("resume"); return result;
  }, () => events.push("fatal"));
  return { root, dirs, observer, notices, events, keys, parameters, proof, attach,
    setLocalUnavailable(value) { localUnavailable = value; }, setOriginal(value) { original = value; }, setSpent(value) { authority = { ready: !value, spent: value }; },
    setOffline(value) { offline = value; }, setMissing(value) { enrollmentMissing = value; },
    setEnrollmentFailure(value) { enrollmentFailure = value; },
    holdProbe() { pendingProbe = { ...deferred(), started: deferred() }; return pendingProbe; }, get enrollmentOptions() { return enrollmentOptions; } };
}

test("observer binds its transport, enrollment and continuity to the authenticated original contract without enabling closures", async t => {
  const f = await fixture(t), checked = await f.observer.check();
  assert.equal(checked.status, "passed"); assert.equal(checked.mode, "observe_only"); assert.equal(checked.externalWitnessConfirmed, false); assert.equal(checked.closuresEnabled, false);
  assert.deepEqual(f.parameters.transport.destinationId, contract.destination.destinationId);
  assert.equal(f.parameters.transport.pairingFingerprint, contract.destination.pairingFingerprint); assert.equal(f.parameters.transport.registryId, registryId);
  assert.equal(f.parameters.enrollment.contractSha256, "f".repeat(64)); assert.equal(f.parameters.enrollment.directory, path.join(f.dirs.operator, "enrollment"));
  assert.deepEqual(f.parameters.continuity.key, sourceKey); assert.ok(f.keys.every(key => key.equals(Buffer.alloc(32))));
  assert.equal(f.events.includes("stop"), false); assert.equal(f.events.includes("recover"), false);
  assert.equal(f.observer.state().closuresEnabled, false);
});

test("only explicit initialization enters attached maintenance; the normal check never initializes missing authority", async t => {
  const f = await fixture(t); await f.observer.checkInitial();
  await assert.rejects(f.observer.initialize()); assert.equal(f.events.includes("stop"), false);
  f.attach(); const initialized = await f.observer.initialize();
  assert.equal(initialized.prepared, true); assert.equal(initialized.genesisReplayed, false); assert.equal(initialized.externalWitnessConfirmed, false);
  assert.ok(f.events.indexOf("stop") < f.events.indexOf("resume"));
  f.setMissing(true); await assert.rejects(f.observer.check());
  await writeFile(path.join(f.dirs.operator, "enrollment", "partial.json"), "", { mode: 0o600 });
  await assert.rejects(f.observer.checkInitial());
});

test("unspent authority requests enrollment and a powered-off PC never triggers runtime maintenance", async t => {
  const f = await fixture(t); f.attach(); await f.observer.tick();
  assert.equal(f.observer.state().state, "enrollment_required"); assert.equal(f.events.includes("recover"), false); assert.equal(f.events.includes("stop"), false);
  f.setSpent(true); f.setOffline(true); await f.observer.tick();
  assert.equal(f.observer.state().state, "not_confirmed"); assert.equal(f.events.includes("recover"), true); assert.equal(f.events.includes("stop"), false);
  assert.equal(f.observer.state().externalWitnessConfirmed, false); assert.equal(f.observer.state().lastVerifiedAt, null);
});

test("an available PC is freshly verified under maintenance and confirmed only after the runtime resumes", async t => {
  const f = await fixture(t); f.attach(); f.setSpent(true);
  assert.deepEqual(await f.observer.tick(), f.proof);
  const sequence = f.events.filter(event => ["recover", "stop", "verify", "resume"].includes(event));
  assert.deepEqual(sequence, ["recover", "stop", "verify", "resume"]);
  assert.deepEqual(f.observer.state(), { state: "confirmed", lastVerifiedAt: 1792410000000, externalWitnessConfirmed: true, mode: "observe_only", closuresEnabled: false });
  assert.equal(f.notices.at(-1).state, "confirmed"); assert.equal(f.notices.at(-1).closuresEnabled, false);
  await f.observer.tick(); assert.equal(f.events.filter(value => value === "recover").length, 2); assert.equal(f.events.filter(value => value === "stop").length, 1);
  f.setOffline(true); await f.observer.tick(); assert.equal(f.observer.state().externalWitnessConfirmed, false);
  assert.equal(f.events.filter(value => value === "stop").length, 1);
  f.setOffline(false); await f.observer.tick(); assert.equal(f.events.filter(value => value === "stop").length, 2);
  assert.equal(f.observer.state().externalWitnessConfirmed, true);
});

test("overlapping observations share a single probe and closing shuts down both native handlers", async t => {
  const f = await fixture(t); f.attach(); f.setSpent(true); const held = f.holdProbe();
  const first = f.observer.tick(); await held.started.promise; const second = f.observer.tick();
  assert.equal(f.events.filter(value => value === "recover").length, 1); held.resolve(); await Promise.all([first, second]);
  assert.equal(f.events.filter(value => value === "stop").length, 1);
  await f.observer.handler({ url: "/enrollment-fixture" }, {}); assert.equal(f.events.at(-1), "enrollment-http");
  await f.observer.handler({ url: "/transport-fixture" }, {}); assert.deepEqual(f.events.slice(-2), ["enrollment-http", "transport-http"]);
  f.observer.close(); f.observer.close();
  for (const event of ["gate-close", "transport-close", "enrollment-close", "enrollment-http-close"]) assert.equal(f.events.filter(value => value === event).length, 1);
});

test("changed original source is rejected by prechecks rather than becoming an offline-PC success", async t => {
  const f = await fixture(t); f.attach(); f.setOriginal(false);
  await assert.rejects(f.observer.check()); await assert.rejects(f.observer.checkInitial());
  assert.equal(f.events.includes("stop"), false); assert.equal(f.events.includes("verify"), false);
  await f.observer.tick(); assert.equal(f.events.includes("fatal"), true);
  assert.equal(f.observer.state().externalWitnessConfirmed, false);
});

test("a missing local enrollment is fatal while a missing PC is only an unavailable observation", async t => {
  const f = await fixture(t); f.attach(); f.setSpent(true); f.setMissing(true);
  await f.observer.tick(); assert.equal(f.events.filter(value => value === "fatal").length, 1);
  assert.equal(f.events.includes("recover"), false); assert.equal(f.events.includes("stop"), false);
});

test("an exclusive enrollment reservation makes observation retry without treating its closed BUSY error as lost state", async t => {
  for (const phase of ["before-probe", "after-probe-failure"]) await t.test(phase, async step => {
    const f = await fixture(step); f.attach(); f.setSpent(true);
    const busy = new WitnessEnrollmentError("BUSY");
    if (phase === "before-probe") { f.setEnrollmentFailure(busy); await f.observer.tick(); }
    else {
      f.setOffline(true); const held = f.holdProbe(), pending = f.observer.tick(); await held.started.promise;
      f.setEnrollmentFailure(busy); held.resolve(); await pending;
    }
    assert.equal(f.events.includes("fatal"), false); assert.equal(f.events.includes("stop"), false);
    assert.equal(f.observer.state().externalWitnessConfirmed, false);
    f.setEnrollmentFailure(null); f.setOffline(false);
    assert.deepEqual(await f.observer.tick(), f.proof);
    assert.equal(f.events.filter(value => value === "stop").length, 1); assert.equal(f.events.includes("fatal"), false);
  });
});

test("a plain error that imitates enrollment BUSY is fatal at both local validation boundaries", async t => {
  for (const phase of ["before-probe", "after-probe-failure"]) await t.test(phase, async step => {
    const f = await fixture(step); f.attach(); f.setSpent(true);
    const imitation = Object.assign(new Error("Synthetic untrusted source failure"), { code: "WITNESS_ENROLLMENT_BUSY" });
    if (phase === "before-probe") { f.setEnrollmentFailure(imitation); await f.observer.tick(); }
    else {
      f.setOffline(true); const held = f.holdProbe(), pending = f.observer.tick(); await held.started.promise;
      f.setEnrollmentFailure(imitation); held.resolve(); await pending;
    }
    assert.equal(f.events.includes("fatal"), true); assert.equal(f.observer.state().state, "original_unavailable");
    assert.equal(f.events.includes("stop"), false); assert.equal(f.observer.state().externalWitnessConfirmed, false);
    assert.doesNotMatch(JSON.stringify(f.notices), /Synthetic|untrusted/);
  });
});

test("starting observation twice cannot install a second timer and closing removes the installed timer", async t => {
  const f = await fixture(t); f.attach(); const timers = new Set();
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { const timer = { callback, milliseconds }; timers.add(timer); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => { timers.delete(timer); });
  f.observer.startObservation(); await f.observer.tick(); await Promise.resolve();
  assert.equal(timers.size, 1); assert.equal([...timers][0].milliseconds, 60000);
  assert.throws(() => f.observer.startObservation(), { code: "WITNESS_OBSERVATION_UNAVAILABLE" });
  assert.equal(timers.size, 1); f.observer.close(); assert.equal(timers.size, 0);
});


test("recovery forwards only a fresh pinned read under provenance while a lost local registry remains outside empty observation", async t => {
  const packets = [];
  const f = await fixture(t, { makeTransport: () => ({ async exchange(request, { signal }) {
    assert.equal(signal.aborted, false); packets.push(request);
    return { version: 1, registryId, challenge: request.challenge, revision: 2, sha256: "e".repeat(64), snapshot: { version: 1, registryId, files: [] } };
  }, handler: async () => true, close() {} }) });
  const envelope = { version: 1, contractSha256: "f".repeat(64), binding, request: { version: 1, registryId, challenge: "8".repeat(64), snapshot: null } };
  await assert.rejects(f.observer.recoverExchange(envelope)); assert.equal(packets.length, 0);
  f.setSpent(true); f.setLocalUnavailable(true);
  assert.equal((await f.observer.recoverExchange(envelope)).challenge, envelope.request.challenge);
  assert.deepEqual(packets, [envelope.request]); assert.equal(f.events.includes("stop"), false); assert.equal(f.events.includes("fatal"), false);
  for (const changed of [{ ...envelope, contractSha256: "9".repeat(64) }, { ...envelope, binding: { ...binding, database: "wrong" } },
    { ...envelope, request: { ...envelope.request, snapshot: { version: 1, registryId, files: [] } } }]) await assert.rejects(f.observer.recoverExchange(changed));
  assert.equal(packets.length, 1); f.setOriginal(false); await assert.rejects(f.observer.recoverExchange(envelope));
});

test("recovery and timer observation cannot overlap or stop the daily runtime", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { makeTransport: () => ({ async exchange() { entered.resolve(); await release.promise; return {}; }, handler: async () => true, close() {} }) });
  f.setSpent(true);
  const envelope = { version: 1, contractSha256: "f".repeat(64), binding, request: { version: 1, registryId, challenge: "8".repeat(64), snapshot: null } };
  const pending = f.observer.recoverExchange(envelope); await entered.promise;
  assert.equal(await f.observer.tick(), null); await assert.rejects(f.observer.recoverExchange(envelope));
  assert.equal(f.events.includes("recover"), false); assert.equal(f.events.includes("stop"), false); release.resolve(); await pending;
  const held = f.holdProbe(); f.attach(); const checking = f.observer.tick(); await held.started.promise;
  await assert.rejects(f.observer.recoverExchange(envelope)); held.resolve(); await checking;
});

test("recovery control is created only explicitly and a failure is neutral without affecting observation", async t => {
  const f = await fixture(t, { makeRecoveryControl: async () => { throw new Error("Synthetic operator filesystem issue"); } });
  assert.equal(f.events.includes("fatal"), false); assert.equal(await f.observer.startRecoveryControl(), false);
  assert.deepEqual(f.notices.at(-1), { version: 1, type: "witness_recovery_control", status: "unavailable", closuresEnabled: false });
  assert.equal((await f.observer.check()).status, "passed"); assert.equal(f.events.includes("fatal"), false); assert.equal(f.events.includes("stop"), false);
});
