import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMediaStorage } from "../server/media/storage.mjs";
import { backupIdentity, assertCloneIdentity } from "../server/backup/manifest.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "media-physical-identity-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32), storage = await createMediaStorage({ root, key });
  return { root, key, storage };
}

test("physical root identity uses only the private directory device and inode with its own HMAC purpose", async (t) => {
  const { root, key, storage } = await fixture(t), metadata = await stat(root, { bigint: true });
  const expected = createHmac("sha256", key).update("jessiemessage:media-root-physical:v1:\0", "ascii")
    .update(metadata.dev.toString()).update("\0").update(metadata.ino.toString()).digest();
  const actual = await storage.rootIdentity();
  assert.ok(Buffer.isBuffer(actual)); assert.equal(actual.length, 32); assert.deepEqual(actual, expected);
  assert.deepEqual(await (await createMediaStorage({ root, key })).rootIdentity(), actual);
  assert.notDeepEqual(await storage.fingerprint(), actual);
  const historicalFingerprint = createHmac("sha256", key).update("jessiemessage:media-root:v1:\0", "ascii")
    .update(root, "utf8").update("\0").update(metadata.dev.toString()).update("\0").update(metadata.ino.toString()).digest();
  assert.deepEqual(await storage.fingerprint(), historicalFingerprint, "the existing storage binding remains unchanged");
  actual.fill(0); assert.deepEqual(await storage.rootIdentity(), expected);
  assert.notDeepEqual(await (await createMediaStorage({ root, key: randomBytes(32) })).rootIdentity(), expected);
});

test("a different path to the same physical directory retains its identity and is refused as a clone", async (t) => {
  const { root, key, storage } = await fixture(t);
  const source = await backupIdentity({ databaseName: "source_db", rootPath: root, storage, mediaKey: key });
  const moved = `${root}-moved`; t.after(() => rm(moved, { recursive: true, force: true }));
  await rename(root, moved);
  const alias = await createMediaStorage({ root: moved, key });
  const target = await backupIdentity({ databaseName: "clone_db", rootPath: moved, storage: alias, mediaKey: key });
  assert.notEqual(target.rootPathTag, source.rootPathTag); assert.notEqual(target.rootFingerprint, source.rootFingerprint);
  assert.equal(target.rootPhysicalTag, source.rootPhysicalTag);
  assert.throws(() => assertCloneIdentity(source, target), { code: "BACKUP_CLONE_REQUIRED" });
  await assert.rejects(storage.rootIdentity(), { code: "MEDIA_UNAVAILABLE" });
});

test("physical root identities distinguish private directories and close on permission or inode drift", async (t) => {
  const { root, key, storage } = await fixture(t), other = await fixture(t);
  assert.notDeepEqual(await (await createMediaStorage({ root: other.root, key })).rootIdentity(), await storage.rootIdentity());
  await chmod(root, 0o750); await assert.rejects(storage.rootIdentity(), { code: "MEDIA_UNAVAILABLE" }); await chmod(root, 0o700);
  const previous = `${root}-previous`; t.after(() => rm(previous, { recursive: true, force: true }));
  await rename(root, previous); await mkdir(root, { mode: 0o700 });
  await assert.rejects(storage.rootIdentity(), (error) => error.code === "MEDIA_UNAVAILABLE" && !error.message.includes(root) && error.cause === undefined);
});
