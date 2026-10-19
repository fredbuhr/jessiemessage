import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, readFile, readdir, rename, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { witnessOriginFixture } from "./fixtures/witness-origin.mjs";
import { createWitnessOriginOperations, WITNESS_ORIGIN_PLAN } from "../server/backup/witness-origin-operator.mjs";
import { withConfiguredWitnessOrigin } from "../server/backup/witness-origin-context.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { bundle, inheritedEnv } from "./fixtures/crm-private.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { runManagedWitnessPreparation } from "../server/backup/managed-witness.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function intent(f) {
  const journal = createErasureJournal({ directory: f.dirs.operations, key: Buffer.alloc(32, 7), binding: f.binding, clientId: "d".repeat(32) }, { withDirectory: f.withDirectory });
  try { await journal.save({ version: 1, binding: f.binding, clientId: "d".repeat(32), phase: "requested", cursor: null, startedAt: 1792410000000, updatedAt: 1792410000000 }, 0, async () => {}); }
  finally { journal.close(); }
}
function runtime(f, changes = {}) {
  let status = "running"; const events = [];
  return { events, state: () => ({ status }), async stop() {
    assert.ok((await readdir(f.dirs.operations)).includes("recurring-backup.lock")); events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null };
  }, async start() { assert.ok((await readdir(f.dirs.operations)).includes("recurring-backup.lock")); events.push("start"); status = "running"; }, ...changes };
}

test("operator plan is private, canonical, authenticated, short-lived and contains no delegated token or key", async t => {
  const f = await witnessOriginFixture(t), report = await f.planner.plan();
  assert.equal(report.prepared, false); assert.equal(report.started, false); assert.equal(report.operatorProvenanceRequired, true);
  const bytes = await readFile(path.join(f.dirs.operator, WITNESS_ORIGIN_PLAN)); assert.equal(hash(bytes), report.planSha256);
  assert.equal(bytes.includes(Buffer.alloc(32, 7).toString("base64url")), false);
  for (const secret of [f.binding.database, "pairingFingerprint", "configurationFingerprint"]) assert.equal(JSON.stringify(report).includes(secret), false);
  assert.deepEqual(await readdir(path.join(f.dirs.operator, "contract")), []);
  assert.equal((await f.bind(report).check()).status, "passed");
  assert.ok(f.keys.every(key => key.equals(Buffer.alloc(32))));
  await assert.rejects(f.planner.plan()); assert.deepEqual(await readFile(path.join(f.dirs.operator, WITNESS_ORIGIN_PLAN)), bytes);
});

test("missing, expired, future-clock and wrong-hash plans never create a default contract", async t => {
  const f = await witnessOriginFixture(t);
  await assert.rejects(f.make({ witnessPlanSha256: "e".repeat(64) }).check());
  assert.equal((await readdir(f.dirs.operator)).includes(WITNESS_ORIGIN_PLAN), false);
  const report = await f.planner.plan();
  await assert.rejects(f.make({ witnessPlanSha256: "e".repeat(64) }).check());
  for (const now of [1792413600000, 1792409999999]) { f.setNow(now); await assert.rejects(f.bind(report).check(), { code: "WITNESS_ORIGIN_EXPIRED" }); }
  assert.deepEqual(await readdir(path.join(f.dirs.operator, "contract")), []);
});

test("changed configuration, key, runtime identity, PC capability or physical source invalidates the original plan", async t => {
  for (const mode of ["configuration", "key", "runtime", "pairing", "pause", "source"]) {
    const f = await witnessOriginFixture(t), report = await f.planner.plan(); let operations = f.bind(report);
    if (mode === "configuration") f.setConfiguration("e".repeat(64));
    if (mode === "key") f.setKeyByte(8);
    if (mode === "runtime") operations = f.make({ witnessPlanSha256: report.planSha256, runtimeHead: "3".repeat(40) });
    if (mode === "pairing") await f.updatePc(item => item.tokenHash = "d".repeat(64));
    if (mode === "pause") await f.updatePc(item => item.enabled = false);
    if (mode === "source") await rename(f.dirs.operations, f.dirs.operations + "-original");
    await assert.rejects(operations.check());
    assert.deepEqual(await readdir(path.join(f.dirs.operator, "contract")), []);
  }
});

