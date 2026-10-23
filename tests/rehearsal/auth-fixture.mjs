/**
 * Destructive, synthetic browser rehearsal fixture. No production configuration
 * or environment file is loaded. An explicitly confirmed, initially empty,
 * loopback test schema is required; only this exercise's tables are removed.
 */
import { execFile } from "node:child_process";
import { createECDH, createHash, createHmac, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { databaseOptions } from "../../server/db/connection.mjs";
import { createRuntimePool, runtimeDatabaseOptions } from "../../server/db/runtime.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations, validateMigrationPlan } from "../../server/db/migrations.mjs";
import { createConfiguredServer } from "../../server/index.mjs";
import { createShutdown } from "../../server/lifecycle.mjs";
import { createAuthStore } from "../../server/auth/store.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, tokenDigest, totpCode, verifyTotp } from "../../server/auth/crypto.mjs";
import { createMediaStorage } from "../../server/media/storage.mjs";
import { createMediaCapacityStore } from "../../server/media/capacity-store.mjs";
import { consumeSyntheticInvitation } from "../fixtures/manual-admission.mjs";
import { generateNotificationVapidKeys } from "../../scripts/prepare-runtime-notifications.mjs";
import { loadExperienceMigrations } from "../../server/experience/migrations.mjs";
import { createResetStore } from "../../server/reset/store.mjs";
import { sealPreferences } from "../../server/preferences/crypto.mjs";
import { sealTask } from "../../server/tasks/crypto.mjs";
import { loadVideoMigrations } from "../../server/video/migrations.mjs";
import { createVideoStorage } from "../../server/video/storage.mjs";
import { createVideoStore } from "../../server/video/store.mjs";
import { createChatStore } from "../../server/chat/store.mjs";
import { createAuthService } from "../../server/auth/service.mjs";
import { createAccessStore } from "../../server/access/store.mjs";
import { createAccessService } from "../../server/access/service.mjs";
import { createChatService } from "../../server/chat/service.mjs";
import { seedLegacyClientVideoAsset, seedLegacyClientVideoMessage } from "../helpers/legacy-video-seed.mjs";
import { createVideoMessageStore } from "../../server/video/message-store.mjs";
import { createVideoService } from "../../server/video/service.mjs";
import { createBroadcastStore } from "../../server/broadcast/store.mjs";
import { createBroadcastService } from "../../server/broadcast/service.mjs";
import { createBroadcastWorker } from "../../server/broadcast/worker.mjs";
import { createQuickRepliesFiles } from "../../server/quick-replies/files.mjs";
import { VIDEO_CREATION_ENABLED } from "../../server/release-features.mjs";

const run = promisify(execFile);
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const TEST_DATABASE = /^jessiemessage_test(?:_[a-z0-9]+)*$/;
const DATABASE_KEYS = Object.freeze([
  "JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_PORT", "JESSIEMESSAGE_DB_NAME", "JESSIEMESSAGE_DB_USER", "JESSIEMESSAGE_DB_PASSWORD",
  "JESSIEMESSAGE_MIGRATION_DATABASE", "JESSIEMESSAGE_APPLICATION_DATABASE", "JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL",
  "JESSIEMESSAGE_RUNTIME_DB_USER", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD",
]);
const CERTIFICATE_FILES = new Set(["tls-key.pem", "tls-cert.pem"]);
const MEDIA_FILE = /^(?:[a-f0-9]{64}\.(?:full|thumb)\.enc|\.[a-f0-9]{64}\.(?:full|thumb)\.[a-f0-9]{32}\.tmp)$/;
const VIDEO_FILE = /^(?:[a-f0-9]{64}\.video\.enc|\.[a-f0-9]{64}\.video\.[a-f0-9]{32}\.tmp)$/;
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

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

/** Only the new, pinned flat synthetic media directory is removable. */
async function removeMediaDirectory(directory, identity, pattern = MEDIA_FILE) {
  if (!directory) return;
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino
    || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o7777n) !== 0o700n || await realpath(directory) !== directory) fail("AUTH_REHEARSAL_CLEANUP");
  const files = await readdir(directory);
  for (const name of files) {
    if (!pattern.test(name)) fail("AUTH_REHEARSAL_CLEANUP");
    const file = await lstat(join(directory, name), { bigint: true });
    if (!file.isFile() || file.isSymbolicLink() || file.uid !== stat.uid || file.nlink !== 1n || (file.mode & 0o7777n) !== 0o600n) fail("AUTH_REHEARSAL_CLEANUP");
  }
  for (const name of files) await unlink(join(directory, name));
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

