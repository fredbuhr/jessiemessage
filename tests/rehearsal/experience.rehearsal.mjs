// Real HTTPS/SQL38 application, real cookies and UI; disposable loopback only.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuthenticationFixture } from "./auth-fixture.mjs";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";

const catalogue = JSON.parse(await readFile(new URL("../../public/preferences-catalogue.json", import.meta.url), "utf8"));
const firstChoice = catalogue.categories[0].preferences[0].id, secondChoice = catalogue.categories[0].preferences[1].id;
const catalogueVersion = catalogue.meta.version;
const cookieName = role => role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
async function attest(page, fixture) {
  await page.navigate(`/__video_rehearsal/${fixture.videoAttestation}`);
  assert.equal(await page.execute("return document.body.textContent"), fixture.videoAttestation, "credentials stay on the attested owned loopback fixture");
}
async function json(page, role, path, body = null, authenticated = true) {
  return page.executeAsync(`const role=arguments[0],path=arguments[1],body=arguments[2],auth=arguments[3],done=arguments[arguments.length-1];
    (async()=>{let headers={};if(body!==null){headers['Content-Type']='application/json';if(auth){const session=await fetch(role==='admin'?'/api/auth/session':'/api/access/session',{cache:'no-store'});if(session.status!==200)return{status:session.status};headers['X-CSRF-Token']=(await session.json()).csrf;}}
      const response=await fetch(path,{method:body===null?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,...(body===null?{}:{body:JSON.stringify(body)})});
      return{status:response.status,data:await response.json()};})().then(done,()=>done({status:0}));`, role, path, body, authenticated);
}
async function ready(page, role) {
  await waitUntil(() => page.execute("return location.pathname===arguments[0]&&!!document.getElementById('workspace')&&!document.getElementById('workspace').hidden&&!!document.getElementById('message-body')&&!document.getElementById('message-body').disabled", role === "admin" ? "/admin/messages" : "/messages"), "real experience conversation ready", 20000);
}
async function login(page, fixture, role, { credentials = null, password = null, recoveryIndex = 0 } = {}) {
  await attest(page, fixture);
  if (role === "admin") {
    await page.navigate("/admin/login");
    await waitUntil(() => page.execute("return !!document.getElementById('login-form')&&!document.getElementById('login-form').hidden&&!document.getElementById('login-button').disabled"), "admin credentials available");
    await page.type("#email", fixture.email); await page.type("#password", password ?? fixture.password);
    await page.click("#toggle-password"); assert.equal(await page.execute("return document.getElementById('password').type"), "text");
    await page.click("#toggle-password"); await page.type("#factor", fixture.recoveryCodes[recoveryIndex]); await page.click("#login-button");
    await waitUntil(() => page.execute("return !!document.getElementById('connected')&&!document.getElementById('connected').hidden"), "admin MFA session established", 20000);
    await page.navigate("/admin/messages");
    await waitUntil(() => page.execute("return !!document.querySelector('#conversations [data-conversation-id]')"), "admin conversations loaded");
    // Pick the primary synthetic client, independent of the other client's sort order.
    const selected = await page.execute("const nodes=[...document.querySelectorAll('#conversations [data-conversation-id]')];return nodes.find(n=>n.querySelector('strong')?.textContent==='Synthetic browser client')?.getAttribute('data-conversation-id')");
    assert.match(selected ?? "", /^[a-f0-9]{32}$/); await page.click(`[data-conversation-id="${selected}"]`);
  } else {
    await page.navigate("/access");
    await waitUntil(() => page.execute("return !!document.getElementById('client-login-form')&&!document.getElementById('client-login-form').hidden&&!document.querySelector('#client-login-form button[type=submit]').disabled"), "client credentials available");
    const owner = credentials ?? fixture.client;
    await page.type("#login-email", owner.email); await page.type("#login-password", password ?? owner.password);
    await page.click("#login-password + .password-eye"); assert.equal(await page.execute("return document.getElementById('login-password').type"), "text");
    await page.click("#login-password + .password-eye"); await page.click("#client-login-form button[type=submit]");
  }
  await ready(page, role);
}
async function openProfile(page) {
  const opener = await page.execute("return ['open-conversation-menu','open-account-menu'].find(id=>{const node=document.getElementById(id);return node&&!node.hidden&&!node.disabled&&node.getClientRects().length})");
  assert.ok(opener); await page.click(`#${opener}`);
  await waitUntil(() => page.execute("return document.getElementById('chat-menu').hidden===false"), "profile menu opened");
  await page.click("#open-profile");
  await waitUntil(() => page.execute("return !!document.querySelector('.profile-dialog')?.open&&!document.querySelector('.profile-pseudonym').disabled&&!!document.querySelector('.preferences-search')&&!document.querySelector('.preferences-search').disabled"), "real profile and private preferences loaded", 20000);
}
async function saveChoice(page, choice) {
  await page.type(".preferences-search", choice === firstChoice ? "STRAIGHT" : "GAY");
  await waitUntil(() => page.execute("return !!document.querySelector('[data-preference-id=\"'+arguments[0]+'\"]')", choice), "bilingual alias exposes the existing preference button");
  await page.click(`[data-preference-id="${choice}"]`);
  await page.click(".preferences-actions button:first-child");
  await waitUntil(() => page.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "server confirms preference save");
}
async function changePassword(page, role, currentPassword, replacement) {
  const before = (await page.cookies()).find(cookie => cookie.name === cookieName(role)); assert.ok(before);
  await openProfile(page); await page.click(".profile-password summary");
  await page.type(".profile-password-current", "incorrect synthetic password");
  await page.type(".profile-password-new", replacement); await page.type(".profile-password-confirmation", replacement);
  await page.click(".profile-password-save");
  await waitUntil(() => page.execute("return document.querySelector('.profile-password-status')?.textContent==='Le mot de passe actuel est incorrect.'"), "wrong current password leaves session and draft intact");
  assert.equal((await json(page, role, role === "admin" ? "/api/auth/session" : "/api/access/session")).status, 200);
  assert.equal(await page.execute("return document.querySelector('.profile-password-new').value"), replacement);
  await page.type(".profile-password-current", currentPassword);
  await page.click(".profile-password-save");
  await waitUntil(async () => {
    const value = (await page.cookies()).find(cookie => cookie.name === cookieName(role)); return value?.value && value.value !== before.value;
  }, "HTTP cookie rotated after deliberate password change", 20000);
  await waitUntil(() => page.execute("return !!document.getElementById('workspace')&&!document.getElementById('workspace').hidden"), "renewed session reopens workspace", 20000);
  if (role === "admin") {
    await waitUntil(() => page.execute("return !![...document.querySelectorAll('#conversations [data-conversation-id]')].find(n=>n.querySelector('strong')?.textContent==='Synthetic browser client')"), "renewed admin inbox");
    const selected = await page.execute("return [...document.querySelectorAll('#conversations [data-conversation-id]')].find(n=>n.querySelector('strong')?.textContent==='Synthetic browser client').getAttribute('data-conversation-id')");
    await page.click(`[data-conversation-id="${selected}"]`);
  }
  await ready(page, role);
  assert.equal((await json(page, role, role === "admin" ? "/api/auth/session" : "/api/access/session")).status, 200, "current browser remains authenticated");
  return before.value;
}
async function createPhoto(page, conversationId) {
  return page.executeAsync(`const id=arguments[0],done=arguments[arguments.length-1];(async()=>{
    const session=await(await fetch('/api/access/session',{cache:'no-store'})).json(),headers={'X-CSRF-Token':session.csrf};
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));const upload=await fetch('/api/media/client/assets',{method:'POST',headers:{...headers,'Content-Type':'image/jpeg'},body:blob});
    if(upload.status!==201)return{status:upload.status};const asset=(await upload.json()).asset;
    const response=await fetch('/api/media/client/conversations/'+id+'/messages',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({clientMessageId:crypto.randomUUID().replaceAll('-',''),mediaId:asset.id,caption:'Synthetic retained photo'})});
    const data=await response.json();return{status:response.status,data};})().then(done,()=>done({status:0}));`, conversationId);
}
async function imageReadable(page, path) {
  return page.executeAsync(`const path=arguments[0],done=arguments[arguments.length-1];(async()=>{const response=await fetch(path,{cache:'no-store',credentials:'same-origin'});if(response.status!==200)return{status:response.status};const image=await createImageBitmap(await response.blob());const result={status:200,width:image.width,height:image.height};image.close();return result;})().then(done,()=>done({status:0}));`, path);
}

