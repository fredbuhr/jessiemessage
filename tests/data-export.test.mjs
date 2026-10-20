import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { DATA_EXPORT_DEFAULT_LIMITS, DataExportError, exportClientContent } from "../server/data/export.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";

const NOW = Date.parse("2026-10-15T10:00:00.123Z");
const sql = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const id = (value) => Buffer.from(value.toString(16).padStart(32, "0"), "hex");
const jpg = (value = 1) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, value, 0xff, 0xd9]);
const sha = (value) => createHash("sha256").update(value).digest();
const unavailable = (error) => error instanceof DataExportError && error.code === "DATA_EXPORT_UNAVAILABLE"
  && error.cause === undefined && !/secret|SQL|SMTP|password|example\.invalid/.test(error.message);

function fixture() {
  const clientId = id(1), adminId = id(2), messageKey = randomBytes(32);
  const account = { id: clientId, role: "client", status: "active", pseudonym: "Client fictif", email: "client@example.invalid",
    createdAt: sql(NOW - 60000), updatedAt: sql(NOW - 1000), emailVerifiedAt: sql(NOW - 55000), ageDeclaredAt: sql(NOW - 60000),
    ageAssuredAt: sql(NOW - 50000), accessApprovedAt: sql(NOW - 45000), accessExpiresAt: sql(NOW + 86400000),
    passwordHash: "secret password", token: "secret session", crmNotes: "secret CRM", otherClient: "other-client@example.invalid" };
  const conversation = { id: id(10), clientId, adminId, peerName: "Jessie", createdAt: sql(NOW - 45000), closedAt: null,
    lastReadSequence: "2", peerReadSequence: "1", adminEmail: "secret-admin@example.invalid", campaignAudience: [id(999)] };
  const state = { messages: [], ownMedia: [], files: new Map(), fileReads: [], deliveredBuffers: [], pages: [], writes: [] };
  const output = { json: new Map(), lines: new Map(), media: new Map(), empty: new Set() };
  function asset(value, ownerId = adminId, payload = jpg(value % 255)) {
    const assetId = id(value), storageKey = randomBytes(32);
    const media = { id: assetId, ownerId, ownerRole: ownerId.equals(clientId) ? "client" : "admin", storageKey, digest: sha(payload),
      width: 200, height: 100, fullBytes: payload.length, deletedAt: null, journalState: "registered", journalAssetId: assetId,
      journalOwnerId: ownerId, secret: "secret metadata", ciphertext: "secret cipher" };
    state.files.set(storageKey.toString("hex"), Buffer.from(payload));
    return media;
  }
  function message(value, sequence, body, senderRole = "client", media = null) {
    const senderId = senderRole === "client" ? clientId : adminId;
    const binding = { messageId: id(value), conversationId: conversation.id, senderId };
    return { id: binding.messageId, conversationId: conversation.id, senderId, senderRole, sequence: String(sequence),
      encrypted: encryptMessageBody(body, messageKey, binding), fingerprint: messageFingerprint(body, messageKey, binding),
      createdAt: sql(NOW - 30000 + Number(BigInt(sequence) % 10000n)), deletedAt: null, media, clientMessageId: "secret retry", campaign: "secret campaign" };
  }
  const reader = { account, conversation, preference: { enabled: true, updatedAt: sql(NOW - 20000), secret: "secret consent metadata" },
    async messages({ afterSequence, limit }) {
      state.pages.push({ kind: "messages", afterSequence, limit });
      const eligible = state.messages.filter((row) => BigInt(row.sequence) > BigInt(afterSequence));
      const rows = eligible.slice(0, limit);
      return { rows, hasMore: eligible.length > limit, nextCursor: eligible.length > limit ? rows.at(-1).sequence : null };
    },
    async ownMedia({ afterId, limit }) {
      state.pages.push({ kind: "ownMedia", afterId, limit });
      const eligible = state.ownMedia.filter((row) => afterId === null || Buffer.compare(row.id, afterId) > 0);
      const rows = eligible.slice(0, limit);
      return { rows, hasMore: eligible.length > limit, nextCursor: eligible.length > limit ? rows.at(-1).id : null };
    },
  };
  const storage = { async get(input) {
    state.fileReads.push(input);
    const stored = state.files.get(input.storageKey.toString("hex")); if (!stored) throw new Error("private SQL storage secret");
    const result = Buffer.from(stored); state.deliveredBuffers.push(result); return result;
  } };
  const writer = {
    async empty(name) { state.writes.push(["empty", name]); output.empty.add(name); output.lines.set(name, []); },
    async json(name, value) { state.writes.push(["json", name]); output.json.set(name, structuredClone(value)); },
    async line(name, value) { state.writes.push(["line", name]); output.lines.get(name).push(structuredClone(value)); },
    async media(name, value) { state.writes.push(["media", name]); output.media.set(name, Buffer.from(value)); },
  };
  return { clientId, adminId, messageKey, account, conversation, state, output, asset, message, reader, storage, writer,
    run: (changes = {}) => exportClientContent({ reader, clientId, now: NOW, messageKey, storage, writer, ...changes }) };
}