test("existing erasure records, restoration quarantine and initialized contracts block planning/application", async t => {
  for (const mode of ["intent", "quarantine", "contract"]) {
    const f = await witnessOriginFixture(t), report = await f.planner.plan();
    if (mode === "intent") await intent(f);
    if (mode === "quarantine") await writeFile(path.join(f.dirs.operations, "operational-restore.json"), "{}\n", { mode: 0o600 });
    if (mode === "contract") await writeFile(path.join(f.dirs.operator, "contract", "witness-genesis.json"), "", { mode: 0o600 });
    await assert.rejects(f.bind(report).check()); await assert.rejects(f.planner.plan());
  }
});

test("modified, noncanonical, linked or nonprivate plans fail even when their new hash is supplied", async t => {
  for (const mode of ["tamper", "duplicate", "mode", "symlink", "hardlink"]) {
    const f = await witnessOriginFixture(t); await f.planner.plan(); const name = path.join(f.dirs.operator, WITNESS_ORIGIN_PLAN);
    if (mode === "tamper") { const value = JSON.parse(await readFile(name)); value.plan.observed.destination.pairedAt++; await writeFile(name, JSON.stringify(value) + "\n"); }
    if (mode === "duplicate") await writeFile(name, (await readFile(name, "utf8")).replace('"version":1', '"version":1,"version":1'));
    if (mode === "mode") await chmod(name, 0o640);
    if (mode === "symlink") { await rename(name, path.join(f.root, "outside")); await symlink(path.join(f.root, "outside"), name); }
    if (mode === "hardlink") await link(name, path.join(f.root, "outside"));
    await assert.rejects(f.bind({ planSha256: hash(await readFile(name)) }).check());
  }
});

test("actual prepare holds the common lease across zero-exit stop, publication verification and ready restart", async t => {
  const f = await witnessOriginFixture(t), plan = await f.planner.plan(), app = runtime(f);
  const report = await runManagedWitnessPreparation({ runtime: app, operations: f.bind(plan), source: f.source });
  assert.deepEqual(app.events, ["stop", "start"]); assert.equal(app.state().status, "running");
  assert.equal(report.prepared, true); assert.equal(report.runtimeResumed, true); assert.equal(report.externalWitnessConfirmed, false); assert.equal(report.closuresEnabled, false);
  const name = path.join(f.dirs.operator, "contract", "witness-genesis.json"), bytes = await readFile(name);
  assert.equal(hash(bytes), report.contractSha256); assert.ok(f.keys.every(key => key.equals(Buffer.alloc(32))));
  await assert.rejects(f.bind(plan).check());
  await unlink(name); await writeFile(name, "", { mode: 0o600 });
  await assert.rejects(f.bind(plan).check()); assert.equal(await readFile(name, "utf8"), "");
});

test("a capture lock prevents any stop and is never removed by a failed operator preparation", async t => {
  const f = await witnessOriginFixture(t), plan = await f.planner.plan(), app = runtime(f), name = path.join(f.dirs.operations, "recurring-backup.lock");
  await writeFile(name, "existing-owner", { mode: 0o600 });
  await assert.rejects(runManagedWitnessPreparation({ runtime: app, operations: f.bind(plan), source: f.source }));
  assert.deepEqual(app.events, []); assert.equal(await readFile(name, "utf8"), "existing-owner");
});

test("a capability changed during real drain keeps the process stopped without publishing or retrying", async t => {
  const f = await witnessOriginFixture(t), plan = await f.planner.plan(), app = runtime(f), original = app.stop;
  app.stop = async () => { const result = await original(); await f.updatePc(item => item.tokenHash = "d".repeat(64)); return result; };
  await assert.rejects(runManagedWitnessPreparation({ runtime: app, operations: f.bind(plan), source: f.source }));
  assert.equal(app.state().status, "stopped"); assert.equal(app.events.includes("start"), false);
  assert.deepEqual(await readdir(path.join(f.dirs.operator, "contract")), []);
});

