// Actual 185 application on disposable SQL38 + HTTPS Chrome. DNS attestation
// precedes credentials; no production host, account or configuration is used.
import test from "node:test";
import assert from "node:assert/strict";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";
import { createAuthenticationFixture } from "./auth-fixture.mjs";

async function ready(page, role) {
  await waitUntil(() => page.execute("return location.pathname===arguments[0]&&!!document.getElementById('workspace')&&!document.getElementById('workspace').hidden&&!!document.getElementById('message-body')&&!document.getElementById('message-body').disabled", role === "admin" ? "/admin/messages" : "/messages"), "SQL38 rollback conversation ready", 20000);
}
async function login(page, fixture, role) {
  await page.navigate(`/__video_rehearsal/${fixture.videoAttestation}`);
  assert.equal(await page.execute("return document.body.textContent"), fixture.videoAttestation, "credentials stay on the attested owned loopback fixture");
  if (role === "admin") {
    await page.navigate("/admin/login");
    await waitUntil(() => page.execute("return !!document.getElementById('login-form')&&!document.getElementById('login-form').hidden&&!document.getElementById('login-button').disabled"), "administrator credentials available");
    await page.type("#email", fixture.email); await page.type("#password", fixture.password); await page.type("#factor", fixture.recoveryCodes[0]); await page.click("#login-button");
    await waitUntil(() => page.execute("return !!document.getElementById('connected')&&!document.getElementById('connected').hidden"), "administrator MFA established", 20000);
    await page.navigate("/admin/messages");
    await waitUntil(() => page.execute("return !![...document.querySelectorAll('#conversations [data-conversation-id]')].find(node=>node.querySelector('strong')?.textContent==='Synthetic browser client')"), "primary client in real administrator inbox");
    const conversation = await page.execute("return [...document.querySelectorAll('#conversations [data-conversation-id]')].find(node=>node.querySelector('strong')?.textContent==='Synthetic browser client').dataset.conversationId");
    await page.click(`[data-conversation-id="${conversation}"]`);
  } else {
    await page.navigate("/access");
    await waitUntil(() => page.execute("return !!document.getElementById('client-login-form')&&!document.getElementById('client-login-form').hidden&&!document.querySelector('#client-login-form button[type=submit]').disabled"), "client credentials available");
    await page.type("#login-email", fixture.client.email); await page.type("#login-password", fixture.client.password); await page.click("#client-login-form button[type=submit]");
  }
  await ready(page, role);
}
async function json(page, role, path, body = null) {
  return page.executeAsync(`const role=arguments[0],path=arguments[1],body=arguments[2],done=arguments[arguments.length-1];
    (async()=>{let headers={};if(body!==null){const s=await fetch(role==='admin'?'/api/auth/session':'/api/access/session',{cache:'no-store'});if(s.status!==200)return{status:s.status};headers={'Content-Type':'application/json','X-CSRF-Token':(await s.json()).csrf};}
      const response=await fetch(path,{method:body===null?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,...(body===null?{}:{body:JSON.stringify(body)})});
      const text=await response.text();let data;try{data=JSON.parse(text);}catch{}return{status:response.status,data,allow:response.headers.get('Allow')};})().then(done,()=>done({status:0}));`, role, path, body);
}
async function send(own, peer, caption) {
  await own.type("#message-body", caption); await own.click("#send");
  for (const browser of [own, peer]) await waitUntil(() => browser.execute("return [...document.querySelectorAll('#messages article')].filter(node=>node.textContent.includes(arguments[0])).length===1", caption), "new rollback text is readable exactly once in both real sessions", 20000);
}
async function profileWithout190(page) {
  await page.click("#open-conversation-menu"); await page.click("#open-profile");
  await waitUntil(() => page.execute("return !!document.querySelector('.profile-dialog')?.open&&!document.querySelector('.profile-pseudonym')?.disabled"), "retained 185 own-profile editor");
  assert.equal(await page.execute("return !document.querySelector('.preferences-section,.profile-password,.reply-followup,.crm-reply-check')"), true, "rollback exposes no 190 preference, password or reply controls");
  await page.click(".profile-close");
}

