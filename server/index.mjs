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
  ["/icon.svg", ["icon.svg", "image/svg+xml"]],
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

export function createAppServer() {
  return createServer(async (request, response) => {
    const method = request.method ?? "GET";
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

    // No public authentication, messaging or media routes exist yet.
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
  createAppServer().listen(port, "0.0.0.0", () => {
    console.info(`JessieMessage placeholder listening on port ${port}`);
  });
}
