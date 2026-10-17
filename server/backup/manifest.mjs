import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { openPrivateDirectory, privatePathMode } from "../files/private-directory.mjs";
import { validateApplicationCoverage } from "./application-scope.mjs";
import { manifestBackupProfile } from "./profiles.mjs";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_NODES = 2000000;
const MAX_DEPTH = 64;
const KEY_NAMES = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"];
const TAG_FIELDS = ["databaseTag", "rootPathTag", "rootPhysicalTag", "rootFingerprint"];
const HEX = /^[a-f0-9]{64}$/;
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

export class BackupManifestError extends Error {
  constructor(code = "BACKUP_MANIFEST_INVALID") {
    super("Private backup manifest operation failed.");
    this.name = "BackupManifestError"; this.code = code;
  }
}
const fail = (code) => { throw new BackupManifestError(code); };

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || forbiddenKeys.has(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
  return descriptors;
}
function exact(value, names) {
  const descriptors = plain(value), keys = Object.keys(descriptors);
  if (keys.length !== names.length || keys.some((key) => !names.includes(key))) fail();
}
function safeJson(value, budget = { nodes: MAX_NODES, bytes: MAX_BYTES }, depth = 0) {
  if (--budget.nodes < 0 || depth > MAX_DEPTH) fail();
  const spend = (count) => { budget.bytes -= count; if (budget.bytes < 0) fail(); };
  if (value === null || typeof value === "boolean") { spend(value === null ? 4 : value ? 4 : 5); return value; }
  if (typeof value === "string") {
    if (!value.isWellFormed()) fail();
    spend(Buffer.byteLength(JSON.stringify(value))); return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail();
    spend(String(value).length); return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_NODES || Reflect.ownKeys(value).length !== value.length + 1) fail();
    const result = []; spend(2 + Math.max(0, value.length - 1));
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
      result.push(safeJson(descriptor.value, budget, depth + 1));
    }
    return result;
  }
  const descriptors = plain(value), keys = Object.keys(descriptors).sort(), result = {};
  spend(2 + Math.max(0, keys.length - 1));
  for (const key of keys) {
    if (!key.isWellFormed()) fail();
    spend(Buffer.byteLength(JSON.stringify(key)) + 1);
    result[key] = safeJson(descriptors[key].value, budget, depth + 1);
  }
  return result;
}
const canonical = (value) => JSON.stringify(safeJson(value));
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail(); return value; };
const profileKeyNames = (profile) => {
  const selected = manifestBackupProfile(profile);
  if (selected) return [...KEY_NAMES.slice(0, selected.crm ? 5 : 4), ...(selected.notifications ? ["notificationKey"] : [])];
  if (profile === "full") return KEY_NAMES;
  if (profile === "full-notify") return [...KEY_NAMES, "notificationKey"];
  fail();
};
function keySet(keys, names = KEY_NAMES) {
  exact(keys, names);
  const result = Object.create(null);
  try {
    for (const name of names) {
      if (!Buffer.isBuffer(keys[name]) || keys[name].length !== 32) fail();
      result[name] = Buffer.from(keys[name]);
    }
    for (let index = 0; index < names.length; index += 1) {
      for (let other = index + 1; other < names.length; other += 1) {
        if (timingSafeEqual(result[names[index]], result[names[other]])) fail();
      }
    }
    return result;
  } catch { for (const key of Object.values(result)) key.fill(0); fail(); }
}
function identityValue(identity) {
  const result = safeJson(identity);
  exact(result, [...TAG_FIELDS, "rootAncestors"]);
  for (const name of TAG_FIELDS) if (typeof result[name] !== "string" || !HEX.test(result[name])) fail();
  if (!Array.isArray(result.rootAncestors) || result.rootAncestors.length < 1 || result.rootAncestors.length > 256
    || result.rootAncestors.some((tag) => typeof tag !== "string" || !HEX.test(tag))
    || new Set(result.rootAncestors).size !== result.rootAncestors.length || result.rootAncestors.includes(result.rootPathTag)) fail();
  return result;
}
function decode(value, length) {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== length || decoded.toString("base64url") !== value) fail();
  return decoded;
}
const canaryText = (name) => Buffer.from(`jessiemessage:backup-canary:v1:${name}`, "ascii");
function canaryFields(value, name) {
  if (typeof value !== "string" || value.length > 256) fail();
  const fields = value.split(".");
  if (fields.length !== 4 || fields[0] !== "v1") fail();
  return { nonce: decode(fields[1], 12), ciphertext: decode(fields[2], canaryText(name).length), tag: decode(fields[3], 16) };
}
function manifestValue(manifest) {
  const result = safeJson(manifest);
  const selected = manifestBackupProfile(result.profile), profiled = [2, 3, 4, 5, 6, 7, 8, 9, 10].includes(result.version);
  exact(result, ["version", "payload", "signature", ...(profiled ? ["profile"] : [])]);
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(result.version)
    || profiled && !(selected?.manifestVersion === result.version || result.version === 3 && result.profile === "full-notify")
    || typeof result.signature !== "string" || !HEX.test(result.signature)) fail();
  exact(result.payload, ["createdAt", "identity", "snapshot", "canaries"]);
  instant(result.payload.createdAt); identityValue(result.payload.identity);
  // The coordinator owns the snapshot's schema and ciphertext-only contents.
  snapshotScope(result.payload.snapshot, profiled ? result.profile : "full");
  const names = profileKeyNames(profiled ? result.profile : "full");
  exact(result.payload.canaries, names);
  for (const name of names) canaryFields(result.payload.canaries[name], name);
  return result;
}
const envelope = (profile) => manifestBackupProfile(profile) ? { version: manifestBackupProfile(profile).manifestVersion, profile }
  : profile === "full-notify" ? { version: 3, profile } : { version: 1 };
