import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequestAdmission } from "./http/admission.mjs";
import { createShutdown } from "./lifecycle.mjs";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));

const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
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
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
});

function reply(response, method, statusCode, contentType, body) {
  response.writeHead(statusCode, { ...securityHeaders, "Content-Type": contentType });
  response.end(method === "HEAD" ? undefined : body);
}

export function createAppServer({ authHandler, accessHandler, chatHandler, mediaHandler, crmHandler, resetHandler, readinessHandler, broadcastHandler,
  admission = createRequestAdmission() } = {}) {
  const handlers = [broadcastHandler, readinessHandler, resetHandler, crmHandler, mediaHandler, chatHandler, accessHandler, authHandler].filter(Boolean);
  const protectedFiles = new Set(["/admin", "/messages", "/admin/messages", "/admin/broadcasts", "/admin/readiness",
    "/broadcast.js", "/broadcast-model.js", "/broadcast.css", "/broadcast-preference.js",
    "/crm.js", "/crm-model.js", "/crm.css", "/readiness.js", "/readiness-model.js", "/readiness.css"]);
  let draining = false;
  let pendingRequests = 0;
  const requestWaiters = new Set();
  async function handleRequest(request, response) {
    const method = request.method ?? "GET";
    if (draining) {
      response.writeHead(503, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", Connection: "close" });
      response.end(method === "HEAD" ? undefined : '{"error":"service_unavailable"}');
      request.resume();
      return;
    }
    let pathname;
    try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; }
    catch { reply(response, method, 400, "application/json; charset=utf-8", '{"error":"bad_request"}'); return; }
    let done;
    try {
      if (handlers.length && (pathname.startsWith("/api/") && pathname !== "/api/health" || protectedFiles.has(pathname))) {
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
      for (const handler of handlers) {
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
      const file = publicFiles.get(pathname);
      if (!file) {
        reply(response, method, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }

      try {
        const bytes = await readFile(join(publicRoot, file[0]));
        reply(response, method, 200, file[1], bytes);
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
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function createConfiguredServer(env = process.env) {
  const { authConfiguration } = await import("./auth/config.mjs");
  const { accessConfiguration } = await import("./access/config.mjs");
  const { chatConfiguration } = await import("./chat/config.mjs");
  const { mediaConfiguration } = await import("./media/config.mjs");
  const { crmConfiguration } = await import("./crm/config.mjs");
  const { clientRecoveryConfiguration } = await import("./reset/config.mjs");
  const { broadcastConfiguration } = await import("./broadcast/config.mjs");
  const config = authConfiguration(env);
  const accessConfig = accessConfiguration(env);
  const chatConfig = chatConfiguration(env);
  const mediaConfig = mediaConfiguration(env);
  const crmConfig = crmConfiguration(env);
  const resetConfig = clientRecoveryConfiguration(env);
  const broadcastConfig = broadcastConfiguration(env, { crmEnabled: crmConfig.enabled });
  if (!config.enabled) return { server: createAppServer(), pool: null };
  const { mailConfiguration } = await import("./mail/config.mjs");
  const mailConfig = mailConfiguration(env);
  const { createRuntimePool } = await import("./db/runtime.mjs");
  const { createAuthStore } = await import("./auth/store.mjs");
  const { createAuthService } = await import("./auth/service.mjs");
  const { createAuthHandler } = await import("./auth/http.mjs");
  const pool = await createRuntimePool(env);
  let transport;
  try {
    const store = createAuthStore(pool);
    await store.assertSchema();
    const service = await createAuthService({ store, totpKey: config.totpKey });
    const authHandler = createAuthHandler(service, { origin: config.origin });
    const { createReadinessService } = await import("./readiness/service.mjs");
    const { createReadinessHandler } = await import("./readiness/http.mjs");
    const readinessService = await createReadinessService({ authService: service, authStore: store, mailConfig, key: config.totpKey,
      features: { clientAccess: accessConfig.enabled, chat: chatConfig.enabled, photos: mediaConfig.enabled,
        clientFiles: crmConfig.enabled, passwordRecovery: resetConfig.enabled, broadcasts: broadcastConfig.enabled } });
    const readinessHandler = createReadinessHandler(readinessService, { origin: config.origin });
    if (!accessConfig.enabled) return { server: createAppServer({ authHandler, readinessHandler }), pool, mailWorker: null, diagnostics: readinessService };
    const { createAccessStore } = await import("./access/store.mjs");
    const { createAccessService } = await import("./access/service.mjs");
    const { createAccessHandler } = await import("./access/http.mjs");
    const { createMailStore } = await import("./mail/store.mjs");
    const { createVerificationTransport } = await import("./mail/transport.mjs");
    const { startMailWorker } = await import("./mail/worker.mjs");
    const accessStore = createAccessStore(pool);
    const mailStore = createMailStore(pool);
    await accessStore.assertSchema();
    await mailStore.assertSchema();
    const accessService = await createAccessService({ store: accessStore, authStore: store, authService: service,
      totpKey: config.totpKey, mailKey: accessConfig.mail.key, origin: config.origin });
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
      const resetService = await createResetService({ store: resetStore, authStore: store, mailKey: resetConfig.key });
      resetHandler = createResetHandler(resetService, { origin: resetConfig.origin });
    }
    let chatHandler;
    let mediaHandler;
    let crmHandler;
    let broadcastHandler;
    let broadcastWorker;
    if (chatConfig.enabled) {
      const { createChatStore } = await import("./chat/store.mjs");
      const { createChatService } = await import("./chat/service.mjs");
      const { createChatHandler } = await import("./chat/http.mjs");
      const chatStore = createChatStore(pool);
      await chatStore.assertSchema();
      const chatService = await createChatService({ store: chatStore, authStore: store, authService: service,
        accessService, key: chatConfig.key });
      chatHandler = createChatHandler(chatService, { origin: chatConfig.origin });
      // Chat history joins attachment metadata even when image transfer is off.
      // Verify those tables before accepting any private history requests.
      const { createMediaStore } = await import("./media/store.mjs");
      const mediaStore = createMediaStore({ pool, chatStore });
      await mediaStore.assertSchema();
      if (crmConfig.enabled) {
        const { createCrmStore } = await import("./crm/store.mjs");
        const { createCrmService } = await import("./crm/service.mjs");
        const { createCrmHandler } = await import("./crm/http.mjs");
        const crmStore = createCrmStore({ pool, chatStore });
        await crmStore.assertSchema();
        const crmService = await createCrmService({ store: crmStore, authStore: store, authService: service, key: crmConfig.key });
        crmHandler = createCrmHandler(crmService, { origin: crmConfig.origin });
      }
      if (mediaConfig.enabled) {
        const { createMediaStorage } = await import("./media/storage.mjs");
        const { createMediaService } = await import("./media/service.mjs");
        const { createMediaHandler } = await import("./media/http.mjs");
        const mediaStorage = await createMediaStorage({ root: mediaConfig.root, key: mediaConfig.key });
        await mediaStorage.assertReady();
        const mediaService = await createMediaService({ store: mediaStore, chatService, authStore: store,
          storage: mediaStorage, key: mediaConfig.key });
        mediaHandler = createMediaHandler(mediaService, { origin: mediaConfig.origin });
      }
      if (broadcastConfig.enabled) {
        const { createBroadcastStore } = await import("./broadcast/store.mjs");
        const { createBroadcastService } = await import("./broadcast/service.mjs");
        const { createBroadcastHandler } = await import("./broadcast/http.mjs");
        const { createBroadcastWorker } = await import("./broadcast/worker.mjs");
        const broadcastStore = createBroadcastStore(pool, { chatStore, mediaEnabled: mediaConfig.enabled });
        await broadcastStore.assertSchema();
        const broadcastService = await createBroadcastService({ store: broadcastStore, authStore: store, authService: service,
          key: chatConfig.key, mediaEnabled: mediaConfig.enabled });
        broadcastHandler = createBroadcastHandler(broadcastService, { origin: chatConfig.origin, mediaEnabled: mediaConfig.enabled });
        broadcastWorker = createBroadcastWorker({ store: broadcastStore, authStore: store, key: chatConfig.key });
      }
    }
    transport = await createVerificationTransport(accessConfig.mail);
    const server = createAppServer({ authHandler, accessHandler: createAccessHandler(accessService, { origin: config.origin }), chatHandler, mediaHandler, crmHandler, resetHandler, readinessHandler, broadcastHandler });
    const workers = [];
    let closing, stopping, aborting;
    const mailWorker = {
      stop() {
        if (!stopping) {
          // Calling stop signals every producer before any drain is awaited.
          const drains = [broadcastWorker?.stop(), ...workers.map((worker) => worker.stop())];
          stopping = Promise.allSettled(drains).then((results) => {
            if (results.some((result) => result.status === "rejected")) throw new Error("Private workers could not stop cleanly.");
          });
        }
        return stopping;
      },
      abort() {
        if (!aborting) aborting = transport.close();
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
      broadcastWorker?.start();
      workers.push(startMailWorker({ store: mailStore, transport, key: accessConfig.mail.key, closeTransport: false,
        onError: () => console.error("JessieMessage verification mail worker unavailable.") }));
      if (resetMailStore) workers.push(startMailWorker({ store: resetMailStore, transport, key: resetConfig.key, purpose: "password-reset", closeTransport: false,
        onError: () => console.error("JessieMessage recovery mail worker unavailable.") }));
    });
    return { server, pool, mailWorker, diagnostics: readinessService };
  } catch {
    await transport?.close().catch(() => {});
    await pool.end().catch(() => {});
    throw new Error("Authentication startup failed; check private configuration, database schema and runtime permissions.");
  }
}

async function start() {
  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
  const { server, pool, mailWorker, diagnostics } = await createConfiguredServer();
  server.listen(port, "0.0.0.0", () => {
    console.info(`JessieMessage listening on port ${port}`);
  });
  const drain = createShutdown({ server, pool, mailWorker, diagnostics });
  const shutdown = (exitCode = 0) => {
    if (exitCode) process.exitCode = exitCode;
    void drain().then((result) => {
      if (result.failed || result.timedOut) process.exitCode = 1;
      if (result.timedOut) {
        console.error("JessieMessage shutdown deadline reached; pending operations remain uncertain.");
        process.exit(1);
      }
    });
  };
  server.once("error", () => {
    console.error("JessieMessage HTTP listener unavailable.");
    shutdown(1);
  });
  process.once("SIGTERM", () => shutdown());
  process.once("SIGINT", () => shutdown());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(() => {
    console.error("JessieMessage startup failed; check private configuration and database readiness.");
    process.exitCode = 1;
  });
}
