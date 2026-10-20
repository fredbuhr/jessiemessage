import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckpointReceiptError, hashCheckpointFile, readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { BACKUP_MEDIA_MAX_BYTES } from "../server/media/backup-limits.mjs";

const MIB = 1024 * 1024, base = fileURLToPath(new URL("../../audit/", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const metadata = Buffer.from('{"synthetic":"private-manifest"}');
const neutral = (code = "CHECKPOINT_RECEIPT_UNAVAILABLE") => (error) => {
  assert.ok(error instanceof CheckpointReceiptError); assert.equal(error.code, code);
  assert.equal(error.message, "Private checkpoint receipt operation failed.");
  assert.doesNotMatch(JSON.stringify(error), /synthetic|private-manifest|receipt\.json|database\.sql|checkpoint-receipt-/);
  assert.equal(error.cause, undefined); assert.equal(Object.hasOwn(error, "path"), false); return true;
};
const file = (number, variant = "full", bytes = 45) => ({ name: `${number.toString(16).padStart(64, "0")}.${variant}.enc`, bytes, sha256: "a".repeat(64) });
const receipt = () => ({ format: "jessiemessage-private-checkpoint", version: 1, profile: "messaging-photos-notify", createdAt: 1792193000000,
  schema: { tables: 30, migrations: 30 }, sql: { file: "database.sql.gz", bytes: 120, sha256: "b".repeat(64), uncompressedBytes: 700, uncompressedSha256: "c".repeat(64) },
  manifest: { file: "manifest.json", sha256: hash(metadata) }, media: { files: [file(1), file(1, "thumb", 12)], bytes: 57 } });
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "checkpoint-receipt-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "manifest.json"), metadata, { mode: 0o600 });
  const events = [], scope = { file: (name) => join(directory, name), async assertReady() {
    const stats = await lstat(directory, { bigint: true });
    assert.equal(stats.mode & 0o7777n, 0o700n); events.push("ready"); return stats;
  }, async sync() { events.push("sync"); } };
  return { directory, scope, events, value: receipt(), filename: join(directory, "receipt.json") };
}
async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args); syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("checkpoint receipts publish once as private canonical JSON and reread their raw manifest binding", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await writeCheckpointReceipt(f.scope, f.value), f.value);
  const bytes = await readFile(f.filename), stats = await lstat(f.filename);
  assert.equal(bytes.toString("utf8"), `${JSON.stringify(f.value)}\n`);
  assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1);
  assert.ok(f.events.includes("sync")); assert.deepEqual(await readCheckpointReceipt(f.scope), f.value);
  await assert.rejects(writeCheckpointReceipt(f.scope, f.value), neutral());
  assert.deepEqual(await readFile(f.filename), bytes);
});

test("receipt writes normalize field order while reads refuse alternative bytes, duplicate fields and invalid UTF-8", async (t) => {
  const f = await fixture(t), reversed = Object.fromEntries(Object.entries(f.value).reverse());
  await writeCheckpointReceipt(f.scope, reversed);
  assert.equal(await readFile(f.filename, "utf8"), `${JSON.stringify(f.value)}\n`);
  const canonical = `${JSON.stringify(f.value)}\n`;
  for (const source of [canonical.trimEnd(), `${canonical}\n`, ` ${canonical}`, `${JSON.stringify(reversed)}\n`,
    canonical.replace('"version":1,', '"version":1,"version":1,'), canonical.replace('"format":', '"extra":0,"format":'),
    `\uFEFF${canonical}`, Buffer.from([0xff, 0xfe, 0xfd])]) {
    await writeFile(f.filename, source);
    await assert.rejects(readCheckpointReceipt(f.scope), neutral("CHECKPOINT_RECEIPT_INVALID"));
  }
});

