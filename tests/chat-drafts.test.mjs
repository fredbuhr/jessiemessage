import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createChatDrafts } from "../public/chat-drafts.js";

const id = value => value.toString(16).padStart(32, "0"), now = 1792675816926;
const owner = (value = 1, role = "client", csrf = "A".repeat(43)) => ({ id: id(value), role, csrf });
const draft = (value = 101, text = "Synthetic draft", pending = null) => ({ id: id(value), draft: text, pending });
const send = (value = 101, text = "Synthetic send", request = 901) => draft(value, text, { clientMessageId: id(request), body: text, status: "sending" });
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const create = (store, extra = {}) => createChatDrafts({ storage: () => store, clock: () => now,
  digest: bytes => webcrypto.subtle.digest("SHA-256", bytes), ...extra });
const record = store => JSON.parse([...store.values.values()][0]);

test("a same-tab reload restores bounded Unicode text only for the same role, owner and session fingerprint", async () => {
  const store = storage(), first = create(store), text = "  Synthetic 😀\nsecond line  ";
  assert.equal(await first.bind(owner()), true);
  assert.equal(first.write({ ...draft(101, text), imageDraft: { file: { privateName: "private-photo.jpg" } } }), true);
  first.detach(); const reloaded = create(store); await reloaded.bind(owner());
  assert.equal(reloaded.selected(), id(101));
  assert.deepEqual(reloaded.read(id(101)), { id: id(101), text, pending: null, hadAttachment: true, updatedAt: now });
  const raw = [...store.values.values()].join("");
  assert.doesNotMatch(raw, /private-photo|csrf|file|password|token|storageKey|mediaId|videoId/);
  assert.equal(raw.includes(owner().csrf), false); assert.match(record(store).sessionTag, /^[a-f0-9]{64}$/);
});

test("another owner or renewed session purges old text while the other authenticated role remains separate", async () => {
  for (const replacement of [owner(2), owner(1, "client", "B".repeat(43))]) {
    const store = storage(), first = create(store); await first.bind(owner()); first.write(draft());
    const next = create(store); await next.bind(replacement);
    assert.equal(next.read(id(101)), null); assert.equal(store.values.size, 0);
  }
  const store = storage(), client = create(store), admin = create(store);
  await client.bind(owner()); client.write(draft()); await admin.bind(owner(5, "admin"));
  assert.equal(admin.read(id(101)), null); admin.write(draft(105, "Admin synthetic"));
  client.clear(); assert.equal(store.values.size, 1); assert.equal(admin.read(id(105)).text, "Admin synthetic");
});

test("ordinary drafts expire after a day but an immutable uncertain request is never silently expired", async () => {
  const store = storage(), first = create(store); await first.bind(owner());
  first.write(draft(101)); first.beforeSend(send(102));
  const next = create(store, { clock: () => now + 86400001 }); await next.bind(owner());
  assert.equal(next.read(id(101)), null); assert.equal(next.read(id(102)).pending.clientMessageId, id(901));
  const clockBack = create(store, { clock: () => now - 60000 }); await clockBack.bind(owner());
  assert.equal(clockBack.read(id(102)).pending.clientMessageId, id(901), "a clock rollback cannot turn an uncertain request into a new message");
});

test("invalid, oversized or future-dated records are discarded before any text can be restored", async () => {
  for (const corrupt of [saved => ({ ...saved, csrf: "private-extra" }), saved => ({ ...saved, entries: [saved.entries[0], saved.entries[0]] }),
    saved => ({ ...saved, entries: [{ ...saved.entries[0], updatedAt: now + 1 }] }), saved => ({ ...saved, entries: [{ ...saved.entries[0], text: "\ud800" }] })]) {
    const store = storage(), first = create(store); await first.bind(owner()); first.write(draft());
    const key = [...store.values.keys()][0]; store.setItem(key, JSON.stringify(corrupt(record(store))));
    const next = create(store); await next.bind(owner()); assert.equal(next.read(id(101)), null);
  }
  const store = storage(); store.setItem("jessiemessage.chat-drafts.v1.client", "x".repeat(65537));
  const next = create(store); await next.bind(owner()); assert.equal(next.read(id(101)), null); assert.equal(store.values.size, 0);
});

test("the complete UTF-8 record stays within 64 KiB and twenty entries without evicting an uncertain key", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner());
  drafts.beforeSend(send(100));
  for (let index = 101; index < 131; index += 1) assert.equal(drafts.write(draft(index, "😀".repeat(2048))), true);
  assert.ok(new TextEncoder().encode([...store.values.values()][0]).length <= 65536);
  assert.ok(record(store).entries.length <= 20); assert.equal(drafts.read(id(100)).pending.clientMessageId, id(901));
  assert.equal(drafts.read(id(101)), null); assert.equal(drafts.read(id(130)).text, "😀".repeat(2048));
  for (const invalid of ["x".repeat(4097), "\ud800", "x\u0000y"]) assert.equal(drafts.write(draft(500, invalid)), false);
});

