import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDirectoryIdentities, withPrivateDirectory } from "../files/private-directory.mjs";

const BASENAME = "runtime-database.json";
const DIAGNOSTIC_BASENAME = "runtime-diagnostic.json";
const MAX_BYTES = 16384;
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const FIELDS = ["format", "version", "host", "port", "database", "user", "password", "privilegeProfile"];
const DIAGNOSTIC_FIELDS = ["format", "version", "createdAt", "credentials"];
const FLAGS = ["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"];
const STAT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];

export class RuntimeDatabaseConfigurationError extends Error {
  constructor() {
    super("Private runtime database configuration is unavailable.");
    this.name = "RuntimeDatabaseConfigurationError";
    this.code = "RUNTIME_DATABASE_CONFIGURATION";
  }
}
const fail = () => { throw new RuntimeDatabaseConfigurationError(); };
const inside = (filename, root) => {
  const suffix = path.relative(root, filename);
  return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${path.sep}`) && !path.isAbsolute(suffix);
};

function clearSecrets(value) {
  if (!value || typeof value !== "object") return;
  const nested = Object.getOwnPropertyDescriptor(value, "credentials")?.value;
  for (const record of [value, nested]) {
    if (record && typeof record === "object") {
      const descriptor = Object.getOwnPropertyDescriptor(record, "password");
      if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) record.password = "";
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
      || !["strict", "infomaniak-shared"].includes(privilegeProfile)
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
    // Only the two typed entry points select these internal, fixed filenames.
    if (basename !== BASENAME && basename !== DIAGNOSTIC_BASENAME) fail();
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

async function readConfiguration(directory, basename, validate) {
  let result;
  try {
    if (basename !== BASENAME && basename !== DIAGNOSTIC_BASENAME) fail();
    return await privateScope(directory, async (scope) => {
      const filename = scope.file(basename);
      let file, parsed;
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      try {
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
    });
  } catch { clearSecrets(result); fail(); }
}

export async function readRuntimeDatabaseConfiguration(directory) {
  return readConfiguration(directory, BASENAME, validateRuntimeDatabaseConfiguration);
}

export async function readRuntimeDiagnosticConfiguration(directory) {
  return readConfiguration(directory, DIAGNOSTIC_BASENAME, validateRuntimeDiagnosticConfiguration);
}
