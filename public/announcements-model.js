const MAX_DATE = 253402300799999;
export const ANNOUNCEMENT_MAX_BODY = 1000;
export const ANNOUNCEMENT_MAX_PERIOD = 7 * 24 * 60 * 60 * 1000;
const id = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const date = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const token = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const validBody = value => typeof value === "string" && value.length <= ANNOUNCEMENT_MAX_BODY && value.isWellFormed() && /[\p{L}\p{N}\p{P}\p{S}]/u.test(value);
export const announcementRevision = value => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
const invalid = () => { throw new TypeError("invalid_announcement"); };
export function parseAnnouncement(value) {
  if (value === null) return null;
  if (!value || !id(value.id) || !announcementRevision(value.revision) || value.revision === "0"
    || !validBody(value.body)
    || !date(value.startsAt) || !date(value.expiresAt) || value.startsAt >= value.expiresAt) invalid();
  return { ...value, id: value.id, revision: value.revision, body: value.body, startsAt: value.startsAt, expiresAt: value.expiresAt };
}
export function parseAnnouncementCurrent(value) {
  if (!value || !date(value.serverTime) || !announcementRevision(value.revision) || !Object.hasOwn(value, "announcement")) invalid();
  const announcement = parseAnnouncement(value.announcement);
  if (announcement && announcement.revision !== value.revision) invalid();
  return { serverTime: value.serverTime, revision: value.revision, announcement };
}
export function parseAnnouncementPreview(value) {
  if (!value || ![value.totalCount, value.eligibleCount, value.excludedCount].every(value => Number.isSafeInteger(value) && value >= 0)
    || value.totalCount !== value.eligibleCount + value.excludedCount
    || typeof value.previewToken !== "string" || !value.previewToken || value.previewToken.length > 4096 || /[^\x21-\x7e]/.test(value.previewToken)) invalid();
  return { ...value, eligibleCount: value.eligibleCount, previewToken: value.previewToken };
}
export function createAnnouncementsState() {
  const state = { generation: 0, visible: false, session: null, current: null, serverTime: null,
    currentRevision: "0", baseRevision: "0", draftVersion: 0, preview: null, acknowledged: false, pending: null, csrfFailed: false,
    draft: { body: "", mode: "now", startsAt: null, expiresAt: null, sendMessage: false } };
  rememberAnnouncementDraft(state); return state;
}
function editableDraftValues(state) {
  return [state.draft.body, state.draft.mode, localAnnouncementDate(state.draft.startsAt),
    localAnnouncementDate(state.draft.expiresAt), state.draft.sendMessage, state.acknowledged];
}
export function rememberAnnouncementDraft(state) {
  // The form displays local dates to the minute. Re-entering the same visible
  // date must not make server seconds look like a new unsaved edit.
  state.draftReference = Object.freeze(editableDraftValues(state));
}
export function hasUnsavedAnnouncementChanges(state) {
  return Boolean(state.pending || editableDraftValues(state).some((value, index) => value !== state.draftReference[index]));
}
export function clearAnnouncements(state, visible = false) {
  const next = createAnnouncementsState(); next.generation = state.generation + 1; next.visible = visible;
  Object.assign(state, next);
}
export function announcementTicket(state) {
  return { generation: state.generation, id: state.session?.user.id ?? null, csrf: state.session?.csrf ?? null };
}
export function currentAnnouncementTicket(state, ticket) {
  return Boolean(state.visible && ticket?.generation === state.generation
    && ticket.id === (state.session?.user.id ?? null) && ticket.csrf === (state.session?.csrf ?? null));
}
export function acceptAnnouncementsSession(state, session) {
  if (!session?.user || session.user.role !== "admin" || !id(session.user.id)
    || !token(session.csrf) || !date(session.expiresAt)) return false;
  if (state.session && (state.session.user.id !== session.user.id || state.session.csrf !== session.csrf)) return false;
  state.session = session; return true;
}
export function setAnnouncementCurrent(state, response, { fillDraft = false } = {}) {
  const current = parseAnnouncementCurrent(response);
  if (BigInt(current.revision) < BigInt(state.currentRevision)) return null;
  state.current = current.announcement; state.currentRevision = current.revision; state.serverTime = current.serverTime;
  if (fillDraft && !state.pending) {
    const value = current.announcement;
    state.baseRevision = current.revision;
    state.draft = { body: value?.body ?? "", mode: value && value.startsAt > current.serverTime ? "scheduled" : "now",
      startsAt: value?.startsAt ?? null, expiresAt: value?.expiresAt ?? null, sendMessage: false };
    state.draftVersion += 1; state.preview = null; state.acknowledged = false;
    rememberAnnouncementDraft(state);
  }
  return current;
}
export function updateAnnouncementDraft(state, values) {
  if (state.pending) return false;
  state.draft = { ...state.draft, ...values }; state.draftVersion += 1;
  state.preview = null; state.acknowledged = false; return true;
}
export function announcementDraft(state, now) {
  const value = state.draft;
  const startsAt = value.mode === "now" ? null : value.startsAt;
  if (!validBody(value.body)
    || !["now", "scheduled"].includes(value.mode) || typeof value.sendMessage !== "boolean" || !date(now)
    || startsAt !== null && (!date(startsAt) || startsAt < now)
    || !date(value.expiresAt) || value.expiresAt <= (startsAt ?? now) || value.expiresAt > now + ANNOUNCEMENT_MAX_PERIOD) invalid();
  return { body: value.body.trim(), startsAt, expiresAt: value.expiresAt, sendMessage: value.sendMessage };
}
export function acceptAnnouncementPreview(state, version, value) {
  if (state.pending || version !== state.draftVersion || !state.draft.sendMessage) return false;
  state.preview = { ...parseAnnouncementPreview(value), version }; state.acknowledged = false; return true;
}
export function prepareAnnouncementMutation(state, mutationId, now, remove = false) {
  if (state.pending || !state.session || state.csrfFailed || !id(mutationId)) return null;
  let body;
  if (remove) {
    if (!state.current) return null;
    body = { mutationId, expectedRevision: state.current.revision };
  } else {
    const draft = announcementDraft(state, now);
    if (draft.sendMessage && (!state.preview || state.preview.version !== state.draftVersion || !state.acknowledged)) return null;
    const { sendMessage, ...content } = draft;
    body = { mutationId, expectedRevision: state.baseRevision, ...content, sendPrivateMessage: sendMessage,
      previewToken: draft.sendMessage ? state.preview.previewToken : null };
  }
  state.pending = { kind: remove ? "remove" : "save", body: Object.freeze(body), status: "sending" };
  return state.pending.body;
}
export function retryAnnouncementMutation(state) {
  if (!state.pending || state.csrfFailed) return null;
  state.pending.status = "sending"; return state.pending.body;
}
export function uncertainAnnouncementMutation(state) { if (state.pending) state.pending.status = "uncertain"; }
export function rejectAnnouncementMutation(state) { state.pending = null; state.preview = null; state.acknowledged = false; }
export function completeAnnouncementMutation(state, response) {
  const parsed = parseAnnouncementCurrent(response);
  state.pending = null; state.preview = null; state.acknowledged = false;
  setAnnouncementCurrent(state, parsed, { fillDraft: true }); return parsed;
}
export function localAnnouncementDate(value) {
  if (!date(value)) return "";
  const valueDate = new Date(value), pad = value => String(value).padStart(2, "0");
  return `${valueDate.getFullYear()}-${pad(valueDate.getMonth() + 1)}-${pad(valueDate.getDate())}T${pad(valueDate.getHours())}:${pad(valueDate.getMinutes())}`;
}
export function readLocalAnnouncementDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(value).getTime();
  return date(parsed) && localAnnouncementDate(parsed) === value ? parsed : null;
}
