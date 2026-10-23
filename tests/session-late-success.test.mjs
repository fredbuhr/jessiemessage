import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { successRaceCases, successfulSessionRace } from "./helpers/session-success-race-fixture.mjs";
import { oldToken, newToken } from "./helpers/session-race-fixture.mjs";

const origin = "https://synthetic.example.invalid";
for (const item of successRaceCases) {
  test(`${item.role}/${item.operation}: an old successful response preserves a newer login cookie`, { timeout: 10000 }, async t => {
    const f = successfulSessionRace(item, origin);
    const server = createServer(async (request, response) => {
      if (!await f.handler(request, response)) { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { f.release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    // Model browser response-order updates using real HTTP headers. The separate
    // Chrome HTTPS regression qualifies the actual native browser cookie jar.
    let cookieJar = `${f.cookie}=${oldToken}`;
    const applyCookie = response => {
      const header = response.headers.get("set-cookie");
      if (header) cookieJar = /(?:^|;\s*)Max-Age=0(?:;|$)/i.test(header) ? "" : header.split(";")[0];
    };
    const pending = fetch(base + f.path, { ...f.request, headers: { ...f.request.headers, Origin: origin, Cookie: cookieJar } });
    await f.arrived;
    const login = await fetch(`${base}${f.prefix}/login`, { ...f.loginRequest, headers: { ...f.loginRequest.headers, Origin: origin } });
    assert.equal(login.status, 200);
    assert.equal(f.seconds, 180 * 86400);
    assert.match(login.headers.get("set-cookie"), new RegExp(`^${f.cookie}=${newToken}; Path=/; Max-Age=${f.seconds}; Secure; HttpOnly; SameSite=Strict$`));
    applyCookie(login); await login.arrayBuffer();
    f.release();
    const oldResponse = await pending;
    assert.equal(oldResponse.status, 200);
    assert.equal(oldResponse.headers.get("set-cookie"), null);
    applyCookie(oldResponse); await oldResponse.arrayBuffer();
    assert.equal(cookieJar, `${f.cookie}=${newToken}`);
    assert.equal(f.oldRevoked(), item.operation !== "session");
    const current = await fetch(`${base}${f.prefix}/session`, { headers: { Cookie: cookieJar } });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).user.id, "b".repeat(32));
    assert.equal(current.headers.get("set-cookie"), null);
    if (f.oldRevoked()) {
      const revoked = await fetch(`${base}${f.prefix}/session`, { headers: { Cookie: `${f.cookie}=${oldToken}` } });
      assert.equal(revoked.status, 401); await revoked.arrayBuffer();
    }
  });
}
