// Real HTTPS browser/SQL messaging exercise, using only the explicitly enabled
// disposable fixture. No Push permission, provider delivery or SMTP is used.
import assert from "node:assert/strict";
import test from "node:test";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";
import { createAuthenticationFixture } from "./auth-fixture.mjs";

const clientCookie = "__Host-jessie_client";
const clientForm = "return !!document.getElementById('client-login-form') && !document.getElementById('client-login-form').hidden && !document.querySelector('#client-login-form button[type=submit]').disabled";
async function chatReady(page, role = "client") {
  const path = role === "admin" ? "/admin/messages" : "/messages";
  try {
    await waitUntil(() => page.execute("return location.pathname === arguments[0] && !!document.getElementById('workspace') && !document.getElementById('workspace').hidden", path), "real authenticated messaging workspace", 20000);
  } catch (error) {
    const state = await page.execute("return {path:location.pathname,visibility:document.visibilityState,workspacePresent:!!document.getElementById('workspace'),workspaceHidden:document.getElementById('workspace')?.hidden??null,status:document.getElementById('session-status')?.textContent.slice(0,180)??null}");
    throw new Error(`${error.message}; fixture UI: ${JSON.stringify(state)}`);
  }
}
async function loginClient(page, fixture, { notification = null } = {}) {
  await page.navigate(notification ? `/messages#notification=${notification}` : "/access");
  await waitUntil(() => page.execute(clientForm), "real client login form preserves its destination");
  if (notification) assert.equal(await page.execute("return location.hash"), `#notification=${notification}`);
  await page.type("#login-email", fixture.client.email); await page.type("#login-password", fixture.client.password);
  await page.click("#client-login-form button[type=submit]");
  if (!notification) {
    await waitUntil(() => page.execute("const link=document.getElementById('client-chat-link');return !!link&&!link.hidden&&link.getClientRects().length>0"), "real active client can open their conversation");
    await page.click("#client-chat-link");
  }
  await chatReady(page);
}
async function sessionStatus(page) {
  return page.executeAsync(`const done=arguments[arguments.length-1];
    fetch('/api/access/session',{credentials:'same-origin',cache:'no-store'}).then(response=>done(response.status),()=>done(0));`);
}
async function protectedClientCookie(page) {
  const cookies = (await page.cookies()).filter(cookie => cookie.name === clientCookie);
  assert.equal(cookies.length, 1);
  const cookie = cookies[0];
  assert.deepEqual({ path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite },
    { path: "/", secure: true, httpOnly: true, sameSite: "Strict" });
  assert.equal(typeof cookie.value === "string" && /^[A-Za-z0-9_-]{43}$/.test(cookie.value), true);
  assert.equal(await page.execute("return document.cookie.includes('__Host-jessie_client=')"), false);
  return cookie;
}
async function textVisible(page, text) {
  await waitUntil(() => page.execute("return [...document.querySelectorAll('#messages .bubble')].some(node=>node.textContent===arguments[0])", text), "the actual persisted message arrives through chat polling", 20000);
}
async function photoVisible(page, caption) {
  await waitUntil(() => page.execute(`return [...document.querySelectorAll('#messages article')].some(article=>{
    const image=article.querySelector('.photo-open img'); return article.querySelector('.photo-caption')?.textContent===arguments[0]
      && image?.complete && image.naturalWidth>0; });`, caption), "the actual stored photo is authorized, downloaded and decoded", 20000);
}
async function sessionNotificationSubscription(page, subscription) {
  const result = await page.executeAsync(`const subscription=arguments[0],done=arguments[arguments.length-1];
    (async()=>{ const proof=await fetch('/api/access/session',{credentials:'same-origin',cache:'no-store'});
      if(proof.status!==200)return {proof:proof.status,status:0}; const session=await proof.json();
      const response=await fetch('/api/notifications/client/subscription',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({subscription,language:'fr'})});
      const body=await response.json(); return {proof:proof.status,status:response.status,enabled:body.enabled};
    })().then(done,()=>done({proof:0,status:0}));`, subscription);
  assert.deepEqual(result, { proof: 200, status: 200, enabled: true });
}

