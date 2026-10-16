import { constants } from "node:fs";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDirectoryIdentities, withPrivateDirectory } from "../files/private-directory.mjs";
import { isOfficialOrigin, SITE_DOMAIN } from "../site.mjs";
import { mailConfiguration } from "../mail/config.mjs";

const BASENAME = "runtime-database.json";
const DIAGNOSTIC_BASENAME = "runtime-diagnostic.json";
const AUTHENTICATION_BASENAME = "runtime-auth.json";
const MESSAGING_BASENAME = "runtime-messaging.json";
const MEDIA_BASENAME = "runtime-media.json";
const MAX_BYTES = 16384;
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const FIELDS = ["format", "version", "host", "port", "database", "user", "password", "privilegeProfile"];
const DIAGNOSTIC_FIELDS = ["format", "version", "createdAt", "credentials"];
const AUTHENTICATION_FIELDS = ["format", "version", "origin", "mfaKey"];
const MESSAGING_FIELDS = ["format", "version", "origin", "mailKey", "messageKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword"];
const MEDIA_FIELDS = ["format", "version", "origin", "mediaKey", "mediaRoot", "ownerBytes", "totalBytes", "minimumFreeBytes"];
const FLAGS = ["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"];
const STAT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];

export class RuntimeDatabaseConfigurationError extends Error {
  constructor() {
    super("Private runtime database configuration is unavailable.");
    this.name = "RuntimeDatabaseConfigurationError";
    this.code = "RUNTIME_DATABASE_CONFIGURATION";
  }
}
export class RuntimeAuthenticationConfigurationError extends Error {
  constructor() {
    super("Private authentication configuration is unavailable.");
    this.name = "RuntimeAuthenticationConfigurationError";
    this.code = "RUNTIME_AUTH_CONFIGURATION";
  }
}
export class RuntimeMessagingConfigurationError extends Error {
  constructor() {
    super("Private messaging configuration is unavailable.");
    this.name = "RuntimeMessagingConfigurationError";
    this.code = "RUNTIME_MESSAGING_CONFIGURATION";
  }
}
const fail = () => { throw new RuntimeDatabaseConfigurationError(); };
const authenticationFailure = () => { throw new RuntimeAuthenticationConfigurationError(); };
const messagingFailure = () => { throw new RuntimeMessagingConfigurationError(); };
const inside = (filename, root) => {
  const suffix = path.relative(root, filename);
  return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${path.sep}`) && !path.isAbsolute(suffix);
};

function clearSecrets(value) {
  if (!value || typeof value !== "object") return;
  const nested = ["credentials", "database", "authentication", "messaging", "media"].map((name) => Object.getOwnPropertyDescriptor(value, name)?.value);
  for (const record of [value, ...nested]) {
    if (record && typeof record === "object") {
      for (const name of ["password", "mfaKey", "mailKey", "messageKey", "mediaKey", "smtpUser", "smtpPassword"]) {
        const descriptor = Object.getOwnPropertyDescriptor(record, name);
        if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) record[name] = "";
      }
    }
  }
}

export function validateRuntimeDatabaseConfiguration(value) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).sort().join(",") !== [...FIELDS].sort().join(",")) fail();
    const selected = {};
    for (const name of FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
      selected[name] = descriptor.value;
    }
    const { host, port, database, user, password, privilegeProfile } = selected;
    if (selected.format !== "jessiemessage-runtime-database" || selected.version !== 1
      || typeof host !== "string" || host.length > 253
      || (!isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
      || typeof port !== "string" || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535
      || typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)
      || typeof user !== "string" || !/^[a-zA-Z0-9_]{1,80}$/.test(user)
      || typeof password !== "string" || !password || !password.isWellFormed()
      || Buffer.byteLength(password, "utf8") > 4096 || /[\0\r\n]/.test(password)
      || !["strict", "infomaniak-shared", "infomaniak-shared-pattern"].includes(privilegeProfile)
      || privilegeProfile === "infomaniak-shared-pattern" && !database.includes("_")
      || Buffer.byteLength(JSON.stringify(selected), "utf8") + 1 > MAX_BYTES) fail();
    return selected;
  } catch { fail(); }
}

export function validateRuntimeDiagnosticConfiguration(value) {
  let selected;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).sort().join(",") !== [...DIAGNOSTIC_FIELDS].sort().join(",")) fail();
    selected = {};
    for (const name of DIAGNOSTIC_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
      // The nested source is untrusted and must never be cleared or mutated.
      if (name !== "credentials") selected[name] = descriptor.value;
      else selected.credentials = validateRuntimeDatabaseConfiguration(descriptor.value);
    }
    if (selected.format !== "jessiemessage-runtime-diagnostic" || selected.version !== 1
      || typeof selected.createdAt !== "string" || selected.createdAt.length > 27
      || new Date(selected.createdAt).toISOString() !== selected.createdAt
      || Buffer.byteLength(JSON.stringify(selected), "utf8") + 1 > MAX_BYTES) fail();
    return selected;
  } catch { clearSecrets(selected); fail(); }
}

export function validateRuntimeAuthenticationConfiguration(value) {
  let selected, decoded;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...AUTHENTICATION_FIELDS].sort().join(",")) authenticationFailure();
    selected = {};
    for (const name of AUTHENTICATION_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) authenticationFailure();
      selected[name] = descriptor.value;
    }
    if (selected.format !== "jessiemessage-runtime-auth" || selected.version !== 1
      || typeof selected.origin !== "string" || selected.origin.length > 512 || !isOfficialOrigin(selected.origin)
      || typeof selected.mfaKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(selected.mfaKey)) authenticationFailure();
    const origin = new URL(selected.origin);
    if (origin.hostname === SITE_DOMAIN || origin.hostname === `www.${SITE_DOMAIN}` || origin.port !== ""
      || origin.hostname.length > 253 || !origin.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) authenticationFailure();
    decoded = Buffer.from(selected.mfaKey, "base64url");
    if (decoded.length !== 32 || decoded.toString("base64url") !== selected.mfaKey
      || Buffer.byteLength(JSON.stringify(selected), "utf8") + 1 > MAX_BYTES) authenticationFailure();
    return selected;
  } catch { clearSecrets(selected); authenticationFailure(); }
  finally { decoded?.fill(0); }
}

export function validateRuntimeMessagingConfiguration(value) {
  let selected, authentication, mail, messageKey;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...MESSAGING_FIELDS].sort().join(",")) messagingFailure();
    selected = {};
    for (const name of MESSAGING_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) messagingFailure();
      selected[name] = descriptor.value;
    }
    if (selected.format !== "jessiemessage-runtime-messaging" || selected.version !== 1) messagingFailure();
    // Reuse the persisted auth origin/key syntax without inventing another URL
    // policy. This temporary metadata record is never saved or used as MFA.
    authentication = validateRuntimeAuthenticationConfiguration({ format: "jessiemessage-runtime-auth", version: 1,
      origin: selected.origin, mfaKey: selected.mailKey });
    mail = mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SITE_ORIGIN: selected.origin,
      JESSIEMESSAGE_MAIL_KEY: selected.mailKey, JESSIEMESSAGE_SMTP_HOST: selected.smtpHost,
      JESSIEMESSAGE_SMTP_PORT: selected.smtpPort, JESSIEMESSAGE_SMTP_USER: selected.smtpUser,
      JESSIEMESSAGE_SMTP_PASSWORD: selected.smtpPassword });
    if (typeof selected.messageKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(selected.messageKey)) messagingFailure();
    messageKey = Buffer.from(selected.messageKey, "base64url");
    if (messageKey.length !== 32 || messageKey.toString("base64url") !== selected.messageKey
      || messageKey.equals(mail.key) || Buffer.byteLength(JSON.stringify(selected), "utf8") + 1 > MAX_BYTES) messagingFailure();
    return selected;
  } catch { clearSecrets(selected); messagingFailure(); }
  finally { clearSecrets(authentication); mail?.key.fill(0); messageKey?.fill(0); }
}

export function runtimeDatabaseEnvironment(value) {
  const config = validateRuntimeDatabaseConfiguration(value);
  return {
    JESSIEMESSAGE_DB_HOST: config.host, JESSIEMESSAGE_DB_PORT: config.port,
    JESSIEMESSAGE_DB_NAME: config.database, JESSIEMESSAGE_APPLICATION_DATABASE: config.database,
    JESSIEMESSAGE_RUNTIME_DB_USER: config.user, JESSIEMESSAGE_RUNTIME_DB_PASSWORD: config.password,
    JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: config.privilegeProfile,
    JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd",
    ...Object.fromEntries(FLAGS.map((name) => [`JESSIEMESSAGE_ENABLE_${name}`, "0"])),
  };
}

export function validateRuntimeMediaConfiguration(value) {
  let selected, syntax;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...MEDIA_FIELDS].sort().join(",")) messagingFailure();
    selected = {};
    for (const name of MEDIA_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) messagingFailure();
      selected[name] = descriptor.value;
    }
    if (selected.format !== "jessiemessage-runtime-media" || selected.version !== 1) messagingFailure();
    // Reuse the canonical origin/key syntax; this metadata is never saved as MFA.
    syntax = validateRuntimeAuthenticationConfiguration({ format: "jessiemessage-runtime-auth", version: 1,
      origin: selected.origin, mfaKey: selected.mediaKey });
    const root = selected.mediaRoot;
    if (typeof root !== "string" || !path.isAbsolute(root) || root !== path.resolve(root) || root.length > 4096
      || /[\\\x00-\x1f\x7f]/.test(root) || inside(root, path.resolve(REPOSITORY)) || inside(path.resolve(REPOSITORY), root)) messagingFailure();
    for (const name of ["ownerBytes", "totalBytes", "minimumFreeBytes"]) {
      const amount = selected[name];
      if (typeof amount !== "string" || !/^(?:0|[1-9][0-9]{0,15})$/.test(amount) || !Number.isSafeInteger(Number(amount))
        || Number(amount) < (name === "minimumFreeBytes" ? 0 : 82) || Number(amount) > 1125899906842624) messagingFailure();
    }
    if (Number(selected.ownerBytes) > Number(selected.totalBytes) || Buffer.byteLength(JSON.stringify(selected), "utf8") + 1 > MAX_BYTES) messagingFailure();
    return selected;
  } catch { clearSecrets(selected); messagingFailure(); }
  finally { clearSecrets(syntax); }
}

async function privateScope(directory, callback) {
  try {
    if (typeof directory !== "string" || !path.isAbsolute(directory) || path.normalize(directory) !== directory
      || inside(directory, path.resolve(REPOSITORY))) fail();
    // These protected metadata reads confer no secret-file access capability.
    const protectedRoots = await Promise.all([REPOSITORY, path.join(REPOSITORY, "public")].map(async (root) => ({
      path: await realpath(root), identity: (await inspectDirectoryIdentities(path.resolve(root))).at(-1),
    })));
    return await withPrivateDirectory(directory, async (scope) => {
      const actual = await realpath(scope.path), stats = await scope.assertReady();
      if (protectedRoots.some((root) => inside(actual, root.path)
        || stats.dev === root.identity.dev && stats.ino === root.identity.ino)) fail();
      return callback(scope);
    });
  } catch { fail(); }
}

function regular(stats) {
  if (!stats.isFile() || typeof process.getuid !== "function" || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail();
}
const sameFile = (first, second) => first.dev === second.dev && first.ino === second.ino;
function sameSnapshot(first, second) {
  if (!STAT_FIELDS.every((name) => first[name] === second[name])) fail();
}
async function removeOwned(filename, identity) {
  const stats = await lstat(filename, { bigint: true }).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (!stats) return;
  if (!sameFile(stats, identity) || !stats.isFile()) fail();
  await unlink(filename);
}

async function writeConfiguration(directory, config, basename) {
  let contents;
  try {
    // Only typed entry points select these internal, fixed filenames.
    if (![BASENAME, DIAGNOSTIC_BASENAME, AUTHENTICATION_BASENAME, MESSAGING_BASENAME, MEDIA_BASENAME].includes(basename)) fail();
    contents = Buffer.from(`${JSON.stringify(config)}\n`, "utf8");
    if (contents.length > MAX_BYTES) fail();
    return await privateScope(directory, async (scope) => {
      const temporary = scope.file(`.${basename}.${randomBytes(16).toString("hex")}.tmp`), published = scope.file(basename);
      let file, identity;
      try {
        await scope.assertReady();
        file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        identity = await file.stat({ bigint: true });
        await file.chmod(0o600);
        regular(await file.stat({ bigint: true }));
        if (!sameFile(identity, await lstat(temporary, { bigint: true }))) fail();
        await file.writeFile(contents);
        await file.sync();
        const written = await file.stat({ bigint: true }); regular(written);
        if (written.size !== BigInt(contents.length) || !sameFile(identity, written)) fail();
        await file.close(); file = null;
        await scope.assertReady();
        const visible = await lstat(temporary, { bigint: true }); regular(visible); sameSnapshot(written, visible);
        // link() publishes a complete file atomically and refuses an existing name.
        // Never remove the published name: a failed fsync/close can be ambiguous.
        await link(temporary, published);
        await removeOwned(temporary, identity);
        const final = await lstat(published, { bigint: true }); regular(final);
        if (!sameFile(identity, final) || final.size !== BigInt(contents.length)) fail();
        await scope.sync();
        return { saved: true };
      } finally {
        try { await file?.close(); }
        finally { if (identity) await removeOwned(temporary, identity); }
      }
    });
  } catch { fail(); }
  finally { contents?.fill(0); }
}

export async function writeRuntimeDatabaseConfiguration(directory, value) {
  const config = validateRuntimeDatabaseConfiguration(value);
  try { return await writeConfiguration(directory, config, BASENAME); }
  finally { clearSecrets(config); }
}

export async function writeRuntimeDiagnosticConfiguration(directory, value) {
  const record = validateRuntimeDiagnosticConfiguration(value);
  try { return await writeConfiguration(directory, record, DIAGNOSTIC_BASENAME); }
  finally { clearSecrets(record); }
}

export async function writeRuntimeAuthenticationConfiguration(directory, value) {
  const record = validateRuntimeAuthenticationConfiguration(value);
  try { return await writeConfiguration(directory, record, AUTHENTICATION_BASENAME); }
  catch { authenticationFailure(); }
  finally { clearSecrets(record); }
}

export async function writeRuntimeMessagingConfiguration(directory, value) {
  const record = validateRuntimeMessagingConfiguration(value);
  try { return await writeConfiguration(directory, record, MESSAGING_BASENAME); }
  catch { messagingFailure(); }
  finally { clearSecrets(record); }
}

export async function writeRuntimeMediaConfiguration(directory, value) {
  const record = validateRuntimeMediaConfiguration(value);
  try { return await writeConfiguration(directory, record, MEDIA_BASENAME); }
  catch { messagingFailure(); }
  finally { clearSecrets(record); }
}

// Password rotation is separate from exclusive first publication. It may
// replace only the SMTP password, using the exact previously read record.
export async function replaceRuntimeMessagingSmtpPassword(directory, expected, smtpPassword) {
  let previous, replacement, contents;
  try {
    previous = validateRuntimeMessagingConfiguration(expected);
    replacement = validateRuntimeMessagingConfiguration({ ...previous, smtpPassword });
    contents = Buffer.from(`${JSON.stringify(replacement)}\n`, "utf8");
    return await privateScope(directory, async (scope) => {
      const published = scope.file(MESSAGING_BASENAME), lockName = scope.file(".runtime-messaging-smtp.lock");
      const temporary = scope.file(`.${MESSAGING_BASENAME}.${randomBytes(16).toString("hex")}.tmp`);
      let lock, lockIdentity, file, identity, current, readBack;
      try {
        lock = await open(lockName, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        lockIdentity = await lock.stat({ bigint: true }); regular(lockIdentity);
        const before = await lstat(published, { bigint: true }); regular(before);
        current = await readAnchoredConfiguration(scope, MESSAGING_BASENAME, validateRuntimeMessagingConfiguration);
        if (MESSAGING_FIELDS.some((name) => current[name] !== previous[name])) fail();
        sameSnapshot(before, await lstat(published, { bigint: true }));
        file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        identity = await file.stat({ bigint: true }); regular(identity);
        await file.writeFile(contents); await file.sync();
        const written = await file.stat({ bigint: true }); regular(written);
        if (!sameFile(identity, written) || written.size !== BigInt(contents.length)) fail();
        await file.close(); file = null;
        await scope.assertReady();
        regular(await lstat(lockName, { bigint: true }));
        if (!sameFile(lockIdentity, await lstat(lockName, { bigint: true }))) fail();
        sameSnapshot(written, await lstat(temporary, { bigint: true }));
        sameSnapshot(before, await lstat(published, { bigint: true }));
        await rename(temporary, published);
        const final = await lstat(published, { bigint: true }); regular(final);
        if (!sameFile(identity, final) || final.size !== BigInt(contents.length)) fail();
        await scope.sync();
        readBack = await readAnchoredConfiguration(scope, MESSAGING_BASENAME, validateRuntimeMessagingConfiguration);
        if (MESSAGING_FIELDS.some((name) => readBack[name] !== replacement[name])) fail();
        return { saved: true, keysPreserved: true };
      } finally {
        clearSecrets(current); clearSecrets(readBack);
        try { await file?.close(); }
        finally {
          try { if (identity) await removeOwned(temporary, identity); }
          finally {
            try { await lock?.close(); }
            finally { if (lockIdentity) { await removeOwned(lockName, lockIdentity); await scope.sync(); } }
          }
        }
      }
    });
  } catch { messagingFailure(); }
  finally { contents?.fill(0); clearSecrets(previous); clearSecrets(replacement); }
}

async function readAnchoredConfiguration(scope, basename, validate) {
  let result, file, parsed;
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  try {
    try {
      if (![BASENAME, DIAGNOSTIC_BASENAME, AUTHENTICATION_BASENAME, MESSAGING_BASENAME, MEDIA_BASENAME].includes(basename)) fail();
      const filename = scope.file(basename);
      await scope.assertReady();
      file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await file.stat({ bigint: true }); regular(before);
      if (before.size < 1n || before.size > BigInt(MAX_BYTES)) fail();
      let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > MAX_BYTES || BigInt(length) !== before.size) fail();
      const after = await file.stat({ bigint: true }); regular(after); sameSnapshot(before, after);
      const visible = await lstat(filename, { bigint: true }); regular(visible); sameSnapshot(after, visible);
      await scope.assertReady();
      const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
      parsed = JSON.parse(decoded);
      result = validate(parsed);
      return result;
    } finally { bytes.fill(0); clearSecrets(parsed); await file?.close(); }
  } catch { clearSecrets(result); fail(); }
}

async function readConfiguration(directory, basename, validate) {
  let result;
  try {
    return await privateScope(directory, async (scope) => {
      result = await readAnchoredConfiguration(scope, basename, validate);
      return result;
    });
  } catch { clearSecrets(result); fail(); }
}

export async function readRuntimeDatabaseConfiguration(directory) {
  return readConfiguration(directory, BASENAME, validateRuntimeDatabaseConfiguration);
}

export async function readRuntimeDiagnosticConfiguration(directory) {
  return readConfiguration(directory, DIAGNOSTIC_BASENAME, validateRuntimeDiagnosticConfiguration);
}

export async function readRuntimeAuthenticationConfiguration(directory) {
  try { return await readConfiguration(directory, AUTHENTICATION_BASENAME, validateRuntimeAuthenticationConfiguration); }
  catch { authenticationFailure(); }
}

export async function readRuntimeMessagingConfiguration(directory) {
  try { return await readConfiguration(directory, MESSAGING_BASENAME, validateRuntimeMessagingConfiguration); }
  catch { messagingFailure(); }
}

export async function readRuntimeMediaConfiguration(directory) {
  try { return await readConfiguration(directory, MEDIA_BASENAME, validateRuntimeMediaConfiguration); }
  catch { messagingFailure(); }
}

export async function runtimeMediaConfigurationExists(directory) {
  try {
    return await privateScope(directory, async (scope) => {
      await scope.assertReady();
      try { await lstat(scope.file(MEDIA_BASENAME), { bigint: true }); return true; }
      catch (error) { if (error.code === "ENOENT") return false; throw error; }
    });
  } catch { messagingFailure(); }
}

export async function runtimeMessagingConfigurationExists(directory) {
  try {
    return await privateScope(directory, async (scope) => {
      await scope.assertReady();
      try { await lstat(scope.file(MESSAGING_BASENAME), { bigint: true }); return true; }
      catch (error) { if (error.code === "ENOENT") return false; throw error; }
    });
  } catch { messagingFailure(); }
}

export async function runtimeAuthenticationConfigurationExists(directory) {
  try {
    return await privateScope(directory, async (scope) => {
      await scope.assertReady();
      try { await lstat(scope.file(AUTHENTICATION_BASENAME), { bigint: true }); return true; }
      catch (error) { if (error.code === "ENOENT") return false; throw error; }
    });
  } catch { authenticationFailure(); }
}

export async function readRuntimeAuthenticationBundle(directory) {
  let database, authentication;
  try {
    return await privateScope(directory, async (scope) => {
      database = await readAnchoredConfiguration(scope, BASENAME, validateRuntimeDatabaseConfiguration);
      authentication = await readAnchoredConfiguration(scope, AUTHENTICATION_BASENAME, validateRuntimeAuthenticationConfiguration);
      return { database, authentication };
    });
  } catch {
    clearSecrets(database); clearSecrets(authentication);
    authenticationFailure();
  }
}

export async function readRuntimeMessagingBundle(directory) {
  let database, authentication, messaging;
  try {
    return await privateScope(directory, async (scope) => {
      database = await readAnchoredConfiguration(scope, BASENAME, validateRuntimeDatabaseConfiguration);
      authentication = await readAnchoredConfiguration(scope, AUTHENTICATION_BASENAME, validateRuntimeAuthenticationConfiguration);
      messaging = await readAnchoredConfiguration(scope, MESSAGING_BASENAME, validateRuntimeMessagingConfiguration);
      if (messaging.origin !== authentication.origin || [messaging.mailKey, messaging.messageKey].includes(authentication.mfaKey)) messagingFailure();
      return { database, authentication, messaging };
    });
  } catch {
    clearSecrets(database); clearSecrets(authentication); clearSecrets(messaging);
    messagingFailure();
  }
}

export async function readRuntimeMediaBundle(directory) {
  let database, authentication, messaging, media;
  try {
    return await privateScope(directory, async (scope) => {
      database = await readAnchoredConfiguration(scope, BASENAME, validateRuntimeDatabaseConfiguration);
      authentication = await readAnchoredConfiguration(scope, AUTHENTICATION_BASENAME, validateRuntimeAuthenticationConfiguration);
      messaging = await readAnchoredConfiguration(scope, MESSAGING_BASENAME, validateRuntimeMessagingConfiguration);
      media = await readAnchoredConfiguration(scope, MEDIA_BASENAME, validateRuntimeMediaConfiguration);
      if (authentication.origin !== messaging.origin || authentication.origin !== media.origin
        || [messaging.mailKey, messaging.messageKey].includes(authentication.mfaKey)
        || [authentication.mfaKey, messaging.mailKey, messaging.messageKey].includes(media.mediaKey)) messagingFailure();
      return { database, authentication, messaging, media };
    });
  } catch {
    for (const record of [database, authentication, messaging, media]) clearSecrets(record);
    messagingFailure();
  }
}
