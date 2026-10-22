import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAppServer } from "../server/index.mjs";
import { createEntryHandler } from "../server/entry/http.mjs";

async function listening(t, options) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("the neutral server serves a usable entry shell and exact public assets without private feature activation", async (t) => {
  const base = await listening(t);
  for (const [route, type] of [["/app", "text/html"], ["/entry.js", "text/javascript"],
    ["/entry-model.js", "text/javascript"], ["/entry.css", "text/css"]]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200); assert.ok(response.headers.get("content-type").startsWith(type));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    const head = await fetch(base + route, { method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
  const data = await fetch(base + "/api/entry");
  assert.equal(data.status, 200);
  assert.deepEqual(await data.json(), { status: "unavailable", client: null, administrator: null });
  assert.equal(data.headers.get("cache-control"), "no-store"); assert.equal(data.headers.get("set-cookie"), null);
  assert.equal((await fetch(base + "/access")).status, 404);
  assert.equal((await fetch(base + "/admin/login")).status, 404);
  assert.equal((await fetch(base + "/api/health")).status, 200);
  assert.equal((await fetch(base + "/api/ready")).status, 503);
});

test("the installed identity stays stable while every application page advertises the new entry", async (t) => {
  const base = await listening(t), response = await fetch(base + "/manifest.webmanifest");
  const manifest = await response.json();
  assert.equal(manifest.id, "/"); assert.equal(manifest.start_url, "/app"); assert.equal(manifest.scope, "/");
  assert.equal((await fetch(base + manifest.start_url)).status, 200);
  const root = await (await fetch(base)).text();
  assert.match(root, /href="\/app"/); assert.doesNotMatch(root, /aucun compte n'est encore actif|inscriptions sont désactivées/);
  for (const name of ["index", "entry", "access", "admin-login", "chat", "recover", "readiness", "broadcast"]) {
    const html = await readFile(new URL(`../public/${name}.html`, import.meta.url), "utf8");
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"\s*\/>/);
  }
});

test("entry session resolution is admitted before any configured session callback, independently of cached readiness", async (t) => {
  let admitted = 0, sessions = 0;
  const base = await listening(t, { entryHandler: createEntryHandler({
    clientSession: async () => { sessions++; throw new Error("private SQL details"); },
    adminSession: async () => { sessions++; throw new Error("private SQL details"); },
  }), operations: { publicStatus: () => ({ status: "ready" }) },
  admission: { enter() { admitted++; throw Object.assign(new Error("private limiter details"), { code: "REQUEST_BUSY", retryAfter: 9 }); } } });
  const token = Buffer.alloc(32, 7).toString("base64url");
  const response = await fetch(base + "/api/entry", { headers: { cookie: `__Host-jessie_client=${token}; __Host-jessie_session=${token}` } });
  assert.equal(response.status, 429); assert.equal(admitted, 1); assert.equal(sessions, 0);
  assert.deepEqual(await response.json(), { error: "try_again_later" });
  assert.equal((await fetch(base + "/api/ready")).status, 200);
  assert.equal((await fetch(base + "/api/health")).status, 200);
  assert.equal((await fetch(base + "/app")).status, 200);
  assert.equal(admitted, 1); assert.equal(sessions, 0);
});


test("configured client entry serves the sign-in document directly at root and installed app without a role/migration landing", async t => {
  const base = await listening(t, { accessHandler: async () => false });
  for (const path of ["/", "/app", "/index.html"]) for (const method of ["GET", "HEAD"]) {
    const response = await fetch(base + path, { method }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("location"), null); assert.equal(response.headers.get("set-cookie"), null);
    const html = await response.text();
    if (method === "HEAD") assert.equal(html, "");
    else { assert.match(html, /id="client-login-form"/); assert.match(html, /id="entry-role-choice"/); assert.doesNotMatch(html, /connect-device|id="entry-options"/); }
  }
});
