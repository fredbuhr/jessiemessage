import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastState, clearBroadcast, broadcastTicket, currentBroadcast, acceptBroadcastSession, resetContacts, contactPageQuery, acceptContacts, selectRecipient, clearSelection, updateComposition, previewTicket, acceptPreview, compositionValid, canConfirmBroadcast, prepareCampaign, retryCampaign, rejectCampaign, parseCampaign, mergeCampaign, acceptCampaign, updateAudience, parseRecipientPage } from "../public/broadcast-model.js";
import "../public/session-clock.js";

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
test("inactive access blocks the entire explicit confirmation", () => {
  const state = selected(); const input = preview(state); input.recipients[0].eligible = false; input.recipients[0].reason = "access_inactive"; input.eligibleCount = 1;
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


test("large audiences are explicit and capability absence retains the compatible manual path", () => {
  const legacy = connected(); assert.equal(updateAudience(legacy, { mode: "all" }), false); assert.equal(legacy.audienceMode, "selected");
  const state = createBroadcastState(); acceptBroadcastSession(state, clearBroadcast(state, { visible: true }), admin({ largeAudiencesEnabled: true }), now);
  assert.equal(state.audienceMode, "selected"); assert.equal(updateAudience(state, { mode: "all" }), true);
  updateComposition(state, { title: "Large synthetic audience", body: "Synthetic body" });
  const ticket = previewTicket(state), sample = Array.from({ length: 50 }, (_, index) => ({ conversationId: id(index + 1), client: { id: id(index + 5000), pseudonym: `Client ${index + 1}` }, eligible: true, reason: null, repeatMedia: false }));
  assert.equal(acceptPreview(state, ticket, { recipients: sample, totalCount: 2500, eligibleCount: 2499, excludedCount: 1, repeatCount: 0, previewToken: "v1.opaque.signature" }), true);
  assert.equal(canConfirmBroadcast(state, now), false); state.acknowledged = true;
  const payload = prepareCampaign(state, id(50000), now); assert.deepEqual(payload.audience, { mode: "all" }); assert.equal(Object.hasOwn(payload, "conversationIds"), false);
  assert.equal(state.pending.expectedCount, 2499); assert.ok(Object.isFrozen(payload.audience)); assert.equal(updateAudience(state, { mode: "selected" }), false);
  rejectCampaign(state, broadcastTicket(state)); assert.strictEqual(retryCampaign(state), payload);
  const accepted = acceptCampaign(state, broadcastTicket(state), { duplicate: true, campaign: { ...campaign({ ...payload, conversationIds: Array(2499) }), formatVersion: 2, audienceMode: "all" } });
  assert.equal(accepted.counts.total, 2499); assert.equal(state.audienceMode, "selected");
});

test("2500 manual recipients cross contact pages without a cardinality100 business ceiling", () => {
  const state = createBroadcastState(); acceptBroadcastSession(state, clearBroadcast(state, { visible: true }), admin({ largeAudiencesEnabled: true }), now);
  for (let start = 1; start <= 2500; start += 50) {
    acceptContacts(state, page(Array.from({ length: 50 }, (_, index) => contact(start + index))), { replace: true });
    for (let value = start; value < start + 50; value += 1) assert.equal(selectRecipient(state, id(value), true), true);
    assert.equal(state.contacts.size, 50);
  }
  updateComposition(state, { title: "Manual synthetic audience", body: "Hello" });
  const ticket = previewTicket(state), recipients = ticket.ids.slice(0, 50).map((conversationId) => ({ conversationId, client: { id: id(9000), pseudonym: "Synthetic" }, eligible: true, reason: null, repeatMedia: false }));
  acceptPreview(state, ticket, { recipients, totalCount: 2500, eligibleCount: 2500, excludedCount: 0, repeatCount: 0, previewToken: "v1.opaque.signature" }); state.acknowledged = true;
  const payload = prepareCampaign(state, id(50000), now); assert.equal(payload.audience.conversationIds.length, 2500); assert.ok(Object.isFrozen(payload.audience.conversationIds));
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length < 1048576);
});

test("scope changes invalidate an earlier proof even after restoring the same scope, and capability changes purge it", () => {
  const state = createBroadcastState(); acceptBroadcastSession(state, clearBroadcast(state, { visible: true }), admin({ largeAudiencesEnabled: true }), now);
  updateAudience(state, { mode: "all" }); const ticket = previewTicket(state);
  updateAudience(state, { mode: "filtered", filters: { q: " e\u0301 ", tagId: null, groupId: null, access: "active", unread: false, reminder: "all" } });
  assert.equal(state.audienceFilters.q, "é"); updateAudience(state, { mode: "all" });
  assert.equal(acceptPreview(state, ticket, {}), false);
  updateComposition(state, { title: "Private draft", body: "Private body" });
  assert.equal(acceptBroadcastSession(state, broadcastTicket(state), admin(), now), false); assert.equal(state.draft.body, ""); assert.equal(state.session, null);
});

test("large previews reject inconsistent counters, oversized samples and malformed opaque proofs", () => {
  const state = createBroadcastState(); acceptBroadcastSession(state, clearBroadcast(state, { visible: true }), admin({ largeAudiencesEnabled: true }), now); updateAudience(state, { mode: "all" });
  const input = { recipients: [{ conversationId: id(1), client: { id: id(2), pseudonym: "Synthetic" }, eligible: true, reason: null, repeatMedia: false }], totalCount: 1, eligibleCount: 1, excludedCount: 0, repeatCount: 0, previewToken: "v1.opaque.signature" };
  for (const change of [{ excludedCount: 1 }, { eligibleCount: 2 }, { repeatCount: 2 }, { previewToken: "" }, { previewToken: "x".repeat(4097) }, { recipients: [] }, { totalCount: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => acceptPreview(state, previewTicket(state), { ...input, ...change }), /invalid_preview/);
  }
});

test("recipient pages strip private fields and enforce bounded owned monotone cursors without equating page size and total", () => {
  const campaignId = id(9000), row = (value) => ({ conversationId: id(value), client: { id: id(value + 100), pseudonym: "Synthetic", email: "private@example.invalid" }, state: "pending", reason: null, messageId: null, deliveredAt: null, proof: "private" });
  const page = { campaignId, recipients: Array.from({ length: 50 }, (_, index) => row(index + 1)), hasMore: true, nextCursor: id(50) };
  const parsed = parseRecipientPage(page, { campaignId }); assert.equal(parsed.recipients.length, 50); assert.equal(JSON.stringify(parsed).includes("private"), false);
  for (const change of [{ campaignId: id(9001) }, { nextCursor: id(49) }, { recipients: [row(2), row(1)] }, { recipients: Array.from({ length: 51 }, (_, index) => row(index + 1)) }, { recipients: [{ ...row(1), state: "failed" }], nextCursor: id(1) }]) assert.throws(() => parseRecipientPage({ ...page, ...change }, { campaignId }), /invalid_recipient_page/);
});

test("redaction can shrink a frozen audience at the same timestamp but later stale reads can never enlarge it", () => {
  const previous = parseCampaign(campaign({ clientCampaignId: id(99), title: "Synthetic", body: "Hello", mediaId: null, allowRepeatMedia: false, conversationIds: [id(1), id(2), id(3)] }, { status: "running", counts: { total: 3, pending: 1, sending: 0, delivered: 2, skipped: 0, cancelled: 0, failed: 0 } }));
  const reduced = parseCampaign({ ...previous, counts: { ...previous.counts, total: 2, delivered: 1 } });
  assert.strictEqual(mergeCampaign(previous, reduced), reduced);
  assert.strictEqual(mergeCampaign(reduced, { ...previous, updatedAt: previous.updatedAt + 1000 }), reduced);
  assert.strictEqual(mergeCampaign(reduced, { ...reduced, updatedAt: reduced.updatedAt + 1000, counts: { ...reduced.counts, delivered: 0, pending: 2 } }), reduced);
  assert.throws(() => parseCampaign({ ...reduced, status: "completed" }), /invalid_campaign/);
});