test("receipt validation rejects unknown fields, custom prototypes, getters, symbols and noncanonical media lists before publication", async (t) => {
  const f = await fixture(t); let getterRead = false;
  const accessor = receipt(); Object.defineProperty(accessor, "format", { enumerable: true, get() { getterRead = true; throw new Error("synthetic-private"); } });
  const symbol = receipt(); symbol[Symbol("synthetic")] = true;
  const arrayExtra = receipt(); arrayExtra.media.files.extra = true;
  const sparse = receipt(); delete sparse.media.files[0];
  const withPrototype = Object.assign(Object.create({ extra: true }), receipt());
  const values = [accessor, symbol, arrayExtra, sparse, withPrototype, { ...receipt(), extra: 1 }];
  for (const change of [
    (v) => { v.schema.tables = 28; }, (v) => { v.schema.migrations = 28; }, (v) => { v.schema.extra = true; },
    (v) => { v.profile = "messaging-photos"; }, (v) => { v.createdAt = -1; }, (v) => { v.createdAt = NaN; },
    (v) => { v.sql.file = "../database.sql.gz"; }, (v) => { v.sql.bytes = 0; }, (v) => { v.sql.bytes = 16 * MIB + 1; },
    (v) => { v.sql.uncompressedBytes = 64 * MIB + 1; }, (v) => { v.sql.sha256 = "B".repeat(64); },
    (v) => { v.manifest.file = "manifest-after.json"; }, (v) => { v.media.files.reverse(); },
    (v) => { v.media.files[1] = { ...v.media.files[0] }; }, (v) => { v.media.files[0].name = "../synthetic.full.enc"; },
    (v) => { v.media.files[0].bytes = 10 * MIB + 129; }, (v) => { v.media.files[0].sha256 = "wrong"; },
    (v) => { v.media.bytes++; }, (v) => { v.media.files = Array(100001).fill(file(1)); },
    (v) => { v.media.files = Array.from({ length: 103 }, (_, index) => file(index, "full", 10 * MIB)); v.media.bytes = 103 * 10 * MIB; },
  ]) { const value = receipt(); change(value); values.push(value); }
  for (const value of values) await assert.rejects(writeCheckpointReceipt(f.scope, value), neutral("CHECKPOINT_RECEIPT_INVALID"));
  assert.equal(getterRead, false); assert.deepEqual(await readdir(f.directory), ["manifest.json"]);
});

test("empty media inventories are allowed and every receipt binds the original raw manifest bytes", async (t) => {
  const f = await fixture(t); f.value.media = { files: [], bytes: 0 };
  await writeCheckpointReceipt(f.scope, f.value);
  await writeFile(join(f.directory, "manifest.json"), Buffer.from('{"synthetic":"changed-private-manifest"}'));
  await assert.rejects(readCheckpointReceipt(f.scope), neutral("CHECKPOINT_RECEIPT_INVALID"));
  await unlink(f.filename);
  await assert.rejects(writeCheckpointReceipt(f.scope, f.value), neutral("CHECKPOINT_RECEIPT_INVALID"));
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
});

test("receipts accept the complete media admission budget and reject one additional encrypted byte", async (t) => {
  const f = await fixture(t), limit = 10 * MIB, files = [];
  let remaining = BACKUP_MEDIA_MAX_BYTES;
  while (remaining > 0) {
    const bytes = Math.min(remaining, limit);
    files.push(file(files.length + 1, "full", bytes)); remaining -= bytes;
  }
  const value = { ...receipt(), media: { files, bytes: BACKUP_MEDIA_MAX_BYTES } };
  assert.deepEqual(await writeCheckpointReceipt(f.scope, value), value);
  assert.deepEqual(await readCheckpointReceipt(f.scope), value);
  const over = await fixture(t), increased = structuredClone(value);
  increased.media.files.at(-1).bytes++; increased.media.bytes++;
  await assert.rejects(writeCheckpointReceipt(over.scope, increased), neutral("CHECKPOINT_RECEIPT_INVALID"));
  assert.deepEqual(await readdir(over.directory), ["manifest.json"]);
});

