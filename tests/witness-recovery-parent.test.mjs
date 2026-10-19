import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createConfiguredWitnessRecovery } from "../server/backup/witness-recovery-parent.mjs";
import { prepareWitnessGenesis } from "../server/backup/witness-genesis.mjs";
import { createWitnessEnrollment, WITNESS_ENROLLMENT_FILE } from "../server/backup/witness-enrollment.mjs";
import { saveCopyState, readCopyState } from "../server/backup/copy-files.mjs";
import { createBackupCopyService } from "../server/backup/copy-service.mjs";
import { digestCopyToken } from "../server/backup/copy-state.mjs";
import { createRegistryWitness } from "../server/backup/registry-witness.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { registryHash } from "../server/backup/registry-snapshot.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";
import { withWitnessDirectory } from "./fixtures/witness-origin.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_recovery_parent", rootFingerprint: "b".repeat(64) };
const now = 1792410000000, destinationId = "a".repeat(32), token = Buffer.alloc(32, 3).toString("base64url");
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = () => ({ headersSent: false, destroyed: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
  end(body) { this.body = body; }, destroy() { this.destroyed = true; } });
async function fixture(t, { spent = true } = {}) {
  const root = await erasureDirectory(t), dirs = Object.fromEntries(["operator", "operations", "private", "runtime", "media", "pc"].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(dirs)) await mkdir(directory, { mode: 0o700 });
  const contractDirectory = path.join(dirs.operator, "contract"), enrollmentDirectory = path.join(dirs.operator, "enrollment");
  await mkdir(contractDirectory, { mode: 0o700 }); await mkdir(enrollmentDirectory, { mode: 0o700 });
  const internalFiles = { withDirectory: withWitnessDirectory };
  await saveCopyState(dirs.operations, { version: 1, revision: 0, destinations: [{ id: destinationId, label: "Synthetic PC", kind: "computer", enabled: true,
    pairHash: null, pairExpiresAt: null, tokenHash: digestCopyToken(token), pairedAt: now - 1000, lastSeenAt: null, locationId: null, lastReceipt: null }] }, 0, internalFiles);
  const stats = await lstat(dirs.operations, { bigint: true });
  const genesis = await prepareWitnessGenesis({ directory: contractDirectory, operationsDirectory: dirs.operations, privateDirectory: dirs.private,
    runtimeDirectory: dirs.runtime, key, binding, sourceIdentity: { dev: String(stats.dev), ino: String(stats.ino) },
    destination: { destinationId, pairedAt: now - 1000, pairingFingerprint: digestCopyToken(token) }, assertQuiescent: async () => {} }, internalFiles);
  const enrollment = createWitnessEnrollment({ directory: enrollmentDirectory, contract: genesis.contract, contractSha256: genesis.contractSha256, key,
    assertOriginal: async () => {}, withMaintenance: work => work(async () => {}) }, internalFiles);
  try { await enrollment.initialize(); if (spent) await enrollment.reserve({ version: 1, destinationId, attemptId: "d".repeat(32) }); }
  finally { enrollment.close(); }
  const witness = createRegistryWitness({ directory: dirs.pc, registryId: genesis.contract.registryId }, internalFiles); await witness.initializeEmpty();
  const events = [], notices = [], keys = [], controls = [], requests = [];
  let original = true, configuration = "e".repeat(64), exchangeHook;
  const source = async () => { events.push("source"); if (!original) throw new Error("Synthetic private source failure"); };
  const internals = { ...internalFiles, source,
    withOrigin: async (_options, _settings, work) => {
      await source(); const copied = Buffer.from(key), pinned = configuration; keys.push(copied);
      try { return await work({ key: copied, binding, mediaRoot: dirs.media, configurationFingerprint: pinned,
        async assertReady() { await source(); assert.equal(configuration, pinned); } }); }
      finally { copied.fill(0); }
    },
    makeCopyService: directory => createBackupCopyService(directory, { read: () => readCopyState(directory, internalFiles) }),
    makeTransport: options => {
      assert.equal(options.provisioning, false); assert.equal(options.registryId, genesis.contract.registryId);
      return { async exchange(request, settings) { events.push("exchange"); requests.push(request);
        return exchangeHook ? exchangeHook(request, settings) : witness.exchange(request); },
      async handler(request, outgoing) { events.push("http"); await options.authorize(request.token);
        outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.end('{"version":1,"pending":false}'); return true; },
      close() { events.push("transport-close"); } };
    },
    makeRecoveryControl: async options => { controls.push(options); events.push("control-start"); return { async close() { events.push("control-close"); } }; },
  };
  const options = { command: "start-witness-recovery", runtimeDirectory: dirs.runtime, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    privateDirectory: dirs.private, operationsDirectory: dirs.operations, privatePathMode: "linux-dirfd", witnessOperatorDirectory: dirs.operator,
    witnessContractSha256: genesis.contractSha256 };
  const make = async (changes = {}, settings = {}) => {
    const parent = await createConfiguredWitnessRecovery(options, { emit: value => notices.push(value), ...settings }, { ...internals, ...changes });
    t.after(() => parent.close()); return parent;
  };
  const envelope = (challenge = "f".repeat(64)) => ({ version: 1, contractSha256: genesis.contractSha256, binding,
    request: { version: 1, registryId: genesis.contract.registryId, challenge, snapshot: null } });
  const journal = async () => {
    const value = createErasureJournal({ directory: dirs.operations, key, binding, clientId: "a".repeat(32) }, internalFiles);
    try { await value.save({ version: 1, clientId: "a".repeat(32), binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
    finally { value.close(); }
  };
  return { root, dirs, options, internals, make, envelope, journal, controls, events, notices, keys, requests,
    enrollmentFile: path.join(enrollmentDirectory, WITNESS_ENROLLMENT_FILE), contractFile: path.join(contractDirectory, "witness-genesis.json"),
    setSource(value) { original = value; }, setConfiguration(value) { configuration = value; }, setExchange(value) { exchangeHook = value; } };
}

test("explicit recovery constructs and checks after a nonempty or lost local journal without opening any control", async t => {
  const f = await fixture(t); await f.journal();
  const before = await readdir(f.dirs.operations), authority = await readFile(f.enrollmentFile), contract = await readFile(f.contractFile);
  for (const lost of [false, true]) {
    if (lost) for (const name of await readdir(f.dirs.operations)) if (name.startsWith("erasure-")) await unlink(path.join(f.dirs.operations, name));
    const parent = await f.make({ captureState: () => assert.fail("No local inventory or empty-registry assertion") });
    assert.deepEqual(Object.keys(parent).sort(), ["check", "close", "handler", "start"]);
    const checked = await parent.check(); assert.equal(checked.status, "passed"); assert.equal(checked.started, false);
    assert.equal(checked.mode, "recovery_only"); assert.equal(checked.closuresEnabled, false); assert.equal(checked.externalWitnessConfirmed, false);
    assert.equal(f.controls.length, 0); assert.equal(f.requests.length, 0); await parent.close();
  }
  assert.ok(before.some(name => name.startsWith("erasure-")));
  assert.deepEqual(await readFile(f.enrollmentFile), authority); assert.deepEqual(await readFile(f.contractFile), contract);
  assert.ok(f.keys.every(value => value.equals(Buffer.alloc(32))));
});

test("an authenticated ready, missing or modified authority cannot construct recovery or initialize itself", async t => {
  for (const mode of ["ready", "missing", "corrupt"]) await t.test(mode, async step => {
    const f = await fixture(step, { spent: mode !== "ready" });
    if (mode === "missing") await unlink(f.enrollmentFile);
    if (mode === "corrupt") await writeFile(f.enrollmentFile, "{}\n");
    const before = await readdir(path.dirname(f.enrollmentFile));
    await assert.rejects(f.make(), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
    assert.deepEqual(await readdir(path.dirname(f.enrollmentFile)), before); assert.equal(f.controls.length, 0);
  });
});

test("start creates only the reserved control and relays fresh pinned reads without publishing or changing the authority", async t => {
  const f = await fixture(t), parent = await f.make(), before = await readFile(f.enrollmentFile);
  const [one, two] = await Promise.all([parent.start(), parent.start()]); assert.deepEqual(one, two); assert.equal(one.status, "started");
  assert.equal(f.controls.length, 1); assert.equal((await lstat(path.join(f.dirs.operator, "control"))).mode & 0o7777, 0o700);
  const exchange = f.controls[0].exchange;
  for (const challenge of ["8".repeat(64), "9".repeat(64)]) {
    const result = await exchange(f.envelope(challenge)); assert.equal(result.challenge, challenge); assert.equal(result.revision, 1);
    assert.equal(result.sha256, registryHash(result.snapshot));
  }
  for (const envelope of [{ ...f.envelope(), contractSha256: "0".repeat(64) }, { ...f.envelope(), binding: { ...binding, database: "wrong" } },
    { ...f.envelope(), request: { ...f.envelope().request, snapshot: { version: 1, registryId: f.envelope().request.registryId, files: [] } } }]) await assert.rejects(exchange(envelope));
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(request => request.snapshot === null));
  assert.deepEqual(await readFile(f.enrollmentFile), before);
  await parent.close(); await parent.close(); assert.equal(f.events.filter(event => event === "control-close").length, 1);
  await assert.rejects(exchange(f.envelope()), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
});

test("the public handler delegates only existing PC transport endpoints and never exposes enrollment or application routes", async t => {
  const f = await fixture(t), parent = await f.make(); await parent.start();
  for (const url of ["/", "/api/ready", "/api/admin", "/api/backup-copy/witness/enroll", "/api/backup-copy/witness/unknown"]) {
    const outgoing = response(); assert.equal(await parent.handler({ url, token }, outgoing), false); assert.equal(outgoing.headersSent, false);
  }
  for (const url of ["/api/backup-copy/witness/poll", "/api/backup-copy/witness/response"]) {
    const outgoing = response(); assert.equal(await parent.handler({ url, token }, outgoing), true); assert.equal(outgoing.status, 200);
  }
  const denied = response(); await parent.handler({ url: "/api/backup-copy/witness/poll", token: "invalid" }, denied); assert.equal(denied.status, 503);
  f.setSource(false); const drift = response(); await parent.handler({ url: "/api/backup-copy/witness/poll", token }, drift);
  assert.equal(drift.status, 503); assert.doesNotMatch(drift.body, /Synthetic|source|private/);
});

test("source, configuration, original contract, physical source and pairing drift refuse recovery without repairing state", async t => {
  for (const mode of ["source", "configuration", "contract", "physical", "pairing"]) await t.test(mode, async step => {
    const f = await fixture(step), parent = await f.make(); await parent.start();
    if (mode === "source") f.setSource(false);
    if (mode === "configuration") f.setConfiguration("0".repeat(64));
    if (mode === "contract") await writeFile(f.contractFile, "{}\n");
    if (mode === "physical") { await rename(f.dirs.operations, f.dirs.operations + "-original"); await mkdir(f.dirs.operations, { mode: 0o700 }); }
    if (mode === "pairing") {
      const state = await readCopyState(f.dirs.operations, { withDirectory: withWitnessDirectory }); state.destinations[0].tokenHash = "0".repeat(64);
      await saveCopyState(f.dirs.operations, state, state.revision, { withDirectory: withWitnessDirectory });
    }
    await assert.rejects(f.controls[0].exchange(f.envelope()), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
    assert.equal(f.requests.length, 0);
  });
});

test("a changed source after the PC reply invalidates the response and in-flight exchanges remain exclusive", async t => {
  const f = await fixture(t), parent = await f.make(); await parent.start();
  const entered = defer(), release = defer();
  f.setExchange(async request => { entered.resolve(); await release.promise; f.setConfiguration("0".repeat(64));
    return { version: 1, registryId: request.registryId, challenge: request.challenge, revision: 1, sha256: "e".repeat(64), snapshot: { version: 1, registryId: request.registryId, files: [] } }; });
  const pending = f.controls[0].exchange(f.envelope()); await entered.promise;
  await assert.rejects(f.controls[0].exchange(f.envelope("8".repeat(64))), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  release.resolve(); await assert.rejects(pending, { code: "WITNESS_RECOVERY_UNAVAILABLE" }); assert.equal(f.requests.length, 1);
});

test("cancellation reaches the PC exchange and releases the parent without a listener or state retry", async t => {
  const f = await fixture(t), cancellation = new AbortController(), parent = await f.make({}, { signal: cancellation.signal }); await parent.start();
  const entered = defer();
  f.setExchange((_request, { signal }) => new Promise((_yes, no) => {
    entered.resolve(); signal.addEventListener("abort", () => no(new Error("Synthetic PC operation cancelled")), { once: true });
  }));
  const pending = f.controls[0].exchange(f.envelope()); await entered.promise; cancellation.abort();
  await assert.rejects(pending, { code: "WITNESS_RECOVERY_UNAVAILABLE" }); await parent.close();
  assert.equal(f.events.filter(event => event === "control-start").length, 1); assert.equal(f.events.filter(event => event === "control-close").length, 1);
});

test("a control collision refuses startup, preserves its file, and emits only a neutral technical notice", async t => {
  const f = await fixture(t), directory = path.join(f.dirs.operator, "control"); await mkdir(directory, { mode: 0o700 });
  const filename = path.join(directory, "witness-recovery.sock"); await writeFile(filename, "reserved-by-another-parent", { mode: 0o600 });
  const parent = await f.make({ makeRecoveryControl: async () => { throw new Error("Synthetic existing listener secret"); } });
  await assert.rejects(parent.start(), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  assert.equal(await readFile(filename, "utf8"), "reserved-by-another-parent");
  assert.deepEqual(f.notices, [{ version: 1, type: "witness_recovery_parent_notice", status: "unavailable", mode: "recovery_only", closuresEnabled: false }]);
});


test("cancellation while source provenance is opening prevents all later composition", async t => {
  const f = await fixture(t), controller = new AbortController(), entered = defer(), release = defer();
  let observedAbort = false, composed = false;
  const pending = f.make({ withOrigin: async (_options, { signal }, work) => {
    entered.resolve(); await release.promise; observedAbort = signal.aborted;
    return work({ key, binding, mediaRoot: f.dirs.media, configurationFingerprint: "e".repeat(64), assertReady: async () => {} });
  }, makeCopyService: () => { composed = true; throw new Error("No composition after cancellation"); } }, { signal: controller.signal });
  await entered.promise; controller.abort(); release.resolve();
  await assert.rejects(pending, { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  assert.equal(observedAbort, true); assert.equal(composed, false); assert.equal(f.controls.length, 0);
});
