import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastState, clearBroadcast, broadcastTicket, currentBroadcast, acceptBroadcastSession, resetContacts, contactPageQuery, acceptContacts, selectRecipient, clearSelection, updateComposition, previewTicket, acceptPreview, compositionValid, canConfirmBroadcast, prepareCampaign, retryCampaign, rejectCampaign, parseCampaign, mergeCampaign, acceptCampaign } from "../public/broadcast-model.js";
import { parseBroadcastPreference, createPreferenceState, clearPreference, preferenceTicket, currentPreference, acceptPreferenceSession, acceptPreference, preferenceSaveBody, mountBroadcastPreference } from "../public/broadcast-preference.js";

const now = 1800000000000;
const id = (value) => value.toString(16).padStart(32, "0");
const admin = (extra = {}) => ({ user: { id: id(1000), role: "admin", pseudonym: "Jessie" }, csrf: "x".repeat(43), expiresAt: now + 3600000, mediaEnabled: true, ...extra });
const client = (extra = {}) => ({ user: { id: id(2000), role: "client", pseudonym: "Client fictif" }, csrf: "y".repeat(43), expiresAt: now + 3600000, ...extra });
const contact = (value, extra = {}) => ({ id: id(value), client: { id: id(value + 100), pseudonym: `Client ${value}` }, crm: { nickname: "" }, canSend: true, ...extra });
const page = (contacts) => ({ contacts, nextCursor: contacts.at(-1)?.id ?? null, hasMore: false });
function connected() { const state = createBroadcastState(); acceptBroadcastSession(state, clearBroadcast(state, { visible: true }), admin(), now); return state; }
function selected(count = 2) {
  const state = connected(); acceptContacts(state, page(Array.from({ length: count }, (_, index) => contact(index + 1))));
  for (let value = 1; value <= count; value += 1) selectRecipient(state, id(value), true);
  updateComposition(state, { title: "Pour mes clients", body: "  Bonjour <script>texte</script>\n" }); return state;
}
const preview = (state, changes = {}) => ({ recipients: [...state.selected.keys()].map((conversationId, index) => ({ conversationId, client: { id: id(index + 101), pseudonym: `Client ${index + 1}` }, eligible: true, reason: null, repeatMedia: false })), eligibleCount: state.selected.size, repeatCount: 0, ...changes });
function ready() { const state = selected(); acceptPreview(state, previewTicket(state), preview(state)); state.acknowledged = true; return state; }
function campaign(payload, changes = {}) {
  return { id: id(9000), clientCampaignId: payload.clientCampaignId, title: payload.title, body: payload.body, mediaId: payload.mediaId,
    allowRepeatMedia: payload.allowRepeatMedia, status: "queued", createdAt: now, updatedAt: now, expiresAt: now + 604800000,
    counts: { total: payload.conversationIds.length, pending: payload.conversationIds.length, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 }, ...changes };
}

