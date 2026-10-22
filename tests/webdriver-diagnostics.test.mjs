import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWebDriverNavigationPolicy, createWebDriverRequester, createWebDriverPointerClick } from "./browser/webdriver.mjs";

test("primary-authority rehearsal is explicit, loopback-mapped and has no DNS fallback", () => {
  assert.throws(() => createWebDriverNavigationPolicy("https://jessiemessage.com"));
  const policy = createWebDriverNavigationPolicy("https://jessiemessage.com", [], 45678);
  assert.equal(policy.url("/api/ready"), "https://jessiemessage.com/api/ready");
  assert.equal(policy.resolverRules, "MAP jessiemessage.com 127.0.0.1:45678, MAP * ~NOTFOUND");
  for (const path of ["https://recette.jessiemessage.com", "https://example.invalid", "https://127.0.0.1:45678"])
    assert.throws(() => policy.url(path));
  for (const port of [0, 443, 65536, "45678", NaN])
    assert.throws(() => createWebDriverNavigationPolicy("https://jessiemessage.com", [], port));
  assert.throws(() => createWebDriverNavigationPolicy("https://example.invalid", [], 45678));
  assert.throws(() => createWebDriverNavigationPolicy("https://jessiemessage.com", ["https://recette.jessiemessage.com"], 45678));
});

const secret = "synthetic-sensitive-value";

test("native viewport pointer uses one local W3C action and refuses invalid geometry before input", async () => {
  const calls = []; let point = { x: 195, y: 470, width: 390, height: 844 };
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push({ path: request.url, method: request.method, body: JSON.parse(raw) });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ value: request.url.endsWith("/execute/sync") ? point : null }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const click = createWebDriverPointerClick(createWebDriverRequester(`http://127.0.0.1:${server.address().port}`), "/session/synthetic");
    assert.deepEqual(await click("#upload-video"), { x: 195, y: 470 });
    const action = calls.filter(call => call.path.endsWith("/actions")); assert.equal(action.length, 1);
    assert.equal(action[0].method, "POST"); assert.equal(action[0].body.actions.length, 1);
    const pointer = action[0].body.actions[0]; assert.equal(pointer.type, "pointer"); assert.equal(pointer.parameters.pointerType, "mouse");
    assert.deepEqual(pointer.actions, [{ type: "pointerMove", duration: 0, origin: "viewport", x: 195, y: 470 }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
    for (const invalid of [null, { ...point, x: 195.5 }, { ...point, y: -1 }, { ...point, y: 844 }, { ...point, width: 32769 }, { ...point, height: Infinity }]) {
      point = invalid; await assert.rejects(click("#upload-video"), /not visible and enabled/);
    }
    assert.equal(calls.filter(call => call.path.endsWith("/actions")).length, 1, "invalid or missing hit tests never send pointer input");
    const before = calls.length; await assert.rejects(click(""), /Invalid WebDriver pointer target/); assert.equal(calls.length, before);
  } finally { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; }
});

test("WebDriver timeout names the command without disclosing its session, element, body or transport error", async () => {
  let calls = 0;
  const request = createWebDriverRequester("http://127.0.0.1:12345", async (_url, options) => {
    calls += 1;
    assert.equal(options.method, "POST"); assert.ok(options.signal instanceof AbortSignal);
    throw new DOMException(`transport details ${secret}`, "TimeoutError");
  });
  await assert.rejects(request("POST", `/session/${secret}/element/${secret}/value`, { text: secret }), (error) => {
    assert.equal(error.message, "WebDriver POST /session/:session/element/:element/value: request timed out");
    assert.equal(error.cause, undefined); assert.equal(error.stack.includes(secret), false); return true;
  });
  assert.equal(calls, 1, "a timed-out command is never retried");
});

test("WebDriver non-timeout transport failures also discard raw error details", async () => {
  const request = createWebDriverRequester("http://127.0.0.1:12345", async () => { throw new Error(secret); });
  await assert.rejects(request("POST", "/session", { capabilities: { secret } }), { message: "WebDriver POST /session: request unavailable" });
});

