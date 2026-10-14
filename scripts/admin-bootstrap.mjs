import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { authConfiguration, canonicalEmail } from "../server/auth/config.mjs";
import * as authCrypto from "../server/auth/crypto.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAX_INPUT_BYTES = 4096;

export class AdminBootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdminBootstrapError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new AdminBootstrapError(code, message); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== "--output" || typeof args[1] !== "string"
    || !isAbsolute(args[1]) || args[1].includes("\0")) {
    fail("SETUP_USAGE", "Use: admin-bootstrap.mjs --output /absolute/private/directory/admin-setup.json ; provide JSON on stdin.");
  }
  return { outputPath: args[1] };
}

export function validateInput(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
    || Object.keys(input).sort().join(",") !== "email,password,pseudonym") {
    fail("SETUP_INPUT", "Input must contain exactly email, pseudonym and password.");
  }
  let email;
  try { email = canonicalEmail(input.email); }
  catch { fail("SETUP_INPUT", "Invalid administrator email."); }
  if (typeof input.pseudonym !== "string" || !input.pseudonym.isWellFormed() || input.pseudonym.trim() !== input.pseudonym
    || /[\p{Cc}\p{Cf}]/u.test(input.pseudonym)) {
    fail("SETUP_INPUT", "Invalid administrator pseudonym.");
  }
  const pseudonym = input.pseudonym.normalize("NFC");
  if (pseudonym.length < 1 || pseudonym.length > 64) fail("SETUP_INPUT", "Invalid administrator pseudonym.");
  const password = input.password;
  if (typeof password !== "string" || !password.isWellFormed() || password.length < 14 || password.length > 128
    || Buffer.byteLength(password, "utf8") > 512) {
    fail("SETUP_INPUT", "Password must contain 14–128 characters and at most 512 UTF-8 bytes.");
  }
  return { email, pseudonym, password };
}

export async function readInput(stream) {
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_INPUT_BYTES) fail("SETUP_INPUT", "Administrator setup JSON exceeds its size limit.");
      chunks.push(buffer);
    }
    const source = Buffer.concat(chunks);
    try {
      let decoded;
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(source); }
      catch { fail("SETUP_INPUT", "Administrator setup input is not valid UTF-8."); }
      let value;
      try { value = JSON.parse(decoded); }
      catch { fail("SETUP_INPUT", "Administrator setup input is not valid JSON."); }
      return validateInput(value);
    } finally { source.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}

function inside(path, root) {
  const suffix = relative(root, path);
  return suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix));
}

// Setup material must never become a source file, HTTP asset or CI artifact.
// The nearest directory is private; writable or symlinked ancestors are refused.
export async function validateOutputPath(outputPath, { repoRoot = REPOSITORY_ROOT } = {}) {
  if (typeof outputPath !== "string" || !isAbsolute(outputPath) || outputPath.includes("\0")) {
    fail("SETUP_PATH", "Setup output must use an absolute private path outside the repository.");
  }
  const path = resolve(outputPath);
  const parent = dirname(path);
  const root = await realpath(repoRoot).catch(() => fail("SETUP_PATH", "Cannot verify the repository location."));
  const actualParent = await realpath(parent).catch(() => fail("SETUP_PATH", "The private output directory must already exist."));
  if (inside(path, root) || inside(join(actualParent, basename(path)), root)) {
    fail("SETUP_PATH", "Setup output must be outside the entire repository.");
  }
  for (let current = parent; ; current = dirname(current)) {
    const stats = await lstat(current).catch(() => fail("SETUP_PATH", "Cannot verify the private output directory."));
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o022) !== 0) {
      fail("SETUP_PATH", "Output ancestors must be directories without symlinks or group/world write access.");
    }
    if (current === parent && ((stats.mode & 0o077) !== 0
      || (typeof process.getuid === "function" && stats.uid !== process.getuid()))) {
      fail("SETUP_PATH", "The output directory must be owned by this operator and have mode 0700 or stricter.");
    }
    const next = dirname(current);
    if (next === current) break;
  }
  return { path, parent, actualParent };
}

function setupDocument({ email, pseudonym, secret, recoveryCodes, now }) {
  const label = encodeURIComponent(`JessieMessage:${email}`);
  return {
    schema: "jessiemessage-admin-setup-v1",
    createdAt: new Date(now).toISOString(),
    email,
    pseudonym,
    totp: {
      issuer: "JessieMessage", algorithm: "SHA1", digits: 6, period: 30, secret,
      uri: `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=JessieMessage&algorithm=SHA1&digits=6&period=30`,
    },
    recoveryCodes: recoveryCodes.map((code) => code.match(/.{4}/g).join("-")),
    instructions: [
      "Fichier privé : ne jamais l'envoyer à GitHub, aux journaux ou aux artefacts CI.",
      "Importer la clé TOTP dans une application d'authentification ; la première connexion exige son code à six chiffres.",
      "Chaque code de secours remplace une seule fois le TOTP après cette première connexion ; le mot de passe reste obligatoire.",
      "Conserver les codes de secours séparément et effacer ce fichier après une sauvegarde privée vérifiée.",
    ],
  };
}