test("real HTTPS SQL38 rollback185: messaging remains usable and 190 private data remains byte-for-byte intact", {
  skip: process.env.JESSIEMESSAGE_DB_TEST === "1" ? false : "Native Chrome and an explicitly confirmed disposable loopback SQL38 schema are required.", timeout: 150000,
}, async t => {
  const driver = await startWebDriver(); let fixture; const pages = [];
  try {
    fixture = await createAuthenticationFixture({ messaging: true, video: true, experience: true, rollback185: true });
    const before = await fixture.rollback185State(); assert.equal(before.migrations, 38); assert.equal(before.preferences, 1); assert.equal(before.replies, 1);
    const browser = async width => { const page = await driver.browser({ origin: fixture.origin, primaryFixturePort: fixture.primaryFixturePort, width, acceptInsecureCerts: true }); pages.push(page); return page; };
    const client = await browser(375), admin = await browser(1280);
    await login(client, fixture, "client"); await login(admin, fixture, "admin");
    const own = await json(client, "client", "/api/chat/client/conversation"); assert.equal(own.status, 200); const conversation = own.data.id;
    assert.match(conversation, /^[a-f0-9]{32}$/);
    await send(client, admin, "Synthetic client text after SQL38 rollback");
    await send(admin, client, "Synthetic individual administrator response on rollback185");
    for (const [page, role] of [[client, "client"], [admin, "admin"]]) {
      const history = await json(page, role, `/api/chat/${role}/conversations/${conversation}/messages`); assert.equal(history.status, 200); assert.equal(history.data.messages.length, 2);
      const caps = await json(page, role, `/api/chat/${role}/capabilities`); assert.equal(caps.status, 200); assert.equal(caps.data.profile.passwordEnabled, undefined); assert.equal(caps.data.profile.preferencesEnabled, undefined); assert.equal(caps.data.replies, undefined);
      await profileWithout190(page);
      assert.equal((await json(page, role, `/api/profile/${role}/preferences`)).status, 404);
      const password = await json(page, role, `/api/account/${role}/password`, { currentPassword: "unused-synthetic", newPassword: "unused888", confirmation: "unused888" }); assert.equal(password.status, 405);
    }
    assert.equal((await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/reply`)).status, 404);
    assert.equal((await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/reply`, { action: "handled", through: "0", expectedVersion: "1" })).status, 405);
    const tasks = await json(admin, "admin", "/api/admin/crm/tasks"); assert.equal(tasks.status, 200); assert.deepEqual(tasks.data.tasks, [], "the reserved 190 reply task never becomes an ordinary 185 reminder");
    await client.click("#open-composer-tools"); assert.equal(await client.execute("return document.getElementById('pick-video').hidden&&!document.getElementById('pick-image').hidden&&!document.getElementById('pick-image').disabled"), true); await client.click("#close-composer-tools");
    const files = await fixture.videoFileCount();
    const refused = await client.executeAsync(`const done=arguments[arguments.length-1];(async()=>{const session=await(await fetch('/api/access/session',{cache:'no-store'})).json();const response=await fetch('/api/video/client/assets',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'video/mp4','X-CSRF-Token':session.csrf},body:new Uint8Array(16)});return{status:response.status,data:await response.json()};})().then(done,()=>done({status:0}));`);
    assert.equal(refused.status, 403); assert.equal(refused.data.error, "video_admin_only"); assert.equal(await fixture.videoFileCount(), files);
    assert.deepEqual(await fixture.rollback185State(), before, "new text, reads and rejected operations preserve encrypted preferences and every reserved reply-row byte");
    t.diagnostic("Actual185 configured server started onSQL38, isolated HTTPS/MFA/client cookies, bidirectional text, absent190 UI/routes, clientvideo refusal and preserved encrypted preference/reserved-reply hashes verified.");
  } finally { for (const page of pages.reverse()) await page.close(); await fixture?.stop(); await driver.close(); }
});
