// Real Chrome DOM, trusted click and responsive notification settings. Browser
// permission/subscription surfaces and all API data are synthetic: no external
// push provider, account, endpoint secret or real notification is used here.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createECDH } from "node:crypto";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const key = createECDH("prime256v1"); key.generateKeys();
const publicKey = key.getPublicKey().toString("base64url"), publicBytes = [...key.getPublicKey()];
const id = "a".repeat(32), subscriptionId = "b".repeat(32), csrf = "A".repeat(43);
let server, driver, origin, fixture;
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/notifications.css"><link rel="stylesheet" href="/i18n.css"><script src="/fixture.js"></script><script src="/i18n.js" defer></script><script src="/notifications.js" defer></script><script src="/mount.js" defer></script></head><body><button type="button" data-jm-language aria-label="Switch language">EN</button><main id="notifications"></main></body></html>`;
const bootstrap = `"use strict";
window.__browserErrors=[];window.__notificationTrace=[];
window.addEventListener("error",event=>window.__browserErrors.push(String(event.message)));
window.addEventListener("unhandledrejection",event=>window.__browserErrors.push(String(event.reason?.message)));
window.addEventListener("securitypolicyviolation",event=>window.__browserErrors.push("CSP:"+event.violatedDirective));
const denied=new URL(location.href).searchParams.get("case")==="denied";
Object.defineProperty(window,"Notification",{configurable:true,value:{permission:denied?"denied":"default"}});
Object.defineProperty(window,"PushManager",{configurable:true,value:function PushManager(){}});
let current=null;
const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/browser-synthetic-only",options:{applicationServerKey:Uint8Array.from(${JSON.stringify(publicBytes)}).buffer},toJSON(){return {endpoint:this.endpoint,expirationTime:null,keys:{p256dh:"${publicKey}",auth:"AQEBAQEBAQEBAQEBAQEBAQ"}};},async unsubscribe(){window.__notificationTrace.push("unsubscribe");current=null;return true;}};
const registration={active:{},pushManager:{async getSubscription(){return current;},subscribe(options){window.__notificationTrace.push("subscribe:"+navigator.userActivation.isActive);window.Notification.permission="granted";current=subscription;return Promise.resolve(subscription);}}};
Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{register(){window.__notificationTrace.push("register");return Promise.resolve(registration);},ready:Promise.resolve(registration)}});
`;
const mount = `"use strict"; window.__notificationPanel=JessieNotifications.mount(document.getElementById("notifications"),{role:"client",owner:{id:"${id}",csrf:"${csrf}"},isCurrent:()=>document.visibilityState==="visible"});`;

before(async () => {
  const files = new Map(await Promise.all(["notifications.js", "notifications.css", "i18n.js", "i18n.css"].map(async (name) => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  files.set("/fixture.js", Buffer.from(bootstrap)); files.set("/mount.js", Buffer.from(mount));
  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://localhost");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      const json = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
      if (url.pathname === "/fixture") { fixture = { enabled: false, csrf, subscriptionPosts: 0, disabled: 0 }; response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
      if (files.has(url.pathname)) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" }); response.end(files.get(url.pathname)); return; }
      if (url.pathname === "/api/access/session") { json({ user: { id, role: "client" }, csrf: fixture.csrf, expiresAt: Date.now() + 3600000 }); return; }
      if (url.pathname.endsWith("/capabilities")) { json({ enabled: true, vapidPublicKey: publicKey }); return; }
      if (request.method === "POST") {
        let body = ""; for await (const part of request) body += part;
        if (request.headers["x-csrf-token"] !== fixture.csrf) { json({ error: "forbidden" }, 403); return; }
        const input = JSON.parse(body);
        if (url.pathname.endsWith("/subscription")) { fixture.enabled = true; fixture.subscriptionPosts++; fixture.language = input.language; json({ enabled: true, subscriptionId }); return; }
        if (url.pathname.endsWith("/status")) { json({ enabled: fixture.enabled, subscriptionId: fixture.enabled ? subscriptionId : null }); return; }
        if (url.pathname.endsWith("/disable")) { assert.equal(input.id, subscriptionId); fixture.enabled = false; fixture.disabled++; json({ enabled: false }); return; }
      }
      json({ error: "not_found" }, 404);
    })().catch(() => { response.writeHead(500); response.end(); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  driver = await startWebDriver();
}, { timeout: 30000 });
after(async () => { try { await driver?.close(); } finally { if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } } }, { timeout: 35000 });
const action = (name) => `[data-notification-action="${name}"]`;
async function ready(page, path = "/fixture") { await page.navigate(path); await waitUntil(() => page.execute("return !document.getElementById('notifications').hidden && !document.querySelector('.notification-button').disabled"), "notification settings prepared"); }
async function noErrors(page) { assert.deepEqual(await page.execute("return window.__browserErrors"), []); }

test("Chrome 320px: trusted click subscribes directly, language changes preserve state and disabling affects this preference only", { timeout: 30000 }, async () => {
  const page = await driver.browser({ origin, width: 320 });
  try {
    await ready(page); assert.deepEqual(await page.execute("return window.__notificationTrace"), ["register"]);
    await page.click("[data-jm-language]"); assert.equal(await page.execute(`return document.querySelector('${action("enable")}').textContent`), "Turn on on this device");
    await page.click(action("enable")); await waitUntil(() => page.execute("return document.querySelector('.notification-status').textContent==='Notifications are on on this device.'"), "server-confirmed notification preference");
    assert.equal(fixture.language, "en"); assert.equal(fixture.subscriptionPosts, 1); assert.deepEqual(await page.execute("return window.__notificationTrace"), ["register", "subscribe:true"]);
    assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"), true);
    await page.click(action("disable")); await waitUntil(() => page.execute("return document.querySelector('.notification-status').textContent.includes('other devices are unchanged')"), "device-only disable");
    assert.equal(fixture.disabled, 1); assert.equal(fixture.enabled, false); assert.deepEqual(await page.execute("return window.__notificationTrace"), ["register", "subscribe:true", "unsubscribe"]);
    await noErrors(page);
  } finally { await page.close(); }
});

test("Chrome: refused notification permission stays off without prompting or subscribing", { timeout: 30000 }, async () => {
  const page = await driver.browser({ origin });
  try {
    await ready(page, "/fixture?case=denied");
    assert.equal(await page.execute(`return document.querySelector('${action("enable")}').hidden`), true);
    assert.equal(await page.execute("return document.querySelector('.notification-status').textContent.includes('réglages de ce site')"), true);
    assert.deepEqual(await page.execute("return window.__notificationTrace"), ["register"]); assert.equal(fixture.subscriptionPosts, 0); await noErrors(page);
  } finally { await page.close(); }
});

test("Chrome: a changed cookie owner prevents the subscription POST and shows no false enabled state", { timeout: 30000 }, async () => {
  const page = await driver.browser({ origin });
  try {
    await ready(page); fixture.csrf = "E".repeat(43); await page.click(action("enable"));
    await waitUntil(() => page.execute("return document.querySelector('.notification-status').textContent.includes('connexion a changé')"), "changed owner notice");
    assert.equal(fixture.subscriptionPosts, 0); assert.equal(fixture.enabled, false); await noErrors(page);
  } finally { await page.close(); }
});