test("fixed-name hashes use bounded erased buffers and permit an explicit archive budget up to two GiB", async (t) => {
  const f = await fixture(t), bytes = Buffer.alloc(170001, 65), observed = []; let closed = false;
  await writeFile(join(f.directory, "checkpoint.tar.gz"), bytes, { mode: 0o600 });
  const report = await hookOpen(async (original, args) => {
    const handle = await original(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (buffer, offset, length, position) => { observed.push(buffer); assert.ok(buffer.length <= 65536); assert.ok(length <= 65536); return read(buffer, offset, length, position); };
    handle.close = async () => { closed = true; return close(); }; return handle;
  }, () => hashCheckpointFile(f.scope, "checkpoint.tar.gz", { maxBytes: 2 * 1024 * MIB }));
  assert.deepEqual(report, { bytes: bytes.length, sha256: hash(bytes) }); assert.equal(closed, true);
  assert.ok(observed.length >= 3); assert.ok(observed.every((buffer) => buffer.every((byte) => byte === 0)));
  for (const name of ["database.sql", "database.sql.gz", "manifest-after.json", "receipt.json"]) {
    await writeFile(join(f.directory, name), bytes, { mode: 0o600 });
    assert.deepEqual(await hashCheckpointFile(f.scope, name), report);
  }
  for (const name of ["../manifest.json", "unknown.json", file(1).name, "/manifest.json", "manifest.json\0"]) {
    await assert.rejects(hashCheckpointFile(f.scope, name), neutral("CHECKPOINT_RECEIPT_INVALID"));
  }
  for (const maxBytes of [0, -1, 1.1, NaN, 2 * 1024 * MIB + 1]) {
    await assert.rejects(hashCheckpointFile(f.scope, "manifest.json", { maxBytes }), neutral("CHECKPOINT_RECEIPT_INVALID"));
  }
  await assert.rejects(hashCheckpointFile(f.scope, "manifest.json", { maxBytes: metadata.length - 1 }), neutral());
});

test("receipt and hash readers refuse symlinks, hard links and unsafe file modes without changing foreign bytes", async (t) => {
  const f = await fixture(t); await writeCheckpointReceipt(f.scope, f.value);
  for (const name of ["manifest.json", "receipt.json"]) {
    const filename = join(f.directory, name), read = name === "receipt.json" ? () => readCheckpointReceipt(f.scope) : () => hashCheckpointFile(f.scope, name);
    const original = await readFile(filename);
    await chmod(filename, 0o640); await assert.rejects(read(), neutral()); await chmod(filename, 0o600);
    await link(filename, join(f.directory, "foreign-link")); await assert.rejects(read(), neutral()); await unlink(join(f.directory, "foreign-link"));
    await unlink(filename); const target = join(f.directory, "foreign-keep"); await writeFile(target, original, { mode: 0o600 });
    await symlink(target, filename); await assert.rejects(read(), neutral());
    if (name === "receipt.json") await assert.rejects(writeCheckpointReceipt(f.scope, f.value), neutral());
    assert.deepEqual(await readFile(target), original);
    await unlink(filename); await unlink(target); await writeFile(filename, original, { mode: 0o600 });
  }
});

test("a changed file mode or pathname replacement during hashing fails after closing and erasing buffers", async (t) => {
  for (const change of ["mode", "replacement"]) {
    const f = await fixture(t), filename = join(f.directory, "database.sql");
    await writeFile(filename, Buffer.alloc(130000, 66), { mode: 0o600 });
    const buffers = []; let changed = false, closed = false;
    await hookOpen(async (original, args) => {
      const handle = await original(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...parameters) => {
        buffers.push(parameters[0]); const result = await read(...parameters);
        if (!changed) {
          changed = true;
          if (change === "mode") await chmod(filename, 0o640);
          else { await unlink(filename); await writeFile(filename, "synthetic-foreign-keep", { mode: 0o600 }); }
        }
        return result;
      };
      handle.close = async () => { closed = true; return close(); }; return handle;
    }, () => assert.rejects(hashCheckpointFile(f.scope, "database.sql"), neutral()));
    assert.equal(changed, true); assert.equal(closed, true);
    assert.ok(buffers.every((buffer) => buffer.every((byte) => byte === 0)));
    if (change === "replacement") assert.equal(await readFile(filename, "utf8"), "synthetic-foreign-keep");
  }
});

test("cancellation and root validation failure never expose private data or leave an open reader", async (t) => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(writeCheckpointReceipt(f.scope, f.value, { signal: controller.signal }), neutral("CHECKPOINT_RECEIPT_ABORTED"));
  await assert.rejects(hashCheckpointFile(f.scope, "manifest.json", { signal: controller.signal }), neutral("CHECKPOINT_RECEIPT_ABORTED"));
  assert.deepEqual(await readdir(f.directory), ["manifest.json"]);
  let checks = 0;
  const scope = { ...f.scope, async assertReady() { checks++; if (checks > 1) throw new Error("synthetic private root replaced"); return f.scope.assertReady(); } };
  await assert.rejects(hashCheckpointFile(scope, "manifest.json"), neutral()); assert.equal(checks, 2);
});