function snapshotScope(snapshot, profile) {
  plain(snapshot);
  if (manifestBackupProfile(profile)?.application) {
    if (snapshot.version !== 2 || snapshot.counts?.tables !== 30) fail();
    validateApplicationCoverage(snapshot.coverage);
  } else if (snapshot.version === 2 || Object.hasOwn(snapshot, "coverage")) {
    // Application-only snapshots cannot acquire the complete-backup envelope.
    fail();
  }
}
function binding(payload, profile = "full") {
  return createHash("sha256").update(canonical({ ...envelope(profile), createdAt: payload.createdAt, identity: payload.identity,
    snapshotHash: createHash("sha256").update(canonical(payload.snapshot)).digest("hex") })).digest();
}
function canaryKey(key, name) {
  return createHmac("sha256", key).update("jessiemessage:backup-canary-key:v1:\0", "ascii").update(name, "ascii").digest();
}
const canaryAad = (name, bound) => Buffer.concat([Buffer.from(`jessiemessage:backup-canary-aad:v1:${name}:`, "ascii"), bound]);
function sealCanary(key, name, bound) {
  const secret = canaryKey(key, name), plaintext = canaryText(name);
  try {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret, nonce, { authTagLength: 16 });
    cipher.setAAD(canaryAad(name, bound));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  } finally { secret.fill(0); plaintext.fill(0); }
}
function verifyCanary(value, key, name, bound) {
  const secret = canaryKey(key, name), expected = canaryText(name);
  let plaintext, tail;
  try {
    const { nonce, ciphertext, tag } = canaryFields(value, name);
    const decipher = createDecipheriv("aes-256-gcm", secret, nonce, { authTagLength: 16 });
    decipher.setAAD(canaryAad(name, bound)); decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext); tail = decipher.final();
    if (tail.length !== 0 || plaintext.length !== expected.length || !timingSafeEqual(plaintext, expected)) fail();
  } finally { secret.fill(0); expected.fill(0); plaintext?.fill(0); tail?.fill(0); }
}
function signature(payload, mediaKey, profile = "full") {
  return createHmac("sha256", mediaKey).update("jessiemessage:backup-manifest-signature:v1:\0", "ascii")
    .update(canonical({ ...envelope(profile), payload })).digest("hex");
}
export function createBackupManifest({ snapshot, identity, keys, now, profile = "full" } = {}) {
  let secrets;
  try {
    const names = profileKeyNames(profile); secrets = keySet(keys, names);
    const payload = { createdAt: instant(now), identity: identityValue(identity), snapshot: safeJson(snapshot), canaries: Object.create(null) };
    snapshotScope(payload.snapshot, profile);
    const bound = binding(payload, profile);
    for (const name of names) payload.canaries[name] = sealCanary(secrets[name], name, bound);
    return manifestValue({ ...envelope(profile), payload, signature: signature(payload, secrets.mediaKey, profile) });
  } catch { fail(); }
  finally { if (secrets) for (const key of Object.values(secrets)) key.fill(0); }
}
export function verifyBackupManifest({ manifest, keys } = {}) {
  let secrets;
  try {
    const result = manifestValue(manifest), profile = result.version === 1 ? "full" : result.profile, names = profileKeyNames(profile);
    secrets = keySet(keys, names);
    const expected = Buffer.from(signature(result.payload, secrets.mediaKey, profile), "hex");
    if (!timingSafeEqual(Buffer.from(result.signature, "hex"), expected)) fail();
    const bound = binding(result.payload, profile);
    for (const name of names) verifyCanary(result.payload.canaries[name], secrets[name], name, bound);
    return result.payload;
  } catch { fail(); }
  finally { if (secrets) for (const key of Object.values(secrets)) key.fill(0); }
}
export function manifestHash(manifest) {
  try { return createHash("sha256").update(canonical(manifestValue(manifest))).digest("hex"); }
  catch { fail(); }
}