test("broadcast UI starts without selected clients or a sendable composition", () => {
  const state = createBroadcastState(); assert.equal(state.visible, false); assert.equal(state.session, null); assert.equal(state.selected.size, 0);
  assert.equal(canConfirmBroadcast(state, now), false); assert.equal(prepareCampaign(state, id(90), now), null);
});
test("client, malformed and expired sessions clear private broadcast state", () => {
  for (const input of [client(), admin({ expiresAt: now }), admin({ csrf: "x".repeat(42) + "\n" }), admin({ user: { ...admin().user, id: id(1) + "\n" } }), admin({ mediaEnabled: "true" })]) {
    const state = ready(); const ticket = broadcastTicket(state); assert.equal(acceptBroadcastSession(state, ticket, input, now), false);
    assert.equal(state.session, null); assert.equal(state.selected.size, 0); assert.equal(state.draft.body, ""); assert.equal(currentBroadcast(state, ticket), false);
  }
});
test("a different account or a new login for the same admin invalidates pending sends", () => {
  for (const input of [admin({ user: { ...admin().user, id: id(1001) } }), admin({ csrf: "z".repeat(43) })]) {
    const state = ready(); prepareCampaign(state, id(90), now); const ticket = broadcastTicket(state);
    assert.equal(acceptBroadcastSession(state, ticket, input, now), false); assert.equal(state.pending, null); assert.equal(state.selected.size, 0); assert.equal(state.session, null);
  }
});
test("CRM filter changes preserve only explicitly checked recipients and reject the old in-flight page", () => {
  const state = selected(); const oldEpoch = state.filterEpoch; const nextEpoch = resetContacts(state, "limit=50&q=autre%25%5F&tagId=" + id(50));
  assert.equal(acceptContacts(state, page([contact(3)]), { epoch: oldEpoch }), false); assert.equal(state.contacts.size, 0);
  assert.equal(acceptContacts(state, page([contact(4)]), { epoch: nextEpoch }), true); assert.equal(state.selected.size, 2); assert.equal(state.selected.has(id(4)), false);
  assert.equal(selectRecipient(state, id(3), true), false); assert.equal(selectRecipient(state, id(4), true), true);
});
test("keyset pagination retains the submitted filter snapshot while the form changes", () => {
  const state = connected(); resetContacts(state, "limit=50&q=ancien%25%5F&groupId=" + id(50));
  const query = new URLSearchParams(contactPageQuery(state, id(10))); assert.equal(query.get("q"), "ancien%_"); assert.equal(query.get("groupId"), id(50)); assert.equal(query.get("afterId"), id(10));
  const oldEpoch = state.filterEpoch; resetContacts(state, "limit=50&q=nouveau");
  assert.equal(acceptContacts(state, page([contact(11)]), { epoch: oldEpoch }), false); assert.equal(new URLSearchParams(contactPageQuery(state)).get("q"), "nouveau");
});
test("broadcast selection is capped at 100 and never auto-selects newly loaded clients", () => {
  const state = connected(); acceptContacts(state, page(Array.from({ length: 100 }, (_, index) => contact(index + 1))));
  assert.equal(state.selected.size, 0); for (let value = 1; value <= 100; value += 1) assert.equal(selectRecipient(state, id(value), true), true);
  acceptContacts(state, page([contact(101)])); assert.equal(selectRecipient(state, id(101), true), false); assert.equal(state.selected.size, 100);
  assert.equal(selectRecipient(state, id(2), false), true); assert.equal(selectRecipient(state, id(101), true), true);
});
test("contact DTOs retain no email, private notes or extra CRM fields", () => {
  const state = connected(); acceptContacts(state, page([contact(1, { email: "private@example.invalid", crm: { nickname: "Alias", notes: "Secret", labels: [{ name: "Privé" }] } })]));
  const stored = state.contacts.get(id(1)); assert.deepEqual(Object.keys(stored).sort(), ["canSend", "client", "id", "nickname"]); assert.equal(JSON.stringify(stored).includes("Secret"), false);
});
test("changing a recipient or photo invalidates the earlier eligibility proof even if selection returns", () => {
  const state = selected(); const ticket = previewTicket(state); selectRecipient(state, id(1), false); selectRecipient(state, id(1), true);
  assert.equal(acceptPreview(state, ticket, preview(state)), false);
  const photoTicket = previewTicket(state); updateComposition(state, { mediaId: id(300) }); updateComposition(state, { mediaId: null });
  assert.equal(acceptPreview(state, photoTicket, preview(state)), false); assert.equal(state.preview, null);
});
test("eligibility preview rejects missing, duplicate, foreign or contradictory recipients", () => {
  const state = selected(); const good = preview(state);
  const inputs = [{ ...good, eligibleCount: 1 }, { ...good, repeatCount: 1 }, { ...good, recipients: good.recipients.slice(1) },
    { ...good, recipients: [good.recipients[0], good.recipients[0]] }, { ...good, recipients: [{ ...good.recipients[0], conversationId: id(99) }, good.recipients[1]] },
    { ...good, recipients: [{ ...good.recipients[0], reason: "opted_out" }, good.recipients[1]] }];
  for (const input of inputs) assert.throws(() => acceptPreview(state, previewTicket(state), input), /invalid_preview/);
  assert.equal(state.preview, null);
});
test("consent or access failure blocks the entire explicit confirmation", () => {
  const state = selected(); const input = preview(state); input.recipients[0].eligible = false; input.recipients[0].reason = "opted_out"; input.eligibleCount = 1;
  acceptPreview(state, previewTicket(state), input); state.acknowledged = true; assert.equal(canConfirmBroadcast(state, now), false); assert.equal(prepareCampaign(state, id(90), now), null);
});
test("a previously shared photo requires its own override followed by another explicit acknowledgment", () => {
  const state = selected(); updateComposition(state, { mediaId: id(300), body: "" }); const input = preview(state); input.recipients[0].repeatMedia = true; input.repeatCount = 1;
  acceptPreview(state, previewTicket(state), input); state.acknowledged = true; assert.equal(canConfirmBroadcast(state, now), false);
  updateComposition(state, { allowRepeatMedia: true }); assert.equal(state.acknowledged, false); state.acknowledged = true; assert.equal(canConfirmBroadcast(state, now), true);
});
test("text and photo captions preserve exact valid Unicode and reject unsupported or invisible content", () => {
  const state = selected();
  for (const body of ["  Bonjour  ", "é", "e\u0301", "\ufeffDébut", "<script>texte</script>", "ligne\r\n\tfin", "😀".repeat(2048)]) { updateComposition(state, { body }); assert.equal(compositionValid(state), true); assert.equal(state.draft.body, body); }
  for (const body of ["", "   ", "\u200b\u200d", "\ud800", "a\u0085b", "a\u0000b", "x".repeat(4097)]) { updateComposition(state, { body }); assert.equal(compositionValid(state), false); }
  updateComposition(state, { mediaId: id(300), body: "" }); assert.equal(compositionValid(state), true);
  for (const body of [" ", "\u200b", "x".repeat(1001)]) { updateComposition(state, { body }); assert.equal(compositionValid(state), false); }
  updateComposition(state, { body: "Légende", mediaId: id(300) }); state.session.mediaEnabled = false; assert.equal(compositionValid(state), false);
});
test("title checks refuse hidden-only, directional controls and multiline titles before confirmation", () => {
  const state = selected();
  for (const title of ["", " ", "\u200b", "Un\ntitre", "a\u202eb", "a\u2066b", "a\u0085b", "x".repeat(81)]) { updateComposition(state, { title }); assert.equal(compositionValid(state), false); }
  updateComposition(state, { title: "  Nouvelles de Jessie 💬  " }); assert.equal(compositionValid(state), true);
});
test("confirmation is explicit, expires with the session and is reset by content edits", () => {
  const state = ready(); assert.equal(canConfirmBroadcast(state, now), true); assert.equal(canConfirmBroadcast(state, now + 3600000), false);
  updateComposition(state, { body: "Nouveau contenu" }); assert.equal(canConfirmBroadcast(state, now), false); assert.equal(state.acknowledged, false);
  state.acknowledged = true; assert.equal(canConfirmBroadcast(state, now), true);
});
test("uncertain sends freeze one immutable payload and retry with exactly the same identifier", () => {
  const state = ready(); const payload = prepareCampaign(state, id(90), now); const ticket = broadcastTicket(state);
  assert.ok(Object.isFrozen(payload)); assert.ok(Object.isFrozen(payload.conversationIds)); assert.equal(prepareCampaign(state, id(91), now), null);
  assert.equal(updateComposition(state, { body: "Changé" }), false); assert.equal(clearSelection(state), false); assert.equal(selectRecipient(state, id(1), false), false);
  assert.equal(retryCampaign(state), null); rejectCampaign(state, ticket); assert.strictEqual(retryCampaign(state), payload); assert.equal(payload.clientCampaignId, id(90));
});
test("a definite rejected request unlocks its unchanged draft and requires a new eligibility review", () => {
  const state = ready(); const original = prepareCampaign(state, id(90), now); rejectCampaign(state, broadcastTicket(state), { definitiveRejected: true });
  assert.equal(state.pending, null); assert.equal(state.preview, null); assert.equal(state.draft.body, original.body); assert.equal(state.selected.size, 2); assert.equal(canConfirmBroadcast(state, now), false);
  assert.equal(selectRecipient(state, id(1), false), true); assert.equal(updateComposition(state, { body: "Corrigé" }), true);
});
test("CSRF failure blocks retries without silently repeating a POST", () => {
  const state = ready(); prepareCampaign(state, id(90), now); rejectCampaign(state, broadcastTicket(state), { csrfFailed: true });
  assert.equal(state.pending.status, "uncertain"); assert.equal(retryCampaign(state), null); assert.equal(canConfirmBroadcast(state, now), false);
});
test("acknowledgment must match the immutable caller ID and contents before releasing the draft", () => {
  const state = ready(); const payload = prepareCampaign(state, id(90), now); const ticket = broadcastTicket(state);
  for (const changes of [{ clientCampaignId: id(91) }, { body: "Autre texte" }, { title: "Autre titre" }, { mediaId: id(300) }]) assert.throws(() => acceptCampaign(state, ticket, { campaign: campaign(payload, changes), duplicate: false }));
  const accepted = acceptCampaign(state, ticket, { campaign: campaign(payload, { privateField: "secret" }), duplicate: true });
  assert.equal(accepted.id, id(9000)); assert.equal(Object.hasOwn(accepted, "privateField"), false); assert.equal(state.pending, null); assert.equal(state.selected.size, 0); assert.equal(state.draft.body, "");
});
test("hiding or logging out drops content, recipients and pending acknowledgments even after the same admin returns", () => {
  const state = ready(); const payload = prepareCampaign(state, id(90), now); const ticket = broadcastTicket(state); const oldPreview = previewTicket(state); clearBroadcast(state);
  assert.equal(state.pending, null); assert.equal(state.preview, null); assert.equal(state.contacts.size, 0); assert.equal(state.selected.size, 0); assert.equal(state.draft.body, "");
  acceptBroadcastSession(state, clearBroadcast(state, { visible: true }), admin(), now);
  assert.equal(acceptCampaign(state, ticket, { campaign: campaign(payload), duplicate: false }), null); assert.equal(acceptPreview(state, oldPreview, { recipients: [], eligibleCount: 0, repeatCount: 0 }), false);
});
test("campaign detail discards private server fields and retains only individual recipient status", () => {
  const state = ready(); const payload = prepareCampaign(state, id(90), now); const row = campaign(payload, { recipients: payload.conversationIds.map((conversationId) => ({ conversationId, client: { id: id(400), pseudonym: "Client fictif", email: "private@example.invalid" }, state: "pending", reason: null, messageId: null, deliveredAt: null, notes: "Secret" })) });
  const result = parseCampaign(row, { detail: true }); assert.equal(result.recipients.length, 2); assert.equal(JSON.stringify(result).includes("private@example.invalid"), false); assert.equal(JSON.stringify(result).includes("Secret"), false);
  assert.throws(() => parseCampaign({ ...row, counts: { ...row.counts, total: 3 } }, { detail: true }));
});
test("older history responses cannot roll back delivery counts or repaint a cancelled campaign as queued", () => {
  const payload = prepareCampaign(ready(), id(90), now); const queued = campaign(payload);
  const running = campaign(payload, { status: "running", updatedAt: now + 1, counts: { ...queued.counts, delivered: 1, pending: 1 } });
  assert.strictEqual(mergeCampaign(running, queued), running);
  const cancelled = campaign(payload, { status: "cancelled", updatedAt: now + 1, counts: { ...queued.counts, delivered: 1, pending: 0, cancelled: 1 } });
  assert.strictEqual(mergeCampaign(cancelled, running), cancelled); assert.strictEqual(mergeCampaign(cancelled, { ...queued, updatedAt: now + 2 }), cancelled);
  assert.strictEqual(mergeCampaign(queued, running), running);
});

