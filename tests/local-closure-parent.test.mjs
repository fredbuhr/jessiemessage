import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createConfiguredLocalClosures } from "../server/backup/local-closure-parent.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

async function fixture(t, { schemaFailure = false } = {}) {
  const directory = await erasureDirectory(t), events = [];
  const configuration = { JESSIEMESSAGE_CRM_KEY: Buffer.alloc(32, 7).toString("base64url"), JESSIEMESSAGE_MESSAGE_KEY: Buffer.alloc(32, 8).toString("base64url"),
    JESSIEMESSAGE_DB_NAME: "jessiemessage_test_local", JESSIEMESSAGE_MEDIA_ROOT: "/synthetic-media" };
  const loaded = [], mediaKey = Buffer.alloc(32, 9), root = Buffer.alloc(32, 6);
  let inspect = 0;
  const internal = {
    async loadEnvironment() { const env = { ...configuration }; loaded.push(env); return env; },
    mediaConfiguration: () => ({ enabled: true, root: "/synthetic-media", key: mediaKey, capacity: { ownerBytes: 1024, totalBytes: 10240 } }),
    async makeStorage() { return { async fingerprint() { return Buffer.from(root); }, async remove() { assert.fail("Read-only context cannot remove media"); } }; },
    async createPool() { return { async getConnection() { return { async release() { events.push("release"); } }; }, async end() { events.push("pool-close"); } }; },
    makeStore: () => ({ binding: { database: configuration.JESSIEMESSAGE_DB_NAME, rootFingerprint: root.toString("hex") },
      async withLease(_id, work) { return work({ async verifyAbsent() { events.push("absent"); } }); } }),
    makeCapacity: () => ({ async status() { return { ready: true, ownerBytes: 1024, totalBytes: 10240, rootFingerprint: Buffer.from(root) }; } }),
    async assertSchema() { inspect++; if (schemaFailure) throw new Error("Synthetic schema unavailable"); },
    withDirectory: withErasureDirectory,
  };
  const create = settings => createConfiguredLocalClosures({ privateDirectory: "/synthetic-private", operationsDirectory: directory },
    { environment: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" }, ...settings }, internal);
  return { directory, events, configuration, loaded, mediaKey, create, inspect: () => inspect };
}

test("configured local check reads actual private journals without creating intent, listener or erasure", async t => {
  const f = await fixture(t), owner = await f.create();
  try {
    assert.deepEqual(await owner.check(), { version: 1, type: "local_closure_precheck", status: "passed", scope: "local_application",
      pendingClosures: false, started: false, erased: false, externalContinuityVerified: false });
    assert.deepEqual(await owner.operations.verifyStartup(async () => {}), { verified: true, completedReceipts: 0, scope: "local_application" });
    assert.ok(f.inspect() >= 2);
  } finally { await owner.close(); }
  assert.equal(f.events.at(-1), "pool-close"); assert.equal(f.mediaKey.every(value => value === 0), true);
  assert.ok(f.loaded.every(env => !env.JESSIEMESSAGE_CRM_KEY && !env.JESSIEMESSAGE_MESSAGE_KEY));
});

test("changed configuration and restored target marker block a local owner before any mutation", async t => {
  for (const change of ["configuration", "quarantine"]) {
    const f = await fixture(t), owner = await f.create(); let mutationReached = false;
    try {
      if (change === "configuration") f.configuration.JESSIEMESSAGE_DB_NAME = "jessiemessage_test_changed";
      else await writeFile(path.join(f.directory, "operational-restore.json"), "{}\n", { mode: 0o600 });
      await assert.rejects(owner.operations.run(async () => { mutationReached = true; }));
      assert.equal(mutationReached, false); assert.equal(f.events.includes("absent"), false);
    } finally { await owner.close(); }
  }
});

test("unavailable schema closes the SQL pool and clears loaded keys", async t => {
  const f = await fixture(t, { schemaFailure: true }); await assert.rejects(f.create());
  assert.equal(f.events.at(-1), "pool-close"); assert.equal(f.mediaKey.every(value => value === 0), true);
  assert.ok(f.loaded.every(env => !env.JESSIEMESSAGE_CRM_KEY && !env.JESSIEMESSAGE_MESSAGE_KEY));
});

test("cancellation never constructs an owner and a closed owner cannot be reused", async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(f.create({ signal: controller.signal }), { code: "ERASURE_ABORTED" });
  assert.equal(f.loaded.length, 0);
  const owner = await f.create(); await owner.close(); await owner.close();
  await assert.rejects(owner.operations.hasPending(), { code: "ERASURE_ABORTED" });
  assert.equal(f.events.filter(value => value === "pool-close").length, 1);
});
