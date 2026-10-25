import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/index.mjs";
import { createProfileHandler } from "../server/profile/http.mjs";
import { PREFERENCES_CATALOGUE_VERSION } from "../public/preferences-model.js";

const origin = "https://jessiemessage.com";
const view = { displayName: "Jessie", bio: "Présentation synthétique", catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: [] };
test("the application serves the public profile page and module graph without enabling private APIs", async t => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/jessie", "/public-profile.js", "/public-profile.css", "/public-profile-model.js", "/profile-publication.js", "/i18n-public-profile.js"]) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    if (path === "/jessie") { const html = await response.text(); assert.match(html, /public-profile-content/); assert.doesNotMatch(html, /api\/profile\/client|userId|csrf/); }
  }
  for (const path of ["/api/public/jessie", "/api/profile/admin/publication", "/jessie-public-profile.json"]) assert.equal((await fetch(base + path)).status, 404);
});
test("profile handler composition exposes only the publication service's public DTO anonymously", async t => {
  let privateCalls = 0;
  const privateOperation = () => { privateCalls++; throw new Error("private operation must not be reached"); };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
  const publication = { actor: privateOperation, read: privateOperation, save: privateOperation, publicView: async () => ({ ...view, userId: "never-serialize", csrf: "never-serialize" }), publicAvatar: async version => { assert.equal(version, "1"); return { bytes: jpeg, mime: "image/jpeg" }; } };
  const profileHandler = createProfileHandler({ actor: privateOperation, profile: privateOperation, save: privateOperation, avatar: privateOperation, peerAvatar: privateOperation, publication }, { origin });
  const server = createAppServer({ profileHandler });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/public/jessie"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), view);
  const image = await fetch(base + "/api/public/jessie/avatar?v=1"); assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/jpeg"); assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
  assert.equal(privateCalls, 0);
  assert.equal((await fetch(base + "/api/profile/admin/publication")).status, 401);
  assert.equal(privateCalls, 0);
});
