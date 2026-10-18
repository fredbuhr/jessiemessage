import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, readFile, readdir, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), clientId = "a".repeat(32), binding = { database: "synthetic_private_database", rootFingerprint: "b".repeat(64) };
const record = () => ({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: 1792350000000, updatedAt: 1792350000000 });
const allow = async () => {};
async function fixture(t, real = false) {
  const directory = await erasureDirectory(t), options = { directory, key, clientId, binding };
  const journal = createErasureJournal(options, real ? {} : { withDirectory: withErasureDirectory }); t.after(() => journal.close());
  return { directory, journal, options, async filename() { return path.join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))); } };
}
test("the minimal erasure journal is encrypted, opaque, private, canonical and durable across instances", async t => {
  const f = await fixture(t); assert.deepEqual(await f.journal.read(), { revision: 0, record: null }); assert.deepEqual(await readdir(f.directory), []);
  const saved = await f.journal.save(record(), 0, allow); assert.equal(saved.revision, 1);
  const name = await f.filename(), bytes = await readFile(name, "utf8");
  for (const plaintext of [clientId, binding.database, binding.rootFingerprint, "requested", "1792350000000"]) assert.equal(bytes.includes(plaintext), false);
  assert.equal(path.basename(name).includes(clientId), false); assert.equal((await lstat(name)).mode & 0o7777, 0o600);
  const next = createErasureJournal(f.options, { withDirectory: withErasureDirectory }); t.after(() => next.close());
  assert.deepEqual(await next.read(), saved); assert.equal((await readdir(f.directory)).length, 1);
});
test("a wrong key finds the existing journal and cannot replace or hide it", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow); const before = await readFile(await f.filename());
  const wrong = createErasureJournal({ ...f.options, key: Buffer.alloc(32, 8) }, { withDirectory: withErasureDirectory }); t.after(() => wrong.close());
  await assert.rejects(wrong.read()); await assert.rejects(wrong.save(record(), 1, allow));
  assert.deepEqual(await readFile(await f.filename()), before); assert.equal((await readdir(f.directory)).length, 1);
});
test("changed revision, tag and duplicate envelope fields fail without replacing the journal", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow); const name = await f.filename(), original = await readFile(name, "utf8");
  const revision = JSON.parse(original); revision.revision++;
  const tag = JSON.parse(original); tag.envelope.tag = Buffer.alloc(16).toString("base64url");
  for (const text of [JSON.stringify(revision) + "\n", JSON.stringify(tag) + "\n", original.replace('"version":1', '"version":1,"version":1')]) {
    await writeFile(name, text, { mode: 0o600 }); await assert.rejects(f.journal.read());
    await assert.rejects(f.journal.save({ ...record(), phase: "prepared" }, 1, allow)); assert.equal(await readFile(name, "utf8"), text);
  }
});
test("two erasure writers cannot silently overwrite their acknowledged revision", async t => {
  const f = await fixture(t), settled = await Promise.allSettled([f.journal.save(record(), 0, allow), f.journal.save(record(), 0, allow)]);
  assert.equal(settled.filter(x => x.status === "fulfilled").length, 1); assert.equal((await f.journal.read()).revision, 1);
  await assert.rejects(f.journal.save(record(), 0, allow), { code: "ERASURE_CHANGED" });
});
test("phase rollback, progress rollback and a revoked producer exclusion preserve the last receipt", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow);
  const prepared = { ...record(), phase: "prepared", cursor: "1".repeat(32), updatedAt: record().updatedAt + 1 };
  await f.journal.save(prepared, 1, allow); const before = await readFile(await f.filename());
  await assert.rejects(f.journal.save(record(), 2, allow));
  await assert.rejects(f.journal.save({ ...prepared, cursor: null }, 2, allow));
  await assert.rejects(f.journal.save({ ...prepared, phase: "files_erased" }, 2, async () => { throw new Error("Synthetic exclusion lost"); }));
  assert.deepEqual(await readFile(await f.filename()), before);
});
test("a durable rename with a lost acknowledgement is discovered on the next read", async t => {
  const f = await fixture(t); let once = true;
  const journal = createErasureJournal(f.options, { withDirectory: (directory, work) => withErasureDirectory(directory, scope => work({ ...scope,
    async sync() { await scope.sync(); if (once) { once = false; throw new Error("Synthetic acknowledgement loss"); } },
  })) }); t.after(() => journal.close());
  await assert.rejects(journal.save(record(), 0, allow)); assert.deepEqual(await f.journal.read(), { revision: 1, record: record() });
});
test("symbolic links, multiple links and non-private modes never become erasure receipts", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow); const name = await f.filename(), bytes = await readFile(name);
  await chmod(name, 0o644); await assert.rejects(f.journal.read()); await chmod(name, 0o600);
  const extra = path.join(f.directory, "extra"); await link(name, extra); await assert.rejects(f.journal.read()); await unlink(extra);
  await unlink(name); await writeFile(extra, bytes, { mode: 0o600 }); await symlink(extra, name);
  await assert.rejects(f.journal.read()); await assert.rejects(f.journal.save(record(), 0, allow)); assert.deepEqual(await readFile(extra), bytes);
});
test("copied ciphertext cannot be rebound to a different account, database or physical media root", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow); const source = await readFile(await f.filename());
  for (const options of [{ ...f.options, clientId: "c".repeat(32) }, { ...f.options, binding: { ...binding, database: "other_database" } },
    { ...f.options, binding: { ...binding, rootFingerprint: "d".repeat(64) } }]) {
    const before = await readdir(f.directory), journal = createErasureJournal(options, { withDirectory: withErasureDirectory });
    try {
      await journal.save({ ...record(), clientId: options.clientId, binding: options.binding }, 0, allow);
      const name = (await readdir(f.directory)).find(x => x.endsWith(".json") && !before.includes(x));
      await writeFile(path.join(f.directory, name), source, { mode: 0o600 }); await assert.rejects(journal.read());
    } finally { journal.close(); }
  }
});
test("a closed journal destroys its derived key and refuses further reads or writes", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow); f.journal.close();
  await assert.rejects(f.journal.read()); await assert.rejects(f.journal.save(record(), 1, allow)); assert.deepEqual(key, Buffer.alloc(32, 7));
});
let procfs = false; try { procfs = (await statfs("/proc/self/fd", { bigint: true })).type === 0x9fa0n; } catch {}
test("native Linux anchoring persists the actual erasure receipt without a test directory adapter", { skip: !procfs }, async t => {
  const f = await fixture(t, true); await f.journal.save(record(), 0, allow); assert.equal((await f.journal.read()).record.phase, "requested");
});
test("Linux CI must exercise native erasure journal anchoring", { skip: process.env.CI !== "true" && process.env.CI !== "1" }, () => assert.equal(procfs, true));