function absolutePath(value) {
  if (typeof value !== "string" || value.length < 2 || value.length > 4096 || value.includes("\0")
    || !path.isAbsolute(value) || path.resolve(value) !== value || path.parse(value).root === value) fail("BACKUP_IDENTITY_INVALID");
  return value;
}
const identityTag = (key, purpose, value) => createHmac("sha256", key).update(`jessiemessage:backup-identity:${purpose}:v1:\0`, "ascii").update(value, "utf8").digest("hex");
export async function backupIdentity({ databaseName, rootPath, storage, mediaKey } = {}) {
  let secret;
  try {
    if (typeof databaseName !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(databaseName)
      || !Buffer.isBuffer(mediaKey) || mediaKey.length !== 32
      || typeof storage?.rootIdentity !== "function" || typeof storage?.fingerprint !== "function") throw new Error();
    absolutePath(rootPath); secret = Buffer.from(mediaKey);
    const physical = await storage.rootIdentity(), fingerprint = await storage.fingerprint();
    if (!Buffer.isBuffer(physical) || physical.length !== 32 || !Buffer.isBuffer(fingerprint) || fingerprint.length !== 32) throw new Error();
    const rootAncestors = [];
    let ancestor = path.dirname(rootPath);
    while (true) {
      rootAncestors.push(identityTag(secret, "root-path", ancestor));
      if (rootAncestors.length > 256) throw new Error();
      if (ancestor === path.parse(ancestor).root) break;
      ancestor = path.dirname(ancestor);
    }
    // Reject case-only aliases even on hosts that preserve identifier case
    // while resolving database names without case sensitivity.
    return identityValue({ databaseTag: identityTag(secret, "database", databaseName.toLowerCase()), rootPathTag: identityTag(secret, "root-path", rootPath),
      rootPhysicalTag: physical.toString("hex"), rootFingerprint: fingerprint.toString("hex"), rootAncestors });
  } catch { fail("BACKUP_IDENTITY_INVALID"); }
  finally { secret?.fill(0); }
}
export function assertCloneIdentity(source, target) {
  try {
    const left = identityValue(source), right = identityValue(target);
    if (TAG_FIELDS.some((field) => left[field] === right[field]) || left.rootAncestors.includes(right.rootPathTag)
      || right.rootAncestors.includes(left.rootPathTag)) fail("BACKUP_CLONE_REQUIRED");
  } catch (error) {
    if (error instanceof BackupManifestError && error.code === "BACKUP_CLONE_REQUIRED") throw error;
    fail("BACKUP_IDENTITY_INVALID");
  }
}

