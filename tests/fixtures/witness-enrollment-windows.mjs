// Disposable Windows transport fixture. It deliberately uses loopback HTTP;
// the test replaces only the PowerShell request constructor, never system TLS.
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { registryHash } from "../../server/backup/registry-snapshot.mjs";

const destinationId = "1".repeat(32), registryId = "a".repeat(64);
const attempts = new Set();
const server = createServer(async (request, response) => {
  const reply = (status, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    response.writeHead(status, { "Content-Type": "application/json", "Content-Length": bytes.length, "Cache-Control": "no-store" }); response.end(bytes);
  };
  try {
    if (request.method !== "POST" || request.url !== "/api/backup-copy/witness/enroll") return reply(404, {});
    if (request.headers.authorization !== `Bearer ${"A".repeat(43)}` || request.headers["x-jessie-backup"] !== "1"
      || request.headers.cookie !== undefined || request.headers.origin !== undefined
      || Object.keys(request.headers).some(name => name.startsWith("sec-fetch-"))) return reply(403, {});
    if (request.headers["content-type"] !== "application/json; charset=utf-8") return reply(415, {});
    const chunks = []; let bytes = 0;
    for await (const chunk of request) { if ((bytes += chunk.length) > 4096) return reply(413, {}); chunks.push(chunk); }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (Object.keys(body).sort().join(",") !== "attemptId,destinationId,version" || body.version !== 1 || body.destinationId !== destinationId
      || typeof body.attemptId !== "string" || !/^[a-f0-9]{32}$/.test(body.attemptId)) return reply(400, {});
    if (body.attemptId === "b".repeat(32)) return reply(200, { oversized: "x".repeat(4096) });
    if (body.attemptId === "c".repeat(32)) { response.setHeader("Set-Cookie", "unexpected=1"); return reply(200, {}); }
    if (body.attemptId === "d".repeat(32)) { response.setHeader("Location", "/redirect-must-not-be-followed"); return reply(302, {}); }
    if (body.attemptId === "e".repeat(32)) { response.writeHead(200, { "Content-Type": "application/json" }); response.end("{"); return; }
    if (attempts.size && !attempts.has(body.attemptId)) return reply(409, {});
    const initialize = !attempts.has(body.attemptId); attempts.add(body.attemptId);
    return reply(200, { version: 1, initialize, destinationId, attemptId: body.attemptId, contractSha256: "c".repeat(64), contractId: "d".repeat(64),
      registryId, initialSnapshotSha256: registryHash({ version: 1, registryId, files: [] }) });
  } catch { reply(400, {}); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
await writeFile(process.argv[2], String(server.address().port), { flag: "wx" });
