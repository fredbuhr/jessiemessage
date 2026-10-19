import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmod, link, readFile, readdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReconciliationProgress, deriveReconciliationJournalKey } from "../server/backup/reconciliation-progress.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), planSha256 = "a".repeat(64), manifestSha256 = "b".repeat(64);
const targetBinding = { database: "synthetic_reconciliation_target", rootFingerprint: "c".repeat(64) };
const context = () => ({ key, planSha256, manifestSha256, targetBinding });
const record = (phase = "prepared") => ({ version: 1, planSha256, manifestSha256, targetBinding, phase });
const allow = async () => {};
async function fixture(t) {
  const directory = await erasureDirectory(t), options = { directory, ...context() };
  const progress = createReconciliationProgress(options, { withDirectory: withErasureDirectory }); t.after(() => progress.close());
  return { directory, options, progress, filename: path.join(directory, "reconciliation-progress.json") };
}
test("a reconciliation ledger is encrypted, private, canonical and durable", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.progress.read(), { revision: 0, record: null }); assert.deepEqual(await readdir(f.directory), []);
  const saved = await f.progress.save(record(), 0, allow), text = await readFile(f.filename, "utf8");
  assert.deepEqual(saved, { revision: 1, record: record() }); assert.equal(text, `${JSON.stringify(JSON.parse(text))}\n`);
  for (const secret of [planSha256, manifestSha256, targetBinding.database, targetBinding.rootFingerprint, f.directory, "prepared"]) assert.equal(text.includes(secret), false);
  assert.equal((await stat(f.filename)).mode & 0o7777, 0o600);
  const restarted = createReconciliationProgress(f.options, { withDirectory: withErasureDirectory }); t.after(() => restarted.close());
  assert.deepEqual(await restarted.read(), saved); assert.deepEqual(await readdir(f.directory), ["reconciliation-progress.json"]);
  assert.deepEqual(key, Buffer.alloc(32, 7));
});
test("a wrong key, plan, manifest, database or root cannot hide or overwrite an existing ledger", async t => {
  const f = await fixture(t); await f.progress.save(record(), 0, allow); const before = await readFile(f.filename);
  for (const patch of [{ key: Buffer.alloc(32, 8) }, { planSha256: "d".repeat(64) }, { manifestSha256: "d".repeat(64) },
    { targetBinding: { ...targetBinding, database: "other_target" } }, { targetBinding: { ...targetBinding, rootFingerprint: "d".repeat(64) } }]) {
    const options = { ...f.options, ...patch }, other = createReconciliationProgress(options, { withDirectory: withErasureDirectory });
    try {
      await assert.rejects(other.read());
      await assert.rejects(other.save({ ...record("running"), planSha256: options.planSha256, manifestSha256: options.manifestSha256, targetBinding: options.targetBinding }, 1, allow));
      assert.deepEqual(await readFile(f.filename), before);
    } finally { other.close(); }
  }
});
test("ledger transitions are ordered, CAS protected and completed state cannot regress", async t => {
  const f = await fixture(t);
  await assert.rejects(f.progress.save(record("running"), 0, allow), { code: "RECONCILIATION_PROGRESS_CHANGED" });
  await f.progress.save(record(), 0, allow);
  await assert.rejects(f.progress.save(record("completed"), 1, allow), { code: "RECONCILIATION_PROGRESS_CHANGED" });
  await assert.rejects(f.progress.save(record("running"), 0, allow), { code: "RECONCILIATION_PROGRESS_CHANGED" });
  await f.progress.save(record(), 1, allow); await f.progress.save(record("running"), 2, allow);
  await assert.rejects(f.progress.save(record(), 3, allow), { code: "RECONCILIATION_PROGRESS_CHANGED" });
  await f.progress.save(record("completed"), 3, allow); const before = await readFile(f.filename);
  await assert.rejects(f.progress.save(record("running"), 4, allow), { code: "RECONCILIATION_PROGRESS_CHANGED" });
  assert.deepEqual(await readFile(f.filename), before);
  assert.deepEqual(await f.progress.save(record("completed"), 4, allow), { revision: 5, record: record("completed") });
});
test("concurrent writers and guards cannot commit stale or revoked work", async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.progress.save(record(), 0, allow), f.progress.save(record(), 0, allow)]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  const before = await readFile(f.filename);
  await assert.rejects(f.progress.save(record("running"), 1, async () => { throw new Error("Synthetic exclusion lost"); }));
  assert.deepEqual(await readFile(f.filename), before); assert.deepEqual(await readdir(f.directory), ["reconciliation-progress.json"]);
  let calls = 0;
  await f.progress.save(record("running"), 1, async () => { calls++; }); assert.equal(calls, 1);
});
test("closing before or during authorization refuses publication and preserves the source key", async t => {
  const f = await fixture(t); await f.progress.save(record(), 0, allow); const before = await readFile(f.filename);
  await assert.rejects(f.progress.save(record("running"), 1, async () => { f.progress.close(); }));
  assert.deepEqual(await readFile(f.filename), before); await assert.rejects(f.progress.read());
  await assert.rejects(f.progress.save(record("running"), 1, allow)); assert.deepEqual(key, Buffer.alloc(32, 7));
  assert.deepEqual(await readdir(f.directory), ["reconciliation-progress.json"]);
});
test("lost acknowledgement after durable rename is discovered without repeating a write", async t => {
  const f = await fixture(t); let once = true;
  const progress = createReconciliationProgress(f.options, { withDirectory: (directory, work) => withErasureDirectory(directory, scope => work({ ...scope,
    async sync() { await scope.sync(); if (once) { once = false; throw new Error("Synthetic acknowledgement lost"); } },
  })) }); t.after(() => progress.close());
  await assert.rejects(progress.save(record(), 0, allow)); assert.deepEqual(await f.progress.read(), { revision: 1, record: record() });
  assert.deepEqual(await readdir(f.directory), ["reconciliation-progress.json"]);
});
test("resource drift during authorization and a pre-existing lock refuse publication", async t => {
  const f = await fixture(t); await f.progress.save(record(), 0, allow); const before = await readFile(f.filename);
  await assert.rejects(f.progress.save(record("running"), 1, async () => { await writeFile(f.filename, before, { mode: 0o600 }); }),
    { code: "RECONCILIATION_PROGRESS_CHANGED" });
  assert.deepEqual(await readFile(f.filename), before); assert.deepEqual(await readdir(f.directory), ["reconciliation-progress.json"]);
  const lock = path.join(f.directory, "reconciliation-progress.lock"); await writeFile(lock, "", { mode: 0o600 }); let calls = 0;
  await assert.rejects(f.progress.save(record("running"), 1, async () => { calls++; }), { code: "RECONCILIATION_PROGRESS_BUSY" });
  assert.equal(calls, 0); assert.deepEqual(await readFile(f.filename), before); await unlink(lock);
});
test("revision drift, tampering, alternate encodings and malformed envelope fields fail closed", async t => {
  const f = await fixture(t); await f.progress.save(record(), 0, allow); const original = await readFile(f.filename, "utf8");
  const alteredRevision = JSON.parse(original); alteredRevision.revision++;
  const alteredTag = JSON.parse(original); alteredTag.envelope.tag = Buffer.alloc(16).toString("base64url");
  const huge = JSON.parse(original); huge.envelope.ciphertext = Buffer.alloc(1025).toString("base64url");
  const empty = { version: 1, revision: 1, envelope: null };
  for (const text of [`${JSON.stringify(alteredRevision)}\n`, `${JSON.stringify(alteredTag)}\n`, `${JSON.stringify(huge)}\n`, `${JSON.stringify(empty)}\n`,
    original.replace('"version":1', '"version":1,"version":1'), original.replace('"version":1', '"version": 1'), original.trimEnd(), " ".repeat(8193)]) {
    await writeFile(f.filename, text, { mode: 0o600 }); await assert.rejects(f.progress.read());
    await assert.rejects(f.progress.save(record("running"), 1, allow)); assert.equal(await readFile(f.filename, "utf8"), text);
  }
});
test("authenticated plaintext still requires exact canonical fields, phases and context", async t => {
  const f = await fixture(t), namespace = "jessiemessage:closure-reconciliation-progress:v1";
  const selected = { planSha256, manifestSha256, targetBinding }, contextText = JSON.stringify(selected);
  const derived = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(`${namespace}:ledger-key:${contextText}`), 32));
  try {
    for (const text of [JSON.stringify(record()).replace('"version":1', '"version":1,"version":1'),
      JSON.stringify({ ...record(), phase: "unknown" }), JSON.stringify({ ...record(), extra: true }),
      JSON.stringify({ ...record(), planSha256: "d".repeat(64) }), JSON.stringify(record()).replace('"version":1', '"version": 1')]) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", derived, iv);
      cipher.setAAD(Buffer.from(`${namespace}:ledger:${contextText}:1`));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(text)), cipher.final()]);
      const state = { version: 1, revision: 1, envelope: { iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } };
      await writeFile(f.filename, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      await assert.rejects(f.progress.read()); await assert.rejects(f.progress.save(record("running"), 1, allow));
    }
  } finally { derived.fill(0); }
});
test("getter fields, extra members, malformed contexts and records are rejected without invoking accessors", async t => {
  const f = await fixture(t); let calls = 0;
  const accessor = object => Object.defineProperty(object, "planSha256", { enumerable: true, get() { calls++; return planSha256; } });
  assert.throws(() => createReconciliationProgress(accessor({ ...f.options })), { code: "RECONCILIATION_PROGRESS_INPUT" });
  assert.throws(() => deriveReconciliationJournalKey(accessor(context())), { code: "RECONCILIATION_PROGRESS_INPUT" });
  await assert.rejects(f.progress.save(accessor(record()), 0, allow), { code: "RECONCILIATION_PROGRESS_INPUT" });
  const symbol = Symbol("unexpected");
  for (const patch of [{ extra: true }, { [symbol]: true }, { phase: "unknown" }, { version: 2 },
    { targetBinding: { ...targetBinding, extra: true } }, { planSha256: "d".repeat(64) }, { manifestSha256: "d".repeat(64) }]) await assert.rejects(f.progress.save({ ...record(), ...patch }, 0, allow));
  for (const patch of [{ key: Buffer.alloc(31) }, { directory: "" }, { planSha256: "A".repeat(64) },
    { manifestSha256: "b".repeat(63) }, { targetBinding: { database: "../target", rootFingerprint: "c".repeat(64) } }]) assert.throws(() => createReconciliationProgress({ ...f.options, ...patch }));
  for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER]) await assert.rejects(f.progress.save(record(), value, allow));
  await assert.rejects(f.progress.save(record(), 0)); assert.equal(calls, 0); assert.deepEqual(await readdir(f.directory), []);
});
test("unsafe modes, hard links and symbolic links never become reconciliation ledgers", async t => {
  const f = await fixture(t); await f.progress.save(record(), 0, allow); const bytes = await readFile(f.filename), extra = path.join(f.directory, "extra");
  await chmod(f.filename, 0o644); await assert.rejects(f.progress.read()); await chmod(f.filename, 0o600);
  await link(f.filename, extra); await assert.rejects(f.progress.read()); await unlink(extra);
  await unlink(f.filename); await writeFile(extra, bytes, { mode: 0o600 }); await symlink(extra, f.filename);
  await assert.rejects(f.progress.read()); await assert.rejects(f.progress.save(record("running"), 1, allow));
  assert.deepEqual(await readFile(extra), bytes);
});
test("target journal derivation is deterministic, epoch bound, domain separated and independently owned", async t => {
  const f = await fixture(t), first = deriveReconciliationJournalKey(context()), second = deriveReconciliationJournalKey(context());
  assert.equal(first.length, 32); assert.deepEqual(first, second); first.fill(0); assert.notDeepEqual(first, second);
  for (const patch of [{ key: Buffer.alloc(32, 8) }, { planSha256: "d".repeat(64) }, { manifestSha256: "d".repeat(64) },
    { targetBinding: { ...targetBinding, database: "other_target" } }, { targetBinding: { ...targetBinding, rootFingerprint: "d".repeat(64) } }]) {
    const derived = deriveReconciliationJournalKey({ ...context(), ...patch }); assert.notDeepEqual(derived, second); derived.fill(0);
  }
  await f.progress.save(record(), 0, allow); const targetKeyLedger = createReconciliationProgress({ ...f.options, key: second }, { withDirectory: withErasureDirectory });
  try { await assert.rejects(targetKeyLedger.read()); } finally { targetKeyLedger.close(); second.fill(0); }
  assert.deepEqual(key, Buffer.alloc(32, 7));
});