async function removeOwnedFile(path, identity) {
  const current = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw new AdminBootstrapError("SETUP_CLEANUP", "Private setup cleanup failed; inspect the selected output privately.");
  });
  if (!current) return;
  if (current.dev !== identity.dev || current.ino !== identity.ino || !current.isFile()) {
    fail("SETUP_CLEANUP", "The selected output changed; inspect it privately before retrying.");
  }
  await unlink(path).catch(() => fail("SETUP_CLEANUP", "Private setup cleanup failed; inspect the selected output privately."));
}

export async function bootstrap({ input, outputPath, config, store, repoRoot = REPOSITORY_ROOT, now = Date.now(), crypto = authCrypto }) {
  if (config?.enabled !== true || !Buffer.isBuffer(config.totpKey) || config.totpKey.length !== 32) {
    fail("SETUP_CONFIG", "Administrator authentication must be explicitly configured before initialization.");
  }
  if (!store || typeof store.initializeAdmin !== "function" || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    fail("SETUP_CONFIG", "Administrator initialization is not configured.");
  }
  const { email, pseudonym, password } = validateInput(input);
  const destination = await validateOutputPath(outputPath, { repoRoot });
  const id = crypto.newId();
  const passwordHash = await crypto.hashPassword(password);
  const secret = crypto.makeTotpSecret();
  const secretEncrypted = crypto.sealTotpSecret(secret, config.totpKey, id);
  const recoveryCodes = crypto.createRecoveryCodes(8);
  const recoveryDigests = recoveryCodes.map((code) => crypto.recoveryCodeDigest(code));
  const document = `${JSON.stringify(setupDocument({ email, pseudonym, secret, recoveryCodes, now }), null, 2)}\n`;
  let file;
  let identity;
  try {
    file = await open(destination.path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    identity = await file.stat();
    await file.chmod(0o600);
    const checked = await validateOutputPath(destination.path, { repoRoot });
    const visible = await lstat(destination.path);
    if (checked.actualParent !== destination.actualParent || visible.dev !== identity.dev || visible.ino !== identity.ino) {
      fail("SETUP_PATH", "The private output location changed during initialization.");
    }
    await file.writeFile(document, "utf8");
    await file.sync();
    await file.close();
    file = null;
    const directory = await open(destination.parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); }
    finally { await directory.close(); }
  } catch (error) {
    await file?.close().catch(() => {});
    if (identity) await removeOwnedFile(destination.path, identity);
    if (error instanceof AdminBootstrapError) throw error;
    fail("SETUP_FILE", "Cannot create the private setup output; existing files are never overwritten.");
  }
  try {
    // All secret material has been durably written before the database can commit.
    await store.initializeAdmin({ id, email, pseudonym, passwordHash, secretEncrypted, recoveryDigests, now });
  } catch (error) {
    // A lost COMMIT reply may have created the account. Preserve its sole setup
    // copy until an operator establishes the actual database outcome.
    if (error?.preserveSetupFile === true) {
      fail("SETUP_UNCERTAIN", "Database outcome is uncertain; keep the private setup output and inspect the account before retrying.");
    }
    await removeOwnedFile(destination.path, identity);
    fail("SETUP_DATABASE", "Administrator initialization failed; no setup file was retained. Inspect private configuration and existing accounts.");
  }
  return { created: true, mfaEnrollmentPending: true, recoveryCodeCount: recoveryCodes.length };
}

export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { outputPath } = parseArguments(args);
  const config = (dependencies.configure ?? authConfiguration)(env);
  if (config.enabled !== true) fail("SETUP_CONFIG", "Set JESSIEMESSAGE_ENABLE_AUTH=1 and configure authentication explicitly.");
  const inputStream = dependencies.inputStream ?? process.stdin;
  if (inputStream.isTTY) fail("SETUP_INPUT", "Read setup JSON from a private file through stdin; interactive secret entry is refused.");
  const input = await readInput(inputStream);
  await validateOutputPath(outputPath, { repoRoot: dependencies.repoRoot ?? REPOSITORY_ROOT });
  const createPool = dependencies.createPool ?? (await import("../server/db/runtime.mjs")).createRuntimePool;
  const makeStore = dependencies.makeStore ?? (await import("../server/auth/store.mjs")).createAuthStore;
  const pool = await createPool(env);
  try {
    const store = makeStore(pool);
    if (typeof store?.assertSchema !== "function") fail("SETUP_CONFIG", "Administrator setup requires a verified database schema.");
    await store.assertSchema();
    const result = await bootstrap({ input, outputPath, config, store, repoRoot: dependencies.repoRoot,
      now: dependencies.now, crypto: dependencies.crypto ?? authCrypto });
    (dependencies.outputStream ?? process.stdout).write("Administrator created. Complete the first TOTP login using the private setup file.\n");
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof AdminBootstrapError ? `${error.code}: ${error.message}`
      : "SETUP_OPERATION: Administrator setup failed; inspect private configuration and docs/auth-admin.md.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
