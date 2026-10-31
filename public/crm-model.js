const ID = /^[0-9a-f]{32}$/;
const accessStates = new Set(["all", "active", "pending", "expired", "revoked", "suspended", "deleted"]);
export const emptyFilters = () => ({ q: "", tagId: "", groupId: "", access: "all", unread: false, reply: false, reminder: "all" });
export function canonicalVersion(value) {
  if (typeof value !== "string" || value.length > 10 || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 4294967295n || BigInt(value).toString() !== value) throw new TypeError("invalid_version");
  return value;
}
export function contactName(contact) { return contact.crm?.nickname || contact.peerName; }
export function createCrmState() {
  return { filters: emptyFilters(), filterEpoch: 0, contacts: new Map(), cursor: null, hasMore: false,
    labels: new Map(), selected: null, selectionEpoch: 0, detailEpoch: 0, drafts: new Map() };
}
export function setFilters(state, input) {
  const next = { ...emptyFilters(), ...input };
  if (typeof next.q !== "string" || next.q.length > 80 || !accessStates.has(next.access) || typeof next.unread !== "boolean" || typeof next.reply !== "boolean" || !["all", "due", "upcoming", "none"].includes(next.reminder)
    || [next.tagId, next.groupId].some((value) => value !== "" && (typeof value !== "string" || value.length !== 32 || !ID.test(value)))) throw new TypeError("invalid_filters");
  if (JSON.stringify(next) === JSON.stringify(state.filters)) return false;
  state.filters = next; state.filterEpoch += 1; state.contacts.clear(); state.cursor = null; state.hasMore = false; return true;
}
export function contactQuery(filters, afterId = null) {
  const query = new URLSearchParams({ limit: "50" });
  for (const key of ["q", "tagId", "groupId"]) if (filters[key]) query.set(key, filters[key]);
  if (filters.access !== "all") query.set("access", filters.access);
  if (filters.reminder !== "all") query.set("reminder", filters.reminder);
  if (filters.unread) query.set("unread", "1");
  if (filters.reply) query.set("reply", "1");
  if (afterId) query.set("afterId", afterId);
  return query.toString();
}
// Only the current keyset page is retained. Selection and unsaved profile
// drafts are independent from these replaceable contact rows.
export function applyContactPage(state, page, { epoch, afterId = null } = {}) {
  if (epoch !== state.filterEpoch) return false;
  if (!Array.isArray(page?.contacts) || page.contacts.length > 50 || typeof page.hasMore !== "boolean"
    || page.nextCursor !== null && (typeof page.nextCursor !== "string" || !ID.test(page.nextCursor))) throw new TypeError("invalid_contact_page");
  let previous = afterId;
  for (const contact of page.contacts) {
    if (typeof contact?.id !== "string" || !ID.test(contact.id) || previous !== null && contact.id <= previous) throw new TypeError("invalid_contact_page");
    previous = contact.id;
  }
  if (page.hasMore && (!page.contacts.length || page.nextCursor !== previous)) throw new TypeError("invalid_contact_page");
  state.contacts.clear();
  for (const contact of page.contacts) state.contacts.set(contact.id, contact);
  return true;
}
export function updateContact(state, conversation) {
  const previous = state.contacts.get(conversation.id); if (!previous) return false;
  state.contacts.set(conversation.id, { ...previous, ...conversation, crm: previous.crm, access: previous.access }); return true;
}
export function selectProfile(state, conversationId) { state.selected = conversationId; state.selectionEpoch += 1; return profileTicket(state); }
export function profileTicket(state) { return { id: state.selected, epoch: state.selectionEpoch }; }
export function currentProfile(state, ticket) { return ticket.id === state.selected && ticket.epoch === state.selectionEpoch; }
export function detailTicket(state) { return { ...profileTicket(state), detailEpoch: state.detailEpoch }; }
export function currentDetail(state, ticket) { return currentProfile(state, ticket) && ticket.detailEpoch === state.detailEpoch; }
export function invalidateDetail(state) { state.detailEpoch += 1; }
export function draftFrom(profile) {
  canonicalVersion(profile.version);
  return { conversationId: profile.conversationId, baseVersion: profile.version, nickname: profile.nickname, notes: profile.notes,
    reminderAt: profile.reminderAt, labelIds: profile.labels.map((label) => label.id).sort(), dirty: false, conflict: null, profile };
}
export function receiveProfile(state, profile, ticket) {
  if (!currentProfile(state, ticket) || profile.conversationId !== ticket.id) return null;
  const previous = state.drafts.get(ticket.id);
  if (previous?.dirty) {
    previous.profile = profile;
    if (previous.baseVersion !== profile.version) previous.conflict = profile;
    return previous;
  }
  const draft = draftFrom(profile); state.drafts.set(ticket.id, draft); return draft;
}
export function changeDraft(draft, fields) {
  for (const key of ["nickname", "notes", "reminderAt", "labelIds"]) if (Object.hasOwn(fields, key)) draft[key] = key === "labelIds" ? [...fields[key]].sort() : fields[key];
  draft.dirty = true; return draft;
}
export function saveBody(draft, { overwrite = false } = {}) {
  if (draft.conflict && !overwrite) throw new Error("review_required");
  return { expectedVersion: canonicalVersion(overwrite ? draft.conflict?.version ?? draft.baseVersion : draft.baseVersion), nickname: draft.nickname, notes: draft.notes,
    reminderAt: draft.reminderAt, labelIds: [...draft.labelIds] };
}
export function discardDraft(state, conversationId, latest) {
  if (!latest || latest.conversationId !== conversationId) throw new TypeError("wrong_profile");
  const draft = draftFrom(latest); state.drafts.set(conversationId, draft); return draft;
}
export function labelsOfKind(labels, kind) {
  return [...labels].filter((label) => label.kind === kind).sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}
export function localDateTime(timestamp) {
  if (timestamp === null) return "";
  const date = new Date(timestamp); const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function reminderTimestamp(value) {
  if (value === "") return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 253402300799999) throw new TypeError("invalid_reminder");
  return timestamp;
}
export function clearCrmState(state) {
  state.filterEpoch += 1; state.selectionEpoch += 1; state.detailEpoch += 1; state.selected = null; state.contacts.clear(); state.labels.clear(); state.drafts.clear();
  state.filters = emptyFilters(); state.cursor = null; state.hasMore = false;
}