/** Seed a former writable release before the compatibility application exists.
 * Historical client videos use explicit synthetic rows; new admin videos use the
 * real direct services. These sessions are revoked before boot;
 * no production option or feature gate is overridden. */
async function seedVideoCompatibility({ pool, connection, adminId, clientId, key, keys, origin, root, operationsRoot }) {
  const now = Date.now(), created = sqlDate(now), conversation = await connection.query("SELECT id FROM conversations WHERE admin_id=? AND client_id=?", [adminId, clientId]);
  if (conversation.length !== 1) fail();
  const conversationId = conversation[0].id.toString("hex"), owners = [];
  for (const [role, userId] of [["admin", adminId], ["client", clientId]]) {
    const owner = { role, id: userId, sessionId: randomBytes(16), token: randomBytes(32).toString("base64url") };
    owners.push(owner);
    await connection.query("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)", [owner.sessionId, userId, tokenDigest(owner.token), created, sqlDate(now + 3600000)]);
    await connection.query(role === "admin" ? "INSERT INTO auth_session_state(session_id,last_seen_at,mfa_verified_at,mfa_version) VALUES(?,?,?,1)"
      : "INSERT INTO client_session_state(session_id,last_seen_at,credential_version) VALUES(?,?,1)", role === "admin" ? [owner.sessionId, created, created] : [owner.sessionId, created]);
  }
  try {
    const authStore = createAuthStore(pool), authService = await createAuthService({ store: authStore, totpKey: key });
    const accessService = await createAccessService({ store: createAccessStore(pool), authStore, authService, totpKey: key, mailKey: keys.MAIL, origin });
    let messages;
    const chatStore = createChatStore(pool, { decorateMessages: (...args) => messages.decorateMessages(...args) });
    const storage = await createVideoStorage({ root, key: keys.VIDEO }), videoStore = createVideoStore({ pool, chatStore,
      capacity: { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await storage.fingerprint() } });
    messages = createVideoMessageStore({ pool, chatStore, videoStore });
    const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key: keys.MESSAGE, videoMessages: messages });
    const videos = await createVideoService({ store: videoStore, chatService, authStore, storage, key: keys.VIDEO, messages, minimumFreeBytes: 0 });
    const media = Buffer.from((await readFile(new URL("../fixtures/video-decodable.mp4.base64", import.meta.url), "utf8")).trim(), "base64");
    const seeded = [];
    try {
      for (const owner of owners) {
        const caption = `Synthetic retained ${owner.role} video`;
        if (owner.role === "client") {
          const legacy = await seedLegacyClientVideoAsset({ connection, storage, owner, now, bytes: media.length, source: (async function* () { yield Buffer.from(media); })() });
          const result = await seedLegacyClientVideoMessage({ chatStore, owner, conversationId: Buffer.from(conversationId, "hex"), asset: legacy, caption, key: keys.MESSAGE, now });
          seeded.push({ role: owner.role, asset: { id: legacy.id.toString("hex"), bytes: legacy.bytes, mime: "video/mp4" }, message: { ...result.message, id: result.message.id.toString("hex") }, caption });
        } else {
          const ticket = await videos.admitUpload(owner.role, owner.token, { bytes: media.length, mime: "video/mp4" });
          const asset = await videos.upload(owner.role, owner.token, ticket, (async function* () { yield Buffer.from(media); })());
          const result = await videos.send(owner.role, owner.token, conversationId, { clientMessageId: randomBytes(16).toString("hex"), videoId: asset.id, caption });
          seeded.push({ role: owner.role, asset, message: result.message, caption });
        }
      }
    } finally { media.fill(0); }
    const replies = createQuickRepliesFiles(operationsRoot, keys.CRM, adminId.toString("hex")); let catalogue;
    try { catalogue = await replies.save([{ id: "c".repeat(32), title: "Retained personal reply", body: "Private retained <phrase> 💛", language: "fr" }], 0, async () => {}); }
    finally { replies.close(); }
    const broadcastStore = createBroadcastStore(pool, { chatStore, videoStore, videoMessageStore: messages, key: keys.MESSAGE, videoEnabled: true });
    const broadcasts = await createBroadcastService({ store: broadcastStore, authStore, authService, key: keys.MESSAGE, videoEnabled: true, largeAudiencesEnabled: true });
    const admin = owners.find(value => value.role === "admin"), videoId = seeded.find(value => value.role === "admin").asset.id,
      audience = { mode: "selected", conversationIds: [conversationId] };
    const preview = await broadcasts.preview(admin.token, { audience, mediaId: null, videoId });
    const campaignInput = { clientCampaignId: randomBytes(16).toString("hex"), title: "Retained video campaign", body: "Synthetic pending video campaign", mediaId: null,
      videoId, allowRepeatMedia: true, audience, previewToken: preview.previewToken };
    const campaign = await broadcasts.create(admin.token, campaignInput);
    if (campaign.campaign.formatVersion !== 3 || campaign.duplicate !== false) fail();
    return Object.freeze({ conversationId, seeded, campaignInput, campaignId: campaign.campaign.id,
      replies: { version: String(catalogue.revision), replies: catalogue.replies } });
  } finally {
    const revoked = await connection.query("UPDATE sessions SET revoked_at=? WHERE id IN (?,?) AND revoked_at IS NULL", [sqlDate(Date.now()), ...owners.map(owner => owner.sessionId)]);
    if (Number(revoked.affectedRows) !== 2) fail();
    for (const owner of owners) owner.token = "";
  }
}

