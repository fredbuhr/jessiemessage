import test from "node:test";
import assert from "node:assert/strict";
import { createCrmState, emptyFilters, canonicalVersion, contactName, setFilters, contactQuery, applyContactPage, updateContact, selectProfile, currentProfile, detailTicket, currentDetail, invalidateDetail, receiveProfile, changeDraft, saveBody, discardDraft, labelsOfKind, reminderTimestamp, localDateTime, clearCrmState } from "../public/crm-model.js";

const id = (value) => value.toString(16).padStart(32, "0");
const contact = (value, extra = {}) => ({ id: id(value), peerName: `Client ${value}`, unreadCount: 1, crm: { nickname: "", labels: [], reminderAt: null, version: "0" }, access: { state: "active", expiresAt: null }, ...extra });
const profile = (value, version = "1", extra = {}) => ({ conversationId: id(value), client: { id: id(value + 100), pseudonym: `Client ${value}`, email: `client${value}@example.test`, status: "active" }, access: { state: "active", expiresAt: null }, nickname: "", notes: "Notes enregistrées", reminderAt: null, labels: [], version, updatedAt: 1, ...extra });

test("CRM optimistic versions retain canonical unsigned 32-bit strings", () => {
  assert.equal(canonicalVersion("0"), "0"); assert.equal(canonicalVersion("4294967295"), "4294967295");
  for (const value of [0, "01", "-1", "1e2", "4294967296", "1\n", "1\r\n", "", " 1"]) assert.throws(() => canonicalVersion(value));
});
test("private aliases affect administrator contact naming without changing the shared pseudonym", () => {
  const item = contact(1, { crm: { nickname: "Mon client régulier" } });
  assert.equal(contactName(item), "Mon client régulier"); assert.equal(item.peerName, "Client 1");
  assert.equal(contactName(contact(2)), "Client 2"); assert.equal(contactName({ peerName: "Jessie" }), "Jessie");
});
test("search and filters encode percent and underscore literally and compose tag plus group", () => {
  const filters = { ...emptyFilters(), q: "a%_@example.test", tagId: id(1), groupId: id(2), access: "expired", unread: true, reminder: "due" };
  const query = new URLSearchParams(contactQuery(filters, id(5)));
  assert.equal(query.get("q"), "a%_@example.test"); assert.equal(query.get("tagId"), id(1)); assert.equal(query.get("groupId"), id(2));
  assert.equal(query.get("unread"), "1"); assert.equal(query.get("access"), "expired"); assert.equal(query.get("reminder"), "due"); assert.equal(query.get("afterId"), id(5));
  assert.equal(query.has("notes"), false);
});
test("filter changes invalidate late pages while preserving the selected conversation and its draft", () => {
  const state = createCrmState(); const ticket = selectProfile(state, id(1)); const draft = receiveProfile(state, profile(1), ticket); changeDraft(draft, { notes: "Brouillon privé" });
  applyContactPage(state, { contacts: [contact(1)], nextCursor: null, hasMore: false }, { epoch: 0 });
  assert.equal(setFilters(state, { q: "un autre client" }), true);
  assert.equal(applyContactPage(state, { contacts: [contact(2)], nextCursor: null, hasMore: false }, { epoch: 0 }), false);
  assert.equal(state.contacts.size, 0); assert.equal(state.selected, id(1)); assert.equal(state.drafts.get(id(1)).notes, "Brouillon privé");
  assert.equal(setFilters(state, { q: "un autre client" }), false);
});
test("an authoritative filtered page replaces rows instead of retaining earlier intervals", () => {
  const state = createCrmState(); for (let value = 1; value <= 8; value += 1) state.contacts.set(id(value), contact(value));
  applyContactPage(state, { contacts: [contact(2), contact(4)], nextCursor: id(4), hasMore: true }, { epoch: 0 });
  assert.deepEqual([...state.contacts.keys()], [id(2), id(4)]);
  applyContactPage(state, { contacts: [contact(6)], nextCursor: null, hasMore: false }, { epoch: 0, afterId: id(4) });
  assert.deepEqual([...state.contacts.keys()], [id(6)]);
});
test("an empty final page clears stale rows from the displayed contact page", () => {
  const state = createCrmState(); state.contacts.set(id(2), contact(2)); state.contacts.set(id(8), contact(8));
  applyContactPage(state, { contacts: [], hasMore: false, nextCursor: null }, { epoch: 0, afterId: id(2) });
  assert.deepEqual([...state.contacts.keys()], []);
});
test("chat polling updates matching rows without reinserting a selected filtered-out client or losing CRM metadata", () => {
  const state = createCrmState(); const stored = contact(1, { crm: { nickname: "Alias privé", labels: [{ id: id(30), name: "Régulier" }] } }); state.contacts.set(stored.id, stored); selectProfile(state, id(2));
  assert.equal(updateContact(state, { id: id(2), peerName: "Ne correspond plus", unreadCount: 0 }), false);
  assert.equal(updateContact(state, { id: id(1), peerName: "Pseudo changé", unreadCount: 5 }), true);
  assert.equal(state.contacts.size, 1); assert.equal(state.contacts.get(id(1)).crm.nickname, "Alias privé"); assert.equal(state.contacts.get(id(1)).unreadCount, 5);
});
test("a fiche response from a previous selection cannot place private notes in another client", () => {
  const state = createCrmState(); const first = selectProfile(state, id(1)); const second = selectProfile(state, id(2));
  assert.equal(currentProfile(state, first), false); assert.equal(receiveProfile(state, profile(1), first), null);
  const draft = receiveProfile(state, profile(2), second); assert.equal(draft.conversationId, id(2)); assert.equal(state.drafts.has(id(1)), false);
  assert.equal(receiveProfile(state, profile(1), second), null);
});
test("switching away and back creates a new fiche epoch even for the same client ID", () => {
  const state = createCrmState(); const first = selectProfile(state, id(1)); selectProfile(state, id(2)); const reopened = selectProfile(state, id(1));
  assert.equal(currentProfile(state, first), false); assert.equal(currentProfile(state, reopened), true);
});
test("closing and reopening the same fiche invalidates an in-flight save acknowledgment", () => {
  const state = createCrmState(); const selection = selectProfile(state, id(1)); invalidateDetail(state);
  const savingTicket = detailTicket(state); const draft = receiveProfile(state, profile(1), selection); changeDraft(draft, { notes: "Premier brouillon" });
  invalidateDetail(state); invalidateDetail(state); const reopened = detailTicket(state); changeDraft(draft, { notes: "Nouveau brouillon après réouverture" });
  assert.equal(currentDetail(state, savingTicket), false); assert.equal(currentDetail(state, reopened), true);
  if (currentDetail(state, savingTicket)) discardDraft(state, id(1), profile(1, "2", { notes: "Premier brouillon" }));
  assert.equal(state.drafts.get(id(1)).notes, "Nouveau brouillon après réouverture");
});
test("a concurrent fiche update preserves exact draft notes and requires an explicit overwrite decision", () => {
  const state = createCrmState(); const ticket = selectProfile(state, id(1)); const draft = receiveProfile(state, profile(1), ticket);
  changeDraft(draft, { notes: "  Mes notes\n<script>texte</script>  ", nickname: "Alias", labelIds: [id(40)] });
  receiveProfile(state, profile(1, "2", { notes: "Notes de l’autre onglet" }), ticket);
  assert.equal(draft.notes, "  Mes notes\n<script>texte</script>  "); assert.equal(draft.baseVersion, "1"); assert.equal(draft.conflict.version, "2");
  assert.throws(() => saveBody(draft), /review_required/);
  assert.deepEqual(saveBody(draft, { overwrite: true }), { expectedVersion: "2", nickname: "Alias", notes: draft.notes, reminderAt: null, labelIds: [id(40)] });
  assert.equal(draft.baseVersion, "1", "building an explicit resave never silently changes the original version");
});
test("an unchanged remote version never replaces a dirty draft on reopening a fiche", () => {
  const state = createCrmState(); const ticket = selectProfile(state, id(1)); const draft = receiveProfile(state, profile(1), ticket);
  changeDraft(draft, { notes: "Brouillon" }); const same = receiveProfile(state, profile(1), ticket);
  assert.strictEqual(same, draft); assert.equal(same.notes, "Brouillon"); assert.equal(same.conflict, null);
});
test("explicit reload discards only the intended client draft and uses latest label membership", () => {
  const state = createCrmState(); let ticket = selectProfile(state, id(1)); const first = receiveProfile(state, profile(1), ticket); changeDraft(first, { notes: "Brouillon 1" });
  ticket = selectProfile(state, id(2)); const other = receiveProfile(state, profile(2), ticket); changeDraft(other, { notes: "Brouillon 2" });
  const latest = profile(1, "3", { notes: "Nouvelle version", labels: [] }); const reloaded = discardDraft(state, id(1), latest);
  assert.equal(reloaded.notes, "Nouvelle version"); assert.equal(reloaded.baseVersion, "3"); assert.equal(reloaded.dirty, false); assert.equal(other.notes, "Brouillon 2");
  assert.throws(() => discardDraft(state, id(2), latest), /wrong_profile/);
});
test("tags and groups keep separate choices even when display names coincide", () => {
  const labels = [{ id: id(2), kind: "group", name: "Réguliers", version: "1" }, { id: id(1), kind: "tag", name: "Réguliers", version: "1" }];
  assert.deepEqual(labelsOfKind(labels, "tag").map((label) => label.id), [id(1)]); assert.deepEqual(labelsOfKind(labels, "group").map((label) => label.id), [id(2)]);
});
test("reminder controls round-trip local minute precision and permit removing the date", () => {
  const timestamp = new Date(2026, 9, 15, 11, 40).getTime(); assert.equal(reminderTimestamp(localDateTime(timestamp)), timestamp);
  assert.equal(localDateTime(null), ""); assert.equal(reminderTimestamp(""), null);
  for (const value of ["invalid", "1969-12-01T10:00"]) assert.throws(() => reminderTimestamp(value));
});
test("logout clears notes, aliases, labels, filters and invalidates all queued results", () => {
  const state = createCrmState(); const ticket = selectProfile(state, id(1)); changeDraft(receiveProfile(state, profile(1), ticket), { notes: "Privé" });
  state.labels.set(id(5), { id: id(5), kind: "tag", name: "Privé" }); state.contacts.set(id(1), contact(1)); setFilters(state, { q: "contact@example.test" });
  clearCrmState(state); assert.equal(state.drafts.size, 0); assert.equal(state.contacts.size, 0); assert.equal(state.labels.size, 0); assert.equal(state.selected, null); assert.deepEqual(state.filters, emptyFilters());
  assert.equal(currentProfile(state, ticket), false); assert.equal(receiveProfile(state, profile(1), ticket), null);
});


