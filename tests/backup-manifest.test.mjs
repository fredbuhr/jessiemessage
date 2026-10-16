import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackupManifestError, createBackupManifest, verifyBackupManifest, manifestHash, backupIdentity,
  assertCloneIdentity, readManifest, writeManifest } from "../server/backup/manifest.mjs";

const now = 1750000000000;
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
const names = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"];
const keys = () => Object.fromEntries(names.map((name) => [name, randomBytes(32)]));
const identity = () => ({ databaseTag: "1".repeat(64), rootPathTag: "2".repeat(64), rootPhysicalTag: "3".repeat(64),
  rootFingerprint: "4".repeat(64), rootAncestors: ["5".repeat(64), "6".repeat(64)] });
const snapshot = () => ({ version: 1, schemaDigest: "7".repeat(64), coreDigest: "8".repeat(64),
  counts: { rows: 0, tables: 30 }, objects: [], assets: [] });
const valid = (changes = {}) => ({ snapshot: snapshot(), identity: identity(), keys: keys(), now, ...changes });
const hasCode = (code = "BACKUP_MANIFEST_INVALID") => (error) => error instanceof BackupManifestError && error.code === code
  && error.message === "Private backup manifest operation failed." && error.cause === undefined;
const copy = (value) => JSON.parse(JSON.stringify(value));
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, sorted(value[name])])) : value;
const resign = (manifest, mediaKey) => {
  manifest.signature = createHmac("sha256", mediaKey).update("jessiemessage:backup-manifest-signature:v1:\0", "ascii")
    .update(JSON.stringify(sorted({ version: 1, payload: manifest.payload }))).digest("hex");
  return manifest;
};

test("photo manifests authenticate exactly four real keys, bind their profile and preserve v1 full manifests", () => {
  const input = valid(), four = Object.fromEntries(Object.entries(input.keys).filter(([name]) => name !== "crmKey"));
  const manifest = createBackupManifest({ ...input, keys: four, profile: "messaging-photos" });
  assert.equal(manifest.version, 2); assert.equal(manifest.profile, "messaging-photos");
  assert.deepEqual(Object.keys(verifyBackupManifest({ manifest, keys: four }).canaries).sort(), Object.keys(four).sort());
  for (const name of Object.keys(four)) assert.throws(() => verifyBackupManifest({ manifest, keys: { ...four, [name]: randomBytes(32) } }), hasCode());
  assert.throws(() => createBackupManifest({ ...input, keys: four }), hasCode());
  assert.throws(() => createBackupManifest({ ...input, profile: "messaging-photos" }), hasCode());
  for (const change of [{ profile: "full" }, { version: 1 }, { profile: "messaging-text" }]) {
    assert.throws(() => verifyBackupManifest({ manifest: { ...manifest, ...change }, keys: four }), hasCode());
  }
  assert.throws(() => verifyBackupManifest({ manifest, keys: input.keys }), hasCode());
  const previous = createBackupManifest(input); assert.equal(previous.version, 1);
  assert.deepEqual(verifyBackupManifest({ manifest: previous, keys: input.keys }).snapshot, input.snapshot);
});
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "backup-manifest-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = valid(), manifest = createBackupManifest(input);
  return { root, filename: path.join(root, "backup.manifest.json"), input, manifest };
}