function owned(stats) { return process.getuid === undefined || stats.uid === BigInt(process.getuid()); }
function privateFile(stats) { return stats.isFile() && owned(stats) && (stats.mode & 0o7777n) === 0o600n && stats.nlink === 1n; }
function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
async function parentIdentity(filename) {
  absolutePath(filename);
  const parent = path.dirname(filename); let current = path.parse(parent).root;
  for (const component of parent.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stats = await lstat(current, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink() || process.getuid !== undefined && stats.uid !== 0n && !owned(stats)
      || (stats.mode & 0o022n) !== 0n && (stats.mode & 0o1000n) === 0n) throw new Error();
  }
  const stats = await lstat(parent, { bigint: true });
  if (!stats.isDirectory() || !owned(stats) || (stats.mode & 0o7777n) !== 0o700n || await realpath(parent) !== parent) throw new Error();
  return { path: parent, dev: stats.dev, ino: stats.ino };
}
async function parentHandle(identity) {
  const handle = await open(identity.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory() || !owned(stats) || (stats.mode & 0o7777n) !== 0o700n || stats.dev !== identity.dev || stats.ino !== identity.ino) throw new Error();
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function unchangedParent(filename, identity) {
  const current = await parentIdentity(filename);
  if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error();
}
function selectedPathMode(mode) {
  return mode === undefined ? privatePathMode() : privatePathMode({ JESSIEMESSAGE_PRIVATE_PATH_MODE: mode });
}
async function manifestDirectory(filename, mode) {
  absolutePath(filename);
  if (selectedPathMode(mode) === "linux-dirfd") {
    const scope = await openPrivateDirectory(path.dirname(filename));
    try {
      return { filename: scope.file(path.basename(filename)), check: () => scope.assertReady(),
        sync: () => scope.sync(), close: () => scope.close() };
    } catch (error) { await scope.close(); throw error; }
  }
  const identity = await parentIdentity(filename), handle = await parentHandle(identity);
  return { filename, check: () => unchangedParent(filename, identity), sync: () => handle.sync(), close: () => handle.close() };
}
export async function writeManifest(filename, manifest, { pathMode } = {}) {
  let handle, directory;
  try {
    const bytes = Buffer.from(canonical(manifestValue(manifest)), "utf8");
    directory = await manifestDirectory(filename, pathMode);
    handle = await open(directory.filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    if (!privateFile(await handle.stat({ bigint: true }))) throw new Error();
    await handle.writeFile(bytes); await handle.sync();
    const final = await handle.stat({ bigint: true });
    if (!privateFile(final) || final.size !== BigInt(bytes.length) || !sameFile(final, await lstat(directory.filename, { bigint: true }))) throw new Error();
    await directory.check(); await directory.sync(); await directory.check();
  } catch { fail("BACKUP_MANIFEST_UNAVAILABLE"); }
  finally {
    const closed = await Promise.allSettled([handle?.close(), directory?.close()]);
    if (closed.some((result) => result.status === "rejected")) fail("BACKUP_MANIFEST_UNAVAILABLE");
  }
}
export async function readManifest(filename, { pathMode } = {}) {
  let handle, directory, bytes;
  try {
    directory = await manifestDirectory(filename, pathMode);
    const initial = await lstat(directory.filename, { bigint: true });
    if (!privateFile(initial) || initial.size < 1n || initial.size > BigInt(MAX_BYTES)) throw new Error();
    handle = await open(directory.filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    if (!privateFile(before) || !sameFile(initial, before)) throw new Error();
    bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error(); offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!privateFile(after) || !sameFile(before, after) || !sameFile(after, await lstat(directory.filename, { bigint: true }))) throw new Error();
    await directory.check();
    const manifest = manifestValue(JSON.parse(bytes.toString("utf8")));
    if (!Buffer.from(canonical(manifest), "utf8").equals(bytes)) throw new Error();
    return manifest;
  } catch { fail("BACKUP_MANIFEST_UNAVAILABLE"); }
  finally {
    bytes?.fill(0);
    const closed = await Promise.allSettled([handle?.close(), directory?.close()]);
    if (closed.some((result) => result.status === "rejected")) fail("BACKUP_MANIFEST_UNAVAILABLE");
  }
}
