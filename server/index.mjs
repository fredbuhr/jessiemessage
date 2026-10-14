import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

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

export function createAppServer({ authHandler, accessHandler, chatHandler, mediaHandler, crmHandler } = {}) {
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    for (const handler of [crmHandler, mediaHandler, chatHandler, accessHandler, authHandler]) {
      if (!handler) continue;
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

    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      reply(response, method, 400, "application/json; charset=utf-8", '{"error":"bad_request"}');
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
  });
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
  const config = authConfiguration(env);
  const accessConfig = accessConfiguration(env);
  const chatConfig = chatConfiguration(env);
  const mediaConfig = mediaConfiguration(env);
  const crmConfig = crmConfiguration(env);
  if (!config.enabled) return { server: createAppServer(), pool: null };
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
    if (!accessConfig.enabled) return { server: createAppServer({ authHandler }), pool, mailWorker: null };
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
    let chatHandler;
    let mediaHandler;
    let crmHandler;
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
    }
    transport = await createVerificationTransport(accessConfig.mail);
    const server = createAppServer({ authHandler, accessHandler: createAccessHandler(accessService, { origin: config.origin }), chatHandler, mediaHandler, crmHandler });
    let worker;
    let closing;
    const mailWorker = {
      close() {
        if (!closing) closing = worker ? worker.close() : transport.close();
        return closing;
      },
    };
    // Queue delivery starts only once the HTTP listener is available, and stops
    // before the application pool is closed during graceful shutdown.
    server.once("listening", () => {
      if (!closing) worker = startMailWorker({ store: mailStore, transport, key: accessConfig.mail.key,
        onError: () => console.error("JessieMessage verification mail worker unavailable.") });
    });
    return { server, pool, mailWorker };
  } catch {
    await transport?.close().catch(() => {});
    await pool.end().catch(() => {});
    throw new Error("Authentication startup failed; check private configuration, database schema and runtime permissions.");
  }
}

async function start() {
  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
  const { server, pool, mailWorker } = await createConfiguredServer();
  server.listen(port, "0.0.0.0", () => {
    console.info(`JessieMessage listening on port ${port}`);
  });
  let closing = false;
  const shutdown = (exitCode = 0) => {
    if (closing) return;
    closing = true;
    const closeResources = async () => {
      await mailWorker?.close().catch(() => {});
      await pool?.end().catch(() => {});
      process.exitCode = exitCode;
    };
    if (server.listening) {
      server.close(() => { void closeResources(); });
      server.closeIdleConnections();
    } else void closeResources();
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