test("operator and managed preparation retain closed failures through the actual configured context boundary", async t => {
  for (const mode of ["expired", "existing-genesis", "unknown-source-error"]) await t.test(mode, async step => {
    const f = await witnessOriginFixture(step); let now = 1792410000000, failSource = false;
    const dependencies = {
      loadEnvironment: (_directory, options) => loadRuntimeBroadcastEnvironment(f.dirs.private, options, { readBundle: async () => bundle(f.dirs.media) }),
      makeStorage: async () => ({ async fingerprint() { return Buffer.alloc(32, 8); } }),
      createPool: async () => ({ async end() {} }),
      makeCapacity: ({ capacity }) => ({ async assertSchema() {}, async status() { return { ...capacity, ready: true }; } }),
    };
    const source = async () => {
      if (failSource) throw Object.assign(new Error("Synthetic private password and SQL cause"), { code: "WITNESS_ORIGIN_PRIVATE_SECRET", privatePath: "/synthetic/private-secret" });
    };
    const make = changes => createWitnessOriginOperations({ ...f.options, ...changes }, { environment: inheritedEnv }, {
      withDirectory: f.withDirectory, source, clock: () => now,
      withOrigin: (options, settings, work) => withConfiguredWitnessOrigin(options, settings, work, dependencies),
    });
    const plan = await make().plan(), operations = make({ command: "prepare-witness", witnessDestination: undefined, witnessPlanSha256: plan.planSha256 });
    const app = runtime(f), contract = path.join(f.dirs.operator, "contract", "witness-genesis.json");
    if (mode === "expired") now = plan.expiresAt;
    if (mode === "unknown-source-error") failSource = true;
    if (mode === "existing-genesis") {
      const stop = app.stop; let first = true;
      app.stop = async () => {
        const receipt = await stop();
        if (first) { first = false; await writeFile(contract, "existing-uncertain-genesis", { mode: 0o600, flag: "wx" }); }
        return receipt;
      };
    }
    const expected = mode === "expired" ? "WITNESS_ORIGIN_EXPIRED" : mode === "existing-genesis" ? "WITNESS_GENESIS_EXISTS" : "WITNESS_ORIGIN_CONTEXT";
    await assert.rejects(runManagedWitnessPreparation({ runtime: app, operations, source }), error => {
      assert.equal(error.code, expected); assert.deepEqual(Object.keys(error), ["code"]);
      assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /Synthetic|password|SQL|private-secret/); return true;
    });
    assert.equal(app.events.includes("start"), false);
    if (mode === "existing-genesis") {
      assert.equal(app.state().status, "stopped"); assert.equal(await readFile(contract, "utf8"), "existing-uncertain-genesis");
    } else {
      assert.deepEqual(app.events, []); assert.deepEqual(await readdir(path.join(f.dirs.operator, "contract")), []);
    }
    assert.equal(hash(await readFile(path.join(f.dirs.operator, WITNESS_ORIGIN_PLAN))), plan.planSha256);
  });
});

test("real IPC child drains request, producer, transports and pool before the actual contract, then resumes", { timeout: 15000 }, async t => {
  const f = await witnessOriginFixture(t), report = await f.planner.plan();
  const child = await managedClosureFixture(t, f.dirs.operations, { accountClosures: false });
  await child.runtime.start(); const response = await fetch(child.origin + "/hold"), body = response.text();
  const operations = f.bind(report), source = async () => {
    if (child.runtime.state().status === "stopped") {
      assert.equal(child.children[0].exitCode, 0); assert.equal(await body, "starteddone");
      const events = (await readFile(child.marker, "utf8")).trim().split("\n");
      for (const name of ["request-finished", "producer-stopped", "transport-closed", "pool-closed"]) assert.ok(events.includes(name));
      await assert.rejects(fetch(child.origin + "/api/ready"));
    }
  };
  const result = await runManagedWitnessPreparation({ runtime: child.runtime, operations, source });
  assert.equal(result.runtimeResumed, true); assert.equal(child.children.length, 2); assert.equal(child.runtime.state().status, "running");
  await child.runtime.destroy();
});

let unavailable;
if (process.platform !== "linux") unavailable = "Linux required";
else { try { if ((await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "procfs unavailable"; } catch { unavailable = "procfs unavailable"; } }
test("Linux CI must exercise the production origin plan and managed contract anchors", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("native original plan and actual managed preparation use protected anchors without a PC or erasure capability", { skip: unavailable, timeout: 15000 }, async t => {
  const f = await witnessOriginFixture(t, { native: true }), plan = await f.planner.plan();
  const child = await managedClosureFixture(t, f.dirs.operations, { accountClosures: false });
  await child.runtime.start();
  const result = await runManagedWitnessPreparation({ runtime: child.runtime, operations: f.bind(plan), source: f.source });
  assert.equal(result.prepared, true); assert.equal(result.externalWitnessConfirmed, false);
  assert.equal(child.children[0].exitCode, 0); assert.equal(child.runtime.state().status, "running"); await child.runtime.destroy();
});
