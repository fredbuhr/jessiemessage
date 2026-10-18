import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, mkdir, mkdtemp, chmod, rm, writeFile, readFile, symlink, link, statfs } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createCopyCatalog } from "../server/backup/copy-catalog.mjs";

const start = 1792340000000, id = `capture-${start}-${"c".repeat(16)}`, recipientSha256 = "a".repeat(64), bytes = Buffer.from("synthetic encrypted archive"), sha256 = createHash("sha256").update(bytes).digest("hex");
const receipt = { format: "jessiemessage-checkpoint-encryption", version: 1, createdAt: start + 10, encrypted: true, protection: "mdc", decryptionVerified: false, independentCopyPending: true,
  source: { file: "checkpoint.tar.gz", bytes: 10, sha256: "d".repeat(64) }, recipient: { file: "recipient-public.asc", sha256: recipientSha256, fingerprint: "B".repeat(40) },
  ciphertext: { file: "checkpoint.tar.gz.gpg", bytes: bytes.length, sha256 } };
async function withDirectory(directory, callback) {
  const before = await lstat(directory, { bigint: true });
  const ready = async () => { const after = await lstat(directory, { bigint: true }); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); assert.equal(after.mode & 0o7777n, 0o700n); };
  await ready(); const result = await callback({ path: directory, file: name => join(directory, name), assertReady: ready }); await ready(); return result;
}
async function fixture(t, native = false) {
  const base = resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 }); const directory = await mkdtemp(join(base, "copy-catalog-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true })); const capture = join(directory, id); await mkdir(capture, { mode: 0o700 });
  await writeFile(join(capture, "checkpoint.tar.gz.gpg"), bytes, { mode: 0o600 }); await writeFile(join(capture, "encryption-receipt.json"), JSON.stringify(receipt), { mode: 0o600 });
  const internal = { readConfiguration: async () => ({ version: 1, recipientSha256, enabled: true, hourUtc: 5, minuteUtc: 15 }),
    readHistory: async () => ({ records: [{ status: "succeeded", startedAt: start }] }),
    ...(native ? {} : { withDirectory, capturePath: (root, selected) => root.file(selected) }) };
  return { directory, capture, internal, catalog: createCopyCatalog(directory, internal) };
}
test("catalog is restricted to successful encrypted captures and contains no private paths or clear source", async t => {
  const f = await fixture(t); await mkdir(join(f.directory, `capture-${start + 1}-${"d".repeat(16)}`), { mode: 0o700 });
  const listing = await f.catalog.list(); assert.equal(listing.archives.length, 1); assert.equal(listing.archives[0].sha256, sha256);
  assert.doesNotMatch(JSON.stringify(listing), /encryption-receipt|recipient|\/|checkpoint\.tar\.gz"/);
  let received; await f.catalog.transfer(id, async (record, file) => { const output = Buffer.alloc(record.bytes); await file.read(output, 0, output.length, 0); received = output; });
  assert.deepEqual(received, bytes);
  for (const invalid of ["../checkpoint.tar.gz", ".env", "recipient-public.asc", "checkpoint.tar.gz", `${id}/../../x`]) await assert.rejects(f.catalog.transfer(invalid, () => assert.fail()), { code: "input" });
});
test("wrong recipient, clear filename, forged size and unknown receipt fields cannot be exported", async t => {
  for (const invalid of [{ ...receipt, recipient: { ...receipt.recipient, sha256: "0".repeat(64) } }, { ...receipt, ciphertext: { ...receipt.ciphertext, file: "checkpoint.tar.gz" } },
    { ...receipt, ciphertext: { ...receipt.ciphertext, bytes: 1 } }, { ...receipt, key: "must not escape" }]) {
    const f = await fixture(t); await writeFile(join(f.capture, "encryption-receipt.json"), JSON.stringify(invalid), { mode: 0o600 });
    await assert.rejects(f.catalog.list()); await assert.rejects(f.catalog.transfer(id, () => assert.fail()));
  }
});
test("ciphertext tampering is rejected before the download consumer or headers", async t => {
  const f = await fixture(t); await writeFile(join(f.capture, "checkpoint.tar.gz.gpg"), Buffer.alloc(bytes.length, 120), { mode: 0o600 });
  await assert.rejects(f.catalog.transfer(id, () => assert.fail("corrupt ciphertext was exposed")), { code: "changed" });
});
test("offline verification exposes only validated hashes for an already successful capture", async t => {
  const f = await fixture(t), result = await f.catalog.verification(id);
  assert.deepEqual(result, { format: "jessiemessage-backup-verification", version: 1, archive: (await f.catalog.list()).archives[0],
    source: { bytes: receipt.source.bytes, sha256: receipt.source.sha256 }, recipient: { fingerprint: receipt.recipient.fingerprint }, protection: "mdc" });
  assert.doesNotMatch(JSON.stringify(result), /\/|recipient-public|encryption-receipt|checkpoint\.tar\.gz"|key|token|password|csrf/i);
  await assert.rejects(f.catalog.verification(`capture-${start + 1}-${"c".repeat(16)}`), { code: "missing" });
  await assert.rejects(f.catalog.verification("../encryption-receipt.json"), { code: "input" });
  await writeFile(join(f.capture, "encryption-receipt.json"), JSON.stringify({ ...receipt, source: { ...receipt.source, bytes: 2151677953 } }), { mode: 0o600 });
  await assert.rejects(f.catalog.verification(id), { code: "limit" });
});
test("symbolic links, hardlinks, broad file permissions and a linked capture directory are refused", async t => {
  for (const defect of ["file-symlink", "file-hardlink", "file-mode", "receipt-symlink", "directory-symlink"]) {
    const f = await fixture(t), target = join(f.capture, defect === "receipt-symlink" ? "encryption-receipt.json" : "checkpoint.tar.gz.gpg");
    if (defect.endsWith("symlink") && defect !== "directory-symlink") { const outside = join(f.directory, "outside"); await writeFile(outside, await readFile(target), { mode: 0o600 }); await rm(target); await symlink(outside, target); }
    if (defect === "file-hardlink") await link(target, join(f.directory, "alias"));
    if (defect === "file-mode") await chmod(target, 0o640);
    if (defect === "directory-symlink") { const outside = join(f.directory, "other"); await mkdir(outside, { mode: 0o700 }); await rm(f.capture, { recursive: true }); await symlink(outside, f.capture); }
    await assert.rejects(f.catalog.list());
  }
});
test("mutating the ciphertext while its consumer runs cannot produce a successful transfer", async t => {
  const f = await fixture(t);
  await assert.rejects(f.catalog.transfer(id, async () => { await writeFile(join(f.capture, "checkpoint.tar.gz.gpg"), Buffer.alloc(bytes.length), { mode: 0o600 }); }), { code: "changed" });
});
let unavailable;
try { if (process.platform !== "linux" || (await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "native procfs unavailable"; } catch { unavailable = "native procfs unavailable"; }
test("Linux CI must exercise the real copy directory and streaming descriptor", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("native pinned capture directory exports exactly the verified ciphertext", { skip: unavailable }, async t => {
  const f = await fixture(t, true); const result = await f.catalog.list(); assert.equal(result.archives[0].id, id);
  const chunks = []; await f.catalog.transfer(id, async (_record, file) => { for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) chunks.push(chunk); });
  assert.deepEqual(Buffer.concat(chunks), bytes);
});