test("client export whitelists account, selected messages, preferences and active own library with deduplicated photos", async () => {
  const f = fixture(), received = f.asset(201), own = f.asset(202, f.clientId), unused = f.asset(203, f.clientId);
  f.state.messages = [f.message(101, 1, "Mon texte exact\n<b>préservé</b>"), f.message(102, 2, "Bonjour", "admin"),
    f.message(103, 3, JSON.stringify({ mediaId: received.id.toString("hex"), caption: "Photo reçue" }), "admin", received),
    f.message(104, 4, JSON.stringify({ mediaId: own.id.toString("hex"), caption: "" }), "client", own)];
  const deleted = f.message(105, 5, "supprimé", "admin", received); deleted.encrypted = null; deleted.deletedAt = sql(NOW - 1000); f.state.messages.push(deleted);
  f.state.ownMedia = [own, unused];
  assert.deepEqual(await f.run(), { messages: 5, mediaFiles: 3, libraryItems: 2, mediaBytes: 21, rows: 7 });
  const account = f.output.json.get("account.json");
  assert.deepEqual(Object.keys(account), ["format", "version", "generatedAt", "user", "conversation", "preferences"]);
  assert.equal(account.format, "jessiemessage-client-content"); assert.equal(account.version, 1); assert.equal(account.user.email, f.account.email);
  assert.equal(account.conversation.peerName, "Jessie"); assert.deepEqual(account.preferences, { broadcasts: { enabled: true, updatedAt: "2026-10-15T09:59:40.123000Z" } });
  assert.equal(account.conversation.lastReadSequence, "2"); assert.equal(account.conversation.peerReadSequence, "0");
  const messages = f.output.lines.get("messages.jsonl");
  assert.equal(messages[0].body, "Mon texte exact\n<b>préservé</b>"); assert.equal(messages[0].sender, "me"); assert.equal(messages[1].sender, "peer");
  assert.equal(messages[2].body, "Photo reçue"); assert.equal(messages[3].body, ""); assert.equal(messages[4].body, null); assert.equal(messages[4].media, null);
  assert.deepEqual(messages[2].media, { file: `media/${received.id.toString("hex")}.jpg`, type: "image/jpeg", width: 200, height: 100 });
  assert.equal(f.output.media.size, 3); assert.equal(f.state.fileReads.length, 3);
  assert.deepEqual(f.output.lines.get("library.jsonl").map((row) => row.file), [own, unused].map((row) => `media/${row.id.toString("hex")}.jpg`));
  const all = JSON.stringify([...f.output.json.values(), ...f.output.lines.values()]);
  assert.doesNotMatch(all, /secret|other-client|password|token|fingerprint|digest|storageKey|campaign|crm|encrypted|ciphertext|adminEmail/i);
  for (const value of [f.account.id, f.conversation.id, f.adminId, received.storageKey, own.storageKey]) assert.equal(JSON.stringify(account).includes(value.toString("hex")), false);
  assert.ok(f.state.deliveredBuffers.every((value) => value.every((byte) => byte === 0)), "temporary decrypted photo buffers are erased after awaited writes");
  assert.ok(f.output.media.values().next().value.some((byte) => byte !== 0));
});