test("client diffusion preference defaults to opt-out and versions remain exact unsigned 64-bit strings", () => {
  assert.deepEqual(parseBroadcastPreference({ enabled: false, version: "0", updatedAt: null }), { enabled: false, version: "0", updatedAt: null });
  assert.equal(parseBroadcastPreference({ enabled: true, version: "18446744073709551615", updatedAt: now }).version, "18446744073709551615");
  for (const version of [1, "01", "-1", "1\n", "1\r\n", " 1", "1e2", "18446744073709551616"]) assert.throws(() => parseBroadcastPreference({ enabled: true, version, updatedAt: now }));
  for (const input of [{ enabled: true, version: "0", updatedAt: null }, { enabled: false, version: "1", updatedAt: null }, { enabled: "true", version: "1", updatedAt: now }]) assert.throws(() => parseBroadcastPreference(input));
});
test("only a current client session can load or save preferences and it need not have active chat gates", () => {
  const state = createPreferenceState(); assert.equal(preferenceSaveBody(state, true, now), null);
  let ticket = clearPreference(state, { visible: true }); assert.equal(acceptPreferenceSession(state, ticket, admin(), now), false);
  ticket = clearPreference(state, { visible: true }); assert.equal(acceptPreferenceSession(state, ticket, client({ access: { state: "expired" } }), now), true);
  acceptPreference(state, preferenceTicket(state), { enabled: false, version: "0", updatedAt: null });
  const body = preferenceSaveBody(state, true, now); assert.deepEqual(body, { enabled: true, expectedVersion: "0" }); assert.equal(preferenceSaveBody(state, false, now), null);
});
test("conflict or CSRF refresh requirement requires a new GET and another explicit save", () => {
  const state = createPreferenceState(); acceptPreferenceSession(state, clearPreference(state, { visible: true }), client(), now);
  const ticket = preferenceTicket(state); acceptPreference(state, ticket, { enabled: true, version: "2", updatedAt: now }); state.refreshRequired = true;
  assert.equal(preferenceSaveBody(state, false, now), null); acceptPreference(state, ticket, { enabled: false, version: "3", updatedAt: now + 1 });
  assert.equal(state.busy, false); assert.deepEqual(preferenceSaveBody(state, true, now), { enabled: true, expectedVersion: "3" });
});
test("a hidden page or a changed client login cannot accept an older preference acknowledgment", () => {
  const state = createPreferenceState(); acceptPreferenceSession(state, clearPreference(state, { visible: true }), client(), now); const ticket = preferenceTicket(state);
  acceptPreference(state, ticket, { enabled: false, version: "0", updatedAt: null }); preferenceSaveBody(state, true, now);
  assert.equal(acceptPreferenceSession(state, ticket, client({ csrf: "z".repeat(43) }), now), false); assert.equal(state.session, null); assert.equal(state.preference, null);
  assert.equal(acceptPreference(state, ticket, { enabled: true, version: "1", updatedAt: now }), false);
  clearPreference(state); assert.equal(currentPreference(state, ticket), false);
});

