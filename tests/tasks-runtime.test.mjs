import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer, createConfiguredServer } from "../server/index.mjs";
import { createChatHandler } from "../server/chat/http.mjs";

async function fixture(t, options = {}) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("private task routes never fall through to public assets without their handler", async t => {
  const base = await fixture(t);
  for (const path of ["/admin/tasks", "/api/admin/crm/tasks", "/api/admin/crm/tasks/summary", "/tasks.js", "/tasks-model.js", "/tasks.css"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.text();
  }
});

test("task page returns through administrator login before feature code is called", async t => {
  let calls = 0;
  const base = await fixture(t, { authHandler: async () => false, tasksHandler: async () => { calls += 1; return false; } });
  const response = await fetch(base + "/admin/tasks", { redirect: "manual", headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin/login?continue=%2Fadmin%2Ftasks");
  assert.equal(calls, 0);
  await response.text();
});

test("task capability is configured explicitly and never disclosed to clients", async t => {
  const token = Buffer.alloc(32, 3).toString("base64url"), csrf = Buffer.alloc(32, 4).toString("base64url");
  const service = Object.fromEntries(["listConversations", "clientConversation", "messages", "events", "send", "markRead", "delete"].map(name => [name, async () => { throw new Error("unexpected domain call"); }]));
  service.actor = async role => ({ user: { id: (role === "admin" ? "a" : "b").repeat(32), role, pseudonym: "Synthetic" },
    csrf, expiresAt: Date.now() + 3600000, access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, approved: true, ageAssured: false } });
  for (const enabled of [false, true]) {
    const base = await fixture(t, { chatHandler: createChatHandler(service, { origin: "https://jessiemessage.com", tasksEnabled: enabled }) });
    for (const role of ["admin", "client"]) {
      const response = await fetch(base + `/api/chat/${role}/capabilities`, { headers: { Cookie: `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${token}` } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), enabled && role === "admin" ? { enabled: true, tasks: { enabled: true } } : { enabled: true });
    }
  }
  for (const value of [null, 0, "true", {}]) assert.throws(() => createChatHandler(service, { origin: "https://jessiemessage.com", tasksEnabled: value }));
});

test("configured tasks require the private CRM runtime and a boolean gate", async () => {
  for (const options of [{ tasks: true }, { tasks: "true" }, { tasks: null }]) {
    await assert.rejects(createConfiguredServer({}, options), error => error.code === "REQUEST_ORIGIN_CONFIG");
  }
});
