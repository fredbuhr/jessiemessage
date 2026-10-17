import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { validateRuntimeAuthenticationConfiguration, validateRuntimeDatabaseConfiguration, validateRuntimeMessagingConfiguration,
  validateRuntimeMediaConfiguration, validateRuntimeNotificationsConfiguration, validateRuntimeCrmConfiguration,
  validateRuntimeCrmBundle } from "../server/config/runtime-database-file.mjs";
import { readPassword } from "./migration-input.mjs";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
const FILES = ["runtime-auth.json", "admin-setup.json", "runtime-database.json"];
const MESSAGING_FILE = "runtime-messaging.json";
const MEDIA_FILE = "runtime-media.json";
const NOTIFICATIONS_FILE = "runtime-notifications.json";
const CRM_FILE = "runtime-crm.json";
const PRIMARY_CRM_PROFILE = "primary-crm";
const PRIMARY = Object.freeze({ originProfile: "primary" });
const FILE_LIMIT = 16384, PAYLOAD_LIMIT = 65536, CIPHER_LIMIT = 131072;
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const FORMAT = "jessiemessage-private-secrets-backup";
const CODES = new Set(["USAGE", "PASSWORD", "SOURCE", "OUTPUT", "GPG", "VERIFY", "OPERATION"].map((name) => `PRIVATE_SECRETS_${name}`));

export class PrivateSecretsBackupError extends Error {
  constructor(code) {
    const selected = CODES.has(code) ? code : "PRIVATE_SECRETS_OPERATION";
    super(selected); this.name = "PrivateSecretsBackupError"; this.code = selected;
  }
}
const fail = (code) => { throw new PrivateSecretsBackupError(code); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const inside = (filename, root) => { const suffix = relative(root, filename); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };

export function parseArguments(args) {
  if (!Array.isArray(args) || ![4, 6].includes(args.length)) fail("PRIVATE_SECRETS_USAGE");
  const selected = {}, names = new Map([["--private-directory", "privateDirectory"], ["--output", "output"], ["--profile", "profile"]]);
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value) fail("PRIVATE_SECRETS_USAGE");
    selected[name] = value;
  }
  const { privateDirectory, output } = selected;
  if (typeof privateDirectory !== "string" || typeof output !== "string"
    || selected.profile !== undefined && !["auth", "messaging", "messaging-photos", "messaging-photos-notify", PRIMARY_CRM_PROFILE].includes(selected.profile)
    || !privateDirectory.startsWith("/") || privateDirectory === "/" || privateDirectory.length > 4096
    || resolve(privateDirectory) !== privateDirectory || /[\\\x00-\x1f\x7f]/.test(privateDirectory)
    || inside(privateDirectory, REPOSITORY) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.json\.gpg$/.test(output)) fail("PRIVATE_SECRETS_USAGE");
  return { privateDirectory, output, ...(selected.profile === undefined ? {} : { profile: selected.profile }) };
}