async function preservesSessionAfterExternalNavigation(page, fixture, role) {
  const name = role === "admin" ? "__Host-jessie_session" : clientCookie;
  const cookie = (await page.cookies()).find(value => value.name === name);
  assert.ok(cookie, "the fixture has a native session cookie before navigating");
  assert.deepEqual({ secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite }, { secure: true, httpOnly: true, sameSite: "Strict" });
  assert.equal(await fixture.sessionRemainsActive(role, cookie.value), true);
  for (const kind of ["session", "conversation"]) {
    const previous = fixture.sessionNavigations().length;
    await page.navigate(fixture.externalApiNavigation(role, kind));
    await page.click("#c01-return");
    const target = kind === "session" ? role === "admin" ? "/api/auth/session" : "/api/access/session"
      : role === "admin" ? "/api/chat/admin/conversations" : "/api/chat/client/conversation";
    await waitUntil(() => page.execute("return location.pathname===arguments[0]&&document.body.textContent.includes('authentication_required')", target), "native cross-site API navigation denied");
    assert.deepEqual(fixture.sessionNavigations().slice(previous), [{ role, site: "cross-site", mode: "navigate", hasCookie: false, status: 401, clearsCookie: false }]);
    assert.equal((await page.cookies()).find(value => value.name === name)?.value === cookie.value, true, "the denied navigation preserves the exact withheld Strict cookie");
  }
  assert.equal(await fixture.sessionRemainsActive(role, cookie.value), true, "the original SQL session remains active");
  await page.navigate(role === "admin" ? "/admin/messages" : "/messages");
  await chatReady(page, role);
  assert.equal((await page.cookies()).find(value => value.name === name)?.value === cookie.value, true, "the same session opens its authenticated workspace without a new login");
}

