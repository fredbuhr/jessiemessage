const ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const reasons = new Set([null, "access_inactive", "conversation_unavailable"]);
export const recipientNames = Object.freeze({ pending: "En attente", sending: "En cours", delivered: "Remis", skipped: "Ignoré", cancelled: "Annulé", failed: "Échec" });
export const campaignNames = Object.freeze({ queued: "En attente", running: "En cours", completed: "Terminée", cancelled: "Annulée", paused: "Interrompue" });
export const reasonNames = Object.freeze({ access_inactive: "Accès non actif", opted_out: "Diffusions non acceptées", conversation_unavailable: "Conversation indisponible", media_unavailable: "Pièce jointe indisponible", repeat_media: "Pièce jointe déjà partagée", expired: "Délai d’envoi dépassé", administrator_invalid: "Autorisation de Jessie à renouveler", processing_failed: "Envoi non abouti", cancelled: "Annulé par Jessie" });
const id = (value) => typeof value === "string" && value.length === 32 && ID.test(value);
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const text = (value, max) => typeof value === "string" && value.length <= max && value.isWellFormed() && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
const label = (value, max = 64) => text(value, max) && value.length > 0 && !/[\r\n\t]/u.test(value);
const title = (value) => label(value, 80) && value.trim().length > 0 && !/^[\p{C}\p{Z}]*$/u.test(value) && !/[\u202A-\u202E\u2066-\u2069]/u.test(value);
const body = (value, mediaId) => text(value, mediaId === null ? 4096 : 1000) && (mediaId !== null && value === "" || value.trim().length > 0 && !/^[\p{C}\p{Z}]*$/u.test(value));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const defaultFilters = () => ({ q: "", tagId: null, groupId: null, access: "active", unread: false, reminder: "all" });
export function createBroadcastState() {
  return { epoch: 0, visible: false, session: null, contacts: new Map(), selected: new Map(), filterEpoch: 0, contactQuery: "limit=50", previewEpoch: 0,
    audienceMode: "selected", audienceFilters: defaultFilters(), preview: null, draft: { title: "", body: "", mediaId: null, allowRepeatMedia: false }, acknowledged: false, pending: null, csrfFailed: false };
}
export function clearBroadcast(state, { visible = false } = {}) {
  state.epoch += 1; state.filterEpoch += 1; state.previewEpoch += 1; state.visible = visible; state.session = null;
  state.contacts.clear(); state.selected.clear(); state.preview = null; state.draft = { title: "", body: "", mediaId: null, allowRepeatMedia: false };
  state.contactQuery = "limit=50";
  state.audienceMode = "selected"; state.audienceFilters = defaultFilters();
  state.acknowledged = false; state.pending = null; state.csrfFailed = false; return broadcastTicket(state);
}
export function suspendBroadcast(state) {
  if (!state.visible) return broadcastTicket(state);
  state.epoch += 1; state.filterEpoch += 1; state.previewEpoch += 1; state.visible = false; state.acknowledged = false;
  // An aborted confirmation may already have committed. Keep its exact key and
  // immutable payload for an explicit retry after the owner is verified again.
  if (state.pending) state.pending.status = "uncertain";
  else { state.preview = null; state.draft.allowRepeatMedia = false; }
  return broadcastTicket(state);
}
export function broadcastTicket(state) { return { epoch: state.epoch, adminId: state.session?.id ?? null }; }
export function currentBroadcast(state, ticket) { return state.visible && ticket.epoch === state.epoch && (ticket.adminId === null || ticket.adminId === state.session?.id); }
export function acceptBroadcastSession(state, ticket, input, now = Date.now()) {
  if (!currentBroadcast(state, ticket)) return false;
  const user = input?.user;
  if (!id(user?.id) || user.role !== "admin" || !label(user.pseudonym) || typeof input.csrf !== "string" || input.csrf.length !== 43 || !TOKEN.test(input.csrf)
    || !date(input.expiresAt) || input.expiresAt <= now || typeof input.mediaEnabled !== "boolean"
    || input.videoEnabled !== undefined && typeof input.videoEnabled !== "boolean"
    || input.videoCreationEnabled !== undefined && typeof input.videoCreationEnabled !== "boolean"
    || input.videoEnabled === true && input.largeAudiencesEnabled !== true
    || input.largeAudiencesEnabled !== undefined && typeof input.largeAudiencesEnabled !== "boolean") { clearBroadcast(state); return false; }
  const largeAudiencesEnabled = input.largeAudiencesEnabled === true;
  if (state.session && (state.session.id !== user.id || state.session.csrf !== input.csrf || state.session.mediaEnabled !== input.mediaEnabled || state.session.largeAudiencesEnabled !== largeAudiencesEnabled || (state.session.videoEnabled === true) !== (input.videoEnabled === true) || (state.session.videoCreationEnabled !== false) !== (input.videoCreationEnabled !== false))) { clearBroadcast(state, { visible: true }); return false; }
  state.session = { id: user.id, csrf: input.csrf, expiresAt: input.expiresAt, mediaEnabled: input.mediaEnabled, largeAudiencesEnabled, ...(input.videoEnabled === true ? { videoEnabled: true, ...(input.videoCreationEnabled === false ? { videoCreationEnabled: false } : {}) } : {}) }; return true;
}
export function resetContacts(state, query = "limit=50") { state.filterEpoch += 1; state.contactQuery = query; state.contacts.clear(); return state.filterEpoch; }
export function contactPageQuery(state, afterId = null) {
  if (afterId !== null && !id(afterId)) throw new TypeError("invalid_contact_cursor");
  const query = new URLSearchParams(state.contactQuery); query.delete("afterId"); if (afterId) query.set("afterId", afterId); return query.toString();
}
export function acceptContacts(state, input, { epoch = state.filterEpoch, replace = false } = {}) {
  if (!state.visible || epoch !== state.filterEpoch) return false;
  if (!Array.isArray(input.contacts) || input.contacts.length > 100 || typeof input.hasMore !== "boolean" || input.nextCursor !== null && !id(input.nextCursor)) throw new TypeError("invalid_contacts");
  const contacts = input.contacts.map((value) => {
    if (!id(value?.id) || !id(value.client?.id) || !label(value.client.pseudonym) || !text(value.crm?.nickname, 64) || typeof value.canSend !== "boolean") throw new TypeError("invalid_contacts");
    return { id: value.id, client: { id: value.client.id, pseudonym: value.client.pseudonym }, nickname: value.crm.nickname, canSend: value.canSend };
  });
  if (new Set(contacts.map((value) => value.id)).size !== contacts.length || input.hasMore && (!contacts.length || input.nextCursor !== contacts.at(-1).id)) throw new TypeError("invalid_contacts");
  if (replace) state.contacts.clear();
  for (const contact of contacts) state.contacts.set(contact.id, contact); return true;
}
function invalidatePreview(state) { state.previewEpoch += 1; state.preview = null; state.acknowledged = false; state.draft.allowRepeatMedia = false; }
export function selectRecipient(state, conversationId, checked) {
  if (state.pending || !id(conversationId) || typeof checked !== "boolean") return false;
  if (!checked) { if (!state.selected.delete(conversationId)) return false; invalidatePreview(state); return true; }
  if (state.selected.has(conversationId)) return true;
  const contact = state.contacts.get(conversationId); if (!contact || !state.session?.largeAudiencesEnabled && state.selected.size >= 100) return false;
  state.selected.set(conversationId, { id: contact.id, pseudonym: contact.client.pseudonym }); invalidatePreview(state); return true;
}
export function clearSelection(state) { if (state.pending) return false; state.selected.clear(); invalidatePreview(state); return true; }
export function updateComposition(state, input) {
  if (state.pending) return false;
  const previousMedia = state.draft.mediaId, previousVideo = state.draft.videoId ?? null;
  const contentChanged = ["title", "body"].some(key => Object.hasOwn(input, key) && input[key] !== state.draft[key]);
  if (Object.hasOwn(input, "videoId")) {
    if (!state.session?.videoEnabled || input.videoId !== null && (!id(input.videoId) || state.session.videoCreationEnabled === false)) return false;
    state.draft.videoId = input.videoId; if (input.videoId !== null) state.draft.mediaId = null;
  }
  if (input.mediaId !== undefined && input.mediaId !== null) state.draft.videoId = null;
  for (const key of ["title", "body", "mediaId", "allowRepeatMedia"]) if (Object.hasOwn(input, key)) state.draft[key] = input[key];
  if (contentChanged || state.draft.mediaId !== previousMedia || (state.draft.videoId ?? null) !== previousVideo) invalidatePreview(state); else state.acknowledged = false;
  return true;
}
export function updateAudience(state, { mode = state.audienceMode, filters = state.audienceFilters } = {}) {
  if (state.pending || !["selected", "all", "filtered"].includes(mode) || mode !== "selected" && !state.session?.largeAudiencesEnabled) return false;
  const next = { q: filters.q, tagId: filters.tagId, groupId: filters.groupId, access: filters.access, unread: filters.unread, reminder: filters.reminder };
  if (typeof next.q !== "string" || !next.q.isWellFormed() || !text(next.q, 80) || /[\r\n\t]/u.test(next.q)
    || next.tagId !== null && !id(next.tagId) || next.groupId !== null && !id(next.groupId)
    || !["all", "active", "pending", "expired", "revoked", "suspended", "deleted"].includes(next.access)
    || typeof next.unread !== "boolean" || !["all", "due", "upcoming", "none"].includes(next.reminder)) return false;
  next.q = next.q.normalize("NFC").trim();
  if (new TextEncoder().encode(next.q).length > 320) return false;
  if (state.audienceMode === mode && JSON.stringify(state.audienceFilters) === JSON.stringify(next)) return true;
  state.audienceMode = mode; state.audienceFilters = next; invalidatePreview(state); return true;
}
export function audienceValue(state) {
  if (state.audienceMode === "all") return Object.freeze({ mode: "all" });
  if (state.audienceMode === "filtered") return Object.freeze({ mode: "filtered", filters: Object.freeze({ ...state.audienceFilters }) });
  return Object.freeze({ mode: "selected", conversationIds: Object.freeze([...state.selected.keys()].sort()) });
}
export function confirmationCount(state) { return state.preview?.eligibleCount ?? 0; }
export function previewTicket(state) { return { ...broadcastTicket(state), previewEpoch: state.previewEpoch, ids: [...state.selected.keys()].sort(), mediaId: state.draft.mediaId,
  ...(state.draft.videoId ? { videoId: state.draft.videoId } : {}),
  ...(state.session?.largeAudiencesEnabled ? { audience: audienceValue(state) } : {}) }; }