test("client content export never discloses Jessie’s read cursor supplied by an alternate reader", async () => {
  const f = fixture(); f.state.messages = [f.message(101, 1, "Client-visible content")];
  f.conversation.peerReadSequence = "0";
  await f.run();
  const before = structuredClone(f.output.json.get("account.json"));
  f.conversation.peerReadSequence = "18446744073709551615";
  await f.run();
  assert.deepEqual(f.output.json.get("account.json"), before);
  assert.equal(before.conversation.lastReadSequence, "2");
  assert.equal(before.conversation.peerReadSequence, "0");
});

test("tombstoned received photos never decrypt or copy their retained media link, while owned unused library remains available", async () => {
  const f = fixture(), photo = f.asset(201), own = f.asset(202, f.clientId);
  const deleted = f.message(101, 1, "secret-deleted-body", "admin", photo); deleted.encrypted = null; deleted.deletedAt = sql(NOW - 1000);
  photo.deletedAt = sql(NOW - 500); photo.journalState = "erasing";
  f.state.messages = [deleted]; f.state.ownMedia = [own];
  assert.deepEqual(await f.run(), { messages: 1, mediaFiles: 1, libraryItems: 1, mediaBytes: 7, rows: 2 });
  assert.deepEqual(f.state.fileReads.map((row) => row.assetId), [own.id]);
  assert.doesNotMatch(JSON.stringify(f.output.lines.get("messages.jsonl")), /secret-deleted-body|media\/|secret/);
});

test("offline authority accepts retained client states including expired or suspended access without creating sessions or reading secrets", async () => {
  for (const status of ["pending", "active", "suspended", "revoked", "deleted"]) {
    const f = fixture(); f.account.status = status;
    if (status === "active") f.account.accessExpiresAt = sql(NOW - 1000);
    f.state.messages = [f.message(101, 1, "Historique conservé")];
    assert.deepEqual(await f.run({ storage: null }), { messages: 1, mediaFiles: 0, libraryItems: 0, mediaBytes: 0, rows: 1 });
    assert.equal(f.output.json.get("account.json").user.status, status);
  }
  const empty = fixture(); empty.reader.conversation = null; empty.reader.preference = { enabled: false, updatedAt: null }; empty.account.ageDeclaredAt = null;
  assert.deepEqual(await empty.run({ storage: null }), { messages: 0, mediaFiles: 0, libraryItems: 0, mediaBytes: 0, rows: 0 });
  assert.deepEqual([...empty.output.empty], ["messages.jsonl", "library.jsonl"]); assert.equal(empty.output.json.get("account.json").conversation, null);
  assert.equal(empty.output.json.get("account.json").user.ageDeclaredAt, null);
});

test("administrators, mismatched client selection and foreign conversation or sender rows fail closed", async () => {
  for (const mutation of ["admin", "selection", "conversation-client", "conversation-id", "sender-client", "sender-admin", "role", "no-conversation"]) {
    const f = fixture(), row = f.message(101, 1, "Scoped content"); f.state.messages = [row];
    if (mutation === "admin") f.account.role = "admin";
    if (mutation === "selection") f.account.id = id(3);
    if (mutation === "conversation-client") f.conversation.clientId = id(3);
    if (mutation === "conversation-id") row.conversationId = id(11);
    if (mutation === "sender-client") row.senderId = id(3);
    if (mutation === "sender-admin") { row.senderRole = "admin"; row.senderId = id(3); }
    if (mutation === "role") row.senderRole = "operator";
    if (mutation === "no-conversation") f.reader.conversation = null;
    await assert.rejects(f.run(), unavailable); assert.equal(f.output.media.size, 0);
  }
});