test("real Chrome + MariaDB: independent client sessions, live text and JPEG, memory draft and exact notification after new login", { timeout: 240000 }, async t => {
  const driver = await startWebDriver();
  let fixture; const pages = [];
  try {
    fixture = await createAuthenticationFixture({ messaging: true });
    // Separate WebDriver sessions have independent native cookies and storage.
    const first = await driver.browser({ origin: fixture.origin, siblingOrigins: [fixture.outsideOrigin], width: 390, acceptInsecureCerts: true }); pages.push(first);
    const second = await driver.browser({ origin: fixture.origin, width: 1280, acceptInsecureCerts: true }); pages.push(second);
    await loginClient(first, fixture); await loginClient(second, fixture);
    const firstCookie = await protectedClientCookie(first), secondCookie = await protectedClientCookie(second);
    assert.equal(firstCookie.value !== secondCookie.value, true, "the same client owns two distinct SQL sessions");
    for (const [page, cookie] of [[first, firstCookie], [second, secondCookie]]) {
      await page.navigate("/messages"); await chatReady(page);
      assert.equal((await protectedClientCookie(page)).value === cookie.value, true, "reloading preserves this browser's protected session");
      assert.equal(await sessionStatus(page), 200);
    }
    await preservesSessionAfterExternalNavigation(first, fixture, "client");
    assert.equal(await sessionStatus(second), 200, "external navigation on A leaves B's session usable");
    t.diagnostic("C01 client: Chrome withheld the Strict cookie on cross-site session and conversation API navigations; both 401 responses preserved it and the same SQL session reopened messaging without login.");
    // This is the real authenticated subscription endpoint with an inert test
    // endpoint. The fixture stops delivery workers before listening.
    await sessionNotificationSubscription(first, fixture.notificationSubscription);
    t.diagnostic("Two independent protected client sessions survive reload; a synthetic subscription is stored through the real HTTP/SQL service.");

    const admin = await driver.browser({ origin: fixture.origin, siblingOrigins: [fixture.outsideOrigin], width: 1280, acceptInsecureCerts: true }); pages.push(admin);
    await admin.navigate("/admin/login");
    await waitUntil(() => admin.execute("return !!document.getElementById('login-form')&&!document.getElementById('login-form').hidden&&!document.getElementById('login-button').disabled"), "real administrator login form");
    await admin.type("#email", fixture.email); await admin.type("#password", fixture.password); await admin.type("#factor", fixture.recoveryCodes[0]);
    await admin.click("#login-button");
    await waitUntil(() => admin.execute("return !!document.getElementById('connected')&&!document.getElementById('connected').hidden"), "real administrator recovery factor accepted");
    await preservesSessionAfterExternalNavigation(admin, fixture, "admin");
    t.diagnostic("C01 admin: Chrome withheld the Strict cookie on cross-site session and conversation API navigations; both 401 responses preserved it and the same SQL session reopened messaging without login.");
    await waitUntil(() => admin.execute("return !!document.querySelector('#conversations [data-conversation-id]')"), "the real client conversation is in the administrator inbox");
    await admin.click("#conversations [data-conversation-id]");
    await waitUntil(() => admin.execute("return !document.getElementById('message-body').disabled"), "the selected conversation can compose");

    const draft = "Synthetic unsent draft on device A", message = "Synthetic administrator text for both client sessions", caption = "Synthetic JPEG delivered through the real media service";
    await first.type("#message-body", draft);
    await admin.type("#message-body", message); await admin.click("#send");
    await textVisible(admin, message); await textVisible(first, message); await textVisible(second, message);
    assert.equal(await first.execute("return document.getElementById('message-body').value"), draft);
    assert.equal(await second.execute("return document.getElementById('message-body').value"), "");
    // A controlled visibility event exercises the real Chrome DOM lifecycle;
    // it does not claim an operating-system background/PWA observation.
    await first.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange')); ");
    assert.equal(await first.execute("return document.getElementById('workspace').hidden"), true);
    await first.execute("delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));");
    await chatReady(first); assert.equal(await first.execute("return document.getElementById('message-body').value"), draft);

    const selected = await admin.executeAsync(`const done=arguments[arguments.length-1];
      const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#b52f68';ctx.fillRect(0,0,96,64);ctx.fillStyle='#153f68';ctx.fillRect(48,0,48,64);
      canvas.toBlob(blob=>{if(!blob){done(false);return;} const transfer=new DataTransfer();
        transfer.items.add(new File([blob],'synthetic-rehearsal.jpg',{type:'image/jpeg'}));
        const input=document.getElementById('image-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));done(true);
      },'image/jpeg',0.9);`);
    assert.equal(selected, true);
    await waitUntil(() => admin.execute("return !document.getElementById('image-draft').hidden"), "real file selection becomes a photo draft");
    await admin.type("#message-body", caption); await admin.click("#send");
    await photoVisible(admin, caption); await photoVisible(first, caption); await photoVisible(second, caption);
    assert.equal(await first.execute("return document.getElementById('message-body').value"), draft, "incoming photo does not overwrite another device's draft");
    const photoSequence = await first.execute("return [...document.querySelectorAll('#messages article')].find(article=>article.querySelector('.photo-caption')?.textContent===arguments[0]).dataset.sequence", caption);
    assert.match(photoSequence, /^[1-9][0-9]*$/);
    const target = await fixture.notificationReference("client");
    assert.match(target.notification, /^[a-f0-9]{32}$/); assert.match(target.messageId, /^[a-f0-9]{32}$/); assert.equal(target.sequence, photoSequence);
    t.diagnostic("Real message polling, native JPEG upload/storage/decoding and same-session visibility preserve the unsent draft.");

    // The same-document notification intent must not reload this memory draft.
    await first.execute("location.hash='notification='+arguments[0]", target.notification);
    await waitUntil(() => first.execute("return location.hash===''&&document.querySelector('#messages .notification-target')?.dataset.sequence===arguments[0]", photoSequence), "the real notification reference focuses its exact photo without navigation");
    assert.equal(await first.execute("return document.getElementById('message-body').value"), draft);
    await first.click("#logout");
    await waitUntil(() => first.execute(clientForm), "this-device logout returns to client sign-in");
    assert.equal((await first.cookies()).some(cookie => cookie.name === clientCookie), false);
    assert.equal(await sessionStatus(first), 401); assert.equal(await sessionStatus(second), 200, "logging out device A leaves device B's SQL session valid");
    assert.equal((await protectedClientCookie(second)).value === secondCookie.value, true);
    await photoVisible(second, caption);
    const reply = "Synthetic client reply from the independently connected device B";
    await second.type("#message-body", reply); await second.click("#send");
    await textVisible(second, reply); await textVisible(admin, reply);
    await loginClient(first, fixture, { notification: target.notification });
    await waitUntil(() => first.execute("return location.hash===''&&document.querySelector('#messages .notification-target')?.dataset.sequence===arguments[0]", photoSequence), "HTTP redirect, real reauthentication and notification resolution reach the original message");
    assert.equal(await first.execute("return document.activeElement.dataset.sequence"), photoSequence);
    assert.equal(await first.execute("return document.querySelector('#messages .notification-target .photo-caption')?.textContent"), caption);
    assert.equal(await first.execute("return document.getElementById('message-body').value"), "", "logout clears private drafts; no cross-login draft persistence is promised");
    assert.equal((await protectedClientCookie(first)).value !== firstCookie.value, true);
    assert.equal(await sessionStatus(second), 200);
    t.diagnostic("The exact older photo survives notification-driven reauthentication; the independent client session still sends after this-device logout.");
  } finally {
    for (const page of pages.reverse()) { try { await page.close(); } catch {} }
    try { await driver.close(); } finally { await fixture?.stop(); }
  }
});
