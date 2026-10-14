import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authConfiguration, canonicalEmail } from "../server/auth/config.mjs";
import * as authCrypto from "../server/auth/crypto.mjs";
import { bootstrap, AdminBootstrapError, validateOutputPath, validateInput as validateBootstrapInput } from "./admin-bootstrap.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAX_INPUT_BYTES = 4096;

export class AdminRecoveryError extends Error {
  constructor(code, message) { super(message); this.name = "AdminRecoveryError"; this.code = code; }
}
const fail = (code, message) => { throw new AdminRecoveryError(code, message); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 5 || args[0] !== "--output" || typeof args[1] !== "string"
    || !isAbsolute(args[1]) || args[1].includes("\0") || args[2] !== "--admin-id"
    || typeof args[3] !== "string" || !/^[0-9a-f]{32}$/.test(args[3]) || args[4] !== "--confirm-reset") {
    fail("RECOVERY_USAGE", "Use: admin-recover.mjs --output /absolute/private/directory/recovery-setup.json --admin-id HEX32 --confirm-reset ; provide private JSON on stdin.");
  }
  return { outputPath: args[1], adminId: Buffer.from(args[3], "hex") };
}

export function validateInput(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).sort().join(",") !== "email,password") {
    fail("RECOVERY_INPUT", "Recovery input must contain exactly email and password.");
  }
  let email;
  try { email = canonicalEmail(input.email); }
  catch { fail("RECOVERY_INPUT", "Invalid administrator email."); }
  try { validateBootstrapInput({ email, pseudonym: "Recovery", password: input.password }); }
  catch { fail("RECOVERY_INPUT", "Password must contain 14–128 characters and at most 512 UTF-8 bytes."); }
  return { email, password: input.password };
}

export async function readInput(stream) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      size += buffer.length;
      if (size > MAX_INPUT_BYTES) fail("RECOVERY_INPUT", "Recovery input exceeds its size limit.");
    }
    const source = Buffer.concat(chunks);
    try {
      let decoded;
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(source); }
      catch { fail("RECOVERY_INPUT", "Recovery input is not valid UTF-8."); }
      let input;
      try { input = JSON.parse(decoded); }
      catch { fail("RECOVERY_INPUT", "Recovery input is not valid JSON."); }
      return validateInput(input);
    } finally { source.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}

export async function recover({ input, outputPath, adminId, config, store, repoRoot = REPOSITORY_ROOT, now = Date.now(), crypto = authCrypto }) {
  const validated = validateInput(input);
  if (!Buffer.isBuffer(adminId) || adminId.length !== 16 || config?.enabled !== true
    || !Buffer.isBuffer(config.totpKey) || config.totpKey.length !== 32
    || typeof store?.getAdminForRecovery !== "function" || typeof store?.resetAdmin !== "function") {
    fail("RECOVERY_CONFIG", "Administrator recovery requires explicit private configuration and an exact existing administrator target.");
  }
  const admin = await store.getAdminForRecovery(adminId, validated.email);
  if (!admin || !Buffer.isBuffer(admin.id) || !admin.id.equals(adminId) || admin.email !== validated.email
    || !Number.isInteger(admin.version) || admin.version < 1 || admin.version >= 4294967295) {
    fail("RECOVERY_TARGET", "The active administrator identity could not be verified. No account was changed.");
  }
  // Reuse bootstrap's private-file reservation, fsync, confirmed-failure cleanup
  // and uncertain-COMMIT preservation; only the transactional DB adapter differs.
  const result = await bootstrap({
    input: { ...validated, pseudonym: admin.pseudonym }, outputPath, config, repoRoot, now,
    crypto: { ...crypto, newId: () => Buffer.from(adminId) },
    store: { initializeAdmin: (record) => store.resetAdmin({ ...record, expectedVersion: admin.version }) },
  });
  return { recovered: true, mfaEnrollmentPending: result.mfaEnrollmentPending, recoveryCodeCount: result.recoveryCodeCount };
}

export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { outputPath, adminId } = parseArguments(args);
  const config = (dependencies.configure ?? authConfiguration)(env);
  if (config.enabled !== true) fail("RECOVERY_CONFIG", "Set JESSIEMESSAGE_ENABLE_AUTH=1 and configure authentication explicitly.");
  const stream = dependencies.inputStream ?? process.stdin;
  if (stream.isTTY) fail("RECOVERY_INPUT", "Read private recovery JSON through stdin; interactive secret entry is refused.");
  const input = await readInput(stream);
  const repoRoot = dependencies.repoRoot ?? REPOSITORY_ROOT;
  await validateOutputPath(outputPath, { repoRoot });
  const createPool = dependencies.createPool ?? (await import("../server/db/runtime.mjs")).createRuntimePool;
  const makeStore = dependencies.makeStore ?? (await import("../server/auth/store.mjs")).createAuthStore;
  const makeRecoveryStore = dependencies.makeRecoveryStore ?? (await import("../server/auth/recovery-store.mjs")).createAdminRecoveryStore;
  const pool = await createPool(env);
  try {
    const authStore = makeStore(pool);
    if (typeof authStore?.assertSchema !== "function") fail("RECOVERY_CONFIG", "Administrator recovery requires a verified database schema.");
    await authStore.assertSchema();
    const result = await recover({ input, outputPath, adminId, config, store: makeRecoveryStore(pool), repoRoot,
      now: dependencies.now, crypto: dependencies.crypto ?? authCrypto });
    (dependencies.outputStream ?? process.stdout).write("Administrator recovered. Previous sessions and factors are revoked; complete the new first TOTP login using the private setup file.\n");
    return result;
  } finally {
    // Database/file outcome has already been established. Cleanup must not
    // overwrite that outcome or remove the private copy of newly committed MFA.
    try { await pool.end(); } catch {}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof AdminRecoveryError || error instanceof AdminBootstrapError
      ? `${error.code}: ${error.message}`
      : "RECOVERY_OPERATION: Administrator recovery failed; inspect private configuration and docs/admin-recovery.md.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
