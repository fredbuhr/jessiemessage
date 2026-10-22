import { bindParentPeer } from "./http/peer-address.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequestAdmission } from "./http/admission.mjs";
import { createShutdown } from "./lifecycle.mjs";
import { createEntryHandler } from "./entry/http.mjs";
import { createRequestOriginGuard, isOriginFormTarget, RequestOriginError } from "./http/request-origin.mjs";
import { sessionToken } from "./auth/http.mjs";
import { getProcessRelease } from "./release.mjs";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const PRIMARY_ORIGIN = "https://jessiemessage.com";
const RECIPE_ORIGIN = "https://recette.jessiemessage.com";
// Release gate: compatibility 1.4.1 reads schema 32; 1.5.0 offers announcement creation.
const ANNOUNCEMENTS_ENABLED = true;
// Compatibility release reads schema 33; task editing is enabled in 1.6.0.
const TASKS_ENABLED = true;

const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/app", ["entry.html", "text/html; charset=utf-8"]],
  ["/help", ["help.html", "text/html; charset=utf-8"]],
  ["/help.css", ["help.css", "text/css; charset=utf-8"]],
  ["/help.js", ["help.js", "text/javascript; charset=utf-8"]],
  ["/help-link.js", ["help-link.js", "text/javascript; charset=utf-8"]],
  ["/notifications.js", ["notifications.js", "text/javascript; charset=utf-8"]],
  ["/notifications.css", ["notifications.css", "text/css; charset=utf-8"]],
  ["/session-clock.js", ["session-clock.js", "text/javascript; charset=utf-8"]],
  ["/notification-link.js", ["notification-link.js", "text/javascript; charset=utf-8"]],
  ["/image-preparation.js", ["image-preparation.js", "text/javascript; charset=utf-8"]],
  ["/emoji-catalog.js", ["emoji-catalog.js", "text/javascript; charset=utf-8"]],
  ["/emoji.css", ["emoji.css", "text/css; charset=utf-8"]],
  ["/profile.js", ["profile.js", "text/javascript; charset=utf-8"]],
  ["/profile.css", ["profile.css", "text/css; charset=utf-8"]],
  ["/i18n-profile.js", ["i18n-profile.js", "text/javascript; charset=utf-8"]],
  ["/entry.js", ["entry.js", "text/javascript; charset=utf-8"]],
  ["/entry-model.js", ["entry-model.js", "text/javascript; charset=utf-8"]],
  ["/entry.css", ["entry.css", "text/css; charset=utf-8"]],
  ["/i18n.js", ["i18n.js", "text/javascript; charset=utf-8"]],
  ["/i18n.css", ["i18n.css", "text/css; charset=utf-8"]],
  ["/i18n-access.js", ["i18n-access.js", "text/javascript; charset=utf-8"]],
  ["/i18n-admin.js", ["i18n-admin.js", "text/javascript; charset=utf-8"]],
  ["/i18n-chat.js", ["i18n-chat.js", "text/javascript; charset=utf-8"]],
  ["/i18n-tools.js", ["i18n-tools.js", "text/javascript; charset=utf-8"]],
  ["/i18n-readiness.js", ["i18n-readiness.js", "text/javascript; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/favicon.ico", ["favicon.ico", "image/x-icon"]],
  ["/apple-touch-icon.png", ["apple-touch-icon.png", "image/png"]],
  ["/brand/brand.css", ["brand/brand.css", "text/css; charset=utf-8"]],
  ["/brand/icon-16.png", ["brand/icon-16.png", "image/png"]],
  ["/brand/icon-32.png", ["brand/icon-32.png", "image/png"]],
  ["/brand/icon-48.png", ["brand/icon-48.png", "image/png"]],
  ["/brand/icon-64.png", ["brand/icon-64.png", "image/png"]],
  ["/brand/icon-128.png", ["brand/icon-128.png", "image/png"]],
  ["/brand/icon-192.png", ["brand/icon-192.png", "image/png"]],
  ["/brand/icon-512.png", ["brand/icon-512.png", "image/png"]],
  ["/brand/icon-maskable-512.png", ["brand/icon-maskable-512.png", "image/png"]],
]);

const securityHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
});

function reply(response, method, statusCode, contentType, body, headers = {}) {
  response.writeHead(statusCode, { ...securityHeaders, "Content-Type": contentType, ...headers });
  response.end(method === "HEAD" ? undefined : body);
}

