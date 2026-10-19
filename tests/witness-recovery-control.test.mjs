import test from "node:test";
import assert from "node:assert/strict";
import { createServer, createConnection } from "node:net";
import { chmod, lstat, mkdir, readFile, rename, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWitnessRecoveryControl, exchangeWitnessRecovery } from "../server/backup/witness-recovery-control.mjs";
import { createRegistryWitness } from "../server/backup/registry-witness.mjs";
import { createErasureContinuity } from "../server/backup/registry-continuity.mjs";
import { registryIdentity } from "../server/backup/registry-snapshot.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_recovery", rootFingerprint: "a".repeat(64) }, contractSha256 = "b".repeat(64);
const registryId = registryIdentity(key, binding);
let unavailable;
try {
  if (process.platform !== "linux" || (await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "native procfs unavailable";
  const probe = createServer();
  await new Promise((yes, no) => { probe.once("error", no); probe.listen("\0jm-recovery-probe-" + process.pid, yes); });
  await new Promise(resolve => probe.close(resolve));
} catch { unavailable = "native Unix sockets/procfs unavailable"; }
test("Linux CI requires native Unix recovery and private anchors", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
async function fixture(t) {
  const root = await erasureDirectory(t), directory = path.join(root, "control"), pc = path.join(root, "pc");
  await mkdir(directory, { mode: 0o700 }); await mkdir(pc, { mode: 0o700 });
  const witness = createRegistryWitness({ directory: pc, registryId }, { withDirectory: withErasureDirectory }); await witness.initializeEmpty();
  const native = {}, requests = [];
  const server = await createWitnessRecoveryControl({ directory, exchange: async envelope => { requests.push(envelope); return witness.exchange(envelope.request); } }, native);
  t.after(() => server.close());
  const exchange = request => exchangeWitnessRecovery({ directory, contractSha256, binding, request }, native);
  return { root, directory, socket: path.join(directory, "witness-recovery.sock"), server, exchange, requests, native };
}
test("private Unix recovery carries each gate challenge to the durable witness without retaining a success", { skip: unavailable }, async t => {
  const f = await fixture(t), gate = createErasureContinuity({ key, binding, readCurrent: async () => ({ version: 1, binding, files: [] }), exchange: f.exchange });
  t.after(() => gate.close());
  assert.equal((await lstat(f.socket)).mode & 0o7777, 0o600);
  const first = await gate.recover(async () => {}), second = await gate.recover(async () => {});
  assert.deepEqual(first, second); assert.equal(first.witnessRevision, 1); assert.equal(first.started, false);
  assert.equal(f.requests.length, 2); assert.notEqual(f.requests[0].request.challenge, f.requests[1].request.challenge);
  assert.ok(f.requests.every(value => value.request.snapshot === null));
  await f.server.close(); await assert.rejects(f.exchange(f.requests[0].request), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  const restarted = await createWitnessRecoveryControl({ directory: f.directory, exchange: async () => { throw new Error("No request expected"); } }, f.native);
  await restarted.assertReady(); await restarted.close();
});
test("private recovery refuses socket drift before exchange and confines listener cleanup to its reserved transient leaf", { skip: unavailable }, async t => {
  for (const mode of ["mode", "symlink", "regular", "preexisting"]) await t.test(mode, async step => {
    const f = await fixture(step), request = { version: 1, registryId, challenge: "c".repeat(64), snapshot: null };
    if (mode === "mode") await chmod(f.socket, 0o660);
    if (mode === "symlink" || mode === "regular") {
      await rename(f.socket, f.socket + ".original");
      if (mode === "symlink") await symlink(f.socket + ".original", f.socket);
      else await writeFile(f.socket, "preserve", { mode: 0o600 });
    }
    if (mode === "preexisting") await assert.rejects(createWitnessRecoveryControl({ directory: f.directory, exchange: async () => assert.fail() }, f.native), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
    else await assert.rejects(f.exchange(request), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
    assert.equal(f.requests.length, 0);
    if (mode === "regular") {
      assert.equal(await readFile(f.socket, "utf8"), "preserve");
      const protectedFile = path.join(f.root, "protected-origin-fixture");
      await writeFile(protectedFile, "original-state", { mode: 0o600 });
      await f.server.close();
      // control/ and this exact leaf are exclusively transient listener
      // storage. libuv may unlink a same-UID replacement after a successful
      // bind; neither business state nor arbitrary files belong at this leaf.
      assert.equal(await readFile(protectedFile, "utf8"), "original-state");
    }
  });
});
test("a collision before listener binding preserves the existing file without cleanup", { skip: unavailable }, async t => {
  const root = await erasureDirectory(t), directory = path.join(root, "control"); await mkdir(directory, { mode: 0o700 });
  const filename = path.join(directory, "witness-recovery.sock");
  await writeFile(filename, "preexisting-unknown", { mode: 0o600 }); const before = await lstat(filename, { bigint: true });
  await assert.rejects(createWitnessRecoveryControl({ directory, exchange: async () => assert.fail("No exchange on collision") }), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  const after = await lstat(filename, { bigint: true });
  assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(await readFile(filename, "utf8"), "preexisting-unknown");
});

test("the local relay rejects publications and malformed frames, and cancellation releases its only connection", { skip: unavailable }, async t => {
  const f = await fixture(t), request = { version: 1, registryId, challenge: "c".repeat(64), snapshot: null };
  await assert.rejects(f.exchange({ ...request, snapshot: { version: 1, registryId, files: [] } }), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  const malformed = createConnection({ path: f.socket }); malformed.on("error", () => {});
  const closed = new Promise(resolve => malformed.once("close", resolve)); malformed.once("connect", () => malformed.write("x".repeat(4097))); malformed.resume(); await closed;
  assert.equal(f.requests.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exchangeWitnessRecovery({ directory: f.directory, contractSha256, binding, request, signal: controller.signal }, f.native), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  assert.equal((await f.exchange(request)).challenge, request.challenge);
});


test("a caller disconnect aborts its in-flight PC exchange and releases the sole operator connection", { skip: unavailable }, async t => {
  const f = await fixture(t); await f.server.close();
  let entered, cancelled, first = true, calls = 0;
  const started = new Promise(resolve => { entered = resolve; }), aborted = new Promise(resolve => { cancelled = resolve; });
  const server = await createWitnessRecoveryControl({ directory: f.directory, exchange: (envelope, { signal }) => {
    calls++; if (!first) return { version: 1, registryId, challenge: envelope.request.challenge, revision: 1,
      sha256: "bad", snapshot: { version: 1, registryId, files: [] } };
    first = false; entered(); return new Promise((_yes, no) => signal.addEventListener("abort", () => { cancelled(); no(new Error("Synthetic cancelled PC exchange")); }, { once: true }));
  } }, f.native); t.after(() => server.close());
  const controller = new AbortController(), request = { version: 1, registryId, challenge: "c".repeat(64), snapshot: null };
  const pending = exchangeWitnessRecovery({ directory: f.directory, contractSha256, binding, request, signal: controller.signal }, f.native);
  await started; controller.abort(); await assert.rejects(pending, { code: "WITNESS_RECOVERY_UNAVAILABLE" }); await aborted;
  await new Promise(resolve => setImmediate(resolve));
  // A second request reaches the exchange (and fails its deliberately bad
  // hash), rather than being rejected as a leaked occupied connection.
  await assert.rejects(f.exchange(request), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  assert.equal(calls, 2);
});