function options(value) {
  if (!plain(value) || Object.getOwnPropertySymbols(value).length
    || !["output,privateDirectory", "output,privateDirectory,profile"].includes(Object.getOwnPropertyNames(value).sort().join(","))
    || ["privateDirectory", "output"].some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("PRIVATE_SECRETS_USAGE");
  const profile = Object.getOwnPropertyDescriptor(value, "profile");
  if (profile && !Object.hasOwn(profile, "value")) fail("PRIVATE_SECRETS_USAGE");
  return parseArguments(["--private-directory", value.privateDirectory, "--output", value.output,
    ...(profile ? ["--profile", profile.value] : [])]);
}

const sourceNames = (selected) => selected.profile === PRIMARY_CRM_PROFILE ? [FILES[0], FILES[2], MESSAGING_FILE, MEDIA_FILE, NOTIFICATIONS_FILE, CRM_FILE]
  : selected.profile === "messaging-photos-notify" ? [...FILES, MESSAGING_FILE, MEDIA_FILE, NOTIFICATIONS_FILE]
  : selected.profile === "messaging-photos" ? [...FILES, MESSAGING_FILE, MEDIA_FILE]
  : selected.profile === "messaging" ? [...FILES, MESSAGING_FILE] : FILES;
const payloadVersion = (selected) => selected.profile === PRIMARY_CRM_PROFILE ? 5 : selected.profile === "messaging-photos-notify" ? 4 : selected.profile === "messaging-photos" ? 3 : selected.profile === "messaging" ? 2 : 1;
const profileMetadata = selected => selected.profile === PRIMARY_CRM_PROFILE ? { profile: PRIMARY_CRM_PROFILE } : {};

// Refuse a new AUTH-only receipt that would omit already-prepared mail/chat
// secrets. Old three-file coffres remain valid and are never replaced.
async function assertNotificationsProfile(scope, selected) {
  if (["messaging-photos-notify", PRIMARY_CRM_PROFILE].includes(selected.profile)) return;
  await scope.assertReady();
  try { await lstat(scope.file(NOTIFICATIONS_FILE)); fail("PRIVATE_SECRETS_SOURCE"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function assertProfile(scope, selected) {
  if (selected.profile === PRIMARY_CRM_PROFILE) return;
  // A legacy new archive cannot silently omit the newly prepared CRM key.
  await scope.assertReady();
  try { await lstat(scope.file(CRM_FILE)); fail("PRIVATE_SECRETS_SOURCE"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await assertNotificationsProfile(scope, selected);
  if (["messaging-photos", "messaging-photos-notify"].includes(selected.profile)) return;
  await scope.assertReady();
  try { await lstat(scope.file(MEDIA_FILE)); fail("PRIVATE_SECRETS_SOURCE"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (selected.profile === "messaging") return;
  await scope.assertReady();
  try { await lstat(scope.file(MESSAGING_FILE)); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  fail("PRIVATE_SECRETS_SOURCE");
}

function passwordBytes(password) {
  if (typeof password !== "string" || !password.isWellFormed() || [...password].length < 20
    || Buffer.byteLength(password, "utf8") > 4096 || /[\0\r\n]/.test(password)) fail("PRIVATE_SECRETS_PASSWORD");
  return Buffer.from(password, "utf8");
}
function regular(stats) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail("PRIVATE_SECRETS_SOURCE");
}
function unchanged(first, second) {
  if (STATS.some((name) => first[name] !== second[name])) fail("PRIVATE_SECRETS_SOURCE");
}

async function readPrivateFile(scope, name, maximum = FILE_LIMIT, snapshots) {
  let handle; const bytes = Buffer.alloc(maximum + 1);
  try {
    await scope.assertReady();
    handle = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); regular(before);
    if (before.size < 1n || before.size > BigInt(maximum)) fail("PRIVATE_SECRETS_SOURCE");
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (BigInt(length) !== before.size || length > maximum) fail("PRIVATE_SECRETS_SOURCE");
    const after = await handle.stat({ bigint: true }); regular(after); unchanged(before, after);
    const visible = await lstat(scope.file(name), { bigint: true }); regular(visible); unchanged(after, visible);
    await scope.assertReady();
    snapshots?.push({ name, stats: after });
    return Buffer.from(bytes.subarray(0, length));
  } finally { bytes.fill(0); await handle?.close(); }
}

async function inspectPrivateFile(scope, name, expected) {
  let handle;
  try {
    await scope.assertReady();
    handle = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); regular(before);
    if (expected) unchanged(expected, before);
    if (before.size < 1n || before.size > BigInt(FILE_LIMIT)) fail("PRIVATE_SECRETS_SOURCE");
    const after = await handle.stat({ bigint: true }); regular(after); unchanged(before, after);
    unchanged(after, await lstat(scope.file(name), { bigint: true }));
    await scope.assertReady();
  } finally { await handle?.close(); }
}

async function inspectGpg() {
  const output = await new Promise((resolveResult, reject) => {
    execFile("/usr/bin/gpg", ["--no-options", "--homedir", "/", "--version"], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", maxBuffer: 8192, timeout: 5000,
    }, (error, stdout) => error ? reject(new PrivateSecretsBackupError("PRIVATE_SECRETS_GPG")) : resolveResult(stdout));
  });
  const version = /^gpg \(GnuPG\) (\d+)\.(\d+)\.(\d+)(?:[^\d]|$)/.exec(output);
  if (!version || Number(version[1]) !== 2 || Number(version[2]) < 2 || !output.includes("AES256") || !output.includes("SHA512")) fail("PRIVATE_SECRETS_GPG");
}

function validateSource(name, content, selected) {
  let value, validated;
  try {
    value = JSON.parse(content);
    const originOptions = selected.profile === PRIMARY_CRM_PROFILE ? PRIMARY : {};
    if (name === "runtime-auth.json") validated = validateRuntimeAuthenticationConfiguration(value, originOptions);
    else if (name === "runtime-database.json") validated = validateRuntimeDatabaseConfiguration(value);
    else if (name === MESSAGING_FILE) validated = validateRuntimeMessagingConfiguration(value, originOptions);
    else if (name === MEDIA_FILE) validated = validateRuntimeMediaConfiguration(value, originOptions);
    else if (name === NOTIFICATIONS_FILE) validated = validateRuntimeNotificationsConfiguration(value, originOptions);
    else if (name === CRM_FILE) validated = validateRuntimeCrmConfiguration(value, originOptions);
    else if (!plain(value) || value.schema !== "jessiemessage-admin-setup-v1" || !plain(value.totp)
      || typeof value.totp.secret !== "string" || !/^[A-Z2-7]{26,103}$/.test(value.totp.secret)
      || !Array.isArray(value.recoveryCodes) || value.recoveryCodes.length !== 8
      || value.recoveryCodes.some((code) => typeof code !== "string" || !/^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/.test(code))) fail("PRIVATE_SECRETS_SOURCE");
  } catch { fail("PRIVATE_SECRETS_SOURCE"); }
  finally {
    for (const record of [value, validated]) if (record && typeof record === "object") {
      for (const name of ["password", "mfaKey", "smtpUser", "smtpPassword", "mailKey", "messageKey", "mediaKey", "notificationKey", "vapidPrivateKey", "crmKey"]) if (Object.hasOwn(record, name)) record[name] = "";
      if (record.totp) { record.totp.secret = ""; record.totp.uri = ""; }
      if (record.recoveryCodes) record.recoveryCodes.fill("");
    }
  }
}

async function capture(scope, now, snapshots, selected) {
  const files = []; let payload;
  try {
    if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("PRIVATE_SECRETS_USAGE");
    for (const name of sourceNames(selected)) {
      let bytes;
      try {
        bytes = await readPrivateFile(scope, name, FILE_LIMIT, snapshots);
        const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        validateSource(name, content, selected);
        files.push({ name, encoding: "utf-8", content, sha256: digest(bytes) });
      } finally { bytes?.fill(0); }
    }
    await validatePhotoBundle(files, selected);
    payload = Buffer.from(JSON.stringify({ format: FORMAT, version: payloadVersion(selected),
      ...(["messaging", "messaging-photos", "messaging-photos-notify", PRIMARY_CRM_PROFILE].includes(selected.profile) ? { profile: selected.profile } : {}),
      createdAt: new Date(now).toISOString(), applicationVersion: "0.24.0", files }) + "\n", "utf8");
    if (payload.length > PAYLOAD_LIMIT) fail("PRIVATE_SECRETS_SOURCE");
    return payload;
  } catch (error) { payload?.fill(0); throw error; }
  finally { for (const file of files) file.content = ""; }
}

async function validatePhotoBundle(files, selected) {
  if (!["messaging-photos", "messaging-photos-notify", PRIMARY_CRM_PROFILE].includes(selected.profile)) return;
  let records, env, crmBundle;
  try {
    records = Object.fromEntries(files.filter(file => file.name !== "admin-setup.json").map(file => [file.name, JSON.parse(file.content)]));
    const primaryCrm = selected.profile === PRIMARY_CRM_PROFILE;
    const notifications = primaryCrm || selected.profile === "messaging-photos-notify";
    const baseBundle = {
      database: records["runtime-database.json"], authentication: records["runtime-auth.json"], messaging: records[MESSAGING_FILE], media: records[MEDIA_FILE],
      ...(notifications ? { notifications: records[NOTIFICATIONS_FILE] } : {}) };
    env = await (notifications ? loadRuntimeNotificationsEnvironment : loadRuntimeMediaEnvironment)(selected.privateDirectory,
      primaryCrm ? { ...PRIMARY, recovery: true } : {}, { readBundle: async () => baseBundle });
    if (primaryCrm) crmBundle = validateRuntimeCrmBundle({ ...baseBundle, crm: records[CRM_FILE] }, PRIMARY);
  } catch { fail("PRIVATE_SECRETS_SOURCE"); }
  finally { clearRuntimeMessagingSecrets(env); for (const value of [...Object.values(records ?? {}), ...Object.values(crmBundle ?? {})]) clearRuntimeMessagingSecrets(value); }
}

async function absent(scope, name) {
  await scope.assertReady();
  try { await lstat(scope.file(name)); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  fail("PRIVATE_SECRETS_OUTPUT");
}

async function privateScope(selected, callback) {
  return withPrivateDirectory(selected.privateDirectory, async (scope) => {
    const actual = await realpath(scope.path);
    if (inside(actual, await realpath(REPOSITORY))) fail("PRIVATE_SECRETS_USAGE");
    await absent(scope, selected.output);
    return callback(scope);
  });
}

async function gpg(scope, homeFd, mode, input, password) {
  if (!Number.isSafeInteger(homeFd) || homeFd < 0) fail("PRIVATE_SECRETS_GPG");
  const args = ["--no-options", "--batch", "--no-tty", "--pinentry-mode", "loopback", "--no-symkey-cache", "--no-autostart",
    "--homedir", "/proc/self/fd/4", "--passphrase-fd", "3", "--status-fd", "5", "--output", "-"];
  if (mode === "encrypt") args.push("--compress-algo", "none", "--cipher-algo", "AES256", "--s2k-mode", "3", "--s2k-digest-algo", "SHA512", "--s2k-count", "65011712", "--force-mdc", "--symmetric");
  else args.push("--decrypt");
  const maximum = mode === "encrypt" ? CIPHER_LIMIT : PAYLOAD_LIMIT;
  await scope.assertReady();
  return new Promise((resolveResult, reject) => {
    const output = [], status = []; let size = 0, statusSize = 0, failure = false, child;
    const abort = () => { failure = true; child?.kill("SIGKILL"); };
    try {
      child = spawn("/usr/bin/gpg", args, { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
        stdio: ["pipe", "pipe", "ignore", "pipe", homeFd, "pipe"], cwd: "/" });
    } catch { reject(new PrivateSecretsBackupError("PRIVATE_SECRETS_GPG")); return; }
    const timer = setTimeout(abort, 30000);
    child.on("error", abort);
    child.stdin.on("error", abort); child.stdio[3].on("error", abort);
    child.stdout.on("error", abort); child.stdio[5].on("error", abort);
    child.stdout.on("data", (bytes) => { size += bytes.length; if (size > maximum || failure) { bytes.fill(0); abort(); } else output.push(bytes); });
    child.stdio[5].on("data", (bytes) => { statusSize += bytes.length; if (statusSize > 16384 || failure) { bytes.fill(0); abort(); } else status.push(bytes); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      let result;
      try {
        if (failure || code !== 0 || signal !== null || size < 1) fail("PRIVATE_SECRETS_GPG");
        const state = Buffer.concat(status).toString("ascii");
        if (mode === "decrypt" && (!state.includes("[GNUPG:] GOODMDC\n") || !state.includes("[GNUPG:] DECRYPTION_OKAY\n"))) fail("PRIVATE_SECRETS_VERIFY");
        result = Buffer.concat(output); resolveResult(result);
      } catch { result?.fill(0); reject(new PrivateSecretsBackupError(mode === "decrypt" ? "PRIVATE_SECRETS_VERIFY" : "PRIVATE_SECRETS_GPG")); }
      finally { for (const bytes of [...output, ...status]) bytes.fill(0); }
    });
    child.stdin.end(input); child.stdio[3].end(password);
  });
}

async function isolatedGpg(scope, callback) {
  const homeName = `.secrets-gpg-${randomBytes(16).toString("hex")}`, home = scope.file(homeName);
  let identity, handle, result, failure;
  try {
    await mkdir(home, { mode: 0o700 }); await chmod(home, 0o700);
    handle = await open(home, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    identity = await handle.stat({ bigint: true });
    if (!identity.isDirectory() || identity.uid !== BigInt(process.getuid()) || (identity.mode & 0o7777n) !== 0o700n) fail("PRIVATE_SECRETS_GPG");
    const visible = await lstat(home, { bigint: true });
    if (visible.dev !== identity.dev || visible.ino !== identity.ino) fail("PRIVATE_SECRETS_GPG");
    result = await callback(handle.fd);
  } catch (error) { failure = error; }
  finally {
    try {
      if (identity) {
        const final = await lstat(home, { bigint: true });
        if (!final.isDirectory() || final.dev !== identity.dev || final.ino !== identity.ino || final.uid !== identity.uid || final.mode !== identity.mode) fail("PRIVATE_SECRETS_GPG");
        const anchoredHome = `/proc/self/fd/${handle.fd}`, names = await readdir(anchoredHome);
        // Only these ordinary GPG bookkeeping files were observed. Never
        // recurse or erase an unknown artifact after a failed subprocess.
        if (names.some((name) => !["pubring.kbx", "random_seed"].includes(name))) fail("PRIVATE_SECRETS_GPG");
        const records = [];
        for (const name of names) {
          const filename = `${anchoredHome}/${name}`, stats = await lstat(filename, { bigint: true }); regular(stats);
          records.push({ filename, stats });
        }
        for (const record of records) {
          const current = await lstat(record.filename, { bigint: true }); regular(current); unchanged(record.stats, current);
          await unlink(record.filename);
        }
        await handle.sync();
        const current = await lstat(home, { bigint: true });
        if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) fail("PRIVATE_SECRETS_GPG");
        await rmdir(home); await scope.sync();
      }
    } catch { failure = new PrivateSecretsBackupError("PRIVATE_SECRETS_GPG"); }
    finally { try { await handle?.close(); } catch { failure = new PrivateSecretsBackupError("PRIVATE_SECRETS_GPG"); } }
  }
  if (failure) { if (Buffer.isBuffer(result)) result.fill(0); throw failure; }
  return result;
}

async function publish(scope, name, ciphertext) {
  let handle;
  try {
    await scope.assertReady();
    handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const first = await handle.stat({ bigint: true }); regular(first);
    await handle.writeFile(ciphertext); await handle.sync();
    const written = await handle.stat({ bigint: true }); regular(written);
    if (written.dev !== first.dev || written.ino !== first.ino || written.size !== BigInt(ciphertext.length)) fail("PRIVATE_SECRETS_OUTPUT");
    unchanged(written, await lstat(scope.file(name), { bigint: true }));
    await handle.close(); handle = null; await scope.sync();
    const saved = await readPrivateFile(scope, name, CIPHER_LIMIT);
    try { if (!saved.equals(ciphertext)) fail("PRIVATE_SECRETS_OUTPUT"); } finally { saved.fill(0); }
  } catch { fail("PRIVATE_SECRETS_OUTPUT"); }
  finally { await handle?.close(); }
}

/** No database access or server change. Existing files are never overwritten. */
export async function check(value) {
  try {
    const selected = options(value);
    return await privateScope(selected, async (scope) => {
      await assertProfile(scope, selected);
      for (const name of sourceNames(selected)) await inspectPrivateFile(scope, name);
      await inspectGpg();
      await assertProfile(scope, selected);
      return { status: "checked", ...profileMetadata(selected), files: sourceNames(selected).length, sourceContentsRead: false, gpgAvailable: true, secretsOnly: true, databaseBackup: false };
    });
  } catch (error) { if (error instanceof PrivateSecretsBackupError) throw error; fail("PRIVATE_SECRETS_SOURCE"); }
}

export async function run(value, password) {
  let pass, payload, ciphertext, decrypted;
  try {
    const selected = options(value); pass = passwordBytes(password); password = "";
    return await privateScope(selected, async (scope) => {
      await assertProfile(scope, selected);
      const snapshots = [];
      payload = await capture(scope, Date.now(), snapshots, selected);
      for (const record of snapshots) await inspectPrivateFile(scope, record.name, record.stats);
      ciphertext = await isolatedGpg(scope, async (homeFd) => {
        const encrypted = await gpg(scope, homeFd, "encrypt", payload, pass);
        try {
          decrypted = await gpg(scope, homeFd, "decrypt", encrypted, pass);
          if (!payload.equals(decrypted)) fail("PRIVATE_SECRETS_VERIFY");
          return encrypted;
        } catch (error) { encrypted.fill(0); throw error; }
        finally { decrypted?.fill(0); decrypted = undefined; }
      });
      await assertProfile(scope, selected);
      for (const record of snapshots) await inspectPrivateFile(scope, record.name, record.stats);
      await publish(scope, selected.output, ciphertext);
      await assertProfile(scope, selected);
      for (const record of snapshots) await inspectPrivateFile(scope, record.name, record.stats);
      return { status: "saved", ...profileMetadata(selected), output: selected.output, files: sourceNames(selected).length, bytes: ciphertext.length, sha256: digest(ciphertext),
        encrypted: true, verified: true, secretsOnly: true, databaseBackup: false };
    });
  } catch (error) { if (error instanceof PrivateSecretsBackupError) throw error; fail("PRIVATE_SECRETS_OPERATION"); }
  finally { password = ""; for (const bytes of [pass, payload, ciphertext, decrypted]) bytes?.fill(0); }
}

/** Verification seam for synthetic fixtures; no decrypted data is returned. */
export async function verifyCiphertext(value, ciphertext, password) {
  let pass, decrypted, parsed;
  try {
    const selected = options(value); pass = passwordBytes(password); password = "";
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 1 || ciphertext.length > CIPHER_LIMIT) fail("PRIVATE_SECRETS_VERIFY");
    return await privateScope(selected, async (scope) => isolatedGpg(scope, async (homeFd) => {
      await assertNotificationsProfile(scope, selected);
      decrypted = await gpg(scope, homeFd, "decrypt", ciphertext, pass);
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted));
      const names = sourceNames(selected), messaging = ["messaging", "messaging-photos", "messaging-photos-notify", PRIMARY_CRM_PROFILE].includes(selected.profile);
      if (!plain(parsed) || parsed.format !== FORMAT || parsed.version !== payloadVersion(selected)
        || messaging && parsed.profile !== selected.profile || !Array.isArray(parsed.files) || parsed.files.length !== names.length) fail("PRIVATE_SECRETS_VERIFY");
      for (let index = 0; index < names.length; index += 1) {
        const file = parsed.files[index];
        if (!plain(file) || file.name !== names[index] || file.encoding !== "utf-8" || typeof file.content !== "string"
          || digest(Buffer.from(file.content, "utf8")) !== file.sha256) fail("PRIVATE_SECRETS_VERIFY");
        validateSource(file.name, file.content, selected);
      }
      await validatePhotoBundle(parsed.files, selected);
      return { verified: true, ...profileMetadata(selected), files: names.length, secretsOnly: true, databaseBackup: false };
    }));
  } catch (error) { if (error instanceof PrivateSecretsBackupError) throw error; fail("PRIVATE_SECRETS_VERIFY"); }
  finally { password = ""; pass?.fill(0); decrypted?.fill(0); for (const file of Array.isArray(parsed?.files) ? parsed.files : []) if (file && typeof file === "object") file.content = ""; }
}

export async function main(args = process.argv.slice(2), { inputStream = process.stdin, outputStream = process.stdout } = {}) {
  let password = "";
  try {
    const metadataOnly = args[0] === "check", selected = parseArguments(metadataOnly ? args.slice(1) : args);
    const checked = await check(selected);
    if (metadataOnly) { outputStream.write(`${JSON.stringify(checked)}\n`); return checked; }
    try { password = await readPassword(inputStream); } catch { fail("PRIVATE_SECRETS_PASSWORD"); }
    const result = await run(selected, password);
    outputStream.write(`${JSON.stringify(result)}\n`); return result;
  } finally { password = ""; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const code = error instanceof PrivateSecretsBackupError ? error.code : "PRIVATE_SECRETS_OPERATION";
    process.stdout.write(`${JSON.stringify({ status: "blocked", error: code, secretsOnly: true, databaseBackup: false })}\n`);
    process.stderr.write(`${code}: Private secrets backup was not confirmed; preserve existing private files.\n`);
    process.exitCode = 1;
  }
}
