import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationExporter, CONVERSATION_EXPORT_LIMITS, ConversationExportError } from "../server/chat/conversation-export.mjs";

const id = n => n.toString(16).padStart(32, "0"), conversationId = id(1), clientId = id(2), now = 1792340000000;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
const media = { id: id(20), width: 12, height: 8, bytes: jpeg.length, sharedHere: true, storageKey: "never-export-storage-key", fullUrl: "never-follow-arbitrary-url" };
const message = (n, changes = {}) => ({ id: id(n + 100), sequence: String(n), sender: "peer", body: "Bonjour <script>bad()</script> & salut", createdAt: now - 20000 + n, deletedAt: null,
  clientMessageId: "never-export-client-key", campaignId: "never-export-campaign", ...changes });
function fixture({ pages, photo = true, limits = {}, history: intercept, photoRead, elapsed = () => 0 } = {}) {
  let clock = now; const calls = [], buffers = [];
  const history = async (token, selected, options) => {
    calls.push({ token, selected, ...options });
    if (intercept) return intercept(calls.length, options);
    return pages?.[calls.length - 1] ?? page([message(1)]);
  };
  const exporter = createConversationExporter({ history, photo: photo ? async (...args) => {
    if (photoRead) return photoRead(...args);
    const bytes = Buffer.from(jpeg); buffers.push(bytes); return { bytes, mime: "image/jpeg", secret: "never-export-secret" };
  } : null, clock: () => clock, elapsed, limits: { ...CONVERSATION_EXPORT_LIMITS, ...limits } });
  return { exporter, calls, buffers, advance() { clock += 30001; }, create: (options = {}) => exporter.create({ token: "synthetic", conversationId, expectedClientId: clientId, includePhotos: photo, ...options }) };
}
const page = (messages, changes = {}) => ({ conversation: { id: conversationId, client: { id: clientId, pseudonym: "<Client & test>" }, peerName: "Synthetic peer", latestSequence: "500", privateNotes: "never-export-notes" },
  messages, hasMoreBefore: false, nextBefore: null, ...changes });
