/**
 * Destructive, synthetic browser rehearsal fixture. No production configuration
 * or environment file is loaded. An explicitly confirmed, initially empty,
 * loopback test schema is required; only this exercise's tables are removed.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { chmod, lstat, mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { databaseOptions } from "../../server/db/connection.mjs";
import { runtimeDatabaseOptions } from "../../server/db/runtime.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations, validateMigrationPlan } from "../../server/db/migrations.mjs";
import { createConfiguredServer } from "../../server/index.mjs";
import { createShutdown } from "../../server/lifecycle.mjs";
import { createAuthStore } from "../../server/auth/store.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, totpCode, verifyTotp } from "../../server/auth/crypto.mjs";

const run = promisify(execFile);
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const TEST_DATABASE = /^jessiemessage_test(?:_[a-z0-9]+)*$/;
const DATABASE_KEYS = Object.freeze([
  "JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_PORT", "JESSIEMESSAGE_DB_NAME", "JESSIEMESSAGE_DB_USER", "JESSIEMESSAGE_DB_PASSWORD",
  "JESSIEMESSAGE_MIGRATION_DATABASE", "JESSIEMESSAGE_APPLICATION_DATABASE", "JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL",
  "JESSIEMESSAGE_RUNTIME_DB_USER", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD",
]);
const CERTIFICATE_FILES = new Set(["tls-key.pem", "tls-cert.pem"]);

export class AuthenticationFixtureError extends Error {
  constructor(code = "AUTH_REHEARSAL_UNAVAILABLE") {
    super("The isolated authentication rehearsal could not be completed safely.");
    this.name = "AuthenticationFixtureError";
    this.code = code;
  }
}
const fail = (code) => { throw new AuthenticationFixtureError(code); };

/** Pure prerequisite check: returns only non-secret, bounded fixture metadata. */
export function validateFixtureEnvironment(env = process.env) {
  if (!env || typeof env !== "object") fail("AUTH_REHEARSAL_CONFIG");
  if (env.JESSIEMESSAGE_DB_TEST !== "1") fail("AUTH_REHEARSAL_DISABLED");
  try {
    if (!LOOPBACK.has(env.JESSIEMESSAGE_DB_HOST) || typeof env.JESSIEMESSAGE_DB_NAME !== "string" || !TEST_DATABASE.test(env.JESSIEMESSAGE_DB_NAME)
      || typeof env.JESSIEMESSAGE_DB_USER !== "string" || typeof env.JESSIEMESSAGE_RUNTIME_DB_USER !== "string"
      || env.JESSIEMESSAGE_DB_PORT !== undefined && typeof env.JESSIEMESSAGE_DB_PORT !== "string"
      || env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL !== "1" || env.JESSIEMESSAGE_DB_TLS_CA_PATH !== undefined) fail();
    const migration = databaseOptions(env), runtime = runtimeDatabaseOptions(env);
    if (migration.database !== runtime.database || migration.host !== runtime.host || migration.port !== runtime.port
      || migration.user === runtime.user) fail();
    return Object.freeze({ database: migration.database, host: migration.host === "localhost" ? "127.0.0.1" : migration.host, port: migration.port });
  } catch { fail("AUTH_REHEARSAL_CONFIG"); }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const error = () => { server.off("listening", ready); reject(new AuthenticationFixtureError()); };
    const ready = () => { server.off("error", error); resolve(); };
    server.once("error", error); server.once("listening", ready); server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") fail();
  return address.port;
}

async function removeCertificateDirectory(directory) {
  if (!directory) return;
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("AUTH_REHEARSAL_CLEANUP");
  const files = await readdir(directory);
  if (files.some((name) => !CERTIFICATE_FILES.has(name))) fail("AUTH_REHEARSAL_CLEANUP");
  for (const name of files) {
    const path = join(directory, name), file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink()) fail("AUTH_REHEARSAL_CLEANUP");
    await unlink(path);
  }
  await rmdir(directory);
}

/** Never reconnect for cleanup: only the original lock owner may drop its tables. */
export async function cleanupAuthenticationSchema(connection, { database, lockName, allowedTables }) {
  try {
    const held = await connection.query("SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS held", [lockName]);
    if (!Array.isArray(held) || held.length !== 1 || Number(held[0]?.held) !== 1) fail("AUTH_REHEARSAL_CLEANUP");
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    if (!Array.isArray(tables) || tables.some((table) => !allowedTables.includes(table.name))) fail("AUTH_REHEARSAL_CLEANUP");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  } catch {
    // Queries have settled before destroy; there is no replacement connection.
    // An uncertain lock/inventory prevents all DROPs; a later DDL failure stops
    // the remaining cleanup without claiming that earlier DROPs were undone.
    try { connection.destroy(); } catch {}
    fail("AUTH_REHEARSAL_CLEANUP");
  }
}

