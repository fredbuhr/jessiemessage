import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { createArchiveTransfer } from "../server/chat/archive-transfer.mjs";

const parameters = { conversationId: "1".repeat(32) };
function fixture() {
  const request = new PassThrough(); request.method = "POST";
  const parts = []; let release, wrote;
  const written = new Promise(resolve => { wrote = resolve; });
  const response = new Writable({ write(chunk, encoding, done) { parts.push(Buffer.from(chunk)); release = done; wrote(); } });
  response.writeHead = (status, headers) => { response.headersSent = true; response.statusCode = status; response.headers = headers; };
  return { request, response, parts, written, release: () => release() };
}
test("slow archive transfer holds the shared role slot across both origin handlers until completion", async () => {
  const bytes = Buffer.alloc(40, 9); bytes.writeUInt32LE(0x04034b50); let creates = 0;
  const exporter = { photos: false, maxBytes: 1000, create: async () => { creates++; return bytes; } };
  const primary = createArchiveTransfer(exporter), legacy = createArchiveTransfer(exporter), f = fixture();
  const pending = primary.send(f.request, f.response, parameters, async () => {}); await f.written;
  await assert.rejects(legacy.send(f.request, f.response, parameters, async () => {}), error => error.code === "busy");
  assert.equal(creates, 1); assert.equal(bytes[4], 9, "outgoing bytes remain available until finish");
  f.release(); await pending; assert.equal(bytes.every(byte => byte === 0), true); assert.equal(f.parts[0][4], 9);
});
test("shutdown through either origin aborts a stalled transfer and wipes its buffer", async () => {
  const bytes = Buffer.alloc(40, 9); bytes.writeUInt32LE(0x04034b50);
  const exporter = { photos: false, maxBytes: 1000, create: async () => bytes };
  const primary = createArchiveTransfer(exporter), legacy = createArchiveTransfer(exporter), f = fixture();
  const pending = primary.send(f.request, f.response, parameters, async () => {}); await f.written;
  legacy.close(); await pending;
  assert.equal(f.response.destroyed, true); assert.equal(bytes.every(byte => byte === 0), true);
});