test("WebDriver real loopback responses preserve success while protocol failures never echo driver messages", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/status") response.end(JSON.stringify({ value: { ready: true } }));
    else { response.statusCode = 500; response.end(JSON.stringify({ value: { error: secret, message: secret, stacktrace: secret } })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const request = createWebDriverRequester(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(await request("GET", "/status"), { ready: true });
    await assert.rejects(request("POST", `/session/${secret}/url`, { url: `http://127.0.0.1/${secret}` }), (error) => {
      assert.equal(error.message, "WebDriver POST /session/:session/url: command failed (HTTP 500)");
      assert.equal(error.stack.includes(secret), false); return true;
    });
  } finally {
    const closed = new Promise((resolve) => server.close(resolve)); server.closeAllConnections(); await closed;
  }
});

test("WebDriver diagnostic transport refuses non-loopback origins and unsupported commands before fetch", async () => {
  let calls = 0; const fetchRequest = async () => { calls += 1; throw new Error("must not be reached"); };
  for (const origin of ["https://external.example.invalid", "http://127.0.0.1.example.invalid", `http://${secret}@127.0.0.1`, "http://127.0.0.1/path", "http://jessiemessage.localhost:4444"]) {
    assert.throws(() => createWebDriverRequester(origin, fetchRequest));
  }
  const request = createWebDriverRequester("http://127.0.0.1:12345", fetchRequest);
  await assert.rejects(request("POST", `/session/${secret}/unknown?${secret}`), { message: "Unsupported WebDriver command" });
  assert.equal(calls, 0);
});

test("browser navigation permits only its explicit fixed HTTPS loopback sibling on the same port", () => {
  const primary = "https://jessiemessage.localhost:4444", source = "https://recette.jessiemessage.localhost:4444";
  const policy = createWebDriverNavigationPolicy(primary, [source]);
  assert.equal(policy.url("/migration#state=test"), `${primary}/migration#state=test`);
  assert.equal(policy.url(`${source}/migration`), `${source}/migration`);
  assert.equal(policy.transitionAlias, true);
  assert.throws(() => createWebDriverNavigationPolicy(primary).url(source));
  for (const foreign of ["https://jessiemessage.com", "https://recette.jessiemessage.com", "https://other.localhost:4444", "https://127.0.0.1:4444", "http://recette.jessiemessage.localhost:4444", "https://recette.jessiemessage.localhost:5555", `${source}/path`, `https://${secret}@recette.jessiemessage.localhost:4444`]) {
    assert.throws(() => createWebDriverNavigationPolicy(primary, [foreign]));
  }
  assert.throws(() => policy.url("https://jessiemessage.com/migration"));
  assert.throws(() => policy.url(`https://${secret}@jessiemessage.localhost:4444/`));
  assert.throws(() => createWebDriverNavigationPolicy("http://127.0.0.1:4444", [source]));
  assert.throws(() => createWebDriverNavigationPolicy(primary, [source, source]));
  const ordinary = createWebDriverNavigationPolicy("http://127.0.0.1:4444");
  assert.equal(ordinary.url("/app"), "http://127.0.0.1:4444/app");
  assert.throws(() => ordinary.url("http://localhost:4444/app"));
});

test("cookie rehearsals permit only the explicit HTTPS 127.0.0.1/localhost pair on one port", () => {
  for (const [primary, sibling] of [["https://127.0.0.1:4444", "https://localhost:4444"], ["https://localhost:4444", "https://127.0.0.1:4444"]]) {
    const policy = createWebDriverNavigationPolicy(primary, [sibling]);
    assert.equal(policy.url(`${sibling}/c01-navigation?role=client`), `${sibling}/c01-navigation?role=client`);
    assert.equal(policy.transitionAlias, false);
    assert.throws(() => createWebDriverNavigationPolicy(primary).url(sibling));
    for (const foreign of ["https://jessiemessage.com", "https://other.localhost:4444", "https://[::1]:4444", "http://localhost:4444", "https://localhost:5555", "https://127.0.0.1:5555", `${sibling}/path`, `https://${secret}@localhost:4444`]) {
      assert.throws(() => createWebDriverNavigationPolicy(primary, [foreign]));
    }
    assert.throws(() => createWebDriverNavigationPolicy(primary, [sibling, sibling]));
    assert.throws(() => policy.url("https://jessiemessage.com/api/auth/session"));
  }
  assert.throws(() => createWebDriverNavigationPolicy("http://127.0.0.1:4444", ["https://localhost:4444"]));
});
