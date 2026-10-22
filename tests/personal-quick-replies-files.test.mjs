import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createQuickRepliesFiles, verifyQuickRepliesEnvelope, QUICK_REPLIES_FILENAME_PATTERN, QUICK_REPLIES_LOCK_PATTERN, QUICK_REPLIES_TEMPORARY_PATTERN, QUICK_REPLIES_FILE_MAX_BYTES } from "../server/quick-replies/files.mjs";
import { validateReplies, validateSave, MAX_QUICK_REPLIES_VERSION } from "../server/quick-replies/validation.mjs";

const key = Buffer.alloc(32, 7), owner = "a".repeat(32), name = `quick-replies-${owner}.json`;
const replies = (body = "Private synthetic saved reply") => [{ id: "b".repeat(32), title: "Synthetic", body, language: "en" }];
// Real file operations through an internal path seam; the mandatory Linux CI
// case below separately exercises the production descriptor anchor unchanged.
async function withDirectory(directory, work) {
  const before = await lstat(directory, { bigint: true });
  const scope = { file: value => path.join(directory, value), async assertReady() { const after = await lstat(directory, { bigint: true }); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mode & 0o7777n, 0o700n); },
    async sync() { const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await handle.sync(); } finally { await handle.close(); } } };
  const result = await work(scope); await scope.assertReady(); return result;
}
async function fixture(t, production = false) {
  const base = path.resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(base, "personal-quick-replies-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = createQuickRepliesFiles(directory, key, owner, production ? {} : { withDirectory }); t.after(() => files.close());
  return { directory, files };
}
test("saved replies have closed fields, unique ids, valid message bodies and an aggregate UTF-8 limit", () => {
  assert.deepEqual(validateSave({ expectedVersion: "0", replies: replies() }), { expectedVersion: "0", replies: replies() });
  for (const change of [v => v[0].body = "\u0000secret", v => v[0].body = "\ud800", v => v[0].body = " ", v => v[0].body = "x".repeat(4097), v => v[0].title = "x".repeat(65),
    v => v[0].title = " trailing ", v => v[0].language = "de", v => v[0].ownerId = owner, v => v.push({ ...v[0] }), v => Object.defineProperty(v[0], "title", { get() { throw new Error("must not invoke"); }, enumerable: true })]) {
    const value = replies(); change(value); assert.throws(() => validateReplies(value), { code: "QUICK_REPLIES_INPUT" });
  }
  assert.throws(() => validateReplies(Array.from({ length: 51 }, (_, n) => ({ ...replies()[0], id: n.toString(16).padStart(32, "0") }))), { code: "QUICK_REPLIES_INPUT" });
  assert.throws(() => validateReplies(Array.from({ length: 3 }, (_, n) => ({ ...replies("界".repeat(4096))[0], id: n.toString(16).padStart(32, "0") }))), { code: "QUICK_REPLIES_INPUT" });
  for (const version of [0, "00", "-1", "4294967296"]) assert.throws(() => validateSave({ expectedVersion: version, replies: [] }), { code: "QUICK_REPLIES_INPUT" });
});
test("catalogues encrypt privately, survive restart, and authenticate their filename and owner", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.files.read(), { revision: 0, ownerId: owner, replies: [] }); assert.deepEqual(await readdir(f.directory), []);
  const saved = await f.files.save(replies(), 0, async () => {}); assert.equal(saved.revision, 1);
  const bytes = await readFile(path.join(f.directory, name)); assert.equal(bytes.includes(Buffer.from("Private synthetic")), false);
  assert.equal((await lstat(path.join(f.directory, name))).mode & 0o7777, 0o600); assert.deepEqual(await readdir(f.directory), [name]);
  const reopened = createQuickRepliesFiles(f.directory, key, owner, { withDirectory }); t.after(() => reopened.close());
  assert.deepEqual(await reopened.read(), saved); assert.deepEqual(verifyQuickRepliesEnvelope(bytes, key, name), saved);
  assert.throws(() => verifyQuickRepliesEnvelope(bytes, key, `quick-replies-${"c".repeat(32)}.json`), { code: "QUICK_REPLIES_UNAVAILABLE" });
  assert.throws(() => verifyQuickRepliesEnvelope(bytes, Buffer.alloc(32, 8), name), { code: "QUICK_REPLIES_UNAVAILABLE" });
  assert.throws(() => verifyQuickRepliesEnvelope(bytes, key, "../" + name), { code: "QUICK_REPLIES_UNAVAILABLE" });
  assert.ok(QUICK_REPLIES_FILENAME_PATTERN.test(name)); assert.ok(QUICK_REPLIES_LOCK_PATTERN.test(`quick-replies-${owner}.lock`));
  assert.ok(QUICK_REPLIES_TEMPORARY_PATTERN.test(`.${name}.${"d".repeat(32)}.tmp`));
});
test("exact ACK retries do not increment revision; empty catalogues retain their version without ABA", async t => {
  const f = await fixture(t); let authorizations = 0; const authorize = async () => { authorizations++; };
  assert.equal((await f.files.save(replies(), 0, authorize)).revision, 1);
  assert.equal((await f.files.save(replies(), 0, authorize)).revision, 1); assert.equal(authorizations, 2);
  await assert.rejects(f.files.save(replies("Different"), 0, authorize), { code: "QUICK_REPLIES_CONFLICT" });
  assert.equal((await f.files.save([], 1, authorize)).revision, 2);
  assert.equal((await f.files.save([], 1, authorize)).revision, 2);
  assert.deepEqual(await f.files.read(), { revision: 2, ownerId: owner, replies: [] });
  assert.equal(verifyQuickRepliesEnvelope(await readFile(path.join(f.directory, name)), key, name).revision, 2);
  await assert.rejects(f.files.save(replies(), 0, authorize), { code: "QUICK_REPLIES_CONFLICT" });
  await assert.rejects(f.files.save([], MAX_QUICK_REPLIES_VERSION, authorize), { code: "QUICK_REPLIES_CONFLICT" });
});
test("competing writers cannot replace an acknowledged catalogue and existing locks are preserved", async t => {
  const f = await fixture(t), other = createQuickRepliesFiles(f.directory, key, owner, { withDirectory }); t.after(() => other.close());
  const results = await Promise.allSettled([f.files.save(replies("First"), 0, async () => {}), other.save(replies("Second"), 0, async () => {})]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1); assert.equal((await f.files.read()).revision, 1);
  assert.ok(results.some(value => value.status === "rejected" && ["QUICK_REPLIES_BUSY", "QUICK_REPLIES_CONFLICT"].includes(value.reason.code)));
  const lock = path.join(f.directory, `quick-replies-${owner}.lock`); await writeFile(lock, "existing-owner", { flag: "wx", mode: 0o600 });
  await assert.rejects(f.files.save(replies("Third"), 1, async () => {}), { code: "QUICK_REPLIES_BUSY" }); assert.equal(await readFile(lock, "utf8"), "existing-owner");
});
test("authorization revoked immediately before rename preserves the previous ciphertext and removes only owned temporary files", async t => {
  const f = await fixture(t); await f.files.save(replies(), 0, async () => {}); const previous = await readFile(path.join(f.directory, name));
  await assert.rejects(f.files.save(replies("Changed"), 1, async () => { throw Object.assign(new Error("refused"), { code: "CHAT_UNAUTHORIZED" }); }), { code: "CHAT_UNAUTHORIZED" });
  assert.deepEqual(await readFile(path.join(f.directory, name)), previous); assert.deepEqual(await readdir(f.directory), [name]);
  await assert.rejects(f.files.save(replies(), 0, async () => { throw Object.assign(new Error("refused"), { code: "CHAT_UNAUTHORIZED" }); }), { code: "CHAT_UNAUTHORIZED" });
});
test("tampered revisions/tags, persisted zero sentinels and noncanonical or oversized files are unavailable", async t => {
  const f = await fixture(t); await f.files.save(replies(), 0, async () => {}); const original = await readFile(path.join(f.directory, name), "utf8");
  for (const alter of [v => v.revision++, v => v.envelope.tag = Buffer.alloc(16).toString("base64url")]) {
    const value = JSON.parse(original); alter(value); await writeFile(path.join(f.directory, name), JSON.stringify(value) + "\n");
    await assert.rejects(f.files.read(), { code: "QUICK_REPLIES_UNAVAILABLE" });
    await assert.rejects(f.files.save(replies(), 1, async () => {}), { code: "QUICK_REPLIES_UNAVAILABLE" });
  }
  for (const raw of ['{"version":1,"revision":0,"envelope":null}\n', original.trim(), original.replace('"version":1', '"version":1,"version":1'), Buffer.from([0xff]), " ".repeat(QUICK_REPLIES_FILE_MAX_BYTES + 1)]) {
    await writeFile(path.join(f.directory, name), raw); await assert.rejects(f.files.read(), { code: "QUICK_REPLIES_UNAVAILABLE" });
  }
  f.files.close(); await assert.rejects(f.files.read(), { code: "QUICK_REPLIES_UNAVAILABLE" });
});
test("linked, nonprivate and nonregular entries are rejected before catalogue replacement", async t => {
  for (const defect of ["symlink", "hardlink", "mode", "directory"]) {
    const f = await fixture(t); await f.files.save(replies(), 0, async () => {}); const filename = path.join(f.directory, name);
    if (defect === "symlink") { await writeFile(path.join(f.directory, "outside"), await readFile(filename), { mode: 0o600 }); await rm(filename); await symlink("outside", filename); }
    if (defect === "hardlink") await link(filename, path.join(f.directory, "alias"));
    if (defect === "mode") await chmod(filename, 0o640);
    if (defect === "directory") { await rm(filename); await mkdir(filename, { mode: 0o700 }); }
    await assert.rejects(f.files.read(), { code: "QUICK_REPLIES_UNAVAILABLE" }); await assert.rejects(f.files.save(replies(), 1, async () => {}), { code: "QUICK_REPLIES_UNAVAILABLE" });
  }
});
let unavailable;
try { if (process.platform !== "linux" || (await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "Linux procfs unavailable"; } catch { unavailable = "Linux procfs unavailable"; }
test("Linux CI must provide the production private replies directory anchor", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("production anchored saved replies persist and verify without the test path seam", { skip: unavailable }, async t => {
  const f = await fixture(t, true); const saved = await f.files.save(replies(), 0, async () => {}); assert.deepEqual(await f.files.read(), saved);
});
