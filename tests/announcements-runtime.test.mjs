import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createAppServer, createConfiguredServer } from "../server/index.mjs";
import { createChatHandler } from "../server/chat/http.mjs";

async function fixture(t, options = {}) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("announcement routes and assets remain unavailable without the explicit feature handler", async t => {
  const base = await fixture(t);
  for (const path of ["/admin/announcements", "/api/announcements/client/current", "/announcements.js", "/announcements-model.js", "/announcements.css", "/announcement-banner.js", "/announcement-banner.css"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("set-cookie"), null);
    await response.text();
  }
});

test("announcement settings return through administrator login without losing the navigation target", async t => {
  let reads = 0;
  const base = await fixture(t, { authHandler: async () => false, announcementsHandler: async () => { reads += 1; return false; } });
  const response = await fetch(base + "/admin/announcements", { redirect: "manual", headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin/login?continue=%2Fadmin%2Fannouncements");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(reads, 0);
  await response.text();
});

test("announcement private requests pass central admission before any feature code", async t => {
  let reads = 0, admissions = 0;
  const base = await fixture(t, { announcementsHandler: async () => { reads += 1; return false; }, admission: { enter() {
    admissions += 1;
    throw Object.assign(new Error("synthetic admission limit"), { code: "REQUEST_RATE_LIMIT", retryAfter: 4 });
  } } });
  for (const path of ["/admin/announcements", "/api/announcements/admin/current", "/api/announcements/client/current", "/announcements.js", "/announcement-banner.js", "/announcement-banner.css"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "4");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "try_again_later" });
  }
  assert.equal(admissions, 6); assert.equal(reads, 0);
});

test("announcement handler uses the existing configured legacy-origin routing boundary", async t => {
  const primary = "https://jessiemessage.com", legacy = "https://recette.jessiemessage.com";
  const reply = label => async (request, response) => {
    if (request.url !== "/api/announcements/client/current") return false;
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ origin: label })); return true;
  };
  const base = await fixture(t, { requestOrigin: primary, announcementsHandler: reply(primary), legacyHandlers: {
    entryHandler: async () => false, announcementsHandler: reply(legacy),
  } });
  const requestHost = host => new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: new URL(base).port, path: "/api/announcements/client/current", agent: false, headers: { Host: host } }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject); request.end();
  });
  for (const origin of [primary, legacy]) {
    const response = await requestHost(new URL(origin).host);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { origin });
  }
  assert.equal((await requestHost("unrelated.example")).status, 421);
});

test("chat advertises announcements only when configured, for both authenticated roles", async t => {
  const token = Buffer.alloc(32, 3).toString("base64url"), csrf = Buffer.alloc(32, 4).toString("base64url");
  const service = Object.fromEntries(["listConversations", "clientConversation", "messages", "events", "send", "markRead", "delete"].map(name => [name, async () => { throw new Error("unexpected domain call"); }]));
  service.actor = async role => ({ user: { id: (role === "admin" ? "a" : "b").repeat(32), role, pseudonym: "Synthetic" },
    csrf, expiresAt: Date.now() + 3600000, access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, approved: true, ageAssured: false } });
  for (const enabled of [false, true]) {
    const base = await fixture(t, { chatHandler: createChatHandler(service, { origin: "https://jessiemessage.com", announcementsEnabled: enabled }) });
    for (const role of ["admin", "client"]) {
      const response = await fetch(base + `/api/chat/${role}/capabilities`, { headers: { Cookie: `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${token}` } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), enabled ? { enabled: true, announcements: { enabled: true } } : { enabled: true });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  for (const value of [null, 0, "true", {}]) assert.throws(() => createChatHandler(service, { origin: "https://jessiemessage.com", announcementsEnabled: value }));
});

test("configured announcements require the existing broadcast runtime and a boolean gate", async () => {
  for (const options of [{ announcements: true }, { announcements: "true" }, { announcements: null }]) {
    await assert.rejects(createConfiguredServer({}, options), error => error.code === "REQUEST_ORIGIN_CONFIG");
  }
});