test("message key, ciphertext, fingerprint and tombstone invariants are authenticated before plaintext is written", async () => {
  for (const mutation of ["key", "cipher", "fingerprint", "deleted-body", "missing-body", "future", "invalid-date", "before-conversation"]) {
    const f = fixture(), row = f.message(101, 1, "Private retained message"); f.state.messages = [row]; const changes = {};
    if (mutation === "key") changes.messageKey = randomBytes(32);
    if (mutation === "cipher") row.encrypted = "secret corrupted ciphertext";
    if (mutation === "fingerprint") row.fingerprint = randomBytes(32);
    if (mutation === "deleted-body") row.deletedAt = sql(NOW - 1000);
    if (mutation === "missing-body") row.encrypted = null;
    if (mutation === "future") row.createdAt = sql(NOW + 1);
    if (mutation === "invalid-date") row.createdAt = "2026-02-30 10:00:00.000000";
    if (mutation === "before-conversation") row.createdAt = sql(NOW - 50000);
    await assert.rejects(f.run(changes), unavailable); assert.deepEqual(f.output.lines.get("messages.jsonl"), []);
  }
});

test("photo messages require exact canonical photo JSON, matching asset and sender ownership", async () => {
  for (const mutation of ["id", "extra", "duplicate-key", "reordered", "caption", "wrong-owner", "wrong-owner-role", "other-client", "missing-media"]) {
    const f = fixture(), asset = f.asset(201); let body = JSON.stringify({ mediaId: asset.id.toString("hex"), caption: "Photo" });
    if (mutation === "id") body = JSON.stringify({ mediaId: id(999).toString("hex"), caption: "Photo" });
    if (mutation === "extra") body = JSON.stringify({ mediaId: asset.id.toString("hex"), caption: "Photo", secret: "private" });
    if (mutation === "duplicate-key") body = `{"mediaId":"${asset.id.toString("hex")}","caption":"first","caption":"last"}`;
    if (mutation === "reordered") body = JSON.stringify({ caption: "Photo", mediaId: asset.id.toString("hex") });
    if (mutation === "caption") body = JSON.stringify({ mediaId: asset.id.toString("hex"), caption: "x".repeat(1001) });
    if (mutation === "wrong-owner") asset.ownerId = f.clientId;
    if (mutation === "wrong-owner-role") asset.ownerRole = "client";
    if (mutation === "other-client") asset.ownerId = id(3);
    const row = f.message(101, 1, body, "admin", asset); if (mutation === "missing-media") row.media = undefined;
    f.state.messages = [row];
    await assert.rejects(f.run(), unavailable); assert.equal(f.state.fileReads.length, 0); assert.deepEqual(f.output.lines.get("messages.jsonl"), []);
  }
});

test("media metadata, durable journal bindings, full byte length, JPEG envelope and digest fail closed", async () => {
  for (const mutation of ["deleted", "journal-state", "journal-asset", "journal-owner", "dimensions", "size", "missing-file", "bytes", "digest", "jpeg-head", "jpeg-tail"]) {
    const f = fixture(), asset = f.asset(201, f.clientId); f.state.ownMedia = [asset];
    if (mutation === "deleted") asset.deletedAt = sql(NOW - 1);
    if (mutation === "journal-state") asset.journalState = "reserved";
    if (mutation === "journal-asset") asset.journalAssetId = id(999);
    if (mutation === "journal-owner") asset.journalOwnerId = id(999);
    if (mutation === "dimensions") asset.width = 2049;
    if (mutation === "size") asset.fullBytes = 10485761;
    if (mutation === "missing-file") f.state.files.clear();
    if (mutation === "bytes") asset.fullBytes += 1;
    if (mutation === "digest") asset.digest = randomBytes(32);
    if (mutation === "jpeg-head" || mutation === "jpeg-tail") {
      const stored = f.state.files.get(asset.storageKey.toString("hex")); stored[mutation === "jpeg-head" ? 0 : stored.length - 1] = 0; asset.digest = sha(stored);
    }
    await assert.rejects(f.run(), unavailable); assert.equal(f.output.media.size, 0); assert.deepEqual(f.output.lines.get("library.jsonl"), []);
    assert.ok(f.state.deliveredBuffers.every((value) => value.every((byte) => byte === 0)));
  }
});

