import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/index.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { createProfileHandler } from "../server/profile/http.mjs";

test("185 keeps the legacy handlers without activating preference, password or reply endpoints", async t => {
  let called = 0;
  const unused = async () => { called++; throw new Error("A dormant route must not call a legacy service"); };
  const chat = Object.fromEntries(["actor", "listConversations", "clientConversation", "messages", "events", "send", "markRead", "delete"].map(name => [name, unused]));
  const profile = Object.fromEntries(["actor", "profile", "save", "avatar", "peerAvatar"].map(name => [name, unused]));
  const server = createAppServer({ chatHandler: createChatHandler(chat, { origin: "https://example.invalid", profileEnabled: true }),
    profileHandler: createProfileHandler(profile, { origin: "https://example.invalid" }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/api/profile/client/preferences", "/api/profile/admin/preferences", "/api/account/client/password", "/api/account/admin/password",
    `/api/profile/admin/conversations/${"a".repeat(32)}/preferences`, `/api/chat/admin/conversations/${"b".repeat(32)}/reply`,
    "/preferences-catalogue.json", "/preferences-model.js", "/password-input.js"]) {
    for (const method of ["GET", "POST"]) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, method === "GET" ? 404 : 405, `${method} ${path}`);
    }
  }
  assert.equal(called, 0);
});