class FakeNode extends EventTarget {
  constructor(tag) { super(); this.tagName = tag; this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.isConnected = true; this.textContent = ""; this.classList = { toggle() {} }; }
  append(...nodes) { for (const item of nodes) { item.parentNode = this; this.children.push(item); } }
  setAttribute() {}
  remove() { this.isConnected = false; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this); }
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }
const flush = async () => { for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
function browserFixture(handler) {
  const originals = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  const document = Object.assign(new EventTarget(), { visibilityState: "visible", createElement: (tag) => new FakeNode(tag) }); const window = new EventTarget(); const calls = [];
  globalThis.document = document; globalThis.window = window;
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return handler(path, options); };
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const container = new FakeNode("div");
  return { document, container, calls, response, restore() { Object.assign(globalThis, originals); }, find: (tag) => descendants(container).filter((item) => item.tagName === tag) };
}
const liveClient = () => client({ expiresAt: Date.now() + 3600000 });

test("preference mount clears private controls on hide and ignores a late network result", async () => {
  let release; let fixture;
  fixture = browserFixture(async (path) => path.endsWith("/session") ? fixture.response(liveClient()) : new Promise((resolve) => { release = () => resolve(fixture.response({ enabled: true, version: "7", updatedAt: now })); }));
  let ui;
  try {
    ui = mountBroadcastPreference(fixture.container); await flush(); assert.equal(fixture.calls.length, 2);
    fixture.document.visibilityState = "hidden"; fixture.document.dispatchEvent(new Event("visibilitychange")); release(); await flush();
    assert.equal(fixture.container.children[0].hidden, true); assert.equal(fixture.find("input")[0].checked, false); assert.equal(fixture.find("form")[0].hidden, true);
    assert.equal(fixture.calls.some((call) => call.options.method === "POST"), false);
  } finally { ui?.clear(); fixture.restore(); }
});
test("preference mount does not automatically repeat a conflicting POST and reload requires an explicit save", async () => {
  let fixture; let version = "2";
  fixture = browserFixture(async (path, options) => path.endsWith("/session") ? fixture.response(liveClient()) : options.method === "POST" ? fixture.response({ error: "record_changed" }, 409) : fixture.response({ enabled: false, version, updatedAt: now }));
  let ui;
  try {
    ui = mountBroadcastPreference(fixture.container); await flush(); fixture.find("input")[0].checked = true;
    fixture.find("form")[0].dispatchEvent(new Event("submit", { cancelable: true })); await flush(); assert.equal(fixture.calls.filter((call) => call.options.method === "POST").length, 1);
    assert.equal(fixture.find("button")[0].disabled, true); fixture.find("form")[0].dispatchEvent(new Event("submit", { cancelable: true })); await flush();
    assert.equal(fixture.calls.filter((call) => call.options.method === "POST").length, 1);
    version = "3"; await ui.reload(); await flush(); assert.equal(fixture.calls.filter((call) => call.options.method === "POST").length, 1); assert.equal(fixture.find("button")[0].disabled, false);
  } finally { ui?.clear(); fixture.restore(); }
});
test("clearing a preference mount aborts current work and cannot reattach its private controls", async () => {
  let release; let fixture;
  fixture = browserFixture(async () => new Promise((resolve) => { release = () => resolve(fixture.response(liveClient())); }));
  let ui;
  try {
    ui = mountBroadcastPreference(fixture.container); assert.equal(fixture.calls.length, 1); ui.clear(); assert.equal(fixture.calls[0].options.signal.aborted, true); release(); await flush();
    assert.equal(fixture.container.children.length, 0); fixture.document.dispatchEvent(new Event("visibilitychange")); await flush(); assert.equal(fixture.calls.length, 1);
  } finally { ui?.clear(); fixture.restore(); }
});