async function inspect(t, archive) {
  const directory = await mkdtemp(join(tmpdir(), "jm-conversation-zip-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "conversation.zip"); await writeFile(file, archive, { mode: 0o600 });
  const result = await promisify(execFile)("python3", ["-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({'names':z.namelist(),'document':json.loads(z.read('conversation.json')),'html':z.read('Conversation.html').decode(),'readme':z.read('LIRE-MOI.txt').decode(),'photo':list(z.read('photos/00000000000000000000000000000014.jpg')) if 'photos/00000000000000000000000000000014.jpg' in z.namelist() else None}))", file], { maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

test("conversation ZIP is independently readable, chronological, private and safe to open offline", async t => {
  const f = fixture({ pages: [page([message(3, { sender: "me", media }), message(4, { body: null, deletedAt: now })], { hasMoreBefore: true, nextBefore: "3" }), page([message(1), message(2, { media })])] });
  const archive = await f.create(), data = await inspect(t, archive);
  assert.deepEqual(data.names.sort(), ["Conversation.html", "LIRE-MOI.txt", "conversation.json", `photos/${id(20)}.jpg`].sort());
  assert.deepEqual(data.document.messages.map(row => row.sequence), ["1", "2", "3", "4"]);
  assert.equal(data.document.messages[3].body, ""); assert.equal(data.document.messages[3].deletedAt, now);
  assert.deepEqual(data.photo, [...jpeg]); assert.equal(f.buffers.length, 1, "a repeated photo is copied once");
  assert.equal(f.buffers.every(bytes => bytes.every(byte => byte === 0)), true, "temporary photo buffers are wiped after copying");
  assert.equal(archive.includes(Buffer.from("never-export")), false);
  assert.ok(data.html.includes("&lt;Client &amp; test&gt;")); assert.ok(data.html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert.ok(!data.html.includes("<script>")); assert.ok(!data.html.includes("http://") && !data.html.includes("https://"));
  assert.ok(data.html.includes("default-src 'none'")); assert.equal(data.document.administrator, "Jess");
  assert.equal(f.calls[1].before, "3"); assert.equal(data.document.throughSequence, "500");
  assert.deepEqual(Object.keys(data.document.messages[1].photo), ["file", "width", "height", "sha256"]);
});

test("text-only exports never read photos and do not enumerate an unshared library", async t => {
  const f = fixture({ photo: false, pages: [page([message(1, { media })])] });
  const data = await inspect(t, await f.create({ includePhotos: false }));
  assert.equal(data.names.length, 3); assert.equal(data.photo, null); assert.equal(data.document.messages[0].photo.file, null);
  assert.match(data.html, /Photo not included/);
  await assert.rejects(f.create({ includePhotos: true }), error => error.code === "input");
});

test("legacy archives reject a live video rather than silently dropping its attachment", async () => {
  const f = fixture({ photo: false, pages: [page([message(1, { video: { id: id(21), bytes: 100, mime: "video/mp4" } })])] });
  await assert.rejects(f.create({ includePhotos: false }), error => error.code === "changed");
});

test("foreign conversations, rebinding, malformed pagination and deleted-message payloads never form an archive", async t => {
  const wrong = [
    page([message(1)], { conversation: { id: id(88), client: { id: clientId, pseudonym: "X" }, peerName: "X", latestSequence: "1" } }),
    page([message(1)], { conversation: { id: conversationId, client: { id: id(88), pseudonym: "X" }, peerName: "X", latestSequence: "1" } }),
    page([message(2), message(1)]), page([message(1)], { hasMoreBefore: true, nextBefore: "2" }),
    page([], { hasMoreBefore: true, nextBefore: "1" }), page([message(1, { deletedAt: now, body: "private deleted text" })]),
    page([message(1, { media: { ...media, id: "../../etc/passwd" } })]), page([message(1, { media: { ...media, sharedHere: false } })]),
    page([message(1, { media: { ...media, bytes: 10485761 } })]), page([message(1, { sequence: "501" })])
  ];
  for (let i = 0; i < wrong.length; i++) await t.test(String(i), async () => assert.rejects(fixture({ pages: [wrong[i]] }).create(), ConversationExportError));
  const repeated = fixture({ pages: [page([message(3)], { hasMoreBefore: true, nextBefore: "3" }), page([message(3)])] });
  await assert.rejects(repeated.create(), ConversationExportError);
});

test("message, byte and total ZIP limits fail closed instead of returning truncated content", async t => {
  for (const limits of [{ messages: 1 }, { textBytes: 1 }, { archiveBytes: 100 }]) await t.test(JSON.stringify(limits), async () => {
    const f = fixture({ limits, pages: [page([message(1), message(2)])] }); await assert.rejects(f.create(), error => error.code === "limit");
  });
  const f = fixture({ pages: [page([message(1, { media })])], photoRead: async () => ({ bytes: Buffer.from("not a JPEG"), mime: "image/jpeg" }) });
  await assert.rejects(f.create(), error => error.code === "changed");
});

test("aborts and elapsed limits stop preparation and do not release a busy read early", async () => {
  let release; const held = new Promise(resolve => { release = resolve; }), controller = new AbortController();
  const f = fixture({ history: () => held }); const running = f.create({ signal: controller.signal }); controller.abort();
  await assert.rejects(f.create(), error => error.code === "busy"); release(page([message(1)]));
  await assert.rejects(running, error => error.code === "cancelled");
  f.advance(); const next = await f.create(); assert.ok(Buffer.isBuffer(next));
  let tick = 0; const timed = fixture({ elapsed: () => tick++, limits: { milliseconds: 1 } });
  await assert.rejects(timed.create(), error => error.code === "cancelled");
});

test("one bounded cooldown is shared by all callers and resets after thirty seconds", async () => {
  const f = fixture(); await f.create(); await assert.rejects(f.create(), error => error.code === "busy"); f.advance(); await f.create();
});

test("client exports retain the archive's canonical authors without private CRM or campaign hints", async t => {
  const exporter = createConversationExporter({ role: "client", clock: () => now, history: async () => page([
    message(1, { sender: "me", body: "My own client message" }), message(2, { sender: "peer", body: "A message from Jess" })
  ], { conversation: { id: conversationId, client: null, peerName: "Private administrator login", latestSequence: "2" } }) });
  const data = await inspect(t, await exporter.create({ token: "client-session", conversationId, expectedClientId: clientId, clientName: "Client <test>", includePhotos: false }));
  assert.equal(data.document.client, "Client <test>"); assert.equal(data.document.administrator, "Jess");
  assert.deepEqual(data.document.messages.map(row => row.sender), ["peer", "me"], "me in archive v1 always denotes Jess, independent of downloader");
  assert.match(data.html, /<b>Client &lt;test&gt;<\/b>/); assert.match(data.html, /<b>Jess<\/b>/);
  for (const marker of ["Private administrator login", "never-export", "campaign", "broadcast", "notes", "tags", "groupes", "groups", "labels"]) {
    assert.equal(JSON.stringify(data).toLowerCase().includes(marker.toLowerCase()), false, marker);
  }
});

test("client export accepts only its role-specific reader shape and an authenticated display name", async () => {
  assert.throws(() => createConversationExporter({ role: "guest", history: async () => page([]) }), TypeError);
  const exporter = createConversationExporter({ role: "client", clock: () => now, history: async () => page([]) });
  const input = { token: "synthetic", conversationId, expectedClientId: clientId, includePhotos: false };
  await assert.rejects(exporter.create(input), error => error.code === "input");
  await assert.rejects(exporter.create({ ...input, clientName: "Client" }), error => error.code === "unavailable");
});
