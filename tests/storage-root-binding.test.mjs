import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { provisionStorageRootBinding, storageRootFingerprint } from "../server/files/storage-root-binding.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createVideoStorage } from "../server/video/storage.mjs";

async function fixture(t, kind) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url));
  await mkdir(base, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(base, "jm-storage-binding-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "storage");
  await mkdir(root, { mode: 0o700 });
  const key = Buffer.alloc(32, 3);
  const identity = await lstat(root, { bigint: true });
  const previousDevice = identity.dev + 1n;
  const expected = device => createHmac("sha256", key)
    .update(`jessiemessage:${kind}-root:v1:\0${root}\0${device}\0${identity.ino}`).digest();
  const options = { kind, root, key, inode: identity.ino.toString(), previousDevice: previousDevice.toString(),
    currentDevice: identity.dev.toString(), expectedFingerprint: expected(previousDevice) };
  const createStorage = kind === "media" ? createMediaStorage : createVideoStorage;
  const storage = await createStorage({ root, key, pathMode: "linux-dirfd" });
  const bindingFile = async () => join(parent, (await readdir(parent)).find(name => /^binding-[a-f0-9]{64}\.json$/.test(name)));
  return { parent, root, key, identity, previousDevice, expected, options, storage, bindingFile };
}

for (const kind of ["media", "video"]) {
  test(`${kind} keeps historical SQL identity on an attested remount with a separate media inventory`, async t => {
    const f = await fixture(t, kind);
    assert.deepEqual(await f.storage.fingerprint(), f.expected(f.identity.dev));
    const physical = await f.storage.rootIdentity?.();
    assert.deepEqual(await readdir(f.parent), ["storage"]);
    await provisionStorageRootBinding(f.options);
    await provisionStorageRootBinding(f.options);
    assert.deepEqual(await f.storage.fingerprint(), f.expected(f.previousDevice));
    assert.deepEqual(await f.storage.rootIdentity?.(), physical);
    assert.deepEqual(await Array.fromAsync(f.storage.scanEntries()), []);
    assert.deepEqual(await readdir(f.root), []);

    const read = identity => storageRootFingerprint({ kind, root: f.root, key: f.key, identity });
    assert.deepEqual(await read({ ino: f.identity.ino, dev: f.previousDevice }), f.expected(f.previousDevice));
    await assert.rejects(read({ ino: f.identity.ino, dev: f.previousDevice + 1n }), { code: "STORAGE_ROOT_BINDING" });
    await assert.rejects(read({ ino: f.identity.ino + 1n, dev: f.identity.dev }), { code: "STORAGE_ROOT_BINDING" });
    await assert.rejects(storageRootFingerprint({ kind, root: f.root, key: Buffer.alloc(32, 4), identity: f.identity }),
      { code: "STORAGE_ROOT_BINDING" });
  });
}

test("provisioning refuses unrelated SQL fingerprints and changed physical identity without writing", async t => {
  const f = await fixture(t, "media");
  await assert.rejects(provisionStorageRootBinding({ ...f.options, expectedFingerprint: Buffer.alloc(32) }),
    { code: "STORAGE_ROOT_BINDING" });
  await assert.rejects(provisionStorageRootBinding({ ...f.options, currentDevice: (f.identity.dev + 2n).toString() }),
    { code: "STORAGE_ROOT_BINDING" });
  assert.deepEqual(await readdir(f.parent), ["storage"]);
  const id = createHash("sha256").update(JSON.stringify(["media", f.root])).digest("hex");
  const filename = join(f.parent, `binding-${id}.json`);
  await writeFile(filename, '{"revision":0}\n', { mode: 0o600 });
  await assert.rejects(provisionStorageRootBinding(f.options), { code: "STORAGE_ROOT_BINDING" });
  assert.equal(await readFile(filename, "utf8"), '{"revision":0}\n');
});

test("tampered, insecure, linked and substituted binding files cannot authorize a remount", async t => {
  const f = await fixture(t, "video");
  await provisionStorageRootBinding(f.options);
  const filename = await f.bindingFile(), original = await readFile(filename);
  const reject = () => assert.rejects(f.storage.fingerprint(), { code: "VIDEO_UNAVAILABLE" });
  const modified = JSON.parse(original);
  modified.signature = "0".repeat(64);
  await writeFile(filename, `${JSON.stringify(modified)}\n`);
  await reject();
  await writeFile(filename, original);
  await chmod(filename, 0o644);
  await reject();
  await chmod(filename, 0o600);
  const copy = join(f.parent, "copy");
  await link(filename, copy);
  await reject();
  await unlink(copy);
  await copyFile(filename, copy);
  await unlink(filename);
  await symlink(copy, filename);
  await reject();
  await unlink(filename);
  assert.deepEqual(await f.storage.fingerprint(), f.expected(f.identity.dev));
});