test("the own-library reader cannot add another client's or administrator's private photo", async () => {
  for (const owner of [id(2), id(3)]) {
    const f = fixture(); f.state.ownMedia = [f.asset(201, owner)]; await assert.rejects(f.run(), unavailable);
    assert.equal(f.state.fileReads.length, 0);
  }
});

test("paged exports preserve decimal sequences beyond safe Number precision and enforce one total row budget", async () => {
  const f = fixture(), first = 9007199254740993n;
  f.conversation.lastReadSequence = String(first); f.conversation.peerReadSequence = "0";
  for (let offset = 0; offset < 101; offset++) f.state.messages.push(f.message(1000 + offset, String(first + BigInt(offset)), `Message ${offset}`));
  // The fixture's display timestamp must not depend on a potentially enormous sequence.
  for (const row of f.state.messages) row.createdAt = sql(NOW - 1);
  assert.deepEqual(await f.run({ limits: { maxRows: 101 } }), { messages: 101, mediaFiles: 0, libraryItems: 0, mediaBytes: 0, rows: 101 });
  assert.deepEqual(f.state.pages.filter((value) => value.kind === "messages").map((value) => value.afterSequence), ["0", String(first + 99n)]);
  assert.equal(f.output.lines.get("messages.jsonl").at(-1).sequence, String(first + 100n));
  const combined = fixture(); combined.state.messages = [combined.message(101, 1, "One")]; combined.state.ownMedia = [combined.asset(201, combined.clientId)];
  await assert.rejects(combined.run({ limits: { maxRows: 1 } }), unavailable); assert.equal(combined.output.media.size, 0);
});

test("export timestamps retain exact SQL microseconds and a future microsecond is not current content", async () => {
  const f = fixture(), first = f.message(101, 1, "Premier"), second = f.message(102, 2, "Second");
  first.createdAt = "2026-10-15 09:59:59.123001"; second.createdAt = "2026-10-15 09:59:59.123002";
  f.account.updatedAt = "2026-10-15 09:59:59.999999"; f.reader.preference.updatedAt = "2026-10-15 09:59:59.999998";
  f.state.messages = [first, second]; await f.run();
  assert.deepEqual(f.output.lines.get("messages.jsonl").map((row) => row.createdAt), ["2026-10-15T09:59:59.123001Z", "2026-10-15T09:59:59.123002Z"]);
  assert.equal(f.output.json.get("account.json").user.updatedAt, "2026-10-15T09:59:59.999999Z");
  assert.equal(f.output.json.get("account.json").preferences.broadcasts.updatedAt, "2026-10-15T09:59:59.999998Z");
  const future = fixture(), row = future.message(101, 1, "Pas encore visible"); row.createdAt = "2026-10-15 10:00:00.123001"; future.state.messages = [row];
  await assert.rejects(future.run(), unavailable); assert.deepEqual(future.output.lines.get("messages.jsonl"), []);
});

test("limits reject oversized text and media instead of silently truncating, and deduplication charges a photo once", async () => {
  const f = fixture();
  assert.ok(Object.isFrozen(DATA_EXPORT_DEFAULT_LIMITS));
  await assert.rejects(f.run({ limits: { maxTextBytes: 1 } }), unavailable); assert.equal(f.output.json.size, 0);
  for (const changes of [{ maxRows: 0 }, { maxRows: 100001 }, { maxTextBytes: Infinity }, { maxMediaBytes: -1 }, { unknown: 1 }]) {
    await assert.rejects(fixture().run({ limits: changes }), unavailable);
  }
  const noMedia = fixture(); noMedia.state.ownMedia = [noMedia.asset(201, noMedia.clientId)];
  await assert.rejects(noMedia.run({ limits: { maxMediaBytes: 0 } }), unavailable); assert.equal(noMedia.state.fileReads.length, 0);
  const dedup = fixture(), own = dedup.asset(201, dedup.clientId); dedup.state.ownMedia = [own];
  dedup.state.messages = [dedup.message(101, 1, JSON.stringify({ mediaId: own.id.toString("hex"), caption: "" }), "client", own)];
  assert.equal((await dedup.run({ limits: { maxMediaBytes: 7 } })).mediaBytes, 7); assert.equal(dedup.state.fileReads.length, 1);
});