test("twenty uncertain requests keep every exact key when a new draft or request does not fit", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner());
  for (let index = 1; index <= 20; index += 1) assert.equal(drafts.beforeSend(send(index, `Synthetic ${index}`, 900 + index)).persisted, true);
  const before = [...store.values.values()][0];
  assert.equal(drafts.write(draft(21)), false);
  assert.deepEqual(drafts.beforeSend(send(21)), { persisted: false, safeToSend: true });
  assert.equal([...store.values.values()][0], before);
  for (let index = 1; index <= 20; index += 1) assert.equal(drafts.read(id(index)).pending.clientMessageId, id(900 + index));
});

test("quota failure during promotion invalidates the old ordinary draft without losing another uncertain request", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner());
  drafts.beforeSend(send(100, "Other uncertain", 800)); drafts.write(draft(101, "New synthetic send"));
  const set = store.setItem;
  store.setItem = (key, value) => { if (value.includes(id(901))) throw new Error("Synthetic quota"); return set(key, value); };
  assert.deepEqual(drafts.beforeSend(send(101, "New synthetic send", 901)), { persisted: false, safeToSend: true });
  assert.equal(drafts.read(id(101)), null); assert.equal(drafts.read(id(100)).pending.clientMessageId, id(800));
  const next = create(store); await next.bind(owner()); assert.equal(next.read(id(101)), null);
});

test("a completely unwritable store cannot preserve an old ordinary draft before sending with a new key", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner()); drafts.write(draft(101, "New synthetic send"));
  store.setItem = () => { throw new Error("Synthetic denied writes"); };
  assert.deepEqual(drafts.beforeSend(send(101, "New synthetic send")), { persisted: false, safeToSend: true });
  assert.equal(store.values.size, 0, "removing this sole ordinary record prevents its reuse as a new send after reload");
});

test("a new POST stays local if invalidation would discard another uncertain key", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner());
  drafts.beforeSend(send(100, "Other uncertain", 800)); drafts.write(draft(101, "New synthetic send"));
  const before = [...store.values.values()][0]; store.setItem = () => { throw new Error("Synthetic denied writes"); };
  assert.deepEqual(drafts.beforeSend(send(101, "New synthetic send")), { persisted: false, safeToSend: false });
  assert.equal([...store.values.values()][0], before);
  assert.equal(drafts.beforeSend(send(100, "Other uncertain", 800)).safeToSend, true, "the existing exact retry stays available");
});

test("replacement requests cannot overwrite an existing uncertain identity or body", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner()); drafts.beforeSend(send());
  const before = [...store.values.values()][0];
  for (const changed of [send(101, "Different body", 901), send(101, "Synthetic send", 902)]) assert.equal(drafts.beforeSend(changed).safeToSend, false);
  assert.equal([...store.values.values()][0], before);
});

test("media files and uncertain captions never become a text-only retry after reload", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner()); drafts.write(draft(101, "Synthetic caption"));
  const media = { ...draft(101, "Synthetic caption"), pending: { kind: "image", clientMessageId: id(901), caption: "Synthetic caption", mediaId: id(800) }, imageDraft: { file: new Blob(["private"]) } };
  assert.equal(drafts.beforeSend(media).safeToSend, true);
  assert.equal(drafts.read(id(101)), null); assert.doesNotMatch([...store.values.values()].join(""), /caption|mediaId|private/);
});

test("unavailable storage degrades to memory while a late fingerprint cannot reactivate a cleared or replaced owner", async () => {
  const unavailable = create(null); assert.equal(await unavailable.bind(owner()), false); assert.equal(unavailable.write(draft()), false);
  assert.equal(unavailable.beforeSend(send()).safeToSend, true);
  for (const action of ["clear", "replace"]) {
    const store = storage(); let release; const held = new Promise(resolve => { release = resolve; }); let calls = 0;
    const drafts = create(store, { digest: () => ++calls === 1 ? held : Promise.resolve(new Uint8Array(32).fill(2).buffer) });
    const binding = drafts.bind(owner()), shared = drafts.bind(owner());
    if (action === "clear") drafts.clear(); else await drafts.bind(owner(2));
    release(new Uint8Array(32).fill(1).buffer); assert.equal(await binding, false); assert.equal(await shared, false);
    if (action === "clear") assert.equal(drafts.write(draft()), false);
    else { assert.equal(drafts.write(draft()), true); assert.equal(record(store).id, id(2)); }
  }
});

test("acknowledged sends remove their persistent marker and text together", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner()); const state = send(); drafts.beforeSend(state);
  state.pending = null; state.draft = ""; drafts.write(state);
  const next = create(store); await next.bind(owner()); assert.equal(next.read(state.id), null); assert.equal(next.selected(), null);
});


test("photo selections persist only caption text before send and no uncertain batch becomes a text-only retry", async () => {
  const store = storage(), drafts = create(store); await drafts.bind(owner());
  const state = { ...draft(101,"Synthetic batch caption"), photoBatch: { started:false, items:[{ file:new Blob(["private-photo-bytes"]),mediaId:id(700),clientMessageId:id(800) }] } };
  assert.equal(drafts.write(state),true); assert.equal(drafts.read(id(101)).hadAttachment,true);
  assert.doesNotMatch([...store.values.values()].join(""),/private-photo-bytes|mediaId|clientMessageId/);
  state.photoBatch.started=true; assert.equal(drafts.write(state),true);
  assert.equal(drafts.read(id(101)),null);
});