test("signed manifests authenticate a detached snapshot and all five encrypted canaries for empty domains", () => {
  const input = valid(), originals = Object.fromEntries(names.map((name) => [name, Buffer.from(input.keys[name])]));
  const manifest = createBackupManifest(input), payload = verifyBackupManifest({ manifest, keys: input.keys });
  assert.deepEqual(Object.keys(manifest).sort(), ["payload", "signature", "version"]);
  assert.deepEqual(Object.keys(payload).sort(), ["canaries", "createdAt", "identity", "snapshot"]);
  assert.deepEqual(Object.keys(payload.canaries).sort(), [...names].sort());
  assert.equal(manifest.version, 1); assert.equal(payload.createdAt, now);
  assert.deepEqual(payload.snapshot, input.snapshot); assert.deepEqual(payload.identity, input.identity);
  for (const name of names) {
    assert.match(payload.canaries[name], /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(input.keys[name], originals[name]);
    assert.equal(JSON.stringify(manifest).includes(input.keys[name].toString("hex")), false);
  }
  assert.equal(JSON.stringify(manifest).includes("jessiemessage:backup-canary"), false);
  input.snapshot.counts.rows = 5; input.identity.rootAncestors.push("9".repeat(64));
  assert.equal(manifest.payload.snapshot.counts.rows, 0); assert.equal(manifest.payload.identity.rootAncestors.length, 2);
  payload.snapshot.counts.rows = 8;
  assert.equal(manifest.payload.snapshot.counts.rows, 0);
});

test("every original key is required even when its encrypted application domain is empty", () => {
  const input = valid(), manifest = createBackupManifest(input);
  for (const name of names) {
    assert.throws(() => verifyBackupManifest({ manifest, keys: { ...input.keys, [name]: randomBytes(32) } }), hasCode(), name);
  }
  assert.deepEqual(verifyBackupManifest({ manifest, keys: input.keys }).snapshot, input.snapshot);
});

test("signatures and hashes are stable across property order while distinct backups get fresh canary nonces", () => {
  const input = valid(), first = createBackupManifest(input), second = createBackupManifest(input);
  const reordered = { signature: first.signature, payload: Object.fromEntries(Object.entries(first.payload).reverse()), version: 1 };
  assert.equal(manifestHash(reordered), manifestHash(first));
  assert.deepEqual(verifyBackupManifest({ manifest: reordered, keys: input.keys }), first.payload);
  assert.notEqual(manifestHash(first), manifestHash(second));
  for (const name of names) assert.notEqual(first.payload.canaries[name], second.payload.canaries[name]);
  assert.match(manifestHash(first), /^[a-f0-9]{64}$/);
});

test("tampering with signed identity, snapshot, creation time or canaries never verifies", () => {
  const input = valid(), manifest = createBackupManifest(input);
  const corruptions = [
    (value) => { value.payload.snapshot.counts.rows = 1; },
    (value) => { value.payload.identity.databaseTag = "a".repeat(64); },
    (value) => { value.payload.createdAt += 1; },
    (value) => { value.signature = "0".repeat(64); },
    (value) => { value.payload.canaries.totpKey = value.payload.canaries.mailKey; },
    (value) => { value.payload.canaries.messageKey = second.payload.canaries.messageKey; },
  ];
  const second = createBackupManifest(input);
  for (const change of corruptions) {
    const altered = copy(manifest); change(altered);
    assert.throws(() => verifyBackupManifest({ manifest: altered, keys: input.keys }), hasCode());
  }
});

test("canaries bind their purpose and exact snapshot context even after someone with only the signing key resigns", () => {
  const input = valid(), first = createBackupManifest(input), second = createBackupManifest({ ...input, now: now + 1 });
  const transplanted = copy(second); transplanted.payload.canaries.totpKey = first.payload.canaries.totpKey;
  assert.throws(() => verifyBackupManifest({ manifest: resign(transplanted, input.keys.mediaKey), keys: input.keys }), hasCode());
  const swapped = copy(first);
  [swapped.payload.canaries.totpKey, swapped.payload.canaries.mailKey] = [swapped.payload.canaries.mailKey, swapped.payload.canaries.totpKey];
  assert.throws(() => verifyBackupManifest({ manifest: resign(swapped, input.keys.mediaKey), keys: input.keys }), hasCode());
  const changedSnapshot = copy(first); changedSnapshot.payload.snapshot.counts.rows += 1;
  assert.throws(() => verifyBackupManifest({ manifest: resign(changedSnapshot, input.keys.mediaKey), keys: input.keys }), hasCode());
});

test("manifest keys, envelopes, identity fields and version reject aliases and incomplete shapes", () => {
  const input = valid(), manifest = createBackupManifest(input);
  for (const invalidKeys of [null, {}, { ...input.keys, mediaKey: "private-secret" }, { ...input.keys, totpKey: Buffer.alloc(31) },
    { ...input.keys, crmKey: input.keys.messageKey }, { ...input.keys, extraKey: randomBytes(32) }]) {
    assert.throws(() => createBackupManifest({ ...input, keys: invalidKeys }), hasCode());
    assert.throws(() => verifyBackupManifest({ manifest, keys: invalidKeys }), hasCode());
  }
  const mutations = [
    (value) => { value.version = 2; }, (value) => { value.extra = true; },
    (value) => { value.payload.snapshot = []; }, (value) => { value.payload.extra = true; },
    (value) => { value.payload.createdAt = NaN; }, (value) => { value.signature = value.signature.toUpperCase(); },
    (value) => { value.payload.identity.rootPhysicalTag = "A".repeat(64); },
    (value) => { value.payload.identity.rootAncestors = [value.payload.identity.rootPathTag]; },
    (value) => { value.payload.canaries.mailKey += "="; }, (value) => { delete value.payload.canaries.crmKey; },
  ];
  for (const change of mutations) {
    const altered = copy(manifest); change(altered);
    assert.throws(() => verifyBackupManifest({ manifest: altered, keys: input.keys }), hasCode());
  }
});

test("snapshot serialization refuses unsafe JSON, prototype tricks, accessors and excessive nesting", () => {
  const input = valid(), cycle = {}; cycle.self = cycle;
  let accessed = false;
  const getter = Object.defineProperty({}, "secret", { enumerable: true, get() { accessed = true; return "secret"; } });
  let deep = {}; for (let index = 0; index < 66; index += 1) deep = { child: deep };
  for (const snapshot of [undefined, [], { value: undefined }, { value: NaN }, { value: Infinity }, { value: -0 },
    { value: Number.MAX_SAFE_INTEGER + 1 }, { value: 1n }, { value: Buffer.alloc(1) }, { value: new Date() },
    { value: "\ud800" }, { value: () => "secret" }, { value: [undefined] }, { value: new Array(1) },
    JSON.parse('{"__proto__":{"secret":true}}'), getter, cycle, deep]) {
    assert.throws(() => createBackupManifest({ ...input, snapshot }), hasCode());
  }
  assert.equal(accessed, false);
});

test("private manifest files round-trip canonical bytes with exclusive durable publication", async (t) => {
  const f = await fixture(t);
  await writeManifest(f.filename, f.manifest);
  const metadata = await stat(f.filename);
  assert.equal(metadata.mode & 0o777, 0o600); assert.equal(metadata.nlink, 1);
  const original = await readFile(f.filename);
  assert.deepEqual(await readManifest(f.filename), f.manifest);
  assert.deepEqual(verifyBackupManifest({ manifest: await readManifest(f.filename), keys: f.input.keys }).snapshot, f.input.snapshot);
  await assert.rejects(writeManifest(f.filename, createBackupManifest(f.input)), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  assert.deepEqual(await readFile(f.filename), original);
});

test("manifest I/O refuses symlink files and ancestors without touching their targets", async (t) => {
  const f = await fixture(t), target = path.join(f.root, "private-target.json"), linkPath = path.join(f.root, "alias.json");
  await writeManifest(target, f.manifest); const original = await readFile(target);
  await symlink(target, linkPath);
  await assert.rejects(readManifest(linkPath), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  await assert.rejects(writeManifest(linkPath, f.manifest), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  const parent = path.join(f.root, "private-parent"); await mkdir(parent, { mode: 0o700 });
  await writeManifest(path.join(parent, "child.json"), f.manifest);
  const alias = path.join(f.root, "alias-parent"); await symlink(parent, alias);
  await assert.rejects(readManifest(path.join(alias, "child.json")), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  await assert.rejects(writeManifest(path.join(alias, "other.json"), f.manifest), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  assert.deepEqual(await readFile(target), original);
});

test("manifest I/O refuses hard links, public modes, unsafe parents and nonregular files", async (t) => {
  const f = await fixture(t); await writeManifest(f.filename, f.manifest);
  const alias = path.join(f.root, "hard.json"); await link(f.filename, alias);
  await assert.rejects(readManifest(f.filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE")); await unlink(alias);
  await chmod(f.filename, 0o640); await assert.rejects(readManifest(f.filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE")); await chmod(f.filename, 0o600);
  await chmod(f.root, 0o750);
  await assert.rejects(readManifest(f.filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  await assert.rejects(writeManifest(path.join(f.root, "other.json"), f.manifest), hasCode("BACKUP_MANIFEST_UNAVAILABLE")); await chmod(f.root, 0o700);
  const directory = path.join(f.root, "directory"); await mkdir(directory, { mode: 0o700 });
  await assert.rejects(readManifest(directory), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
});

test("bounded manifest reads reject oversized sparse files and noncanonical or malformed JSON", async (t) => {
  const f = await fixture(t); await writeManifest(f.filename, f.manifest);
  await truncate(f.filename, 64 * 1024 * 1024 + 1);
  await assert.rejects(readManifest(f.filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  for (const value of ["", "{private-secret-invalid", JSON.stringify(f.manifest, null, 2), `${JSON.stringify(f.manifest)}\n`,
    JSON.stringify(f.manifest).replace('"version":1', '"version":1,"version":1')]) {
    await writeFile(f.filename, value);
    await assert.rejects(readManifest(f.filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  }
});

test("a named pipe cannot block a manifest read", { skip: process.platform === "win32", timeout: 3000 }, async (t) => {
  const f = await fixture(t); execFileSync("mkfifo", ["-m", "600", f.filename], { timeout: 1000 });
  await assert.rejects(readManifest(f.filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
});

test("manifest failures never disclose paths, JSON, keys or filesystem causes", async (t) => {
  const f = await fixture(t);
  for (const filename of ["relative-private-secret", `${f.root}/../private-secret`, `${f.root}\0private-secret`, path.join(f.root, "missing-private-secret")]) {
    await assert.rejects(readManifest(filename), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
    if (filename.includes("missing")) continue;
    await assert.rejects(writeManifest(filename, f.manifest), hasCode("BACKUP_MANIFEST_UNAVAILABLE"));
  }
});

test("clone identities reject shared database, path, physical root, fingerprint and nested roots", async () => {
  const secret = randomBytes(32), storage = (value) => ({ rootIdentity: async () => Buffer.alloc(32, value), fingerprint: async () => Buffer.alloc(32, value + 1) });
  const source = await backupIdentity({ databaseName: "source_db", rootPath: "/private/source", storage: storage(10), mediaKey: secret });
  const clone = await backupIdentity({ databaseName: "clone_db", rootPath: "/private/clone", storage: storage(20), mediaKey: secret });
  assert.equal(assertCloneIdentity(source, clone), undefined);
  assert.doesNotMatch(JSON.stringify(source), /source_db|\/private|dev|ino/);
  for (const field of ["databaseTag", "rootPathTag", "rootPhysicalTag", "rootFingerprint"]) {
    assert.throws(() => assertCloneIdentity(source, { ...clone, [field]: source[field] }), hasCode("BACKUP_CLONE_REQUIRED"));
  }
  const nested = await backupIdentity({ databaseName: "nested_db", rootPath: "/private/source/child", storage: storage(30), mediaKey: secret });
  assert.throws(() => assertCloneIdentity(source, nested), hasCode("BACKUP_CLONE_REQUIRED"));
  assert.throws(() => assertCloneIdentity(nested, source), hasCode("BACKUP_CLONE_REQUIRED"));
  assert.notEqual(source.databaseTag, source.rootPathTag);
});

test("identity construction and clone comparison reject malformed tags, paths and storage acknowledgements", async () => {
  const input = { databaseName: "source_db", rootPath: "/private/source", mediaKey: randomBytes(32),
    storage: { rootIdentity: async () => Buffer.alloc(32, 1), fingerprint: async () => Buffer.alloc(32, 2) } };
  for (const changes of [{ databaseName: "../private" }, { databaseName: "" }, { rootPath: "/private/source/" }, { rootPath: "relative" },
    { mediaKey: Buffer.alloc(31) }, { storage: {} }, { storage: { ...input.storage, rootIdentity: async () => "private-path" } }]) {
    await assert.rejects(backupIdentity({ ...input, ...changes }), hasCode("BACKUP_IDENTITY_INVALID"));
  }
  assert.throws(() => assertCloneIdentity(identity(), { ...identity(), rootAncestors: [] }), hasCode("BACKUP_IDENTITY_INVALID"));
});

test("a case-only database alias cannot qualify as an isolated clone", async () => {
  const mediaKey = randomBytes(32);
  const source = await backupIdentity({ databaseName: "Jessie_Source", rootPath: "/private/source", mediaKey,
    storage: { rootIdentity: async () => Buffer.alloc(32, 1), fingerprint: async () => Buffer.alloc(32, 2) } });
  const target = await backupIdentity({ databaseName: "JESSIE_SOURCE", rootPath: "/private/target", mediaKey,
    storage: { rootIdentity: async () => Buffer.alloc(32, 3), fingerprint: async () => Buffer.alloc(32, 4) } });
  assert.equal(source.databaseTag, target.databaseTag);
  assert.throws(() => assertCloneIdentity(source, target), hasCode("BACKUP_CLONE_REQUIRED"));
});
