// Offline, one-shot operator preparation. No SQL, listener, worker or Manager action.
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const PRIVATE = "/srv/customer/jessiemessage-private";
const NODE_PATH = `${PRIVATE}/runtime-node-v24.22.1/bin/node`;
const NODE_SHA256 = "e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb";
export const DEFAULTS = Object.freeze({
  sourceCheckout: "/srv/customer/jessiemessage-operator/production-180-fd6e53b1",
  sourceDirectory: `${PRIVATE}/primary-origin-candidate-4a355851`,
  targetDirectory: `${PRIVATE}/runtime-video-180`, videoRoot: `${PRIVATE}/video-180`,
  ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912",
});
const PINS = Object.freeze([
  { version: "1.7.1", directory: "/srv/customer/jessiemessage-operator/production-171-c2d7b3b3", commit: "c2d7b3b31c6d0955892829f808dc4135d7d8debf", tree: "d4945207f25375abb5d89c3a23ae91b6e34ea115" },
  { version: "1.8.0", directory: DEFAULTS.sourceCheckout, commit: "fd6e53b14b520231b0b307a2761331dd8c740a5b", tree: "324c3563fc6b1cfce669bcf58d90962c23c966b8" },
]);
export const BASE_NAMES = Object.freeze(["runtime-database.json", "runtime-auth.json", "runtime-messaging.json", "runtime-media.json", "runtime-notifications.json", "runtime-crm.json"].sort());
export const BUNDLE_NAMES = Object.freeze([...BASE_NAMES, "runtime-video.json"].sort());
const PRIMARY = Object.freeze({ originProfile: "primary" });
const RUNTIME = Object.freeze({ originProfile: "primary", recovery: true });
const STAT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const fail = code => { throw Object.assign(new Error("Video runtime preparation was not confirmed."), { code: `VIDEO180_${code}` }); };
const contains = (a, b) => { const suffix = relative(a, b); return suffix === "" || suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix); };
const same = (a, b) => STAT_FIELDS.every(name => a[name] === b[name]);
const safePath = value => typeof value === "string" && isAbsolute(value) && value !== "/" && resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value);
function regular(stat) {
  if (!stat.isFile() || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o7777n) !== 0o600n || stat.nlink !== 1n || stat.size < 1n || stat.size > 16384n) fail("PRIVATE_FILE");
}
async function readPrivate(scope, name) {
  let handle, result;
  try {
    await scope.assertReady();
    const visible = await lstat(scope.file(name), { bigint: true }); regular(visible);
    handle = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); regular(before); if (!same(visible, before)) fail("FILE_CHANGED");
    result = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < result.length) { const part = await handle.read(result, length, result.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await handle.stat({ bigint: true }), final = await lstat(scope.file(name), { bigint: true }); regular(after); regular(final);
    if (length !== Number(before.size) || !same(before, after) || !same(after, final)) fail("FILE_CHANGED");
    await scope.assertReady(); return Buffer.from(result.subarray(0, length));
  } finally { result?.fill(0); await handle?.close(); }
}
async function writePrivate(scope, name, bytes) {
  let handle;
  try {
    await scope.assertReady();
    handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    await handle.writeFile(bytes); await handle.sync();
    const stat = await handle.stat({ bigint: true }); regular(stat);
    if (stat.size !== BigInt(bytes.length) || !same(stat, await lstat(scope.file(name), { bigint: true }))) fail("PUBLICATION");
  } finally { await handle?.close(); }
  await scope.sync(); const back = await readPrivate(scope, name);
  try { if (!back.equals(bytes)) fail("PUBLICATION"); } finally { back.fill(0); }
}
async function absent(path) {
  try { await lstat(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  fail("EXISTS");
}
/** SHA256(name UTF8, NUL, byteLength ASCII, NUL, exact bytes), sorted fixed names. */
export function computeBundleFingerprint(files) {
  if (!(files instanceof Map) || [...files.keys()].sort().join("\n") !== BUNDLE_NAMES.join("\n")) fail("FINGERPRINT");
  const hash = createHash("sha256");
  for (const name of BUNDLE_NAMES) {
    const bytes = files.get(name); if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 16384) fail("FINGERPRINT");
    hash.update(name, "utf8").update("\0").update(String(bytes.length), "ascii").update("\0").update(bytes);
  }
  return hash.digest("hex");
}
async function loadApis(checkout) {
  const at = file => import(pathToFileURL(`${checkout}/${file}`).href);
  const [files, paths, video, storage, messaging] = await Promise.all([
    at("server/config/runtime-database-file.mjs"), at("server/files/private-directory.mjs"),
    at("server/config/runtime-video.mjs"), at("server/config/runtime-video-storage.mjs"), at("server/config/runtime-messaging.mjs"),
  ]);
  return { ...files, ...paths, ...video, ...storage, ...messaging };
}
async function assertQualifiedSources() {
  for (const pin of PINS) {
    const stat = await lstat(pin.directory); if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(pin.directory) !== pin.directory) fail("SOURCE_PIN");
    const git = async args => (await exec("/usr/bin/git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", pin.directory, ...args],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
    if (await git(["rev-parse", "HEAD"]) !== pin.commit || await git(["rev-parse", "HEAD^{tree}"]) !== pin.tree
      || await git(["rev-parse", `refs/tags/v${pin.version}^{commit}`]) !== pin.commit
      || await git(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail("SOURCE_PIN");
  }
}
async function assertQualifiedNode() {
  if (process.execPath !== NODE_PATH || await realpath(NODE_PATH) !== NODE_PATH) fail("NODE_PIN");
  let handle; const block = Buffer.alloc(65536);
  const nodeFile = stat => stat.isFile() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o7777n) === 0o700n
    && stat.nlink === 1n && stat.size > 0n && stat.size <= 268435456n;
  try {
    const visible = await lstat(NODE_PATH, { bigint: true }); if (!nodeFile(visible)) fail("NODE_PIN");
    handle = await open(NODE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); if (!nodeFile(before) || !same(visible, before)) fail("NODE_PIN");
    const digest = createHash("sha256"); let bytes = 0;
    for (;;) {
      const part = await handle.read(block, 0, block.length, bytes); if (!part.bytesRead) break;
      bytes += part.bytesRead; if (bytes > Number(before.size)) fail("NODE_PIN"); digest.update(block.subarray(0, part.bytesRead));
    }
    const after = await handle.stat({ bigint: true }), final = await lstat(NODE_PATH, { bigint: true });
    if (bytes !== Number(before.size) || !same(before, after) || !same(after, final) || digest.digest("hex") !== NODE_SHA256) fail("NODE_PIN");
  } finally { block.fill(0); await handle?.close(); }
}
/** Internal dependencies are test seams; the CLI exposes no path/pin override. */
export async function run(options = DEFAULTS, internal = {}) {
  const fields = Object.keys(DEFAULTS).sort();
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).length !== fields.length
    || fields.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) fail("USAGE");
  const selected = Object.fromEntries(fields.map(name => [name, options[name]]));
  if (["sourceCheckout", "sourceDirectory", "targetDirectory", "videoRoot"].some(name => !safePath(selected[name]))) fail("USAGE");
  for (const [a, b] of [[selected.sourceDirectory, selected.targetDirectory], [selected.sourceDirectory, selected.videoRoot], [selected.targetDirectory, selected.videoRoot]]) {
    if (contains(a, b) || contains(b, a)) fail("PATH_OVERLAP");
  }
  // Production can only use the immutable defaults. Test overrides require an
  // explicit injected qualification function and never reach the CLI.
  if (!internal.assertSources && JSON.stringify(selected) !== JSON.stringify(Object.fromEntries(fields.map(name => [name, DEFAULTS[name]])))) fail("SOURCE_PIN");
  await (internal.assertSources ?? assertQualifiedSources)();
  const api = await (internal.loadApis ?? loadApis)(selected.sourceCheckout), sourceFiles = new Map(), targetFiles = new Map();
  let source, candidate, verified, env, key, phase = "preconditions", rootCreated = false, bundleCreated = false;
  try {
    await absent(selected.targetDirectory); await absent(selected.videoRoot);
    source = await api.readRuntimeCrmBundle(selected.sourceDirectory, PRIMARY);
    await api.withPrivateDirectory(selected.sourceDirectory, async scope => {
      for (const name of BASE_NAMES) sourceFiles.set(name, await readPrivate(scope, name));
    });
    key = (internal.random ?? randomBytes)(32);
    if (!Buffer.isBuffer(key) || key.length !== 32) fail("KEY");
    const video = { format: "jessiemessage-runtime-video", version: 1, origin: source.authentication.origin,
      videoKey: key.toString("base64url"), videoRoot: selected.videoRoot, ownerBytes: selected.ownerBytes,
      totalBytes: selected.totalBytes, minimumFreeBytes: selected.minimumFreeBytes };
    candidate = api.validateRuntimeVideoBundle({ ...source, video }, PRIMARY);
    const photoRoot = candidate.media.mediaRoot;
    if (contains(photoRoot, selected.videoRoot) || contains(selected.videoRoot, photoRoot)
      || contains(photoRoot, selected.targetDirectory) || contains(selected.targetDirectory, photoRoot)) fail("PATH_OVERLAP");
    // Both targets are checked before the first publication; mkdir is exclusive.
    await absent(selected.targetDirectory); await absent(selected.videoRoot);
    phase = "video_root_publication";
    await api.withPrivateDirectory(dirname(selected.videoRoot), async scope => {
      await scope.assertReady(); await mkdir(scope.file(basename(selected.videoRoot)), { mode: 0o700 }); rootCreated = true; await scope.sync();
    });
    await api.withPrivateDirectory(selected.videoRoot, async scope => { if ((await readdir(scope.path)).length) fail("VIDEO_ROOT_NOT_EMPTY"); });
    await api.assertDistinctVideoRoots(photoRoot, selected.videoRoot);
    phase = "bundle_publication";
    await api.withPrivateDirectory(dirname(selected.targetDirectory), async scope => {
      await scope.assertReady(); await mkdir(scope.file(basename(selected.targetDirectory)), { mode: 0o700 }); bundleCreated = true; await scope.sync();
    });
    await api.withPrivateDirectory(selected.targetDirectory, async scope => {
      for (const name of BASE_NAMES) await writePrivate(scope, name, sourceFiles.get(name));
    });
    if ((await api.writeRuntimeVideoConfiguration(selected.targetDirectory, video, PRIMARY))?.saved !== true) fail("PUBLICATION");
    phase = "verification";
    env = await api.loadRuntimeVideoEnvironment(selected.targetDirectory, RUNTIME);
    verified = await api.readRuntimeVideoBundle(selected.targetDirectory, PRIMARY);
    if (!isDeepStrictEqual(candidate, verified)) fail("PUBLICATION");
    const checked = api.runtimeVideoConfiguration(env); checked.key.fill(0);
    await api.assertDistinctVideoRoots(photoRoot, selected.videoRoot);
    await api.withPrivateDirectory(selected.videoRoot, async scope => { if ((await readdir(scope.path)).length) fail("VIDEO_ROOT_NOT_EMPTY"); });
    await api.withPrivateDirectory(selected.sourceDirectory, async scope => {
      for (const name of BASE_NAMES) { const current = await readPrivate(scope, name); try { if (!current.equals(sourceFiles.get(name))) fail("SOURCE_CHANGED"); } finally { current.fill(0); } }
    });
    await api.withPrivateDirectory(selected.targetDirectory, async scope => {
      if ((await readdir(scope.path)).sort().join("\n") !== BUNDLE_NAMES.join("\n")) fail("PUBLICATION");
      for (const name of BUNDLE_NAMES) { const bytes = await readPrivate(scope, name); targetFiles.set(name, bytes);
        if (sourceFiles.has(name) && !bytes.equals(sourceFiles.get(name))) fail("PUBLICATION"); }
    });
    const bundleFingerprintSha256 = computeBundleFingerprint(targetFiles);
    return { status: "video180_runtime_prepared", files: 7, existingConfigurationsByteExact: true, keysPreserved: true,
      independentVideoKey: true, emptyVideoRoot: true, bundleFingerprintSha256,
      quotas: { ownerBytes: selected.ownerBytes, totalBytes: selected.totalBytes, minimumFreeBytes: selected.minimumFreeBytes },
      source: PINS[1].commit, tree: PINS[1].tree, sqlConnected: false, schemaInitialized: false,
      runtimeStarted: false, managerChanged: false, checkpointChanged: false };
  } catch (error) {
    throw Object.assign(new Error("Video runtime preparation was not confirmed; preserve any published targets for inspection."), {
      code: /^VIDEO180_[A-Z_]+$/.test(error?.code ?? "") ? error.code : "VIDEO180_PREPARATION",
      phase, rootCreated, bundleCreated, publishedTargetsPreserved: true, noAutomaticRetry: true,
    });
  } finally {
    if (Buffer.isBuffer(key)) key.fill(0); for (const bytes of [...sourceFiles.values(), ...targetFiles.values()]) bytes.fill(0);
    api.clearRuntimeMessagingSecrets(env);
    for (const bundle of [source, candidate, verified]) for (const name of ["database", "authentication", "messaging", "media", "notifications", "crm", "video"]) api.clearRuntimeMessagingSecrets(bundle?.[name]);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== "--prepare-video-bundle" || process.version !== "v24.22.1") fail("USAGE");
  const forbidden = ["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"];
  if (process.execArgv.length || Object.keys(process.env).some(name => forbidden.includes(name) || name.startsWith("JESSIEMESSAGE_") && name !== "JESSIEMESSAGE_PRIVATE_PATH_MODE")
    || process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE !== "linux-dirfd") fail("ENVIRONMENT");
  await assertQualifiedNode();
  const result = await run(); process.stdout.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: "video180_runtime_not_prepared", code: /^VIDEO180_[A-Z_]+$/.test(error?.code ?? "") ? error.code : "VIDEO180_PREPARATION",
    phase: error?.phase ?? "preconditions", rootCreated: error?.rootCreated === true, bundleCreated: error?.bundleCreated === true,
    publishedTargetsPreserved: true, noAutomaticRetry: true, sqlConnected: false, runtimeStarted: false })}\n`); process.exitCode = 1; }
}