test("replaceable CRM pages stay bounded while a selected client's unsaved profile remains pinned", () => {
  const state = createCrmState(), ticket = selectProfile(state, id(1));
  const draft = receiveProfile(state, profile(1), ticket); changeDraft(draft, { notes: "Keep these exact notes" });
  for (let pageIndex = 0; pageIndex < 60; pageIndex++) {
    const contacts = Array.from({ length: 50 }, (_, index) => contact(pageIndex * 50 + index + 1));
    applyContactPage(state, { contacts, hasMore: true, nextCursor: contacts.at(-1).id }, { epoch: state.filterEpoch });
    assert.equal(state.contacts.size, 50); assert.equal(state.contacts.has(id(pageIndex * 50 + 1)), true);
  }
  assert.equal(state.contacts.has(id(1)), false); assert.equal(state.selected, id(1));
  assert.equal(state.drafts.get(id(1)).notes, "Keep these exact notes");
});


test("CRM page validation rejects oversized, duplicate and reversed output without replacing the current rows", () => {
  const state = createCrmState(); state.contacts.set(id(100), contact(100));
  for (const contacts of [Array.from({ length: 51 }, (_, index) => contact(index + 1)), [contact(1), contact(1)], [contact(2), contact(1)]]) {
    assert.throws(() => applyContactPage(state, { contacts, nextCursor: null, hasMore: false }, { epoch: 0 }), /invalid_contact_page/);
    assert.equal(state.contacts.get(id(100)).peerName, "Client 100");
  }
});