export function acceptPreview(state, ticket, input) {
  if (!currentBroadcast(state, ticket) || state.pending || ticket.previewEpoch !== state.previewEpoch || ticket.mediaId !== state.draft.mediaId || (ticket.videoId ?? null) !== (state.draft.videoId ?? null)
    || JSON.stringify(ticket.ids) !== JSON.stringify([...state.selected.keys()].sort())) return false;
  const large = !!ticket.audience;
  if (large && JSON.stringify(ticket.audience) !== JSON.stringify(audienceValue(state))) return false;
  if (!Array.isArray(input?.recipients) || !count(input.eligibleCount) || !count(input.repeatCount)) throw new TypeError("invalid_preview");
  if (large) {
    if (!count(input.totalCount) || !count(input.excludedCount) || input.totalCount !== input.eligibleCount + input.excludedCount
      || input.repeatCount > input.eligibleCount || input.recipients.length !== Math.min(input.totalCount, 50)
      || ticket.audience.mode === "selected" && input.totalCount !== ticket.ids.length
      || typeof input.previewToken !== "string" || input.previewToken.length < 1 || input.previewToken.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(input.previewToken)) throw new TypeError("invalid_preview");
  } else if (input.recipients.length !== ticket.ids.length) throw new TypeError("invalid_preview");
  const recipients = input.recipients.map((value) => {
    if (!id(value?.conversationId) || (!large || ticket.audience.mode === "selected") && !ticket.ids.includes(value.conversationId) || !id(value.client?.id) || !label(value.client.pseudonym)
      || typeof value.eligible !== "boolean" || !reasons.has(value.reason) || value.eligible !== (value.reason === null) || typeof value.repeatMedia !== "boolean") throw new TypeError("invalid_preview");
    return { conversationId: value.conversationId, client: { id: value.client.id, pseudonym: value.client.pseudonym }, eligible: value.eligible, reason: value.reason, repeatMedia: value.repeatMedia };
  });
  if (new Set(recipients.map((value) => value.conversationId)).size !== recipients.length || ticket.mediaId === null && !ticket.videoId && input.repeatCount !== 0
    || !large && (input.eligibleCount !== recipients.filter((value) => value.eligible).length || input.repeatCount !== recipients.filter((value) => value.repeatMedia).length)) throw new TypeError("invalid_preview");
  state.preview = { recipients, eligibleCount: input.eligibleCount, repeatCount: input.repeatCount,
    ...(large ? { totalCount: input.totalCount, excludedCount: input.excludedCount, previewToken: input.previewToken, audience: ticket.audience } : {}) }; state.acknowledged = false; return true;
}
export function compositionValid(state) {
  const draft = state.draft;
  if (!title(draft.title) || !body(draft.body, draft.videoId ?? draft.mediaId)
    || draft.mediaId !== null && (!id(draft.mediaId) || !state.session?.mediaEnabled) || draft.videoId != null && (!id(draft.videoId) || !state.session?.videoEnabled || state.session.videoCreationEnabled === false || !state.session?.largeAudiencesEnabled || draft.mediaId !== null)
    || typeof draft.allowRepeatMedia !== "boolean") return false;
  return new TextEncoder().encode(draft.body).length <= (draft.mediaId === null && !draft.videoId ? 16384 : 4096);
}
export function canReviewBroadcast(state, now = Date.now()) {
  return state.visible && !!state.session && state.session.expiresAt > now && !state.pending && !state.csrfFailed
    && (state.session.largeAudiencesEnabled ? state.preview?.eligibleCount > 0 && !!state.preview.previewToken && JSON.stringify(state.preview.audience) === JSON.stringify(audienceValue(state))
      : state.selected.size > 0 && state.selected.size <= 100 && state.preview?.eligibleCount === state.selected.size)
    && compositionValid(state) && !!state.preview && (state.preview.repeatCount === 0 || state.draft.allowRepeatMedia);
}
export function canConfirmBroadcast(state, now = Date.now()) { return canReviewBroadcast(state, now) && state.acknowledged; }
export function prepareCampaign(state, clientCampaignId, now = Date.now()) {
  if (!id(clientCampaignId) || !canConfirmBroadcast(state, now)) return null;
  const payload = Object.freeze({ clientCampaignId, title: state.draft.title, body: state.draft.body, mediaId: state.draft.mediaId,
    ...(state.draft.videoId ? { videoId: state.draft.videoId } : {}), allowRepeatMedia: state.draft.allowRepeatMedia, ...(state.session.largeAudiencesEnabled
      ? { audience: audienceValue(state), previewToken: state.preview.previewToken } : { conversationIds: Object.freeze([...state.selected.keys()].sort()) }) });
  state.pending = { payload, expectedCount: confirmationCount(state), status: "sending" }; return payload;
}
export function retryCampaign(state) {
  if (!state.visible || !state.session || state.csrfFailed || state.pending?.status !== "uncertain") return null;
  state.pending.status = "sending"; return state.pending.payload;
}
export function rejectCampaign(state, ticket, { csrfFailed = false, definitiveRejected = false } = {}) {
  if (!currentBroadcast(state, ticket) || !state.pending) return false;
  if (definitiveRejected && !csrfFailed) { state.pending = null; invalidatePreview(state); return true; }
  state.pending.status = "uncertain"; state.csrfFailed = csrfFailed; return true;
}
export function parseCampaign(input, { detail = false, video = false } = {}) {
  const typedVideo = video && input?.formatVersion === 3;
  if (typedVideo ? !id(input.videoId) || input.mediaId !== null : input?.videoId !== undefined) throw new TypeError("invalid_campaign");
  if (!id(input?.id) || !id(input.clientCampaignId) || !title(input.title) || !body(input.body, typedVideo ? input.videoId : input.mediaId)
    || input.mediaId !== null && !id(input.mediaId) || typeof input.allowRepeatMedia !== "boolean" || !Object.hasOwn(campaignNames, input.status)
    || !date(input.createdAt) || !date(input.updatedAt) || !date(input.expiresAt) || input.updatedAt < input.createdAt || input.expiresAt < input.createdAt) throw new TypeError("invalid_campaign");
  const counts = {};
  for (const key of ["total", ...Object.keys(recipientNames)]) { const value = input.counts?.[key]; if (!count(value)) throw new TypeError("invalid_campaign"); counts[key] = value; }
  if (!counts.total || Object.keys(recipientNames).reduce((sum, key) => sum + counts[key], 0) !== counts.total
    || ["completed", "cancelled", "paused"].includes(input.status) && (counts.pending || counts.sending)) throw new TypeError("invalid_campaign");
  const result = { id: input.id, clientCampaignId: input.clientCampaignId, title: input.title, body: input.body, mediaId: input.mediaId, allowRepeatMedia: input.allowRepeatMedia,
    status: input.status, createdAt: input.createdAt, updatedAt: input.updatedAt, expiresAt: input.expiresAt, counts };
  if (input.formatVersion !== undefined || input.audienceMode !== undefined) {
    if (input.formatVersion !== 2 && !typedVideo || !["selected", "all", "filtered"].includes(input.audienceMode)) throw new TypeError("invalid_campaign");
    result.formatVersion = input.formatVersion; if (typedVideo) result.videoId = input.videoId; result.audienceMode = input.audienceMode;
  }
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
export function mergeCampaign(previous, incoming) {
  if (!previous) return incoming;
  if (previous.id !== incoming.id) throw new TypeError("wrong_campaign");
  // The frozen audience never grows. Authorized erasure can shrink it, even
  // within the same SQL millisecond, but a stale read cannot restore its rows.
  if (incoming.updatedAt < previous.updatedAt || incoming.counts.total > previous.counts.total
    || ["completed", "cancelled", "paused"].includes(previous.status) && incoming.status !== previous.status
    || incoming.counts.total === previous.counts.total && ["delivered", "skipped", "cancelled", "failed"].some((key) => incoming.counts[key] < previous.counts[key])) return previous;
  return incoming;
}
export function acceptCampaign(state, ticket, input) {
  if (!currentBroadcast(state, ticket) || !state.pending) return null;
  const campaign = parseCampaign(input.campaign, { video: state.session?.videoEnabled === true }); const expected = state.pending.payload;
  if (typeof input.duplicate !== "boolean" || campaign.clientCampaignId !== expected.clientCampaignId || campaign.title !== expected.title || campaign.body !== expected.body
    || campaign.mediaId !== expected.mediaId || campaign.videoId !== expected.videoId || campaign.allowRepeatMedia !== expected.allowRepeatMedia || campaign.counts.total !== state.pending.expectedCount) throw new TypeError("invalid_campaign_acknowledgement");
  state.pending = null; state.selected.clear(); state.audienceMode = "selected"; state.draft = { title: "", body: "", mediaId: null, allowRepeatMedia: false }; invalidatePreview(state); return campaign;
}
export function parseRecipientPage(input, { campaignId, afterId = null, limit = 50 } = {}) {
  if (!id(campaignId) || afterId !== null && !id(afterId) || !Number.isInteger(limit) || limit < 1 || limit > 50
    || input?.campaignId !== campaignId || !Array.isArray(input.recipients) || input.recipients.length > limit
    || typeof input.hasMore !== "boolean" || input.nextCursor !== null && !id(input.nextCursor)) throw new TypeError("invalid_recipient_page");
  let previous = afterId;
  const recipients = input.recipients.map((row) => {
    if (!id(row?.conversationId) || previous !== null && row.conversationId <= previous || !id(row.client?.id) || !label(row.client.pseudonym)
      || !Object.hasOwn(recipientNames, row.state) || row.reason !== null && !Object.hasOwn(reasonNames, row.reason)
      || row.messageId !== null && !id(row.messageId) || row.deliveredAt !== null && !date(row.deliveredAt)
      || (row.state === "delivered") !== (row.messageId !== null && row.deliveredAt !== null)
      || ["pending", "sending"].includes(row.state) && row.reason !== null
      || row.state === "delivered" && row.reason !== null
      || row.state !== "delivered" && (row.messageId !== null || row.deliveredAt !== null)
      || ["skipped", "cancelled", "failed"].includes(row.state) && row.reason === null
      || row.state === "failed" && row.reason !== "processing_failed"
      || row.state === "cancelled" && !["cancelled", "administrator_invalid"].includes(row.reason)) throw new TypeError("invalid_recipient_page");
    previous = row.conversationId;
    return { conversationId: row.conversationId, client: { id: row.client.id, pseudonym: row.client.pseudonym }, state: row.state, reason: row.reason, messageId: row.messageId, deliveredAt: row.deliveredAt };
  });
  if (input.hasMore && (!recipients.length || input.nextCursor !== previous)
    || input.nextCursor !== null && (!recipients.length || input.nextCursor !== previous)) throw new TypeError("invalid_recipient_page");
  return { campaignId, recipients, hasMore: input.hasMore, nextCursor: input.nextCursor };
}
