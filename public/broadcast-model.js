const ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const reasons = new Set([null, "access_inactive", "opted_out", "conversation_unavailable"]);
export const recipientNames = Object.freeze({ pending: "En attente", sending: "En cours", delivered: "Remis", skipped: "Ignoré", cancelled: "Annulé", failed: "Échec" });
export const campaignNames = Object.freeze({ queued: "En attente", running: "En cours", completed: "Terminée", cancelled: "Annulée", paused: "Interrompue" });
export const reasonNames = Object.freeze({ access_inactive: "Accès non actif", opted_out: "Diffusions non acceptées", conversation_unavailable: "Conversation indisponible", media_unavailable: "Photo indisponible", repeat_media: "Photo déjà partagée", expired: "Délai d’envoi dépassé", administrator_invalid: "Autorisation de Jessie à renouveler", processing_failed: "Envoi non abouti", cancelled: "Annulé par Jessie" });
const id = (value) => typeof value === "string" && value.length === 32 && ID.test(value);
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const text = (value, max) => typeof value === "string" && value.length <= max && value.isWellFormed() && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
const label = (value, max = 64) => text(value, max) && value.length > 0 && !/[\r\n\t]/u.test(value);
export function createBroadcastState() {
  return { epoch: 0, visible: false, session: null, contacts: new Map(), selected: new Map(), filterEpoch: 0, previewEpoch: 0,
    preview: null, draft: { title: "", body: "", mediaId: null, allowRepeatMedia: false }, acknowledged: false, pending: null, csrfFailed: false };
}
export function clearBroadcast(state, { visible = false } = {}) {
  state.epoch += 1; state.filterEpoch += 1; state.previewEpoch += 1; state.visible = visible; state.session = null;
  state.contacts.clear(); state.selected.clear(); state.preview = null; state.draft = { title: "", body: "", mediaId: null, allowRepeatMedia: false };
  state.acknowledged = false; state.pending = null; state.csrfFailed = false; return broadcastTicket(state);
}
export function broadcastTicket(state) { return { epoch: state.epoch, adminId: state.session?.id ?? null }; }
export function currentBroadcast(state, ticket) { return state.visible && ticket.epoch === state.epoch && (ticket.adminId === null || ticket.adminId === state.session?.id); }
export function acceptBroadcastSession(state, ticket, input, now = Date.now()) {
  if (!currentBroadcast(state, ticket)) return false;
  const user = input?.user;
  if (!id(user?.id) || user.role !== "admin" || !label(user.pseudonym) || typeof input.csrf !== "string" || input.csrf.length !== 43 || !TOKEN.test(input.csrf)
    || !date(input.expiresAt) || input.expiresAt <= now || typeof input.mediaEnabled !== "boolean") { clearBroadcast(state); return false; }
  if (state.session && (state.session.id !== user.id || state.session.csrf !== input.csrf)) { clearBroadcast(state, { visible: true }); return false; }
  state.session = { id: user.id, csrf: input.csrf, expiresAt: input.expiresAt, mediaEnabled: input.mediaEnabled }; return true;
}
export function resetContacts(state) { state.filterEpoch += 1; state.contacts.clear(); return state.filterEpoch; }
export function acceptContacts(state, input, { epoch = state.filterEpoch } = {}) {
  if (!state.visible || epoch !== state.filterEpoch) return false;
  if (!Array.isArray(input.contacts) || input.contacts.length > 100 || typeof input.hasMore !== "boolean" || input.nextCursor !== null && !id(input.nextCursor)) throw new TypeError("invalid_contacts");
  const contacts = input.contacts.map((value) => {
    if (!id(value?.id) || !id(value.client?.id) || !label(value.client.pseudonym) || !text(value.crm?.nickname, 64) || typeof value.canSend !== "boolean") throw new TypeError("invalid_contacts");
    return { id: value.id, client: { id: value.client.id, pseudonym: value.client.pseudonym }, nickname: value.crm.nickname, canSend: value.canSend };
  });
  if (new Set(contacts.map((value) => value.id)).size !== contacts.length || input.hasMore && (!contacts.length || input.nextCursor !== contacts.at(-1).id)) throw new TypeError("invalid_contacts");
  for (const contact of contacts) state.contacts.set(contact.id, contact); return true;
}
function invalidatePreview(state) { state.previewEpoch += 1; state.preview = null; state.acknowledged = false; state.draft.allowRepeatMedia = false; }
export function selectRecipient(state, conversationId, checked) {
  if (state.pending || !id(conversationId) || typeof checked !== "boolean") return false;
  if (!checked) { if (!state.selected.delete(conversationId)) return false; invalidatePreview(state); return true; }
  if (state.selected.has(conversationId)) return true;
  const contact = state.contacts.get(conversationId); if (!contact || state.selected.size >= 100) return false;
  state.selected.set(conversationId, { id: contact.id, pseudonym: contact.client.pseudonym }); invalidatePreview(state); return true;
}
export function clearSelection(state) { if (state.pending) return false; state.selected.clear(); invalidatePreview(state); return true; }
export function updateComposition(state, input) {
  if (state.pending) return false;
  const previousMedia = state.draft.mediaId;
  for (const key of ["title", "body", "mediaId", "allowRepeatMedia"]) if (Object.hasOwn(input, key)) state.draft[key] = input[key];
  if (state.draft.mediaId !== previousMedia) invalidatePreview(state); else state.acknowledged = false;
  return true;
}
export function previewTicket(state) { return { ...broadcastTicket(state), previewEpoch: state.previewEpoch, ids: [...state.selected.keys()].sort(), mediaId: state.draft.mediaId }; }
export function acceptPreview(state, ticket, input) {
  if (!currentBroadcast(state, ticket) || state.pending || ticket.previewEpoch !== state.previewEpoch || ticket.mediaId !== state.draft.mediaId
    || JSON.stringify(ticket.ids) !== JSON.stringify([...state.selected.keys()].sort())) return false;
  if (!Array.isArray(input?.recipients) || input.recipients.length !== ticket.ids.length || !Number.isInteger(input.eligibleCount) || !Number.isInteger(input.repeatCount)) throw new TypeError("invalid_preview");
  const recipients = input.recipients.map((value) => {
    if (!id(value?.conversationId) || !ticket.ids.includes(value.conversationId) || !id(value.client?.id) || !label(value.client.pseudonym)
      || typeof value.eligible !== "boolean" || !reasons.has(value.reason) || value.eligible !== (value.reason === null) || typeof value.repeatMedia !== "boolean") throw new TypeError("invalid_preview");
    return { conversationId: value.conversationId, client: { id: value.client.id, pseudonym: value.client.pseudonym }, eligible: value.eligible, reason: value.reason, repeatMedia: value.repeatMedia };
  });
  if (new Set(recipients.map((value) => value.conversationId)).size !== ticket.ids.length || input.eligibleCount !== recipients.filter((value) => value.eligible).length
    || input.repeatCount !== recipients.filter((value) => value.repeatMedia).length || ticket.mediaId === null && input.repeatCount !== 0) throw new TypeError("invalid_preview");
  state.preview = { recipients, eligibleCount: input.eligibleCount, repeatCount: input.repeatCount }; state.acknowledged = false; return true;
}
export function compositionValid(state) {
  const draft = state.draft;
  if (!label(draft.title, 80) || !draft.title.trim() || !text(draft.body, draft.mediaId === null ? 4096 : 1000)
    || draft.mediaId !== null && (!id(draft.mediaId) || !state.session?.mediaEnabled) || typeof draft.allowRepeatMedia !== "boolean") return false;
  if (draft.mediaId === null && (!draft.body.trim() || !/[^\s\p{Cf}\p{Cc}]/u.test(draft.body))) return false;
  return new TextEncoder().encode(draft.body).length <= (draft.mediaId === null ? 16384 : 4096);
}
export function canConfirmBroadcast(state, now = Date.now()) {
  return state.visible && !!state.session && state.session.expiresAt > now && !state.pending && !state.csrfFailed && state.selected.size > 0 && state.selected.size <= 100
    && compositionValid(state) && !!state.preview && state.preview.eligibleCount === state.selected.size && (state.preview.repeatCount === 0 || state.draft.allowRepeatMedia) && state.acknowledged;
}
export function prepareCampaign(state, clientCampaignId, now = Date.now()) {
  if (!id(clientCampaignId) || !canConfirmBroadcast(state, now)) return null;
  const payload = Object.freeze({ clientCampaignId, title: state.draft.title, body: state.draft.body, mediaId: state.draft.mediaId,
    allowRepeatMedia: state.draft.allowRepeatMedia, conversationIds: Object.freeze([...state.selected.keys()].sort()) });
  state.pending = { payload, status: "sending" }; return payload;
}
export function retryCampaign(state) {
  if (!state.visible || !state.session || state.csrfFailed || state.pending?.status !== "uncertain") return null;
  state.pending.status = "sending"; return state.pending.payload;
}
export function rejectCampaign(state, ticket, { csrfFailed = false } = {}) {
  if (!currentBroadcast(state, ticket) || !state.pending) return false;
  state.pending.status = "uncertain"; state.csrfFailed = csrfFailed; return true;
}
export function parseCampaign(input, { detail = false } = {}) {
  if (!id(input?.id) || !id(input.clientCampaignId) || !label(input.title, 80) || !text(input.body, input.mediaId === null ? 4096 : 1000)
    || input.mediaId !== null && !id(input.mediaId) || typeof input.allowRepeatMedia !== "boolean" || !Object.hasOwn(campaignNames, input.status)
    || !date(input.createdAt) || !date(input.updatedAt) || !date(input.expiresAt) || input.updatedAt < input.createdAt || input.expiresAt < input.createdAt) throw new TypeError("invalid_campaign");
  const counts = {};
  for (const key of ["total", ...Object.keys(recipientNames)]) { const value = input.counts?.[key]; if (!Number.isInteger(value) || value < 0 || value > 100) throw new TypeError("invalid_campaign"); counts[key] = value; }
  if (!counts.total || Object.keys(recipientNames).reduce((sum, key) => sum + counts[key], 0) !== counts.total) throw new TypeError("invalid_campaign");
  const result = { id: input.id, clientCampaignId: input.clientCampaignId, title: input.title, body: input.body, mediaId: input.mediaId, allowRepeatMedia: input.allowRepeatMedia,
    status: input.status, createdAt: input.createdAt, updatedAt: input.updatedAt, expiresAt: input.expiresAt, counts };
  if (detail) {
    if (!Array.isArray(input.recipients) || input.recipients.length !== counts.total) throw new TypeError("invalid_campaign");
    result.recipients = input.recipients.map((row) => {
      if (!id(row?.conversationId) || !id(row.client?.id) || !label(row.client.pseudonym) || !Object.hasOwn(recipientNames, row.state)
        || row.reason !== null && !Object.hasOwn(reasonNames, row.reason) || row.messageId !== null && !id(row.messageId) || row.deliveredAt !== null && !date(row.deliveredAt)
        || (row.state === "delivered") !== (row.messageId !== null && row.deliveredAt !== null)) throw new TypeError("invalid_campaign");
      return { conversationId: row.conversationId, client: { id: row.client.id, pseudonym: row.client.pseudonym }, state: row.state, reason: row.reason, messageId: row.messageId, deliveredAt: row.deliveredAt };
    });
    if (new Set(result.recipients.map((row) => row.conversationId)).size !== counts.total) throw new TypeError("invalid_campaign");
  }
  return result;
}
export function acceptCampaign(state, ticket, input) {
  if (!currentBroadcast(state, ticket) || !state.pending) return null;
  const campaign = parseCampaign(input.campaign); const expected = state.pending.payload;
  if (typeof input.duplicate !== "boolean" || campaign.clientCampaignId !== expected.clientCampaignId || campaign.title !== expected.title || campaign.body !== expected.body
    || campaign.mediaId !== expected.mediaId || campaign.allowRepeatMedia !== expected.allowRepeatMedia || campaign.counts.total !== expected.conversationIds.length) throw new TypeError("invalid_campaign_acknowledgement");
  state.pending = null; state.selected.clear(); state.draft = { title: "", body: "", mediaId: null, allowRepeatMedia: false }; invalidatePreview(state); return campaign;
}
