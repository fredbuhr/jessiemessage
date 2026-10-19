import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, readdir, rename, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { prepareWitnessGenesis, readWitnessGenesis, readWitnessGenesisObservation, WITNESS_GENESIS_FILE } from "../server/backup/witness-genesis.mjs";
import { saveCopyState, readCopyState } from "../server/backup/copy-files.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_genesis", rootFingerprint: "b".repeat(64) };
const now = 1792407600000, destinationId = "a".repeat(32), tokenHash = "c".repeat(64);
const destination = { destinationId, pairedAt: now - 1000, pairingFingerprint: tokenHash };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
// Real files, exclusive creates, fstat and fsync. Native anchoring is mandatory
// separately in Linux CI; this seam never becomes a command/HTTP option.
async function withDirectory(directory, work) {
  const initial = await lstat(directory, { bigint: true });
  const scope = { path: directory, file: name => path.join(directory, name),
    async assertReady() {
      const current = await lstat(directory, { bigint: true });
      assert.equal(current.dev, initial.dev); assert.equal(current.ino, initial.ino);
      assert.equal(current.isDirectory(), true); assert.equal(current.uid, BigInt(process.getuid())); assert.equal(current.mode & 0o7777n, 0o700n);
      return current;
    },
    async sync() { const file = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await file.sync(); } finally { await file.close(); } },
  };
  const result = await work(scope); await scope.assertReady(); return result;
}
const internal = { withDirectory, clock: () => now };
async function fixture(t) {
  const root = await erasureDirectory(t), directory = path.join(root, "trust"), operationsDirectory = path.join(root, "operations");
  await mkdir(directory, { mode: 0o700 }); await mkdir(operationsDirectory, { mode: 0o700 });
  const stats = await lstat(operationsDirectory, { bigint: true });
  const state = { version: 1, revision: 0, destinations: [{ id: destinationId, label: "Synthetic computer", kind: "computer", enabled: true,
    pairHash: null, pairExpiresAt: null, tokenHash, pairedAt: destination.pairedAt, lastSeenAt: null, locationId: null, lastReceipt: null }] };
  await saveCopyState(operationsDirectory, state, 0, internal);
  const options = { directory, operationsDirectory, privateDirectory: path.join(root, "configuration"), runtimeDirectory: path.join(root, "source"),
    key, binding, destination, sourceIdentity: { dev: String(stats.dev), ino: String(stats.ino) }, assertQuiescent: async () => {} };
  const name = path.join(directory, WITNESS_GENESIS_FILE);
  async function update(work) {
    const current = await readCopyState(operationsDirectory, internal); work(current.destinations[0]);
    await saveCopyState(operationsDirectory, current, current.revision, internal);
  }
  const prepare = changes => prepareWitnessGenesis({ ...options, ...changes }, internal);
  return { root, options, directory, operationsDirectory, name, prepare, update,
    async read(result, changes) { return readWitnessGenesis({ ...options, expectedContractSha256: result.contractSha256, ...changes }, internal); },
    async observe(result, changes) { return readWitnessGenesisObservation({ ...options, expectedContractSha256: result.contractSha256, ...changes }, internal); } };
}
async function addIntent(f) {
  const journal = createErasureJournal({ directory: f.operationsDirectory, key, binding, clientId: "d".repeat(32) }, { withDirectory });
  try { await journal.save({ version: 1, clientId: "d".repeat(32), binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
  finally { journal.close(); }
}

test("explicit preparation binds the original complete empty registry and exact existing PC capability without activation", async t => {
  const f = await fixture(t), previous = await readFile(path.join(f.operationsDirectory, "backup-copy-state.json")); let checks = 0;
  const result = await f.prepare({ async assertQuiescent() {
    checks++; assert.equal((await readdir(f.operationsDirectory)).includes("recurring-backup.lock"), true);
  } });
  assert.ok(checks >= 8); assert.equal(result.prepared, true); assert.equal(result.closuresEnabled, false); assert.equal(result.externalWitnessConfirmed, false);
  assert.deepEqual(result.contract.destination, destination); assert.deepEqual(result.contract.sourceIdentity, f.options.sourceIdentity);
  assert.equal(result.contract.createdAt, now); assert.equal(result.contract.origin, "https://jessiemessage.com");
  assert.deepEqual(await f.read(result), result.contract); assert.equal(Object.isFrozen(result.contract.destination), true);
  const bytes = await readFile(f.name), stats = await lstat(f.name);
  assert.equal(sha(bytes), result.contractSha256); assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1);
  assert.deepEqual(await readdir(f.directory), [WITNESS_GENESIS_FILE]);
  assert.deepEqual(await readFile(path.join(f.operationsDirectory, "backup-copy-state.json")), previous);
  assert.equal((await readdir(f.operationsDirectory)).includes("recurring-backup.lock"), false);
  assert.deepEqual(key, Buffer.alloc(32, 7));
});

test("missing metadata never creates a contract or an empty witness during a read", async t => {
  const f = await fixture(t);
  await assert.rejects(f.read({ contractSha256: "f".repeat(64) }), { code: "WITNESS_GENESIS_UNAVAILABLE" });
  assert.deepEqual(await readdir(f.directory), []);
  await assert.rejects(f.prepare({ assertQuiescent: undefined })); assert.deepEqual(await readdir(f.directory), []);
});

test("existing, unrelated, interrupted and concurrent preparations can never overwrite a contract", async t => {
  const f = await fixture(t), settled = await Promise.allSettled([f.prepare(), f.prepare()]);
  assert.equal(settled.filter(value => value.status === "fulfilled").length, 1);
  const bytes = await readFile(f.name);
  await assert.rejects(f.prepare(), { code: "WITNESS_GENESIS_EXISTS" }); assert.deepEqual(await readFile(f.name), bytes);
  for (const name of ["unrelated.txt", WITNESS_GENESIS_FILE]) {
    const g = await fixture(t); await writeFile(path.join(g.directory, name), "", { mode: 0o600 });
    await assert.rejects(g.prepare(), { code: "WITNESS_GENESIS_EXISTS" }); assert.equal(await readFile(path.join(g.directory, name), "utf8"), "");
  }
});

test("actual erasure intentions, restored operational directories and wrong original directory identities block genesis", async t => {
  for (const mode of ["intent", "restore", "identity"]) {
    const f = await fixture(t); let changes;
    if (mode === "intent") await addIntent(f);
    if (mode === "restore") await writeFile(path.join(f.operationsDirectory, "operational-restore.json"), "{}\n", { mode: 0o600 });
    if (mode === "identity") changes = { sourceIdentity: { ...f.options.sourceIdentity, ino: "1" } };
    await assert.rejects(f.prepare(changes)); assert.deepEqual(await readdir(f.directory), []);
  }
});

test("a new intention or changed PC capability during preparation prevents publication", async t => {
  for (const mode of ["intent", "pairing"]) {
    const f = await fixture(t); let checks = 0;
    await assert.rejects(f.prepare({ async assertQuiescent() {
      if (++checks === 3) {
        if (mode === "intent") await addIntent(f);
        else await f.update(item => item.tokenHash = "e".repeat(64));
      }
    } }));
    assert.deepEqual(await readdir(f.directory), []);
  }
});

for (const mode of ["paused", "revoked", "repaired", "replaced_same_time"]) {
  test(`a ${mode} PC pairing cannot initialize or authenticate a previous genesis`, async t => {
    const f = await fixture(t), result = await f.prepare();
    await f.update(item => {
      if (mode === "paused") item.enabled = false;
      if (mode === "revoked") { item.tokenHash = null; item.pairedAt = null; }
      if (mode === "repaired") item.pairedAt++;
      if (mode === "replaced_same_time") item.tokenHash = "e".repeat(64);
    });
    await assert.rejects(f.read(result), { code: "WITNESS_GENESIS_PAIRING" });
    const original = await readFile(f.name); await assert.rejects(f.prepare()); assert.deepEqual(await readFile(f.name), original);
    const g = await fixture(t); await g.update(item => item.enabled = false);
    await assert.rejects(g.prepare(), { code: "WITNESS_GENESIS_PAIRING" }); assert.deepEqual(await readdir(g.directory), []);
  });
}

test("explicit non-destructive observation authenticates the same paused PC without granting active genesis authority", async t => {
  const f = await fixture(t), result = await f.prepare();
  assert.deepEqual(await f.observe(result), result.contract); await f.update(item => item.enabled = false);
  const contractBefore = await readFile(f.name), copyBefore = await readFile(path.join(f.operationsDirectory, "backup-copy-state.json"));
  assert.deepEqual(await f.observe(result), result.contract);
  await assert.rejects(f.read(result), { code: "WITNESS_GENESIS_PAIRING" });
  assert.deepEqual(await readFile(f.name), contractBefore); assert.deepEqual(await readFile(path.join(f.operationsDirectory, "backup-copy-state.json")), copyBefore);
  assert.deepEqual(await readdir(f.directory), [WITNESS_GENESIS_FILE]);
  await f.update(item => item.enabled = true); assert.deepEqual(await f.read(result), result.contract);
});

test("observation never accepts revoked, replaced, re-paired or removed destinations even when copies are paused", async t => {
  for (const mode of ["revoked", "re-paired", "replaced-token", "other-destination", "removed"]) await t.test(mode, async step => {
    const f = await fixture(step), result = await f.prepare();
    await f.update(item => {
      item.enabled = false;
      if (mode === "revoked") { item.tokenHash = null; item.pairedAt = null; }
      if (mode === "re-paired") item.pairedAt++;
      if (mode === "replaced-token") item.tokenHash = "e".repeat(64);
      if (mode === "other-destination") item.id = "e".repeat(32);
    });
    if (mode === "removed") {
      const state = await readCopyState(f.operationsDirectory, internal); state.destinations = [];
      await saveCopyState(f.operationsDirectory, state, state.revision, internal);
    }
    const before = await readFile(f.name);
    await assert.rejects(f.observe(result), { code: "WITNESS_GENESIS_PAIRING" }); assert.deepEqual(await readFile(f.name), before);
  });
});

test("paused observation preserves contract authentication, exact pin and original source binding requirements", async t => {
  const f = await fixture(t), result = await f.prepare(); await f.update(item => item.enabled = false);
  for (const changes of [{ expectedContractSha256: "e".repeat(64) }, { key: Buffer.alloc(32, 8) },
    { binding: { ...binding, database: "different_database" } }, { binding: { ...binding, rootFingerprint: "d".repeat(64) } }]) await assert.rejects(f.observe(result, changes));
  const bytes = await readFile(f.name), altered = JSON.parse(bytes); altered.contract.createdAt++;
  await writeFile(f.name, JSON.stringify(altered) + "\n");
  await assert.rejects(f.observe({ contractSha256: sha(await readFile(f.name)) }), { code: "WITNESS_GENESIS_AUTHENTICATION" });
  await writeFile(f.name, bytes);
  await rename(f.operationsDirectory, path.join(f.root, "original-operations")); await mkdir(f.operationsDirectory, { mode: 0o700 });
  await assert.rejects(f.observe(result), { code: "WITNESS_GENESIS_BINDING" });
  await unlink(f.name); await assert.rejects(f.observe(result)); assert.deepEqual(await readdir(f.directory), []);
});

test("receipt refreshes do not invalidate pairing and later closures do not rerun genesis", async t => {
  const f = await fixture(t), result = await f.prepare();
  await f.update(item => item.lastSeenAt = now + 1000); await addIntent(f);
  assert.deepEqual(await f.read(result), result.contract);
  await assert.rejects(f.prepare(), { code: "WITNESS_GENESIS_NOT_EMPTY" });
});

test("wrong pinned hash, key, database, media binding and replacement operational root are refused", async t => {
  const f = await fixture(t), result = await f.prepare();
  for (const changes of [{ expectedContractSha256: "e".repeat(64) }, { key: Buffer.alloc(32, 8) },
    { binding: { ...binding, database: "different_database" } }, { binding: { ...binding, rootFingerprint: "d".repeat(64) } }]) {
    await assert.rejects(f.read(result, changes));
  }
  await rename(f.operationsDirectory, path.join(f.root, "original")); await mkdir(f.operationsDirectory, { mode: 0o700 });
  await assert.rejects(f.read(result), { code: "WITNESS_GENESIS_BINDING" });
});

test("unauthenticated tampering and noncanonical encodings fail even with a caller-supplied matching file hash", async t => {
  for (const change of [bytes => { const value = JSON.parse(bytes); value.contract.destination.pairedAt++; return JSON.stringify(value) + "\n"; },
    bytes => bytes.toString().replace('"version":1', '"version":1,"version":1'), bytes => bytes.toString().replace('"origin"', '"origi\\u006e"'),
    bytes => bytes.toString().trim(), () => Buffer.from([0xff]), () => " ".repeat(4097)]) {
    const f = await fixture(t); await f.prepare(); const bytes = Buffer.from(change(await readFile(f.name)));
    await writeFile(f.name, bytes); await assert.rejects(f.read({ contractSha256: sha(bytes) }));
    assert.deepEqual(await readFile(f.name), bytes);
  }
});

test("unsafe links, multiple hard links, permissions and nonregular contract files are refused", async t => {
  for (const mode of ["symlink", "hardlink", "permissions", "directory", "unknown_entry"]) {
    const f = await fixture(t), result = await f.prepare();
    if (mode === "symlink") { await rename(f.name, path.join(f.root, "outside")); await symlink(path.join(f.root, "outside"), f.name); }
    if (mode === "hardlink") await link(f.name, path.join(f.root, "outside"));
    if (mode === "permissions") await chmod(f.name, 0o640);
    if (mode === "directory") { await unlink(f.name); await mkdir(f.name, { mode: 0o700 }); }
    if (mode === "unknown_entry") await writeFile(path.join(f.directory, "interrupted.pending"), "", { mode: 0o600 });
    await assert.rejects(f.read(result)); await assert.rejects(f.prepare());
  }
});

test("trust storage must be outside every restorable/configuration/runtime directory", async t => {
  const f = await fixture(t);
  for (const changes of [{ directory: f.operationsDirectory }, { directory: path.join(f.operationsDirectory, "trust") },
    { directory: f.root }, { directory: f.options.privateDirectory }, { directory: f.options.runtimeDirectory },
    { directory: path.join(f.options.privateDirectory, "trust") }, { directory: "/invalid/../trust" }]) {
    await assert.rejects(f.prepare(changes), { code: "WITNESS_GENESIS_INPUT" });
  }
  assert.deepEqual(await readdir(f.directory), []);
});

test("capture lock ownership, cancellation and an unavailable quiescence proof cannot be bypassed", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.operationsDirectory, "recurring-backup.lock"), "existing-owner", { mode: 0o600 });
  await assert.rejects(f.prepare()); assert.deepEqual(await readdir(f.directory), []);
  assert.equal(await readFile(path.join(f.operationsDirectory, "recurring-backup.lock"), "utf8"), "existing-owner");
  await unlink(path.join(f.operationsDirectory, "recurring-backup.lock"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.prepare({ signal: controller.signal }), { code: "WITNESS_GENESIS_ABORTED" });
  await assert.rejects(f.prepare({ async assertQuiescent() { throw new Error("Synthetic private diagnostic, never emitted"); } }), error => {
    assert.equal(error.code, "WITNESS_GENESIS_UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(error), /Synthetic|diagnostic/); return true;
  });
  assert.deepEqual(await readdir(f.directory), []);
});

test("an uncertain durable publication is preserved and never retried as a new original genesis", async t => {
  const f = await fixture(t); let changed = false;
  const unreliable = { ...internal, withDirectory: (directory, work) => withDirectory(directory, async scope => work(directory !== f.directory ? scope : {
    ...scope, async sync() { await scope.sync(); changed = true; await f.update(item => item.tokenHash = "e".repeat(64)); },
  })) };
  await assert.rejects(prepareWitnessGenesis(f.options, unreliable), { code: "WITNESS_GENESIS_PAIRING" });
  assert.equal(changed, true); const bytes = await readFile(f.name); assert.ok(bytes.length > 0);
  await f.update(item => item.tokenHash = tokenHash);
  await assert.rejects(f.prepare(), { code: "WITNESS_GENESIS_EXISTS" }); assert.deepEqual(await readFile(f.name), bytes);
});

let unavailable;
if (process.platform !== "linux") unavailable = "Linux required";
else { try { if ((await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "procfs unavailable"; } catch { unavailable = "procfs unavailable"; } }
test("Linux CI must exercise the production genesis directory anchors", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("native protected anchors prepare/read the contract and reject a directory symlink", { skip: unavailable }, async t => {
  const f = await fixture(t), result = await prepareWitnessGenesis(f.options);
  assert.deepEqual(await readWitnessGenesis({ ...f.options, expectedContractSha256: result.contractSha256 }), result.contract);
  await f.update(item => item.enabled = false);
  assert.deepEqual(await readWitnessGenesisObservation({ ...f.options, expectedContractSha256: result.contractSha256 }), result.contract);
  await assert.rejects(readWitnessGenesis({ ...f.options, expectedContractSha256: result.contractSha256 }), { code: "WITNESS_GENESIS_PAIRING" });
  const alias = path.join(f.root, "alias"); await symlink(f.directory, alias);
  await assert.rejects(readWitnessGenesis({ ...f.options, directory: alias, expectedContractSha256: result.contractSha256 }));
  await assert.rejects(readWitnessGenesisObservation({ ...f.options, directory: alias, expectedContractSha256: result.contractSha256 }));
});
