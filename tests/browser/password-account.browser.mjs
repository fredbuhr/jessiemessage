// Real password fields and profile-password component, isolated synthetic API.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const files = ["password-fields.js", "password-fields.css", "password-change.js", "recover-model.js", "i18n.js", "i18n-profile.js", "profile.css"];
const markup = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/profile.css"><link rel="stylesheet" href="/fixture.css"><script src="/i18n.js" defer></script><script type="module" src="/fixture.js"></script></head><body><main id="host"></main></body></html>`;
const module = `import { createPasswordChangeUI } from '/password-change.js'; import '/i18n-profile.js';
window.__passwordErrors=[]; window.addEventListener('error',()=>window.__passwordErrors.push('error')); window.addEventListener('unhandledrejection',()=>window.__passwordErrors.push('unhandled'));
const query=new URLSearchParams(location.search), role=query.get('role'); JessieI18n.setLanguage(query.get('lang'));
window.__sessionChanges=0;
window.__passwordUI=createPasswordChangeUI({role,host:document.getElementById('host'),isCurrent:()=>true,
 onSessionChanged:()=>{window.__sessionChanges++}, request:async(path,options)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)});const result=await response.json();if(!response.ok)throw Object.assign(new Error('request'),{status:response.status,code:result.error});return result;}});`;
async function fixture() {
  const resources = new Map(await Promise.all(files.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const calls = [], failures = []; let wrong = false;
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"); response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(markup); return; }
    if (url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end("*{box-sizing:border-box}body{margin:12px;background:#100d12;color:white}main{max-width:460px;margin:auto}"); return; }
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(module); return; }
    if (resources.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(resources.get(url.pathname)); return; }
    const match = /^\/api\/account\/(admin|client)\/password$/.exec(url.pathname);
    if (match && request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); calls.push({ role: match[1], body });
      response.setHeader("Content-Type", "application/json");
      if (wrong) { response.writeHead(403); response.end(JSON.stringify({ error: "current_password_invalid" })); return; }
      response.end(JSON.stringify({ status: "password_changed", user: { id: "1".repeat(32), role: match[1] }, csrf: "C".repeat(43), expiresAt: Date.now() + 3600000 })); return;
    }
    response.writeHead(404); response.end("Not found");
  })().catch(error => { failures.push(error.message); response.destroy(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, failures, wrong(value) { wrong = value; }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test("real Chrome: password eyes and account change work for both roles at phone and desktop sizes", { timeout: 120000 }, async t => {
  const driver = await startWebDriver(); let source;
  try {
    source = await fixture();
    for (const role of ["client", "admin"]) for (const width of [320, 1280]) await t.test(`${role}, ${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, width });
      try {
        const language = width === 320 ? "fr" : "en";
        await page.navigate(`/?role=${role}&lang=${language}`);
        await waitUntil(() => page.execute("return !!window.__passwordUI"), "password component mounted");
        await page.click(".profile-password summary");
        await page.type(".profile-password-current", "old synthetic password");
        await page.type(".profile-password-new", "eight888"); await page.type(".profile-password-confirmation", "eight888");
        const before = source.calls.length;
        await page.execute("const input=document.querySelector('.profile-password-current'); input.focus(); input.setSelectionRange(2,5)");
        await page.click(".profile-password-current + .password-eye");
        assert.deepEqual(await page.execute("const input=document.querySelector('.profile-password-current');return [input.type,input.value,input.selectionStart,input.selectionEnd]"), ["text", "old synthetic password", 2, 5]);
        assert.equal(source.calls.length, before, "eye never submits a password form");
        assert.equal(await page.execute("return document.querySelector('.profile-password-current + .password-eye').getAttribute('aria-label')"), language === "fr" ? "Masquer le mot de passe" : "Hide password");
        await page.execute("document.querySelector('.profile-password-current + .password-eye').focus()");
        await page.key("\uE007");
        assert.equal(await page.execute("return document.querySelector('.profile-password-current').type"), "password", "eye is keyboard operable");
        source.wrong(true); await page.click(".profile-password-save");
        await waitUntil(() => page.execute("return document.querySelector('.profile-password-status').classList.contains('is-error')"), "wrong-password feedback");
        assert.equal(await page.execute("return document.querySelector('.profile-password-new').value"), "eight888");
        assert.equal(await page.execute("return window.__sessionChanges"), 0);
        source.wrong(false); await page.execute("const form=document.querySelector('.profile-password-form');form.requestSubmit();form.requestSubmit()");
        await waitUntil(() => page.execute("return window.__sessionChanges===1"), "rotated session adopted");
        assert.equal(source.calls.length, before + 2, "only failed attempt and one explicit success are sent");
        assert.equal(source.calls.at(-1).role, role);
        assert.equal(await page.execute("return [...document.querySelectorAll('.profile-password input')].every(input=>input.value===''&&input.type==='password')"), true);
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= innerWidth"), true, "controls fit phone/desktop width");
        assert.deepEqual(await page.execute("return window.__passwordErrors"), []);
        await page.type(".profile-password-current", "close erases this synthetic secret");
        await page.execute("window.__passwordUI.close()");
        assert.equal(await page.execute("return [...document.querySelectorAll('.profile-password input')].every(input=>input.value===''&&input.type==='password')"), true);
      } finally { await page.close(); }
    });
    assert.deepEqual(source.failures, []);
  } finally { await source?.close(); await driver.close(); }
});
