import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withPrivateDirectory, withStorageBindingParent } from "./private-directory.mjs";
import { createPrivateJsonStore } from "./private-json.mjs";

function unavailable() {
  throw Object.assign(new Error("Private storage root binding is unavailable."), { code: "STORAGE_ROOT_BINDING" });
}

const decimal = value => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value);
const hex = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function validate(value) {
  if (value?.revision === 0 && Object.keys(value).length === 1) return { revision: 0 };
  if (![0, 1].includes(value?.revision) || !decimal(value.inode) || !decimal(value.previousDevice)
    || !decimal(value.currentDevice) || value.previousDevice === value.currentDevice || !hex(value.signature)) unavailable();
  return { revision: value.revision, inode: value.inode, previousDevice: value.previousDevice,
    currentDevice: value.currentDevice, signature: value.signature };
}

function location(kind, root) {
  if (!["media", "video"].includes(kind)) unavailable();
  const id = createHash("sha256").update(JSON.stringify([kind, root])).digest("hex");
  const name = `binding-${id}.json`;
  const directory = dirname(root);
  const store = createPrivateJsonStore({
    name, lock: `binding-${id}.lock`, maxBytes: 512, validate,
    empty: () => ({ revision: 0 }), fail: unavailable,
    isKnownError: error => error?.code === "STORAGE_ROOT_BINDING",
  });
  return { directory, path: join(directory, name), store };
}

const anchored = { withDirectory: withStorageBindingParent };

function signature(kind, root, key, inode, previousDevice, currentDevice) {
  return createHmac("sha256", key).update("jessiemessage:storage-root-binding:v1:\0", "ascii")
    .update(JSON.stringify([kind, root, inode, previousDevice, currentDevice])).digest();
}

function legacyFingerprint(kind, root, key, inode, device) {
  return createHmac("sha256", key).update(`jessiemessage:${kind}-root:v1:\0`, "ascii")
    .update(root, "utf8").update("\0").update(device).update("\0").update(inode).digest();
}

export async function storageRootFingerprint({ kind, root, key, identity }) {
  const { directory, path, store } = location(kind, root);
  const inode = identity.ino.toString();
  const device = identity.dev.toString();
  try { await lstat(path); }
  catch (error) {
    if (error?.code === "ENOENT") return legacyFingerprint(kind, root, key, inode, device);
    unavailable();
  }
  const record = await store.read(directory, anchored);
  if (record.revision !== 1 || record.inode !== inode || ![record.previousDevice, record.currentDevice].includes(device)
    || !timingSafeEqual(signature(kind, root, key, inode, record.previousDevice, record.currentDevice),
      Buffer.from(record.signature, "hex"))) unavailable();
  return legacyFingerprint(kind, root, key, inode, record.previousDevice);
}

// Called only by an offline operator after the SQL and file inventory proves
// continuity. The old fingerprint is independently rederived before writing.
export async function provisionStorageRootBinding({ kind, root, key, previousDevice, currentDevice, inode, expectedFingerprint }) {
  if (!decimal(previousDevice) || !decimal(currentDevice) || previousDevice === currentDevice || !decimal(inode)
    || !Buffer.isBuffer(key) || key.length !== 32
    || !Buffer.isBuffer(expectedFingerprint) || expectedFingerprint.length !== 32
    || !timingSafeEqual(legacyFingerprint(kind, root, key, inode, previousDevice), expectedFingerprint)) unavailable();
  const { directory, store } = location(kind, root);
  return withPrivateDirectory(root, async scope => {
    const checkRoot = async () => {
      const stats = await scope.assertReady();
      const named = await lstat(root, { bigint: true });
      if (stats.dev.toString() !== currentDevice || stats.ino.toString() !== inode || !named.isDirectory()
        || named.dev !== stats.dev || named.ino !== stats.ino || named.mode !== stats.mode || named.uid !== stats.uid) unavailable();
    };
    await checkRoot();
    const fields = { inode, previousDevice, currentDevice,
      signature: signature(kind, root, key, inode, previousDevice, currentDevice).toString("hex") };
    const existing = await store.read(directory, anchored);
    if (existing.revision === 1) {
      if (JSON.stringify(existing) !== JSON.stringify({ revision: 1, ...fields })) unavailable();
      await checkRoot();
      return;
    }
    await store.save(directory, { revision: 0, ...fields }, 0, { ...anchored, exclusiveCreate: true, beforeCommit: checkRoot });
    await checkRoot();
  });
}
