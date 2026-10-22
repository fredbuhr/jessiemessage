import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { raceCases, sessionRace, oldToken } from "./helpers/session-race-fixture.mjs";

for (const item of raceCases) test(`${item.kind}/${item.role}: an old refused request never changes a newer cookie`, { timeout: 10000 }, async () => {
  const f = sessionRace(item);
  const server = createServer(async (request, response) => {
    if (!await f.handler(request, response)) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const pending = fetch(`http://127.0.0.1:${server.address().port}${f.path}`, { headers: { Cookie: `${f.cookie}=${oldToken}` } });
    await f.arrived;
    // The separate native Chrome regression qualifies the actual cookie jar.
    f.release(); const response = await pending;
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.arrayBuffer();
  } finally {
    f.release(); f.handler.close?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
