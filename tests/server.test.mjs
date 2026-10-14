import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/index.mjs";

let server;
let base;

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("neutral landing page is available", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /JessieMessage/);
  assert.match(response.headers.get("content-type"), /text\/html/);
});

test("health endpoint works without leaking configuration", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("private or unknown paths are inaccessible", async () => {
  for (const path of ["/.env", "/server/index.mjs", "/api/messages", "/admin", "/messages", "/admin/messages", "/chat.js", "/chat-model.js", "/chat.css", "/api/chat/client/conversation", "/api/chat/admin/conversations", "/api/media/client/capabilities", "/api/media/admin/assets", "/crm.js", "/crm-model.js", "/crm.css", "/api/admin/crm/capabilities", "/api/admin/crm/contacts", "/recover", "/recover.js", "/recover-model.js", "/recover.css", "/api/access/recovery/capabilities"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
  }
});

test("security headers are returned", async () => {
  const response = await fetch(base);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("no HTTP mutation endpoints are enabled", async () => {
  const response = await fetch(`${base}/api/health`, { method: "POST" });
  assert.equal(response.status, 405);
});