export function createAppServer({ authHandler, accessHandler, chatHandler, mediaHandler, profileHandler, crmHandler, resetHandler, readinessHandler, broadcastHandler, announcementsHandler, tasksHandler, notificationsHandler, backupHandler, privacyHandler, closureHandler,
  entryHandler = createEntryHandler(), admission = createRequestAdmission(), operations = null, requestOrigin = null,
  legacyHandlers = null, transitionHandler = null, parentGateway = false } = {}) {
  if (typeof parentGateway !== "boolean") throw new RequestOriginError();
  const requestOriginAllowed = requestOrigin === null ? null : createRequestOriginGuard(requestOrigin);
  let legacyOriginAllowed = null, legacyChain = null;
  if (legacyHandlers !== null) {
    const names = ["authHandler", "accessHandler", "chatHandler", "mediaHandler", "profileHandler", "crmHandler", "resetHandler", "readinessHandler", "broadcastHandler", "announcementsHandler", "tasksHandler", "notificationsHandler", "entryHandler"];
    if (requestOrigin !== PRIMARY_ORIGIN || !legacyHandlers || Object.getPrototypeOf(legacyHandlers) !== Object.prototype
      || Object.getOwnPropertySymbols(legacyHandlers).length
      || Object.getOwnPropertyNames(legacyHandlers).some(name => !names.includes(name))
      || names.some(name => { const property = Object.getOwnPropertyDescriptor(legacyHandlers, name); return property && (!Object.hasOwn(property, "value") || property.value !== undefined && typeof property.value !== "function"); })
      || typeof legacyHandlers.entryHandler !== "function") throw new RequestOriginError();
    legacyOriginAllowed = createRequestOriginGuard(RECIPE_ORIGIN);
    legacyChain = [transitionHandler, legacyHandlers.entryHandler, ...names.slice(0, -1).reverse().map(name => legacyHandlers[name])].filter(Boolean);
  }
  if (transitionHandler !== null && (typeof transitionHandler !== "function" || legacyChain === null)) throw new RequestOriginError();
  if (operations !== null && typeof operations?.publicStatus !== "function") throw new TypeError("A cached operations monitor is required.");
  if (typeof entryHandler !== "function") throw new TypeError("An entry handler is required.");
  const privateHandlers = [closureHandler, privacyHandler, backupHandler, notificationsHandler, tasksHandler, announcementsHandler, broadcastHandler, readinessHandler, resetHandler, crmHandler, profileHandler, mediaHandler, chatHandler, accessHandler, authHandler].filter(Boolean);
  const handlers = [transitionHandler, entryHandler, ...privateHandlers].filter(Boolean);
  const adminPages = new Map([["/admin", "authHandler"], ["/admin/messages", "chatHandler"], ["/admin/broadcasts", "broadcastHandler"], ["/admin/announcements", "announcementsHandler"], ["/admin/tasks", "tasksHandler"],
    ["/admin/readiness", "readinessHandler"], ["/admin/backups", "backupHandler"], ["/admin/privacy", "privacyHandler"], ["/admin/closures", "closureHandler"]]);
  const primaryPageHandlers = { authHandler, chatHandler, broadcastHandler, announcementsHandler, tasksHandler, readinessHandler, backupHandler, privacyHandler, closureHandler };
  const protectedFiles = new Set(["/admin", "/messages", "/admin/messages", "/admin/broadcasts", "/admin/readiness", "/admin/backups", "/backups.js", "/backups.css", "/i18n-backups.js",
    "/manual-backups.js", "/manual-backups.css", "/i18n-manual-backups.js",
    "/admin/privacy", "/privacy.js", "/privacy.css", "/i18n-privacy.js", "/admin/closures", "/closures.js", "/closures.css", "/i18n-closures.js", "/broadcast.js", "/broadcast-model.js", "/broadcast.css",
    "/crm.js", "/crm-model.js", "/crm.css", "/private-archive.js", "/client-archive.js", "/conversation-download.js", "/readiness.js", "/readiness-model.js", "/readiness.css",
    "/admin/announcements", "/announcements.js", "/announcements-model.js", "/announcements.css", "/announcement-banner.js", "/announcement-banner.css",
    "/admin/tasks", "/tasks.js", "/tasks-model.js", "/tasks.css"]);
  let draining = false;
  let pendingRequests = 0;
  const requestWaiters = new Set();
  async function handleRequest(request, response) {
    const method = request.method ?? "GET";
    // The hosting frontend terminates TLS for these configured HTTPS origins.
    // Keep the policy at the outer boundary so private handlers and errors
    // retain it too; forwarding headers never opt a neutral server into HSTS.
    if (requestOriginAllowed?.(request) || legacyOriginAllowed?.(request)) {
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    if (parentGateway) {
      try { bindParentPeer(request); }
      catch { request.resume(); reply(response, method, 503, "application/json", '{"error":"service_unavailable"}', { Connection: "close" }); return; }
    }
    let activeHandlers = handlers;
    let activeNotifications = notificationsHandler;
    if (draining) {
      response.writeHead(503, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", Connection: "close" });
      response.end(method === "HEAD" ? undefined : '{"error":"service_unavailable"}');
      request.resume();
      return;
    }
    if (requestOriginAllowed) {
      // A reverse proxy may probe with its own Host. This exact public endpoint
      // remains a fixed process signal, with no handlers, admission or SQL.
      if (isOriginFormTarget(request.url) && request.url.split("?", 1)[0] === "/api/health") {
        if (!["GET", "HEAD"].includes(method)) {
          reply(response, method, 405, "application/json; charset=utf-8", '{"error":"method_not_allowed"}', { Allow: "GET, HEAD", Connection: "close" });
          request.resume(); return;
        }
        reply(response, method, 200, "application/json; charset=utf-8", '{"status":"ok"}');
        return;
      }
      if (!requestOriginAllowed(request)) {
        if (legacyOriginAllowed?.(request)) {
          activeHandlers = legacyChain;
          activeNotifications = legacyHandlers.notificationsHandler;
        } else {
          reply(response, method, 421, "application/json; charset=utf-8", '{"error":"misdirected_request"}', { Connection: "close" });
          request.resume(); return;
        }
      }
    }
    let pathname, url;
    try { url = new URL(request.url ?? "/", "http://localhost"); pathname = url.pathname; }
    catch { reply(response, method, 400, "application/json; charset=utf-8", '{"error":"bad_request"}'); return; }
    // This endpoint reads only the monitor's cache. It bypasses private route
    // handlers/admission, never authenticates and never allocates SQL work.
    if (pathname === "/api/ready") {
      if (!["GET", "HEAD"].includes(method)) {
        reply(response, method, 405, "application/json; charset=utf-8", '{"error":"method_not_allowed"}', { Allow: "GET, HEAD", Connection: "close" });
        request.resume(); return;
      }
      if ([...url.searchParams].length) { reply(response, method, 400, "application/json; charset=utf-8", '{"error":"bad_request"}'); return; }
      let available = false;
      try { available = operations?.publicStatus()?.status === "ready"; } catch {}
      reply(response, method, available ? 200 : 503, "application/json; charset=utf-8",
        JSON.stringify({ status: available ? "ready" : "unavailable" }), available ? {} : { "Retry-After": "15" });
      return;
    }
    let done;
    try {
      if ((privateHandlers.length || pathname === "/api/entry") && (pathname.startsWith("/api/") && pathname !== "/api/health" || protectedFiles.has(pathname))) {
        done = admission.enter(request, response);
      }
    } catch (error) {
      const limited = ["REQUEST_RATE_LIMIT", "REQUEST_BUSY"].includes(error?.code);
      const retry = Number.isSafeInteger(error?.retryAfter) ? Math.max(1, Math.min(60, error.retryAfter)) : 5;
      response.writeHead(limited ? 429 : 503, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", Connection: "close",
        ...(limited ? { "Retry-After": String(retry) } : {}) });
      response.end(method === "HEAD" ? undefined : JSON.stringify({ error: limited ? "try_again_later" : "service_unavailable" }));
      request.resume();
      return;
    }
    try {
      // Strict cookies are deliberately absent on a navigation from another
      // site. First load a public same-origin document; its session fetch can
      // prove the existing login. Never let this navigation erase that cookie.
      const pageHandlers = activeHandlers === legacyChain ? legacyHandlers : primaryPageHandlers;
      if (["GET", "HEAD"].includes(method) && pageHandlers?.authHandler && pageHandlers[adminPages.get(pathname)]
        && (request.headers["sec-fetch-mode"] === "navigate" || /(?:^|[,;\s])text\/html(?:$|[,;\s])/i.test(request.headers.accept ?? ""))
        && !sessionToken(request)) {
        const destination = pathname === "/admin" ? "/admin/login" : `/admin/login?continue=${encodeURIComponent(pathname)}`;
        reply(response, method, 303, "text/html; charset=utf-8", "", { Location: destination });
        return;
      }
      for (const handler of activeHandlers) {
        try { if (await handler(request, response)) return; }
        catch {
          if (response.headersSent) response.destroy();
          else reply(response, method, 503, "application/json; charset=utf-8", '{"error":"service_unavailable"}');
          return;
        }
      }
      if (method !== "GET" && method !== "HEAD") {
        reply(response, method, 405, "application/json; charset=utf-8", '{"error":"method_not_allowed"}');
        return;
      }

      if (pathname === "/api/health") {
        reply(response, method, 200, "application/json; charset=utf-8", '{"status":"ok"}');
        return;
      }

      // Authentication is registered only by explicit private configuration.
      // Private routes require their explicitly configured feature handlers.
      // Never serve arbitrary file paths from the filesystem.
      const file = pathname === "/sw.js" && activeNotifications ? ["sw.js", "text/javascript; charset=utf-8"] : publicFiles.get(pathname);
      if (!file) {
        reply(response, method, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }

      try {
        const bytes = await readFile(join(publicRoot, file[0]));
        reply(response, method, 200, file[1], bytes, pathname === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {});
      } catch {
        reply(response, method, 500, "text/plain; charset=utf-8", "Internal server error");
      }
    } finally { done?.(); }
  }
  const server = createServer(async (request, response) => {
    pendingRequests += 1;
    try { await handleRequest(request, response); }
    finally {
      pendingRequests -= 1;
      if (pendingRequests === 0) {
        for (const resolve of requestWaiters) resolve();
        requestWaiters.clear();
      }
    }
  });
  server.beginDrain = () => { draining = true; };
  server.waitForRequests = () => pendingRequests === 0 ? Promise.resolve() : new Promise((resolve) => { requestWaiters.add(resolve); });
  server.requestTimeout = mediaHandler ? 35000 : 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function createConfiguredServer(env = process.env, options = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).some(name => !["requestOrigin", "clock", "deviceTransition", "recovery", "crm", "broadcast", "announcements", "tasks", "backupDirectory", "accountClosures", "parentGateway"].includes(name))
    || Object.values(Object.getOwnPropertyDescriptors(options)).some(property => !Object.hasOwn(property, "value"))) throw new RequestOriginError();
  const requestOrigin = Object.hasOwn(options, "requestOrigin") ? options.requestOrigin : null;
  const clock = Object.hasOwn(options, "clock") ? options.clock : Date.now;
  const deviceTransition = Object.hasOwn(options, "deviceTransition") ? options.deviceTransition : false;
  const recovery = Object.hasOwn(options, "recovery") ? options.recovery : false;
  const crm = Object.hasOwn(options, "crm") ? options.crm : false;
  const broadcast = Object.hasOwn(options, "broadcast") ? options.broadcast : false;
  const announcements = Object.hasOwn(options, "announcements") ? options.announcements : broadcast && ANNOUNCEMENTS_ENABLED;
  const tasks = Object.hasOwn(options, "tasks") ? options.tasks : crm && TASKS_ENABLED;
  const backupDirectory = Object.hasOwn(options, "backupDirectory") ? options.backupDirectory : undefined;
  const parentGateway = Object.hasOwn(options, "parentGateway") ? options.parentGateway : false;
  const accountClosures = Object.hasOwn(options, "accountClosures") ? options.accountClosures : false;
  if (typeof parentGateway !== "boolean" || parentGateway && requestOrigin !== PRIMARY_ORIGIN || typeof deviceTransition !== "boolean" || typeof recovery !== "boolean" || typeof crm !== "boolean" || typeof clock !== "function"
    || typeof broadcast !== "boolean" || broadcast && !crm || typeof announcements !== "boolean" || announcements && !broadcast
    || typeof tasks !== "boolean" || tasks && !crm
    || typeof accountClosures !== "boolean" || accountClosures && backupDirectory === undefined
    || deviceTransition && requestOrigin !== PRIMARY_ORIGIN || recovery && !deviceTransition || crm && !recovery
    || backupDirectory !== undefined && (!broadcast || typeof backupDirectory !== "string" || !backupDirectory.startsWith("/")
      || backupDirectory === "/" || /[\\\x00-\x1f\x7f]/.test(backupDirectory) || backupDirectory.split("/").slice(1).some(part => !part || part === "." || part === ".."))) throw new RequestOriginError();
  if (requestOrigin !== null) createRequestOriginGuard(requestOrigin);
  const { authConfiguration } = await import("./auth/config.mjs");
  const { accessConfiguration } = await import("./access/config.mjs");
  const { chatConfiguration } = await import("./chat/config.mjs");
  const { mediaConfiguration } = await import("./media/config.mjs");
  const { crmConfiguration } = await import("./crm/config.mjs");
  const { clientRecoveryConfiguration } = await import("./reset/config.mjs");
  const { broadcastConfiguration } = await import("./broadcast/config.mjs");
  const { loadNotificationsConfig } = await import("./notifications/config.mjs");
  const config = authConfiguration(env);
  if (requestOrigin !== null && (!config.enabled || config.origin !== requestOrigin)) throw new RequestOriginError();
  const accessConfig = accessConfiguration(env);
  const chatConfig = chatConfiguration(env);
  const mediaConfig = mediaConfiguration(env);
  const crmConfig = crmConfiguration(env);
  const resetConfig = clientRecoveryConfiguration(env);
  const broadcastConfig = broadcastConfiguration(env, { crmEnabled: crmConfig.enabled });
  const notificationsConfig = loadNotificationsConfig(env);
  if (deviceTransition) {
    const { inspectPreproductionConfiguration } = await import("./preflight/config.mjs");
    const profile = inspectPreproductionConfiguration(env, { expectedOrigin: PRIMARY_ORIGIN,
      target: broadcast ? "messaging-photos-notify-recovery-crm-broadcast" : crm ? "messaging-photos-notify-recovery-crm" : recovery ? "messaging-photos-notify-recovery" : "messaging-photos-notify", originProfile: "primary" });
    // The operator loader requires verified TLS. The lower-level server keeps
    // runtimeDatabaseOptions' existing, explicit loopback test policy so SQL
    // rehearsals exercise these same factories without a deployment bypass.
    if (profile.checks.some(check => check.name !== "database_tls" && check.status === "fail")
      || ![config, accessConfig, chatConfig, mediaConfig, notificationsConfig].every(value => value.enabled === true)
      || crmConfig.enabled !== crm || resetConfig.enabled !== recovery || broadcastConfig.enabled !== broadcast) throw new RequestOriginError();
  }
  if (!config.enabled) return { server: createAppServer({ requestOrigin, parentGateway }), pool: null };
  const { mailConfiguration } = await import("./mail/config.mjs");
  const mailConfig = mailConfiguration(env);
  const { createRuntimePool } = await import("./db/runtime.mjs");
  const { createAuthStore } = await import("./auth/store.mjs");
  const { createAuthService } = await import("./auth/service.mjs");
  const { createAuthHandler } = await import("./auth/http.mjs");
  const { createOperationsStore } = await import("./operations/store.mjs");
  const { createOperationsMonitor } = await import("./operations/monitor.mjs");
  const pool = await createRuntimePool(env);
  let transport, operations, notificationTransport, notificationWorker, closureHandler;
  try {
    const store = createAuthStore(pool, { clock });
    await store.assertSchema();
    const service = await createAuthService({ store, totpKey: config.totpKey, clock });
    const authHandler = createAuthHandler(service, { origin: config.origin, clock });
    let backupHandler, privacyHandler, crmHandler, chatHandler;
    if (backupDirectory !== undefined) {
      const [{ withPrivateDirectory }, { assertNoOperationalRestore }] = await Promise.all([
        import("./files/private-directory.mjs"), import("./backup/operational-checkpoint.mjs")]);
      await withPrivateDirectory(backupDirectory, assertNoOperationalRestore);
      if (accountClosures) {
        const [{ createManualBackupService }, { createManualBackupHandler }] = await Promise.all([
          import("./backup/manual-backup-service.mjs"), import("./backup/manual-backup-http.mjs")]);
        backupHandler = createManualBackupHandler(createManualBackupService(backupDirectory, { clock }), { origin: config.origin, actor: token => service.session(token) });
      } else {
        const [{ createBackupCopyService }, { createBackupCopyHandler }] = await Promise.all([import("./backup/copy-service.mjs"), import("./backup/copy-http.mjs")]);
        backupHandler = createBackupCopyHandler(createBackupCopyService(backupDirectory), { origin: config.origin, actor: token => service.session(token), clock });
      }
      const [{ createPrivacyService }, { createPrivacyHandler }] = await Promise.all([import("./privacy/service.mjs"), import("./privacy/http.mjs")]);
      privacyHandler = createPrivacyHandler(await createPrivacyService({ directory: backupDirectory, key: crmConfig.key, clock, accountClosures }),
        { origin: config.origin, actor: token => service.session(token) });
      const { createClosureHandler, disabledClosureService } = await import("./data/closure-http.mjs");
      closureHandler = createClosureHandler(disabledClosureService(), { origin: config.origin, actor: token => service.session(token) });
    }
    const legacyHandlers = deviceTransition ? { authHandler: createAuthHandler(service, { origin: RECIPE_ORIGIN, clock }) } : null;
    const workerNames = [accessConfig.enabled ? "verification" : null, resetConfig.enabled ? "recovery" : null,
      broadcastConfig.enabled ? "broadcasts" : null, notificationsConfig.enabled ? "notifications" : null].filter(Boolean);
    operations = createOperationsMonitor({
      store: createOperationsStore({ pool, verification: accessConfig.enabled, recovery: resetConfig.enabled, broadcasts: broadcastConfig.enabled, notifications: notificationsConfig.enabled }),
      messagingConfigured: accessConfig.enabled && chatConfig.enabled, workerNames,
      report: (event) => {
        const line = `JessieMessage operations ${JSON.stringify(event)}`;
        if (event.event.endsWith("_recovered")) console.info(line); else console.error(line);
      },
    });
    const { createReadinessService } = await import("./readiness/service.mjs");
    const { createReadinessHandler } = await import("./readiness/http.mjs");
    const readinessService = await createReadinessService({ authService: service, authStore: store, mailConfig, key: config.totpKey, operations,
      features: { clientAccess: accessConfig.enabled, chat: chatConfig.enabled, photos: mediaConfig.enabled,
        clientFiles: crmConfig.enabled, passwordRecovery: resetConfig.enabled, broadcasts: broadcastConfig.enabled, notifications: notificationsConfig.enabled } });
    const readinessHandler = createReadinessHandler(readinessService, { origin: config.origin });
    if (legacyHandlers) {
      // The old authority preserves its existing session/chat routes. Recovery
      // is offered only on the primary authority, including its diagnostics.
      const legacyReadiness = resetConfig.enabled ? {
        actor: (...args) => readinessService.actor(...args),
        summary: async (...args) => {
          const summary = await readinessService.summary(...args);
          return { ...summary, features: { ...summary.features, passwordRecovery: false } };
        },
        verifySmtp: (...args) => readinessService.verifySmtp(...args),
      } : readinessService;
      legacyHandlers.readinessHandler = createReadinessHandler(legacyReadiness, { origin: RECIPE_ORIGIN });
    }
    let diagnosticClosing;
    const diagnostics = { close() {
      if (!diagnosticClosing) diagnosticClosing = Promise.allSettled([readinessService.close(), operations.close(), closureHandler?.close(), privacyHandler?.close(), backupHandler?.close(), crmHandler?.close?.(), legacyHandlers?.crmHandler?.close?.(), chatHandler?.close?.(), legacyHandlers?.chatHandler?.close?.()]).then((results) => {
        if (results.some((result) => result.status === "rejected")) throw new Error("Private diagnostics could not close cleanly.");
      });
      return diagnosticClosing;
    } };
    const observe = (name) => (event) => operations.observe(name, event);
    if (!accessConfig.enabled) {
      const server = createAppServer({ authHandler, readinessHandler, operations, requestOrigin, parentGateway,
        entryHandler: createEntryHandler({ adminSession: (token) => service.session(token) }) });
      server.once("listening", () => operations.start());
      return { server, pool, mailWorker: null, diagnostics };
    }
    const { createAccessStore } = await import("./access/store.mjs");
    const { createAccessService } = await import("./access/service.mjs");
    const { createAccessHandler } = await import("./access/http.mjs");
    const { createMailStore } = await import("./mail/store.mjs");
    const { createVerificationTransport } = await import("./mail/transport.mjs");
    const { startMailWorker } = await import("./mail/worker.mjs");
    const accessStore = createAccessStore(pool, { clock });
    const mailStore = createMailStore(pool);
    await accessStore.assertSchema();
    await mailStore.assertSchema();
    const accessService = await createAccessService({ store: accessStore, authStore: store, authService: service,
      totpKey: config.totpKey, mailKey: accessConfig.mail.key, origin: config.origin, clock });
    const legacyAccessService = deviceTransition ? await createAccessService({ store: accessStore, authStore: store, authService: service,
      totpKey: config.totpKey, mailKey: accessConfig.mail.key, origin: RECIPE_ORIGIN, clock }) : null;
    if (legacyHandlers) legacyHandlers.accessHandler = createAccessHandler(legacyAccessService, { origin: RECIPE_ORIGIN, clock });
    let resetHandler;
    let resetMailStore;
    if (resetConfig.enabled) {
      const { createResetStore } = await import("./reset/store.mjs");
      const { createResetMailStore } = await import("./reset/mail-store.mjs");
      const { createResetService } = await import("./reset/service.mjs");
      const { createResetHandler } = await import("./reset/http.mjs");
      const resetStore = createResetStore(pool, { clock });
      resetMailStore = createResetMailStore(pool);
      await resetStore.assertSchema();
      await resetMailStore.assertSchema();
      const resetService = await createResetService({ store: resetStore, authStore: store, mailKey: resetConfig.key, clock });
      resetHandler = createResetHandler(resetService, { origin: resetConfig.origin });
    }
    let mediaHandler, profileHandler;
    let broadcastHandler;
    let announcementsHandler, tasksHandler;
    let notificationsHandler;
    let broadcastWorker;
    if (chatConfig.enabled) {
      const { createChatStore } = await import("./chat/store.mjs");
      const { createChatService } = await import("./chat/service.mjs");
      const { createChatHandler } = await import("./chat/http.mjs");
      const notificationsModule = notificationsConfig.enabled ? await import("./notifications/store.mjs") : null;
      const chatStore = createChatStore(pool, { clock, ...(notificationsModule ? { enqueueNotification: notificationsModule.enqueueNotification } : {}) });
      await chatStore.assertSchema();
      const chatService = await createChatService({ store: chatStore, authStore: store, authService: service,
        accessService, key: chatConfig.key, clock });
      if (notificationsConfig.enabled) {
        const { createNotificationsService } = await import("./notifications/service.mjs");
        const { createNotificationsHttpHandler } = await import("./notifications/http.mjs");
        const { createNotificationTransport } = await import("./notifications/transport.mjs");
        const { createNotificationWorker } = await import("./notifications/worker.mjs");
        const notificationsStore = notificationsModule.createNotificationsStore({ pool, chatStore, key: notificationsConfig.key, clock });
        await notificationsStore.assertSchema();
        const notificationsService = await createNotificationsService({ store: notificationsStore, config: notificationsConfig,
          chatService, authStore: store, clock });
        notificationsHandler = createNotificationsHttpHandler(notificationsService, { origin: notificationsConfig.origin });
        if (legacyHandlers) legacyHandlers.notificationsHandler = createNotificationsHttpHandler(notificationsService, { origin: RECIPE_ORIGIN });
        notificationTransport = createNotificationTransport(notificationsConfig);
        notificationWorker = createNotificationWorker({ store: notificationsStore, transport: notificationTransport,
          config: notificationsConfig, clock, onState: observe("notifications"),
          onError: () => console.error("JessieMessage notifications delivery unavailable.") });
      }
      // Chat history joins attachment metadata even when image transfer is off.
      // Verify those tables before accepting any private history requests.
      const { createMediaStore } = await import("./media/store.mjs");
      let mediaStorage, mediaCapacity, mediaService;
      if (mediaConfig.enabled) {
        const { createMediaStorage } = await import("./media/storage.mjs");
        mediaStorage = await createMediaStorage({ root: mediaConfig.root, key: mediaConfig.key });
        mediaCapacity = { ...mediaConfig.capacity, rootFingerprint: await mediaStorage.fingerprint() };
      }
      const mediaStore = createMediaStore({ pool, chatStore, capacity: mediaCapacity });
      await mediaStore.assertSchema();
      const { createConversationExporter } = await import("./chat/conversation-export.mjs");
      const clientConversationExporter = createConversationExporter({ role: "client", history: (token, id, options) => chatService.messages("client", token, id, options),
        photo: mediaConfig.enabled ? (token, id, message) => mediaService.exportClientMessageAsset(token, id, message) : null, clock });
      if (crmConfig.enabled) {
        const { createCrmStore } = await import("./crm/store.mjs");
        const { createCrmService } = await import("./crm/service.mjs");
        const { createCrmHandler } = await import("./crm/http.mjs");
        const crmStore = createCrmStore({ pool, chatStore });
        await crmStore.assertSchema();
        const crmService = await createCrmService({ store: crmStore, authStore: store, authService: service, key: crmConfig.key, clock });
        const conversationExporter = createConversationExporter({ history: (token, id, options) => chatService.messages("admin", token, id, options),
          photo: mediaConfig.enabled ? (token, id, message) => mediaService.exportMessageAsset(token, id, message) : null, clock });
        crmHandler = createCrmHandler(crmService, { origin: crmConfig.origin, conversationExporter });
        if (legacyHandlers) legacyHandlers.crmHandler = createCrmHandler(crmService, { origin: RECIPE_ORIGIN, conversationExporter });
        const { createTasksStore } = await import("./tasks/store.mjs");
        const tasksStore = createTasksStore({ pool, chatStore, key: crmConfig.key, clock });
        await tasksStore.assertSchema();
        if (tasks) {
          const [{ createTasksService }, { createTasksHttpHandler }] = await Promise.all([
            import("./tasks/service.mjs"), import("./tasks/http.mjs")]);
          const tasksService = await createTasksService({ store: tasksStore, authStore: store, authService: service, key: crmConfig.key, clock });
          tasksHandler = createTasksHttpHandler(tasksService, { origin: crmConfig.origin });
          if (legacyHandlers) legacyHandlers.tasksHandler = createTasksHttpHandler(tasksService, { origin: RECIPE_ORIGIN });
        }
      }
      if (mediaConfig.enabled) {
        const { createMediaCapacityStore } = await import("./media/capacity-store.mjs");
        const { createMediaService } = await import("./media/service.mjs");
        const { createMediaHandler } = await import("./media/http.mjs");
        const capacityStore = createMediaCapacityStore({ pool, capacity: mediaCapacity });
        if (!(await capacityStore.status()).ready) {
          const error = new Error("Private media capacity must be initialized offline.");
          error.code = "MEDIA_CAPACITY_UNAVAILABLE"; throw error;
        }
        mediaService = await createMediaService({ store: mediaStore, chatService, authStore: store,
          storage: mediaStorage, key: mediaConfig.key, minimumFreeBytes: mediaConfig.minimumFreeBytes });
        if (backupDirectory !== undefined) {
          const [{ createErasureStore }, { createErasureJournal, readErasureJournalBatch }, { verifyClosureStartup },
            { createClosureService, createClosureTargets }, { createClosureHandler }] = await Promise.all([
            import("./data/erasure-store.mjs"), import("./data/erasure-journal.mjs"), import("./data/closure-operations.mjs"),
            import("./data/closure-service.mjs"), import("./data/closure-http.mjs")]);
          const erasureStore = createErasureStore({ pool, database: env.JESSIEMESSAGE_DB_NAME, capacity: mediaCapacity, broadcastKey: chatConfig.key });
          // This read-only check applies even when closure requests are disabled.
          // A downgrade to 0.64 must not ignore a receipt or a pending intent.
          await verifyClosureStartup({ store: erasureStore, clock,
            batch: page => readErasureJournalBatch({ directory: backupDirectory, key: crmConfig.key, binding: erasureStore.binding, ...page }) });
          if (accountClosures) {
            closureHandler.close();
            closureHandler = createClosureHandler(createClosureService({ directory: backupDirectory, key: crmConfig.key, store: erasureStore,
              target: createClosureTargets(pool), clock }, { journalFor: clientId => createErasureJournal({ directory: backupDirectory, key: crmConfig.key, binding: erasureStore.binding, clientId }) }),
            { origin: config.origin, actor: token => service.session(token) });
          }
        }
        mediaHandler = createMediaHandler(mediaService, { origin: mediaConfig.origin });
        if (legacyHandlers) legacyHandlers.mediaHandler = createMediaHandler(mediaService, { origin: RECIPE_ORIGIN });
      }
      const [{ createProfileStore }, { createProfileService }, { createProfileHandler }] = await Promise.all([
        import("./profile/store.mjs"), import("./profile/service.mjs"), import("./profile/http.mjs")]);
      const profileStore = createProfileStore({ pool, chatStore });
      await profileStore.assertSchema();
      const profileService = await createProfileService({ store: profileStore, chatService, storage: mediaStorage ?? null,
        authStore: store, key: chatConfig.key, clock });
      profileHandler = createProfileHandler(profileService, { origin: chatConfig.origin });
      if (legacyHandlers) legacyHandlers.profileHandler = createProfileHandler(profileService, { origin: RECIPE_ORIGIN });
      const profileCapabilities = { profileEnabled: true, avatarsEnabled: mediaConfig.enabled, announcementsEnabled: announcements, tasksEnabled: tasks && crmConfig.enabled };
      chatHandler = createChatHandler(chatService, { origin: chatConfig.origin, clientConversationExporter, ...profileCapabilities });
      if (legacyHandlers) legacyHandlers.chatHandler = createChatHandler(chatService, { origin: RECIPE_ORIGIN, clientConversationExporter, ...profileCapabilities });
      if (broadcastConfig.enabled) {
        const { createBroadcastStore } = await import("./broadcast/store.mjs");
        const { createBroadcastService } = await import("./broadcast/service.mjs");
        const { createBroadcastHandler } = await import("./broadcast/http.mjs");
        const { createBroadcastWorker } = await import("./broadcast/worker.mjs");
        const broadcastStore = createBroadcastStore(pool, { chatStore, mediaEnabled: mediaConfig.enabled, clock });
        await broadcastStore.assertSchema();
        const broadcastService = await createBroadcastService({ store: broadcastStore, authStore: store, authService: service,
          key: chatConfig.key, mediaEnabled: mediaConfig.enabled, largeAudiencesEnabled: true, clock });
        broadcastHandler = createBroadcastHandler(broadcastService, { origin: chatConfig.origin, mediaEnabled: mediaConfig.enabled });
        if (legacyHandlers) legacyHandlers.broadcastHandler = createBroadcastHandler(broadcastService, { origin: RECIPE_ORIGIN, mediaEnabled: mediaConfig.enabled });
        broadcastWorker = createBroadcastWorker({ store: broadcastStore, authStore: store, key: chatConfig.key, clock, onState: observe("broadcasts") });
        if (announcements) {
          const [{ createAnnouncementsStore }, { createAnnouncementsService }, { createAnnouncementsHandler }] = await Promise.all([
            import("./announcements/store.mjs"), import("./announcements/service.mjs"), import("./announcements/http.mjs")]);
          const announcementsStore = createAnnouncementsStore({ pool, chatStore, broadcastStore, key: chatConfig.key, clock });
          await announcementsStore.assertSchema();
          const announcementsService = await createAnnouncementsService({ store: announcementsStore, broadcastService, chatService,
            authService: service, authStore: store, key: chatConfig.key, clock });
          announcementsHandler = createAnnouncementsHandler(announcementsService, { origin: chatConfig.origin });
          if (legacyHandlers) legacyHandlers.announcementsHandler = createAnnouncementsHandler(announcementsService, { origin: RECIPE_ORIGIN });
        }
      }
    }
    transport = await createVerificationTransport(accessConfig.mail);
    let transitionHandler = null;
    if (deviceTransition) {
      const { createDeviceTransitionHandler } = await import("./transition/http.mjs");
      transitionHandler = createDeviceTransitionHandler({ authService: service, accessService, clock, admission: null });
      legacyHandlers.entryHandler = createEntryHandler({ adminSession: (token) => service.session(token),
        clientSession: (token) => legacyAccessService.session(token), chatEnabled: chatConfig.enabled, clock });
    }
    const server = createAppServer({ authHandler, accessHandler: createAccessHandler(accessService, { origin: config.origin, clock }), chatHandler, mediaHandler, profileHandler, crmHandler, resetHandler, readinessHandler, broadcastHandler, announcementsHandler, tasksHandler, notificationsHandler, backupHandler, privacyHandler, closureHandler, operations, requestOrigin, parentGateway,
      legacyHandlers, transitionHandler,
      entryHandler: createEntryHandler({ adminSession: (token) => service.session(token), clientSession: (token) => accessService.session(token), chatEnabled: chatConfig.enabled, deviceTransition, clock }) });
    const workers = [];
    let closing, stopping, aborting;
    const mailWorker = {
      stop() {
        if (!stopping) {
          // Calling stop signals every producer before any drain is awaited.
          const drains = [notificationWorker?.stop(), broadcastWorker?.stop(), ...workers.map((worker) => worker.stop())];
          stopping = Promise.allSettled(drains).then((results) => {
            if (results.some((result) => result.status === "rejected")) throw new Error("Private workers could not stop cleanly.");
          });
        }
        return stopping;
      },
      abort() {
        if (!aborting) aborting = Promise.allSettled([transport.close(), notificationTransport?.close()]).then((results) => {
          if (results.some((result) => result.status === "rejected")) throw new Error("Private transports could not close cleanly.");
        });
        return aborting;
      },
      close() {
        if (!closing) closing = (async () => {
          try { await mailWorker.stop(); }
          finally { await mailWorker.abort(); }
        })();
        return closing;
      },
    };
    // Queue delivery starts only once the HTTP listener is available, and stops
    // before the application pool is closed during graceful shutdown.
    server.once("listening", () => {
      if (stopping || closing) return;
      operations.start();
      broadcastWorker?.start();
      notificationWorker?.start();
      workers.push(startMailWorker({ store: mailStore, transport, key: accessConfig.mail.key, closeTransport: false,
        onState: observe("verification") }));
      if (resetMailStore) workers.push(startMailWorker({ store: resetMailStore, transport, key: resetConfig.key, purpose: "password-reset", closeTransport: false,
        onState: observe("recovery") }));
    });
    return { server, pool, mailWorker, diagnostics };
  } catch {
    closureHandler?.close();
    await notificationTransport?.close().catch(() => {});
    await notificationWorker?.stop().catch(() => {});
    await operations?.close().catch(() => {});
    await transport?.close().catch(() => {});
    await pool.end().catch(() => {});
    throw new Error("Authentication startup failed; check private configuration, database schema and runtime permissions.");
  }
}

export async function start(env = process.env, options = {}) {
  const release = getProcessRelease();
  const rawPort = Number(env.PORT ?? 3000);
  const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
  const { server, pool, mailWorker, diagnostics } = await createConfiguredServer(env, options);
  const drain = createShutdown({ server, pool, mailWorker, diagnostics });
  let listening = false, rejectBinding;
  const shutdown = (exitCode = 0) => {
    if (exitCode) process.exitCode = exitCode;
    return drain().then((result) => {
      if (result.failed || result.timedOut) process.exitCode = 1;
      if (result.timedOut) {
        console.error("JessieMessage shutdown deadline reached; pending operations remain uncertain.");
        process.exit(1);
      }
    });
  };
  const onError = () => {
    console.error("JessieMessage HTTP listener unavailable.");
    if (!listening) rejectBinding?.();
    else void shutdown(1);
  };
  const onSignal = () => {
    if (!listening) { rejectBinding?.(); void drain(); }
    else void shutdown();
  };
  server.once("error", onError);
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  let onListening, onClose;
  try {
    await new Promise((resolveBinding, reject) => {
      rejectBinding = () => reject(new Error("JessieMessage HTTP listener could not start."));
      onListening = () => {
        listening = true;
        console.info(`JessieMessage listening on port ${port}`);
        console.info(JSON.stringify({ version: 1, type: "application_started", release }));
        resolveBinding();
      };
      onClose = () => { if (!listening) rejectBinding(); };
      server.once("listening", onListening);
      server.once("close", onClose);
      try { server.listen(port, options.parentGateway === true ? "127.0.0.1" : "0.0.0.0"); }
      catch { rejectBinding(); }
    });
  } catch {
    await drain();
    server.off("error", onError);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    throw new Error("JessieMessage HTTP listener could not start.");
  } finally {
    server.off("listening", onListening);
    server.off("close", onClose);
    rejectBinding = null;
  }
  return { server, pool, mailWorker, diagnostics, drain };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(() => {
    console.error("JessieMessage startup failed; check private configuration and database readiness.");
    process.exitCode = 1;
  });
}
