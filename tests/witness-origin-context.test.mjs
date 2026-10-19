import test from "node:test";
import assert from "node:assert/strict";
import { withConfiguredWitnessOrigin } from "../server/backup/witness-origin-context.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { bundle, inheritedEnv } from "./fixtures/crm-private.mjs";

async function fixture(changes = {}) {
  const events = [], loaded = [], mediaKeys = [];
  const load = async (_directory, options) => {
    const value = await loadRuntimeBroadcastEnvironment("/synthetic/private", options, { readBundle: async () => bundle() });
    loaded.push(value); return value;
  };
  let capacity;
  const dependencies = { loadEnvironment: load,
    async makeStorage(value) { mediaKeys.push(value.key); return { async fingerprint() { events.push("fingerprint"); return Buffer.alloc(32, 8); } }; },
    async createPool() { events.push("pool"); return { async end() { events.push("end"); } }; },
    makeCapacity(value) { capacity = value.capacity; return { async assertSchema() { events.push("schema"); },
      async status() { events.push("capacity"); return { ...capacity, rootFingerprint: Buffer.from(capacity.rootFingerprint), ready: true }; } }; },
    ...changes };
  return { events, loaded, mediaKeys, dependencies, run: work => withConfiguredWitnessOrigin({ privateDirectory: "/synthetic/private" }, { environment: inheritedEnv }, work, dependencies) };
}

test("configured origin reads unchanged private profile, verifies capacity/root and wipes scoped caller buffers", async () => {
  const f = await fixture(); let key;
  const result = await f.run(async context => {
    key = context.key; assert.deepEqual(key, Buffer.alloc(32, 6));
    assert.equal(context.binding.database, "synthetic_crm_test"); assert.equal(context.binding.rootFingerprint, "08".repeat(32));
    assert.match(context.configurationFingerprint, /^[a-f0-9]{64}$/); await context.assertReady(); await context.checkCapacity(); return { checked: true };
  });
  assert.deepEqual(result, { checked: true }); assert.equal(f.events.at(-1), "end");
  assert.deepEqual(key, Buffer.alloc(32)); assert.ok(f.mediaKeys.every(value => value.equals(Buffer.alloc(32))));
  for (const env of f.loaded) for (const name of ["JESSIEMESSAGE_CRM_KEY", "JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_SMTP_PASSWORD"]) assert.equal(env[name], "");
});

test("missing initialized capacity, mismatched physical root and media configuration block the callback", async () => {
  for (const mode of ["uninitialized", "wrong_root", "disabled", "schema"]) {
    const f = await fixture({
      ...(mode === "disabled" ? { mediaConfiguration: () => ({ enabled: false }) } : {}),
      ...(mode !== "disabled" ? { makeCapacity({ capacity }) { return {
        async assertSchema() { if (mode === "schema") throw new Error("Synthetic schema details"); },
        async status() { return { ...capacity, ready: mode !== "uninitialized", rootFingerprint: mode === "wrong_root" ? Buffer.alloc(32, 9) : capacity.rootFingerprint }; },
      }; } } : {}),
    });
    await assert.rejects(f.run(() => assert.fail("No publication after failed capacity check")), { code: "WITNESS_ORIGIN_CONTEXT" });
    for (const env of f.loaded) for (const name of ["JESSIEMESSAGE_CRM_KEY", "JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_SMTP_PASSWORD"]) assert.equal(env[name], "");
    if (mode !== "disabled") assert.equal(f.events.at(-1), "end");
  }
});

test("configuration drift, cancellation, callback or pool cleanup failure never certify an origin", async () => {
  for (const mode of ["configuration", "callback", "cleanup"]) {
    let reads = 0;
    const f = await fixture({ async loadEnvironment(_directory, options) {
      const value = await loadRuntimeBroadcastEnvironment("/synthetic/private", options, { readBundle: async () => bundle() });
      if (++reads > 1 && mode === "configuration") value.JESSIEMESSAGE_SMTP_PASSWORD = "synthetic-new-password";
      return value;
    }, ...(mode === "cleanup" ? { createPool: async () => ({ async end() { throw new Error("Synthetic private SQL cleanup"); } }) } : {}) });
    await assert.rejects(f.run(async context => { if (mode === "callback") throw new Error("Synthetic private error"); await context.assertReady(); return true; }), error => {
      assert.equal(error.code, "WITNESS_ORIGIN_CONTEXT"); assert.doesNotMatch(error.message, /Synthetic|password|SQL/); return true;
    });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withConfiguredWitnessOrigin({}, { environment: inheritedEnv, signal: controller.signal }, () => assert.fail("Aborted")), { code: "WITNESS_ORIGIN_CONTEXT" });
});
