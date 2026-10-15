import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { main, parseArguments, MediaStorageCliError } from "../scripts/media-storage.mjs";

function fixture(changes = {}) {
  const calls = [], output = [], rootFingerprint = randomBytes(32), pool = { end: async () => { calls.push("end"); } };
  const report = { version: 1, integrity: "structure_only", complete: true, healthy: true, canInitialize: true, counts: {}, issues: [] };
  const config = { enabled: true, root: "/synthetic/private/root", key: randomBytes(32), capacity: { ownerBytes: 1000, totalBytes: 10000 }, minimumFreeBytes: 100 };
  const capacityStore = { status: async () => ({}), initialize: async (options) => { calls.push(["initialize", options]); return { ready: true }; } };
  const dependencies = { configure: () => config, createPool: async (env) => { calls.push(["pool", env]); return pool; },
    makeStorage: async (options) => { calls.push(["storage", options]); return { fingerprint: async () => rootFingerprint }; },
    makeCapacityStore: (options) => { calls.push(["capacity", options]); return capacityStore; },
    makeSchemaStore: () => ({ assertSchema: async () => { calls.push("schema"); } }),
    makeInventoryStore: (options) => { calls.push(["reader", options]); return { readonly: true }; },
    inspect: async (options) => { calls.push(["inspect", options]); return report; },
    outputStream: { write: (value) => output.push(value) }, clock: () => 1750000000000, ...changes };
  return { calls, output, report, config, capacityStore, dependencies, pool, rootFingerprint };
}
const code = (expected) => (error) => error instanceof MediaStorageCliError && error.code === expected;

test("storage CLI defaults to inspect and requires the exact offline initialization assertion", () => {
  assert.deepEqual(parseArguments([]), { command: "inspect", offline: false });
  assert.deepEqual(parseArguments(["inspect"]), { command: "inspect", offline: false });
  assert.deepEqual(parseArguments(["initialize", "--offline"]), { command: "initialize", offline: true });
  for (const args of [["initialize"], ["initialize", "--force"], ["inspect", "--offline"], ["cleanup"], ["rebind"], ["initialize", "--offline", "--reserved-timeout", "1"], ["--offline", "initialize"], [null]]) assert.throws(() => parseArguments(args), code("MEDIA_STORAGE_USAGE"));
});

test("inspect uses runtime pool, verifies the real schema dependency, and never mutates capacity", async () => {
  const f = fixture(), env = { synthetic: "runtime-only" }, result = await main([], env, f.dependencies);
  assert.equal(result.initialized, false); assert.equal(result.report, f.report);
  assert.equal(f.calls.some((item) => item[0] === "initialize"), false);
  assert.ok(f.calls.indexOf("schema") < f.calls.findIndex((item) => item[0] === "inspect"));
  const capacity = f.calls.find((item) => item[0] === "capacity")[1].capacity;
  assert.deepEqual(capacity, { ...f.config.capacity, rootFingerprint: f.rootFingerprint });
  assert.deepEqual(f.calls[0], ["pool", env]); assert.equal(f.calls.at(-1), "end");
  const options = f.calls.find((item) => item[0] === "inspect")[1];
  assert.equal(options.minimumFreeBytes, 100); assert.deepEqual(options.capacity, f.config.capacity);
  const output = JSON.parse(f.output.join("")); assert.equal(output.command, "inspect");
  assert.doesNotMatch(f.output.join(""), /synthetic\/private|rootFingerprint|runtime-only/);
});

test("initialize runs only after the complete healthy inventory and passes explicit offline plus fresh time", async () => {
  const f = fixture(), result = await main(["initialize", "--offline"], {}, f.dependencies);
  assert.equal(result.initialized, true);
  assert.ok(f.calls.findIndex((item) => item[0] === "inspect") < f.calls.findIndex((item) => item[0] === "initialize"));
  assert.deepEqual(f.calls.find((item) => item[0] === "initialize"), ["initialize", { now: 1750000000000, offline: true }]);
  assert.equal(f.calls.at(-1), "end");
});

test("initialize without --offline is rejected before configuration, database or file work", async () => {
  const f = fixture();
  await assert.rejects(main(["initialize"], {}, f.dependencies), code("MEDIA_STORAGE_USAGE"));
  assert.deepEqual(f.calls, []); assert.deepEqual(f.output, []);
});

test("initialize rechecks the private storage root after inventory before changing SQL", async () => {
  let fingerprints = 0;
  const f = fixture({ makeStorage: async () => ({ fingerprint: async () => { fingerprints++; return randomBytes(32); } }) });
  await assert.rejects(main(["initialize", "--offline"], {}, f.dependencies), code("MEDIA_STORAGE_OPERATION"));
  assert.equal(fingerprints, 2); assert.equal(f.calls.some((item) => item[0] === "initialize"), false); assert.equal(f.calls.at(-1), "end");
});

test("incomplete, unsafe, aborted or already initialized inventories cannot initialize or report a successful inspection", async () => {
  for (const changes of [{ complete: false }, { healthy: false }, { canInitialize: false }, { complete: false, healthy: false, canInitialize: false }]) {
    const f = fixture(); Object.assign(f.report, changes);
    await assert.rejects(main(["initialize", "--offline"], {}, f.dependencies), code("MEDIA_STORAGE_INVENTORY"));
    assert.equal(f.calls.some((item) => item[0] === "initialize"), false); assert.equal(f.calls.at(-1), "end");
    assert.equal(JSON.parse(f.output[0]).initialized, false);
    if (!f.report.complete || !f.report.healthy) await assert.rejects(main(["inspect"], {}, f.dependencies), code("MEDIA_STORAGE_INVENTORY"));
  }
});

test("configuration, schema and backend failures are sanitized, close the pool, and never initialize", async () => {
  const disabled = fixture({ configure: () => ({ enabled: false }) });
  await assert.rejects(main([], {}, disabled.dependencies), code("MEDIA_STORAGE_CONFIG")); assert.deepEqual(disabled.calls, []);
  for (const changes of [{ makeSchemaStore: () => ({ assertSchema: async () => { throw new Error("SQL private@example.invalid password=/private/path"); } }) },
    { inspect: async () => { throw new Error("private key and secret storage root"); } },
    { inspect: async () => ({ complete: true, healthy: true, canInitialize: true, integrity: "authenticated" }) }, { clock: () => NaN }]) {
    const f = fixture(changes);
    await assert.rejects(main(["initialize", "--offline"], {}, f.dependencies), (error) => {
      assert.ok(error instanceof MediaStorageCliError); assert.doesNotMatch(error.message, /password|private@example|\/private\/path|secret/); return true;
    });
    assert.equal(f.calls.some((item) => item[0] === "initialize"), false); assert.equal(f.calls.at(-1), "end");
  }
});

test("database close failure rejects the CLI with a neutral error even after successful inspection", async () => {
  const f = fixture();
  f.pool.end = async () => { f.calls.push("end-failed"); throw new Error("SQL password private@example.invalid /private/database/path"); };
  await assert.rejects(main(["inspect"], {}, f.dependencies), (error) => {
    assert.ok(code("MEDIA_STORAGE_OPERATION")(error));
    assert.doesNotMatch(error.message, /password|private@example|\/private\/database|SQL/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(f.calls.at(-1), "end-failed");
  assert.equal(f.calls.some((item) => item[0] === "initialize"), false);
});
