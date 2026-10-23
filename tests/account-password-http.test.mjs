import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPasswordHandler } from "../server/account-password/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { newToken, csrfToken } from "../server/auth/crypto.mjs";
const origin = "https://example.invalid", token = newToken(), replacement = newToken(), csrf = csrfToken(token);
const input = { currentPassword: "original password", newPassword: "new password", confirmation: "new password" };
async function fixture(t, role = "client", overrides = {}) {
  const user = { id: "ab".repeat(16), role, pseudonym: "Synthetic" }, calls = [];
  const access = { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null };
  const session = { user, csrf, expiresAt: Date.now() + 100000, ...(role === "client" ? { access } : {}) };
  const service = { actor: async (r, raw) => r === role && raw === token ? session : null,
    change: async (...args) => { calls.push(args); return { ...session, status: "password_changed", token: replacement, csrf: csrfToken(replacement), internalHash: "must-not-leak" }; }, ...overrides };
  const handler = createPasswordHandler(service, { origin });
  const server = createServer(async (req,res) => { if (!await handler(req,res)) {res.writeHead(404);res.end();} });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(async () => {server.closeAllConnections();await new Promise(resolve => server.close(resolve));});
  const url = `http://127.0.0.1:${server.address().port}/api/account/${role}/password`;
  const headers = { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${token}` };
  return { url, calls, headers, post: (body = input, extra = {}) => fetch(url, { method: "POST", headers: {...headers,...extra}, body: typeof body === "string" ? body : JSON.stringify(body) }) };
}
for (const role of ["admin", "client"]) {
  test(`${role}: changes only the authenticated account, rotates HttpOnly cookie, excludes secrets`, async t => {
    const f=await fixture(t,role), response=await f.post();assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.status,"password_changed");assert.equal(body.csrf,csrfToken(replacement));
    assert.equal("token" in body,false);assert.equal("internalHash" in body,false);
    assert.match(response.headers.get("set-cookie"),new RegExp(`^__Host-jessie_${role === "admin" ? "session" : "client"}=${replacement}; Path=/; Max-Age=\\d+; Secure; HttpOnly; SameSite=Strict$`));
    for (const [name,value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name),value,name);
    assert.equal(f.calls.length,1); assert.deepEqual(f.calls[0].slice(0,3),[role,token,input]);
  });
  test(`${role}: missing/wrong cookies, CSRF and cross-origin are rejected before mutation`, async t => {
    const f=await fixture(t,role);
    for (const [extra,status] of [[{Cookie:""},401],[{"X-CSRF-Token":"wrong"},403],[{Origin:"https://attacker.invalid"},403],[{"Sec-Fetch-Site":"cross-site"},403]]) {
      const response=await f.post(input,extra);assert.equal(response.status,status);assert.equal(response.headers.get("set-cookie"),null);
    }
    assert.equal(f.calls.length,0);
  });
}
test("method, query and bounded payload checks reject unintended paths and requests", async t => {
  const f=await fixture(t);
  assert.equal((await fetch(f.url)).status,405);
  assert.equal((await fetch(f.url+"?userId=other",{method:"POST",headers:f.headers,body:JSON.stringify(input)})).status,400);
  assert.equal((await f.post("x".repeat(4097))).status,413);
  assert.equal((await f.post("bad json")).status,400);
  assert.equal((await f.post(input,{"Content-Type":"text/plain"})).status,415);
  assert.equal(f.calls.length,0);
});
test("password errors have bounded public codes, leave cookies intact, and hide private failures", async t => {
  const cases=[["PASSWORD_CURRENT_INVALID",403,"current_password_invalid"],["PASSWORD_INVALID",400,"invalid_password"],["PASSWORD_MISMATCH",400,"password_mismatch"],["PASSWORD_AUTH_INVALID",401,"authentication_required"],["PASSWORD_RATE_LIMIT",429,"try_again_later"],["SECRET_SQL_DRIVER",503,"password_unavailable"]];
  for (const [code,status,publicCode] of cases) {
    const f=await fixture(t,"client",{change:()=>{throw Object.assign(new Error("private detail"),{code,retryAfter:9999});}});
    const response=await f.post(); assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:publicCode});assert.equal(response.headers.get("set-cookie"),null);
    if(status===429)assert.equal(response.headers.get("retry-after"),"900");
  }
});