/**
 * Real configured application + runtime DML account, fronted by test-only TLS.
 * Browser callers must set acceptInsecureCerts on their disposable WebDriver
 * session. This fixture never changes NODE_TLS_REJECT_UNAUTHORIZED or any
 * production listener, feature configuration, mail transport, or credential.
 */
export async function createAuthenticationFixture({ messaging = false, video = false, experience = false, rollback185 = false } = {}) {
  if (typeof messaging !== "boolean" || typeof video !== "boolean" || typeof experience !== "boolean" || typeof rollback185 !== "boolean"
    || video && !messaging || experience && !video || rollback185 && !experience) fail("AUTH_REHEARSAL_CONFIG");
  const confirmed = validateFixtureEnvironment();
  const env = Object.fromEntries(DATABASE_KEYS.map((key) => [key, process.env[key]]));
  env.JESSIEMESSAGE_DB_HOST = confirmed.host;
  let connection, configured, shutdown, proxy, certificateDirectory, stopping, bootstrapPool, mediaRoot, mediaIdentity,
    videoRoot, videoIdentity, operationsRoot, operationsIdentity, compatibilityData, compatibilityWorker;
  let ownsSchema = false, lockHeld = false, targetPort = null, accepting = false;
  let allowedTables = [];
  const upstreams = new Set(), sockets = new Set();
  const lockName = `jessie:auth-rehearsal:${createHash("sha256").update(confirmed.database).digest("hex").slice(0, 32)}`;
  const adminId = randomBytes(16), key = randomBytes(32);
  const clientId = messaging ? randomBytes(16) : null;
  const domainKeys = messaging ? Object.fromEntries(["MAIL", "MESSAGE", "MEDIA", "NOTIFICATIONS", "CRM", ...(video ? ["VIDEO"] : [])].map(name => [name, randomBytes(32)])) : {};
  const videoAttestation = video ? randomBytes(32).toString("hex") : null;
  const client = messaging ? Object.freeze({ id: clientId.toString("hex"), email: `messaging-rehearsal-${randomBytes(6).toString("hex")}@example.invalid`,
    password: `Synthetic client ${randomBytes(24).toString("base64url")}!` }) : null;
  const otherClientId = experience ? randomBytes(16) : null;
  const otherClient = experience ? Object.freeze({ id: otherClientId.toString("hex"), email: `experience-other-${randomBytes(6).toString("hex")}@example.invalid`,
    password: `Synthetic other client ${randomBytes(24).toString("base64url")}!` }) : null;
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
      try { await compatibilityWorker?.stop(); } catch { failed = true; applicationClosed = false; }
      try {
        if (shutdown) {
          const result = await shutdown();
          if (result.failed || result.timedOut) { failed = true; applicationClosed = false; }
        }
      } catch { failed = true; applicationClosed = false; }
      if (bootstrapPool) {
        try { await bootstrapPool.end(); bootstrapPool = null; } catch { failed = true; applicationClosed = false; }
      }
      // On an uncertain drain, leave the disposable schema intact rather than
      // dropping tables beneath a query or commit that may still be running.
      if (connection && ownsSchema && applicationClosed) {
        try { await cleanupAuthenticationSchema(connection, { database: confirmed.database, lockName, allowedTables }); } catch { failed = true; }
      }
      if (connection) {
        if (lockHeld) { try { await connection.query("SELECT RELEASE_LOCK(?)", [lockName]); } catch { failed = true; } lockHeld = false; }
        try { await connection.end(); } catch { failed = true; }
      }
      if (applicationClosed) {
        try { await removeMediaDirectory(mediaRoot, mediaIdentity); } catch { failed = true; }
        try { await removeMediaDirectory(videoRoot, videoIdentity, VIDEO_FILE); } catch { failed = true; }
        // Only this fixture's administrator catalogue may be created here.
        // Any closure, backup, unknown file or writer lock preserves the owned
        // directory instead of deleting potentially unfinished state.
        try { await removeMediaDirectory(operationsRoot, operationsIdentity,
          new RegExp(`^quick-replies-${adminId.toString("hex")}\\.json$`)); } catch { failed = true; }
      }
      try { await removeCertificateDirectory(certificateDirectory); } catch { failed = true; }
      key.fill(0); for (const value of Object.values(domainKeys)) value.fill(0); secret = ""; adminId.fill(0); clientId?.fill(0); otherClientId?.fill(0);
      if (failed) fail("AUTH_REHEARSAL_CLEANUP");
    })();
    return stopping;
  }

  try {
    const migrations = await (experience ? loadExperienceMigrations() : video ? loadVideoMigrations() : loadMigrations());
    validateMigrationPlan(migrations);
    if (migrations.length !== (experience ? 38 : video ? 36 : 33)) fail();
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
    if (messaging) {
      if (new Set([key, ...Object.values(domainKeys)].map(value => value.toString("hex"))).size !== (video ? 7 : 6)) fail();
      mediaRoot = await mkdtemp(join(tmpdir(), "jessiemessage-messaging-rehearsal-"));
      await chmod(mediaRoot, 0o700); mediaIdentity = await lstat(mediaRoot, { bigint: true });
      const storage = await createMediaStorage({ root: mediaRoot, key: domainKeys.MEDIA });
      bootstrapPool = await createRuntimePool(env);
      await createMediaCapacityStore({ pool: bootstrapPool, capacity: {
        ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await storage.fingerprint(),
      } }).initialize({ now: Date.now(), offline: true });
      if (video) {
        videoRoot = await mkdtemp(join(tmpdir(), "jessiemessage-video-rehearsal-"));
        await chmod(videoRoot, 0o700); videoIdentity = await lstat(videoRoot, { bigint: true });
        operationsRoot = await mkdtemp(join(tmpdir(), "jessiemessage-video-operations-"));
        await chmod(operationsRoot, 0o700); operationsIdentity = await lstat(operationsRoot, { bigint: true });
        const videos = await createVideoStorage({ root: videoRoot, key: domainKeys.VIDEO });
        await createVideoStore({ pool: bootstrapPool, chatStore: createChatStore(bootstrapPool), experience, capacity: {
          ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await videos.fingerprint(),
        } }).initialize({ now: Date.now(), offline: true });
      }
      await bootstrapPool.end(); bootstrapPool = null;
    }

    certificateDirectory = await mkdtemp(join(tmpdir(), "jessiemessage-auth-rehearsal-"));
    await chmod(certificateDirectory, 0o700);
    const keyPath = join(certificateDirectory, "tls-key.pem"), certPath = join(certificateDirectory, "tls-cert.pem");
    // No shell is involved and neither output nor private material is logged.
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:jessiemessage.com", "-keyout", keyPath, "-out", certPath],
    { timeout: 15000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
    const [tlsKey, certificate] = await Promise.all([readFile(keyPath), readFile(certPath)]);
    const navigationObservations = [];
    const navigationPaths = {
      admin: { session: "/api/auth/session", conversation: "/api/chat/admin/conversations" },
      client: { session: "/api/access/session", conversation: "/api/chat/client/conversation" },
    };
    try {
      proxy = createHttpsServer({ key: tlsKey, cert: certificate, minVersion: "TLSv1.2" }, (request, response) => {
        if (!accepting || targetPort === null) {
          response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end('{"error":"fixture_unavailable"}'); request.resume(); return;
        }
        if (video && request.method === "GET" && request.url === "/__video_rehearsal/" + videoAttestation) {
          response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
          response.end(videoAttestation); return;
        }
        const requestUrl = new URL(request.url, origin);
        if (request.headers.host === new URL(outside).host) {
          const role = requestUrl.searchParams.get("role"), kind = requestUrl.searchParams.get("kind");
          if (request.method !== "GET" || requestUrl.pathname !== "/c01-navigation" || !Object.hasOwn(navigationPaths, role) || !Object.hasOwn(navigationPaths[role], kind)) {
            response.writeHead(404, { "Cache-Control": "no-store" }); response.end(); return;
          }
          // Only this inert page is served from localhost. The real application
          // stays on 127.0.0.1; Chrome must cross sites when following the link.
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end(`<!doctype html><title>Synthetic external navigation</title><a id="c01-return" href="${origin}${navigationPaths[role][kind]}">Open private API</a>`); return;
        }
        const role = Object.keys(navigationPaths).find(value => Object.values(navigationPaths[value]).includes(requestUrl.pathname));
        let observation;
        if (role && request.method === "GET" && request.headers["sec-fetch-mode"] === "navigate") {
          const name = role === "admin" ? "__Host-jessie_session=" : "__Host-jessie_client=";
          if (navigationObservations.length < 8) navigationObservations.push(observation = { role,
            site: request.headers["sec-fetch-site"], mode: request.headers["sec-fetch-mode"],
            hasCookie: typeof request.headers.cookie === "string" && request.headers.cookie.split(";").some(value => value.trim().startsWith(name)),
            status: null, clearsCookie: false });
        }
        // The upstream destination is always our own loopback application.
        // Preserve Origin, native cookies and Set-Cookie without rewriting.
        const upstream = httpRequest({ host: "127.0.0.1", port: targetPort, path: request.url, method: request.method, headers: request.headers, agent: false }, (result) => {
          if (response.destroyed) { result.destroy(); return; }
          if (observation) {
            observation.status = result.statusCode;
            const prefix = role === "admin" ? "__Host-jessie_session=;" : "__Host-jessie_client=;";
            observation.clearsCookie = Array.isArray(result.headers["set-cookie"]) && result.headers["set-cookie"].some(value => value.startsWith(prefix) && /Max-Age=0(?:;|$)/.test(value));
          }
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
    const port = await listen(proxy), origin = video ? "https://jessiemessage.com" : `https://127.0.0.1:${port}`, outside = `https://localhost:${port}`;
    const runtimeEnvironment = { ...env,
      JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_SITE_ORIGIN: origin, JESSIEMESSAGE_MFA_KEY: key.toString("base64url"),
      JESSIEMESSAGE_ENABLE_ACCESS: "0", JESSIEMESSAGE_ENABLE_CHAT: "0", JESSIEMESSAGE_ENABLE_MEDIA: "0",
      JESSIEMESSAGE_ENABLE_CRM: "0", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0", JESSIEMESSAGE_ENABLE_BROADCAST: "0",
      JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "0",
    };
    let notificationSubscription;
    if (messaging) {
      const vapid = generateNotificationVapidKeys();
      const subscription = createECDH("prime256v1"); subscription.generateKeys();
      if ([key, ...Object.values(domainKeys)].some(value => value.equals(vapid.privateKey))) fail();
      Object.assign(runtimeEnvironment, Object.fromEntries(["ACCESS", "CHAT", "MEDIA", "NOTIFICATIONS", "CRM", "MAIL_DELIVERY"].map(name => [`JESSIEMESSAGE_ENABLE_${name}`, "1"])),
        Object.fromEntries(Object.entries(domainKeys).map(([name, value]) => [`JESSIEMESSAGE_${name}_KEY`, value.toString("base64url")])), {
          JESSIEMESSAGE_MEDIA_ROOT: mediaRoot, JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: String(16 * 1024 * 1024),
          JESSIEMESSAGE_MEDIA_TOTAL_BYTES: String(64 * 1024 * 1024), JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0",
          JESSIEMESSAGE_SMTP_HOST: "smtp.rehearsal.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
          JESSIEMESSAGE_SMTP_USER: "synthetic-rehearsal", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-rehearsal-only",
          JESSIEMESSAGE_SMTP_FROM: "rehearsal@example.invalid", JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com",
          JESSIEMESSAGE_VAPID_PUBLIC_KEY: vapid.publicKey.toString("base64url"), JESSIEMESSAGE_VAPID_PRIVATE_KEY: vapid.privateKey.toString("base64url"),
        });
      notificationSubscription = Object.freeze({ endpoint: `https://fcm.googleapis.com/wp/synthetic-rehearsal-${randomBytes(16).toString("hex")}`, expirationTime: null,
        keys: Object.freeze({ p256dh: subscription.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") }) });
    }
    if (video) Object.assign(runtimeEnvironment, {
      JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1", JESSIEMESSAGE_ENABLE_BROADCAST: "1",
      JESSIEMESSAGE_VIDEO_ROOT: videoRoot, JESSIEMESSAGE_VIDEO_OWNER_BYTES: String(16 * 1024 * 1024),
      JESSIEMESSAGE_VIDEO_TOTAL_BYTES: String(64 * 1024 * 1024), JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES: "0",
      JESSIEMESSAGE_SMTP_USER: "contact@jessiemessage.com", JESSIEMESSAGE_SMTP_FROM: "contact@jessiemessage.com",
    });
    bootstrapPool = await createRuntimePool(env);
    await createAuthStore(bootstrapPool).initializeAdmin({ id: adminId, email, pseudonym: "Synthetic browser administrator",
      passwordHash: await hashPassword(password), secretEncrypted: sealTotpSecret(secret, key, adminId),
      recoveryDigests: recoveryCodes.map(recoveryCodeDigest), now: Date.now() });
    if (messaging) {
      const now = Date.now(), at = sqlDate(now);
      const enabled = await connection.query(`UPDATE admin_mfa SET enabled_at = ?, last_totp_step = ?
        WHERE user_id = ? AND version = 1 AND enabled_at IS NULL AND last_totp_step = -1`, [at, Math.floor(now / 30000) - 1, adminId]);
      if (Number(enabled.affectedRows) !== 1) fail();
      await connection.beginTransaction();
      try {
        for (const person of [{ id: clientId, credentials: client, pseudonym: "Synthetic browser client" },
          ...(experience ? [{ id: otherClientId, credentials: otherClient, pseudonym: "Synthetic second browser client" }] : [])]) {
          await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, access_approved_at, created_at, updated_at)
            VALUES (?, 'client', 'active', ?, ?, ?, ?, ?, ?, ?)`, [person.id, person.pseudonym, person.credentials.email, await hashPassword(person.credentials.password), at, at, at, at]);
          await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [person.id, at]);
          await consumeSyntheticInvitation(connection, person.id, now);
          // Manual approval creates one isolated client/admin conversation.
          await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [randomBytes(16), person.id, adminId, at]);
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
    }
    if (video && !VIDEO_CREATION_ENABLED) compatibilityData = await seedVideoCompatibility({ pool: bootstrapPool, connection, adminId, clientId,
      key, keys: domainKeys, origin, root: videoRoot, operationsRoot });
    if (rollback185) {
      // Test data only, created before the 185 application starts. Use the
      // retained envelope format and the 190 reserved-row ID/proof contract;
      // the 190 reply engine is deliberately absent from this rollback.
      const row = (await connection.query("SELECT id FROM conversations WHERE admin_id = ? AND client_id = ?", [adminId, clientId]))[0];
      if (!Buffer.isBuffer(row?.id) || row.id.length !== 16) fail();
      const now = sqlDate(Date.now()), version = "1", owner = clientId.toString("hex");
      const encrypted = sealPreferences({ catalogueVersion: "2026-10-23-recherche-1", selectedIds: ["pref_c01_hetero-heterosexuel"] }, domainKeys.CRM, owner, version);
      const digest = (...parts) => createHmac("sha256", domainKeys.CRM).update("jessiemessage:reply-task:v1\0").update(JSON.stringify(parts)).digest();
      const taskId = digest("id", adminId.toString("hex"), row.id.toString("hex")).subarray(0, 16);
      const proof = digest("state", adminId.toString("hex"), row.id.toString("hex"), "0", true, version);
      const title = sealTask("À répondre", domainKeys.CRM, { adminId, conversationId: row.id, taskId, version, dueAt: null, done: false });
      await connection.beginTransaction();
      try {
        await connection.query("INSERT INTO profile_preferences (user_id, version, selection_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [clientId, version, encrypted, now, now]);
        await connection.query(`INSERT INTO crm_tasks (id, admin_id, conversation_id, title_encrypted, due_at, done, version,
          request_fingerprint, created_at, updated_at, reply_kind, reply_through, reply_reopened)
          VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, 'reply', 0, 1)`, [taskId, adminId, row.id, title, version, proof, now, now]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
    }
    await bootstrapPool.end(); bootstrapPool = null;
    configured = await createConfiguredServer(runtimeEnvironment, video ? { requestOrigin: origin, deviceTransition: true,
      recovery: true, crm: true, broadcast: true, accountClosures: true, backupDirectory: operationsRoot, video: true, ...(experience ? { experience: true, tasks: true } : {}) } : {});
    shutdown = createShutdown(configured);
    if (!configured.pool || !messaging && configured.mailWorker !== null) fail();
    // Stop the configured owner before listen: no SMTP, push, broadcast or
    // monitoring producer contacts any external endpoint in this fixture.
    if (messaging) { if (typeof configured.mailWorker?.stop !== "function") fail(); await configured.mailWorker.stop(); }
    if (compatibilityData) {
      const chatStore = createChatStore(configured.pool), storage = await createVideoStorage({ root: videoRoot, key: domainKeys.VIDEO }),
        videoStore = createVideoStore({ pool: configured.pool, chatStore, capacity: { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await storage.fingerprint() } }),
        messages = createVideoMessageStore({ pool: configured.pool, chatStore, videoStore });
      compatibilityWorker = createBroadcastWorker({ store: createBroadcastStore(configured.pool, { chatStore, videoStore, videoMessageStore: messages,
        key: domainKeys.MESSAGE, videoEnabled: true, videoCreationEnabled: false }), authStore: createAuthStore(configured.pool), key: domainKeys.MESSAGE, videoEnabled: true, batchSize: 1 });
    }
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
    async function notificationReference(role) {
      if (stopping || !messaging || !["admin", "client"].includes(role)) fail();
      const runtime = await configured.pool.getConnection();
      try {
        const rows = await runtime.query(`SELECT o.id AS notification, m.id AS message_id, m.sequence_no
          FROM push_outbox o JOIN push_subscriptions p ON p.id = o.subscription_id JOIN messages m ON m.id = o.message_id
          JOIN conversations c ON c.id = m.conversation_id WHERE p.user_id = ? AND p.role = ? AND c.admin_id = ? AND c.client_id = ?
          AND o.attempts = 0 AND o.status = 'pending' ORDER BY m.sequence_no DESC, o.id DESC LIMIT 1`, [role === "admin" ? adminId : clientId, role, adminId, clientId]);
        const row = rows[0];
        if (!Buffer.isBuffer(row?.notification) || row.notification.length !== 16 || !Buffer.isBuffer(row.message_id) || row.message_id.length !== 16
          || !/^[1-9][0-9]{0,19}$/.test(String(row.sequence_no))) fail();
        return Object.freeze({ notification: row.notification.toString("hex"), messageId: row.message_id.toString("hex"), sequence: String(row.sequence_no) });
      } catch { fail(); } finally { await runtime.release(); }
    }
    async function sessionRemainsActive(role, rawToken) {
      if (stopping || !messaging || !["admin", "client"].includes(role)) fail();
      let digest, runtime;
      try {
        digest = tokenDigest(rawToken); runtime = await configured.pool.getConnection();
        const rows = await runtime.query(`SELECT COUNT(*) AS amount FROM sessions WHERE token_hash = ? AND user_id = ?
          AND revoked_at IS NULL AND created_at <= UTC_TIMESTAMP(6) AND expires_at > UTC_TIMESTAMP(6)`, [digest, role === "admin" ? adminId : clientId]);
        return Number(rows[0]?.amount) === 1;
      } catch { fail(); }
      finally { digest?.fill(0); runtime?.release(); }
    }
    return Object.freeze({ origin, email, password, currentTotp, isTotpFresh, invalidTotp, recoveryCodes: Object.freeze([...recoveryCodes]), expireSession, stop,
      ...(video ? { primaryFixturePort: port, videoAttestation, videoFileCount: async () => (await readdir(videoRoot)).filter(name => VIDEO_FILE.test(name)).length } : {}),
      ...(compatibilityData ? { compatibilityData, async runExistingVideoCampaign() {
        if (stopping || !compatibilityWorker) fail();
        const result = await compatibilityWorker.runOnce();
        if (result.delivered !== 1 || result.deferred !== 0 || result.failed !== 0) fail();
        return result;
      }, async compatibilityState() {
        if (stopping) fail();
        const rows = await connection.query("SELECT (SELECT COUNT(*) FROM video_assets) AS videos,(SELECT COUNT(*) FROM message_video) AS links,(SELECT COUNT(*) FROM broadcast_campaigns) AS campaigns");
        return { videos: Number(rows[0].videos), links: Number(rows[0].links), campaigns: Number(rows[0].campaigns),
          repliesSha256: createHash("sha256").update(await readFile(join(operationsRoot, `quick-replies-${adminId.toString("hex")}.json`))).digest("hex") };
      } } : {}),
      ...(rollback185 ? { async rollback185State() {
        if (stopping) fail();
        const preferences = await connection.query("SELECT * FROM profile_preferences WHERE user_id = ?", [clientId]);
        const replies = await connection.query("SELECT * FROM crm_tasks WHERE admin_id = ? AND reply_kind = 'reply' ORDER BY id", [adminId]);
        const migrations = await connection.query("SELECT COUNT(*) AS amount FROM schema_migrations");
        const hash = rows => createHash("sha256").update(JSON.stringify(rows, (_, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
        return { migrations: Number(migrations[0].amount), preferences: preferences.length, replies: replies.length,
          preferencesSha256: hash(preferences), replySha256: hash(replies) };
      } } : {}),
      ...(experience ? { otherClient, async seedClientResetToken() {
        if (stopping) fail();
        const token = randomBytes(32).toString("base64url"), now = Date.now();
        await createResetStore(configured.pool).requestReset({ email: client.email, now,
          reset: { id: randomBytes(16), tokenHash: tokenDigest(token), expiresAt: now + 1800000 },
          mail: { id: randomBytes(16), payloadEncrypted: "synthetic-encrypted-reset-fixture" } });
        return token;
      }, async privatePreferencesState(forbiddenIds = []) {
        if (stopping || !Array.isArray(forbiddenIds) || forbiddenIds.some(id => typeof id !== "string")) fail();
        const rows = await connection.query("SELECT selection_encrypted FROM profile_preferences ORDER BY user_id");
        return { rows: rows.length, encrypted: rows.every(row => typeof row.selection_encrypted === "string" && row.selection_encrypted.length > 32
          && forbiddenIds.every(id => !row.selection_encrypted.includes(id))),
          digest: createHash("sha256").update(JSON.stringify(rows.map(row => row.selection_encrypted))).digest("hex") };
      } } : {}),
      ...(messaging ? { client, notificationSubscription, notificationReference, sessionRemainsActive, outsideOrigin: outside,
        externalApiNavigation: (role, kind) => { if (!Object.hasOwn(navigationPaths, role) || !Object.hasOwn(navigationPaths[role], kind)) fail(); return `${outside}/c01-navigation?role=${role}&kind=${kind}`; },
        sessionNavigations: () => navigationObservations.map(value => ({ ...value })) } : {}) });
  } catch (error) {
    let cleanupFailed = false;
    try { await stop(); } catch { cleanupFailed = true; }
    if (cleanupFailed) fail("AUTH_REHEARSAL_CLEANUP");
    if (error instanceof AuthenticationFixtureError) throw error;
    fail();
  }
}
