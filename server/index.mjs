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

export function createAppServer({ authHandler } = {}) {
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (authHandler) {
      try { if (await authHandler(request, response)) return; }
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
    // Messaging and media routes remain unavailable until their own release lot.
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
  const config = authConfiguration(env);
  if (!config.enabled) return { server: createAppServer(), pool: null };
  const { createRuntimePool } = await import("./db/runtime.mjs");
  const { createAuthStore } = await import("./auth/store.mjs");
  const { createAuthService } = await import("./auth/service.mjs");
  const { createAuthHandler } = await import("./auth/http.mjs");
  const pool = await createRuntimePool(env);
  try {
    const store = createAuthStore(pool);
    await store.assertSchema();
    const service = await createAuthService({ store, totpKey: config.totpKey });
    return { server: createAppServer({ authHandler: createAuthHandler(service, { origin: config.origin }) }), pool };
  } catch {
    await pool.end().catch(() => {});
    throw new Error("Authentication startup failed; check private configuration, database schema and runtime permissions.");
  }
}

async function start() {
  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
  const { server, pool } = await createConfiguredServer();
  server.listen(port, "0.0.0.0", () => {
    console.info(`JessieMessage listening on port ${port}`);
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(async () => {
      await pool?.end().catch(() => {});
      process.exitCode = 0;
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(() => {
    console.error("JessieMessage startup failed; check private configuration and database readiness.");
    process.exitCode = 1;
  });
}
