import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { CheckpointReceiptError, readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";

const metadata = Buffer.from('{"synthetic":"application-manifest"}');
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = () => ({ format: "jessiemessage-private-checkpoint", version: 2, profile: "messaging-photos-notify-application",
  coverage: { ...APPLICATION_COVERAGE }, createdAt: 1792240000000, schema: { tables: 30, migrations: 30 },
  sql: { file: "database.sql.gz", bytes: 120, sha256: "b".repeat(64), uncompressedBytes: 700, uncompressedSha256: "c".repeat(64) },
  manifest: { file: "manifest.json", sha256: hash(metadata) }, media: { files: [], bytes: 0 } });
const invalid = (error) => error instanceof CheckpointReceiptError && error.code === "CHECKPOINT_RECEIPT_INVALID"
  && error.message === "Private checkpoint receipt operation failed." && error.cause === undefined;
async function fixture(t) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "application-receipt-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "manifest.json"), metadata, { mode: 0o600 });
  const scope = { file: (name) => join(directory, name), assertReady: async () => lstat(directory), sync: async () => {} };
  return { directory, scope, filename: join(directory, "receipt.json") };
}

test("application receipts publish their exact limited coverage as private canonical v2 bytes bound to the raw manifest", async (t) => {
  const f = await fixture(t), value = receipt();
  const reversed = Object.fromEntries(Object.entries(value).reverse());
  reversed.coverage = Object.fromEntries(Object.entries(value.coverage).reverse());
  assert.deepEqual(await writeCheckpointReceipt(f.scope, reversed), value);
  assert.equal(await readFile(f.filename, "utf8"), `${JSON.stringify(value)}\n`);
  assert.equal((await lstat(f.filename)).mode & 0o7777, 0o600);
  assert.deepEqual(await readCheckpointReceipt(f.scope), value);
  await assert.rejects(writeCheckpointReceipt(f.scope, value), { code: "CHECKPOINT_RECEIPT_UNAVAILABLE" });
  await writeFile(join(f.directory, "manifest.json"), "changed", { mode: 0o600 });
  await assert.rejects(readCheckpointReceipt(f.scope), invalid);
});

test("application receipts reject mismatched versions and profiles, overstated coverage and malformed scope before publication", async (t) => {
  const f = await fixture(t);
  for (const mutate of [
    (v) => { v.version = 1; }, (v) => { v.version = 3; }, (v) => { v.profile = "messaging-photos-notify"; },
    (v) => { delete v.coverage; }, (v) => { v.coverage.completeDatabase = true; },
    (v) => { v.coverage.executableInventory = "proven"; }, (v) => { v.coverage.executableObjects = "included"; },
    (v) => { v.coverage.tables = 29; }, (v) => { v.coverage.encryptedMedia = false; },
    (v) => { v.coverage.scope = "database"; }, (v) => { v.coverage.extra = true; },
    (v) => { v.schema.tables = 29; }, (v) => { v.schema.migrations = 29; },
    (v) => { v.coverage = Object.assign(Object.create({ extra: true }), v.coverage); },
  ]) {
    const value = receipt(); mutate(value);
    await assert.rejects(writeCheckpointReceipt(f.scope, value), invalid);
  }
  let accessed = false;
  const value = receipt(); Object.defineProperty(value.coverage, "completeDatabase", {
    enumerable: true, get() { accessed = true; return false; } });
  await assert.rejects(writeCheckpointReceipt(f.scope, value), invalid);
  const versionGetter = receipt(); Object.defineProperty(versionGetter, "version", {
    enumerable: true, get() { accessed = true; return 2; } });
  await assert.rejects(writeCheckpointReceipt(f.scope, versionGetter), invalid);
  assert.equal(accessed, false); assert.deepEqual(await readdir(f.directory), ["manifest.json"]);
});

test("application receipt reads refuse alternate coverage order, duplicate coverage keys and one-field downgrades", async (t) => {
  const f = await fixture(t), value = receipt(), canonical = `${JSON.stringify(value)}\n`;
  const reordered = { ...value, coverage: Object.fromEntries(Object.entries(value.coverage).reverse()) };
  for (const bytes of [
    `${JSON.stringify(reordered)}\n`,
    canonical.replace('"completeDatabase":false', '"completeDatabase":false,"completeDatabase":false'),
    canonical.replace('"completeDatabase":false', '"completeDatabase":true'),
    canonical.replace('"version":2', '"version":1'),
    canonical.replace('"profile":"messaging-photos-notify-application"', '"profile":"messaging-photos-notify"'),
    canonical.replace('"coverage":', '"otherCoverage":'),
  ]) {
    await writeFile(f.filename, bytes, { mode: 0o600 });
    await assert.rejects(readCheckpointReceipt(f.scope), invalid);
  }
});

test("legacy v1 receipts remain byte-compatible and cannot silently acquire application coverage", async (t) => {
  const f = await fixture(t), value = receipt();
  value.version = 1; value.profile = "messaging-photos-notify"; delete value.coverage;
  assert.deepEqual(await writeCheckpointReceipt(f.scope, value), value);
  assert.equal(await readFile(f.filename, "utf8"), `${JSON.stringify(value)}\n`);
  const altered = { ...value, coverage: { ...APPLICATION_COVERAGE } };
  await writeFile(f.filename, `${JSON.stringify(altered)}\n`, { mode: 0o600 });
  await assert.rejects(readCheckpointReceipt(f.scope), invalid);
});