test("real HTTPS SQL38: private profiles across devices and own-password rotation preserve history and media", { timeout: 240000 }, async t => {
  const driver = await startWebDriver(); let fixture; const pages = [];
  try {
    fixture = await createAuthenticationFixture({ messaging: true, video: true, experience: true });
    const browser = async width => { const page = await driver.browser({ origin: fixture.origin, primaryFixturePort: fixture.primaryFixturePort, width, acceptInsecureCerts: true }); pages.push(page); return page; };
    const client = await browser(390), clientDevice = await browser(1280), other = await browser(375), admin = await browser(1280), adminDevice = await browser(390);
    await login(client, fixture, "client"); await login(clientDevice, fixture, "client"); await login(other, fixture, "client", { credentials: fixture.otherClient });
    await login(admin, fixture, "admin"); await login(adminDevice, fixture, "admin", { recoveryIndex: 1 });
    const conversation = (await json(client, "client", "/api/chat/client/conversation")).data.id;
    const otherConversation = (await json(other, "client", "/api/chat/client/conversation")).data.id;
    assert.notEqual(conversation, otherConversation);
    const caption = "Synthetic encrypted history retained after explicit password changes";
    const sent = await json(client, "client", `/api/chat/client/conversations/${conversation}/messages`, { clientMessageId: randomBytes(16).toString("hex"), body: caption }); assert.equal(sent.status, 201);
    const photo = await createPhoto(client, conversation); assert.equal(photo.status, 201);
    const mediaPath = `/api/media/client/conversations/${conversation}/messages/${photo.data.message.id}/full`;
    assert.equal((await imageReadable(client, mediaPath)).status, 200);

    await t.test("own choices are optional, bilingual-searchable, encrypted and synchronized; other clients cannot read them", async () => {
      await openProfile(client); await saveChoice(client, firstChoice); await client.click(".profile-close");
      const stored = await json(clientDevice, "client", "/api/profile/client/preferences"); assert.equal(stored.status, 200); assert.deepEqual(stored.data.selectedIds, [firstChoice]);
      await openProfile(clientDevice); assert.equal(await clientDevice.execute("return document.querySelector('.preferences-selected button')?.textContent"), catalogue.categories[0].preferences[0].fr); await clientDevice.click(".profile-close");
      assert.deepEqual((await json(other, "client", "/api/profile/client/preferences")).data.selectedIds, []);
      assert.ok([403, 404].includes((await json(other, "client", `/api/profile/client/conversations/${conversation}/preferences`)).status));
      const invalid = await json(client, "client", "/api/profile/client/preferences", { expectedVersion: stored.data.version, catalogueVersion, selectedIds: ["pref_unknown_entry"] }); assert.equal(invalid.status, 400);
      await openProfile(admin); await saveChoice(admin, secondChoice); await admin.click(".profile-close");
      assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
      assert.deepEqual((await json(admin, "admin", `/api/profile/admin/conversations/${conversation}/preferences`)).data.selectedIds, [firstChoice]);
      assert.equal((await json(admin, "admin", `/api/profile/admin/conversations/${conversation}/preferences`, { expectedVersion: stored.data.version, catalogueVersion, selectedIds: [] })).status, 405);
      await admin.click(".crm-fiche-button");
      await waitUntil(() => admin.execute("return !!document.querySelector('.crm-dialog')?.open&&!document.querySelector('.crm-client-preferences').hidden"), "authorized admin client-profile preferences entry");
      await admin.click(".crm-client-preferences summary");
      await waitUntil(() => admin.execute("return document.querySelector('.crm-client-preferences .preferences-selected .preference-choice')?.textContent===arguments[0]", catalogue.categories[0].preferences[0].fr), "client preferences are rendered read-only in the actual CRM profile");
      assert.equal(await admin.execute("const panel=document.querySelector('.crm-client-preferences');return panel.querySelector('.preferences-actions').hidden&&panel.querySelector('.preferences-search-label').hidden&&!panel.querySelector('[data-preference-id]')"), true);
      await admin.click(".crm-dialog .dialog-head button");
      const state = await fixture.privatePreferencesState([firstChoice, secondChoice]); assert.equal(state.rows, 2); assert.equal(state.encrypted, true);
      assert.deepEqual((await json(other, "client", "/api/profile/client/preferences")).data.selectedIds, []);
    });
    const resetToken = await fixture.seedClientResetToken();
    const encryptedBefore = await fixture.privatePreferencesState([firstChoice, secondChoice]);
    await t.test("client password change retains current browser and ciphertext, revokes old device/reset link, and preserves photo reads", async () => {
      const newPassword = "client88"; const oldToken = await changePassword(client, "client", fixture.client.password, newPassword);
      assert.equal(await fixture.sessionRemainsActive("client", oldToken), false);
      assert.equal((await json(clientDevice, "client", "/api/access/session")).status, 401);
      const reset = await json(other, "client", "/api/access/recovery/reset", { token: resetToken, password: "reset888" }, false); assert.equal(reset.status, 401); assert.equal(reset.data.error, "invalid_reset_link");
      const staleLogin = await json(other, "client", "/api/access/login", { email: fixture.client.email, password: fixture.client.password }, false); assert.equal(staleLogin.status, 401);
      await login(clientDevice, fixture, "client", { password: newPassword });
      assert.deepEqual((await json(clientDevice, "client", "/api/profile/client/preferences")).data.selectedIds, [firstChoice]);
      const history = await json(client, "client", `/api/chat/client/conversations/${conversation}/messages`); assert.equal(history.status, 200); assert.ok(history.data.messages.some(message => message.body === caption));
      assert.equal((await imageReadable(client, mediaPath)).status, 200);
      assert.deepEqual(await fixture.privatePreferencesState([firstChoice, secondChoice]), encryptedBefore);
      await client.type("#message-body", "Synthetic message after password rotation"); await client.click("#send");
      await waitUntil(() => client.execute("return [...document.querySelectorAll('#messages article')].some(node=>node.textContent.includes('Synthetic message after password rotation'))"), "real chat adapter adopted renewed CSRF");
    });
    await t.test("admin password change preserves MFA and current session, requires one new sign-in elsewhere and retains private selections", async () => {
      const newPassword = "admin888"; const oldToken = await changePassword(admin, "admin", fixture.password, newPassword);
      assert.equal(await fixture.sessionRemainsActive("admin", oldToken), false);
      assert.equal((await json(adminDevice, "admin", "/api/auth/session")).status, 401);
      await login(adminDevice, fixture, "admin", { password: newPassword, recoveryIndex: 2 });
      assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
      const history = await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(history.status, 200); assert.ok(history.data.messages.some(message => message.body === caption));
      assert.deepEqual(await fixture.privatePreferencesState([firstChoice, secondChoice]), encryptedBefore);
    });
    await t.test("clearing client choices affects only that profile and remains cleared on the other current device", async () => {
      await openProfile(client); await client.click(".preferences-actions button:nth-child(2)"); await client.click(".preferences-actions button:first-child");
      await waitUntil(() => client.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "clear confirmed by real server"); await client.click(".profile-close");
      assert.deepEqual((await json(clientDevice, "client", "/api/profile/client/preferences")).data.selectedIds, []);
      assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
      assert.equal((await imageReadable(client, mediaPath)).status, 200);
    });
  } finally { for (const page of pages.reverse()) await page.close(); await fixture?.stop(); await driver.close(); }
});
