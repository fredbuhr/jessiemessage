import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequestAdmission } from "./http/admission.mjs";
import { createShutdown } from "./lifecycle.mjs";
import { createEntryHandler } from "./entry/http.mjs";
import { createRequestOriginGuard, isOriginFormTarget, RequestOriginError } from "./http/request-origin.mjs";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const PRIMARY_ORIGIN = "https://jessiemessage.com";
const RECIPE_ORIGIN = "https://recette.jessiemessage.com";

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

export function createAppServer({ authHandler, accessHandler, chatHandler, mediaHandler, crmHandler, resetHandler, readinessHandler, broadcastHandler, notificationsHandler,
  entryHandler = createEntryHandler(), admission = createRequestAdmission(), operations = null, requestOrigin = null,
  legacyHandlers = null, transitionHandler = null } = {}) {
  const requestOriginAllowed = requestOrigin === null ? null : createRequestOriginGuard(requestOrigin);
  let legacyOriginAllowed = null, legacyChain = null;
  if (legacyHandlers !== null) {
    const names = ["authHandler", "accessHandler", "chatHandler", "mediaHandler", "crmHandler", "resetHandler", "readinessHandler", "broadcastHandler", "notificationsHandler", "entryHandler"];
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
  const privateHandlers = [notificationsHandler, broadcastHandler, readinessHandler, resetHandler, crmHandler, mediaHandler, chatHandler, accessHandler, authHandler].filter(Boolean);
  const handlers = [transitionHandler, entryHandler, ...privateHandlers].filter(Boolean);
  const protectedFiles = new Set(["/admin", "/messages", "/admin/messages", "/admin/broadcasts", "/admin/readiness",
    "/broadcast.js", "/broadcast-model.js", "/broadcast.css",
    "/crm.js", "/crm-model.js", "/crm.css", "/readiness.js", "/readiness-model.js", "/readiness.css"]);
  let draining = false;
  let pendingRequests = 0;
  const requestWaiters = new Set();
  async function handleRequest(request, response) {
    const method = request.method ?? "GET";
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
    || Object.getOwnPropertyNames(options).some(name => !["requestOrigin", "clock", "deviceTransition", "recovery", "crm", "broadcast"].includes(name))
    || Object.values(Object.getOwnPropertyDescriptors(options)).some(property => !Object.hasOwn(property, "value"))) throw new RequestOriginError();
  const requestOrigin = Object.hasOwn(options, "requestOrigin") ? options.requestOrigin : null;
  const clock = Object.hasOwn(options, "clock") ? options.clock : Date.now;
  const deviceTransition = Object.hasOwn(options, "deviceTransition") ? options.deviceTransition : false;
  const recovery = Object.hasOwn(options, "recovery") ? options.recovery : false;
  const crm = Object.hasOwn(options, "crm") ? options.crm : false;
  const broadcast = Object.hasOwn(options, "broadcast") ? options.broadcast : false;
  if (typeof deviceTransition !== "boolean" || typeof recovery !== "boolean" || typeof crm !== "boolean" || typeof clock !== "function"
    || typeof broadcast !== "boolean" || broadcast && !crm
    || deviceTransition && requestOrigin !== PRIMARY_ORIGIN || recovery && !deviceTransition || crm && !recovery) throw new RequestOriginError();
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
  if (!config.enabled) return { server: createAppServer({ requestOrigin }), pool: null };
  const { mailConfiguration } = await import("./mail/config.mjs");
  const mailConfig = mailConfiguration(env);
  const { createRuntimePool } = await import("./db/runtime.mjs");
  const { createAuthStore } = await import("./auth/store.mjs");
  const { createAuthService } = await import("./auth/service.mjs");
  const { createAuthHandler } = await import("./auth/http.mjs");
  const { createOperationsStore } = await import("./operations/store.mjs");
  const { createOperationsMonitor } = await import("./operations/monitor.mjs");
  const pool = await createRuntimePool(env);
  let transport, operations, notificationTransport, notificationWorker;
  try {
    const store = createAuthStore(pool, { clock });
    await store.assertSchema();
    const service = await createAuthService({ store, totpKey: config.totpKey, clock });
    const authHandler = createAuthHandler(service, { origin: config.origin, clock });
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
      if (!diagnosticClosing) diagnosticClosing = Promise.allSettled([readinessService.close(), operations.close()]).then((results) => {
        if (results.some((result) => result.status === "rejected")) throw new Error("Private diagnostics could not close cleanly.");
      });
      return diagnosticClosing;
    } };
    const observe = (name) => (event) => operations.observe(name, event);
    if (!accessConfig.enabled) {
      const server = createAppServer({ authHandler, readinessHandler, operations, requestOrigin,
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
      const resetStore = createResetStore(pool);
      resetMailStore = createResetMailStore(pool);
      await resetStore.assertSchema();
      await resetMailStore.assertSchema();
      const resetService = await createResetService({ store: resetStore, authStore: store, mailKey: resetConfig.key, clock });
      resetHandler = createResetHandler(resetService, { origin: resetConfig.origin });
    }
    let chatHandler;
    let mediaHandler;
    let crmHandler;
    let broadcastHandler;
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
      chatHandler = createChatHandler(chatService, { origin: chatConfig.origin });
      if (legacyHandlers) legacyHandlers.chatHandler = createChatHandler(chatService, { origin: RECIPE_ORIGIN });
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
      let mediaStorage, mediaCapacity;
      if (mediaConfig.enabled) {
        const { createMediaStorage } = await import("./media/storage.mjs");
        mediaStorage = await createMediaStorage({ root: mediaConfig.root, key: mediaConfig.key });
        mediaCapacity = { ...mediaConfig.capacity, rootFingerprint: await mediaStorage.fingerprint() };
      }
      const mediaStore = createMediaStore({ pool, chatStore, capacity: mediaCapacity });
      await mediaStore.assertSchema();
      if (crmConfig.enabled) {
        const { createCrmStore } = await import("./crm/store.mjs");
        const { createCrmService } = await import("./crm/service.mjs");
        const { createCrmHandler } = await import("./crm/http.mjs");
        const crmStore = createCrmStore({ pool, chatStore });
        await crmStore.assertSchema();
        const crmService = await createCrmService({ store: crmStore, authStore: store, authService: service, key: crmConfig.key, clock });
        crmHandler = createCrmHandler(crmService, { origin: crmConfig.origin });
        if (legacyHandlers) legacyHandlers.crmHandler = createCrmHandler(crmService, { origin: RECIPE_ORIGIN });
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
        const mediaService = await createMediaService({ store: mediaStore, chatService, authStore: store,
          storage: mediaStorage, key: mediaConfig.key, minimumFreeBytes: mediaConfig.minimumFreeBytes });
        mediaHandler = createMediaHandler(mediaService, { origin: mediaConfig.origin });
        if (legacyHandlers) legacyHandlers.mediaHandler = createMediaHandler(mediaService, { origin: RECIPE_ORIGIN });
      }
      if (broadcastConfig.enabled) {
        const { createBroadcastStore } = await import("./broadcast/store.mjs");
        const { createBroadcastService } = await import("./broadcast/service.mjs");
        const { createBroadcastHandler } = await import("./broadcast/http.mjs");
        const { createBroadcastWorker } = await import("./broadcast/worker.mjs");
        const broadcastStore = createBroadcastStore(pool, { chatStore, mediaEnabled: mediaConfig.enabled });
        await broadcastStore.assertSchema();
        const broadcastService = await createBroadcastService({ store: broadcastStore, authStore: store, authService: service,
          key: chatConfig.key, mediaEnabled: mediaConfig.enabled, clock });
        broadcastHandler = createBroadcastHandler(broadcastService, { origin: chatConfig.origin, mediaEnabled: mediaConfig.enabled });
        if (legacyHandlers) legacyHandlers.broadcastHandler = createBroadcastHandler(broadcastService, { origin: RECIPE_ORIGIN, mediaEnabled: mediaConfig.enabled });
        broadcastWorker = createBroadcastWorker({ store: broadcastStore, authStore: store, key: chatConfig.key, clock, onState: observe("broadcasts") });
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
    const server = createAppServer({ authHandler, accessHandler: createAccessHandler(accessService, { origin: config.origin, clock }), chatHandler, mediaHandler, crmHandler, resetHandler, readinessHandler, broadcastHandler, notificationsHandler, operations, requestOrigin,
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
    await notificationTransport?.close().catch(() => {});
    await notificationWorker?.stop().catch(() => {});
    await operations?.close().catch(() => {});
    await transport?.close().catch(() => {});
    await pool.end().catch(() => {});
    throw new Error("Authentication startup failed; check private configuration, database schema and runtime permissions.");
  }
}

export async function start(env = process.env, options = {}) {
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
        resolveBinding();
      };
      onClose = () => { if (!listening) rejectBinding(); };
      server.once("listening", onListening);
      server.once("close", onClose);
      try { server.listen(port, "0.0.0.0"); }
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