test("malformed pages, repeated identities and conflicting duplicate media metadata cannot claim successful completion", async () => {
  for (const kind of ["oversized", "empty-more", "cursor", "order", "duplicate-id", "library-order", "library-cursor", "media-conflict"]) {
    const f = fixture(), row = f.message(101, 1, "Selected content"); f.state.messages = [row];
    if (kind === "oversized") f.reader.messages = async () => ({ rows: Array(101).fill(row), hasMore: false, nextCursor: null });
    if (kind === "empty-more") f.reader.messages = async () => ({ rows: [], hasMore: true, nextCursor: "1" });
    if (kind === "cursor") f.reader.messages = async () => ({ rows: [row], hasMore: false, nextCursor: "1" });
    if (kind === "order") f.reader.messages = async () => ({ rows: [row, row], hasMore: false, nextCursor: null });
    if (kind === "duplicate-id") { const second = f.message(101, 2, "Different selected sequence"); f.state.messages.push(second); }
    if (kind === "library-order") { const a = f.asset(201, f.clientId), b = f.asset(200, f.clientId); f.reader.ownMedia = async () => ({ rows: [a, b], hasMore: false, nextCursor: null }); }
    if (kind === "library-cursor") f.reader.ownMedia = async () => ({ rows: [], hasMore: false, nextCursor: id(201) });
    if (kind === "media-conflict") {
      const media = f.asset(201, f.clientId); f.state.messages = [f.message(101, 1, JSON.stringify({ mediaId: media.id.toString("hex"), caption: "" }), "client", media)];
      f.state.ownMedia = [{ ...media, width: 300 }];
    }
    await assert.rejects(f.run(), unavailable);
  }
});

test("writer and reader failures remain fixed, await writes sequentially and never finalize a partial export", async () => {
  const f = fixture(), photo = f.asset(201, f.clientId); f.state.ownMedia = [photo]; let finalized = false;
  const writer = { ...f.writer, finalize() { finalized = true; }, async line() { throw new Error("private client@example.invalid password SQL /storage/path"); } };
  await assert.rejects(f.run({ writer }), unavailable); assert.equal(finalized, false); assert.equal(f.output.media.size, 1);
  assert.ok(f.state.deliveredBuffers.every((value) => value.every((byte) => byte === 0)));
  const failedRead = fixture(); failedRead.reader.messages = async () => { throw new Error("private SQL email secret"); };
  await assert.rejects(failedRead.run(), unavailable);
  const failedWrite = fixture(); failedWrite.state.ownMedia = [failedWrite.asset(201, failedWrite.clientId)];
  await assert.rejects(failedWrite.run({ writer: { ...failedWrite.writer, async media() { throw new Error("private disk path"); } } }), unavailable);
  assert.ok(failedWrite.state.deliveredBuffers.every((value) => value.every((byte) => byte === 0)));
});

test("export configuration and private metadata validation fail before output and caller key is preserved", async () => {
  const f = fixture(), original = Buffer.from(f.messageKey);
  for (const changes of [{ clientId: f.clientId.toString("hex") }, { clientId: id(3) }, { messageKey: null }, { messageKey: Buffer.alloc(31) },
    { now: NaN }, { now: -1 }, { reader: null }, { storage: {} }, { writer: { ...f.writer, empty: null } }]) {
    await assert.rejects(f.run(changes), unavailable);
  }
  assert.equal(f.state.writes.length, 0); assert.deepEqual(f.messageKey, original);
  for (const mutation of ["email", "date", "preference", "same-peer", "receipt"]) {
    const current = fixture();
    if (mutation === "email") current.account.email = "INVALID@example.invalid";
    if (mutation === "date") current.account.createdAt = "2026-02-30 00:00:00.000000";
    if (mutation === "preference") current.reader.preference = { enabled: true, updatedAt: null };
    if (mutation === "same-peer") current.conversation.adminId = current.clientId;
    if (mutation === "receipt") current.conversation.lastReadSequence = "01";
    await assert.rejects(current.run(), unavailable); assert.equal(current.state.writes.length, 0);
  }
});