/**
 * Real configured application + runtime DML account, fronted by test-only TLS.
 * Browser callers must set acceptInsecureCerts on their disposable WebDriver
 * session. This fixture never changes NODE_TLS_REJECT_UNAUTHORIZED or any
 * production listener, feature configuration, mail transport, or credential.
 */
export async function createAuthenticationFixture() {
  const confirmed = validateFixtureEnvironment();
  const env = Object.fromEntries(DATABASE_KEYS.map((key) => [key, process.env[key]]));
  env.JESSIEMESSAGE_DB_HOST = confirmed.host;
  let connection, configured, shutdown, proxy, certificateDirectory, stopping;
  let ownsSchema = false, lockHeld = false, targetPort = null, accepting = false;
  let allowedTables = [];
  const upstreams = new Set(), sockets = new Set();
  const lockName = `jessie:auth-rehearsal:${createHash("sha256").update(confirmed.database).digest("hex").slice(0, 32)}`;
  const adminId = randomBytes(16), key = randomBytes(32);
  const email = `auth-rehearsal-${randomBytes(6).toString("hex")}@example.invalid`;
  const password = `Synthetic rehearsal ${randomBytes(24).toString("base64url")}!`;
  let secret = makeTotpSecret();
  const recoveryCodes = createRecoveryCodes();

  function stop() {
    if (stopping) return stopping;
    accepting = false;
    stopping = (async () => {
      let failed = false, applicationClosed = true;
      // Close proxy admission and its downstream/upstream sockets first. The
      // application's own shutdown still drains handlers and SQL before DDL.
      try {
        const closed = proxy ? new Promise((resolve) => proxy.close((error) => { if (error && error.code !== "ERR_SERVER_NOT_RUNNING") failed = true; resolve(); })) : Promise.resolve();
        for (const upstream of upstreams) upstream.destroy();
        proxy?.closeAllConnections();
        for (const socket of sockets) socket.destroy();
        await closed;
      } catch { failed = true; }
      try {
        if (shutdown) {
          const result = await shutdown();
          if (result.failed || result.timedOut) { failed = true; applicationClosed = false; }
        }
      } catch { failed = true; applicationClosed = false; }
      // On an uncertain drain, leave the disposable schema intact rather than
      // dropping tables beneath a query or commit that may still be running.
      if (connection && ownsSchema && applicationClosed) {
        try { await cleanupAuthenticationSchema(connection, { database: confirmed.database, lockName, allowedTables }); } catch { failed = true; }
      }
      if (connection) {
        if (lockHeld) { try { await connection.query("SELECT RELEASE_LOCK(?)", [lockName]); } catch { failed = true; } lockHeld = false; }
        try { await connection.end(); } catch { failed = true; }
      }
      try { await removeCertificateDirectory(certificateDirectory); } catch { failed = true; }
      key.fill(0); secret = ""; adminId.fill(0);
      if (failed) fail("AUTH_REHEARSAL_CLEANUP");
    })();
    return stopping;
  }

  try {
    const migrations = await loadMigrations();
    validateMigrationPlan(migrations);
    if (migrations.length !== 28) fail();
    const tables = createdMigrationTables(migrations);
    if (new Set(tables).size !== tables.length) fail();
    allowedTables = [...tables.reverse(), "schema_migrations"];
    // Fixture owner only: browser work can leave this connection idle for over
    // 30 seconds. Preserve it beyond the unchanged 150-second scenario budget,
    // while MariaDB's native queryTimeout keeps statements bounded at 30 s.
    // Runtime/production connection settings remain unchanged at socket 30 s.
    const { default: mariadb } = await import("mariadb");
    connection = await mariadb.createConnection({ ...databaseOptions(env), socketTimeout: 180000, queryTimeout: 30000 });
    const locked = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    if (Number(locked[0]?.acquired) !== 1) fail("AUTH_REHEARSAL_BUSY");
    lockHeld = true;
    const existing = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [confirmed.database]);
    if (existing.length !== 0) fail("AUTH_REHEARSAL_NOT_EMPTY");
    ownsSchema = true;
    await applyMigrations(connection, { database: confirmed.database, migrations });

    certificateDirectory = await mkdtemp(join(tmpdir(), "jessiemessage-auth-rehearsal-"));
    await chmod(certificateDirectory, 0o700);
    const keyPath = join(certificateDirectory, "tls-key.pem"), certPath = join(certificateDirectory, "tls-cert.pem");
    // No shell is involved and neither output nor private material is logged.
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyPath, "-out", certPath],
    { timeout: 15000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
    const [tlsKey, certificate] = await Promise.all([readFile(keyPath), readFile(certPath)]);
    try {
      proxy = createHttpsServer({ key: tlsKey, cert: certificate, minVersion: "TLSv1.2" }, (request, response) => {
        if (!accepting || targetPort === null) {
          response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end('{"error":"fixture_unavailable"}'); request.resume(); return;
        }
        // The upstream destination is always our own loopback application.
        // Preserve Origin, native cookies and Set-Cookie without rewriting.
        const upstream = httpRequest({ host: "127.0.0.1", port: targetPort, path: request.url, method: request.method, headers: request.headers, agent: false }, (result) => {
          if (response.destroyed) { result.destroy(); return; }
          response.writeHead(result.statusCode ?? 503, result.headers);
          result.on("error", () => response.destroy()); result.pipe(response);
        });
        upstreams.add(upstream); upstream.once("close", () => upstreams.delete(upstream));
        upstream.on("error", () => {
          if (response.destroyed) return;
          if (response.headersSent) response.destroy();
          else { response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end('{"error":"fixture_unavailable"}'); }
        });
        upstream.setTimeout(45000, () => upstream.destroy());
        request.on("aborted", () => upstream.destroy()); request.on("error", () => upstream.destroy());
        response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
        request.pipe(upstream);
      });
    } finally { tlsKey.fill(0); }
    proxy.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    proxy.on("clientError", (_error, socket) => socket.destroy());
    const port = await listen(proxy), origin = `https://127.0.0.1:${port}`;
    configured = await createConfiguredServer({ ...env,
      JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_SITE_ORIGIN: origin, JESSIEMESSAGE_MFA_KEY: key.toString("base64url"),
      JESSIEMESSAGE_ENABLE_ACCESS: "0", JESSIEMESSAGE_ENABLE_CHAT: "0", JESSIEMESSAGE_ENABLE_MEDIA: "0",
      JESSIEMESSAGE_ENABLE_CRM: "0", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0", JESSIEMESSAGE_ENABLE_BROADCAST: "0",
      JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "0",
    });
    shutdown = createShutdown(configured);
    if (!configured.pool || configured.mailWorker !== null) fail();
    await createAuthStore(configured.pool).initializeAdmin({ id: adminId, email, pseudonym: "Synthetic browser administrator",
      passwordHash: await hashPassword(password), secretEncrypted: sealTotpSecret(secret, key, adminId),
      recoveryDigests: recoveryCodes.map(recoveryCodeDigest), now: Date.now() });
    targetPort = await listen(configured.server);
    accepting = true;
    const currentTotp = () => { if (stopping) fail(); return totpCode(secret); };
    const isTotpFresh = (code) => { if (stopping) fail(); return verifyTotp(secret, code, { now: Date.now(), lastStep: -1 }) !== null; };
    const invalidTotp = () => {
      if (stopping) fail();
      // Include adjacent future windows too: CI form entry can cross a
      // 30-second boundary before the real password check finishes.
      const now = Date.now(), valid = new Set([-3, -2, -1, 0, 1, 2, 3].map((step) => totpCode(secret, { now: now + step * 30000 })));
      for (let value = 0; value < 1000000; value += 1) { const candidate = String(value).padStart(6, "0"); if (!valid.has(candidate)) return candidate; }
      fail();
    };
    async function expireSession() {
      if (stopping) fail();
      // Keep the lifetime constraint true even for a just-created session.
      // MFA/last-seen remain untouched: expiry, rather than revocation or a
      // changed factor version, causes the next real session lookup to fail.
      const expired = new Date(Date.now() - 1000).toISOString().replace("T", " ").replace("Z", "000");
      const runtime = await configured.pool.getConnection();
      try {
        await runtime.query(`UPDATE sessions SET created_at = LEAST(created_at, DATE_SUB(?, INTERVAL 1 MICROSECOND)), expires_at = ?
          WHERE user_id = ? AND revoked_at IS NULL`, [expired, expired, adminId]);
      } catch { fail(); }
      finally { runtime.release(); }
    }
    return Object.freeze({ origin, email, password, currentTotp, isTotpFresh, invalidTotp, recoveryCodes: Object.freeze([...recoveryCodes]), expireSession, stop });
  } catch (error) {
    let cleanupFailed = false;
    try { await stop(); } catch { cleanupFailed = true; }
    if (cleanupFailed) fail("AUTH_REHEARSAL_CLEANUP");
    if (error instanceof AuthenticationFixtureError) throw error;
    fail();
  }
}
