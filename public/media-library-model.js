const identifier = /^[a-f0-9]{32}$/;
const instant = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const integer = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const invalid = () => { throw new TypeError("invalid_media_library"); };
export const LIBRARY_PAGE_SIZE = 20;
export const libraryId = value => typeof value === "string" && identifier.test(value);
export function createLibraryState() {
  return { generation: 0, visible: false, session: null, kind: "photos", photos: false, videos: false,
    rows: [], selected: null, after: null, back: [], cursor: null, more: false, page: 1, listEpoch: 0 };
}
export function clearLibrary(state) {
  const generation = state.generation + 1;
  Object.assign(state, createLibraryState(), { generation });
}
export function libraryTicket(state) { return { generation: state.generation, owner: state.session?.user.id ?? null, csrf: state.session?.csrf ?? null }; }
export function currentLibraryTicket(state, ticket) {
  return !!state.visible && ticket?.generation === state.generation && ticket.owner === (state.session?.user.id ?? null) && ticket.csrf === (state.session?.csrf ?? null);
}
export function acceptLibrarySession(state, session, now = Date.now()) {
  if (!session?.user || session.user.role !== "admin" || !libraryId(session.user.id)
    || typeof session.user.pseudonym !== "string" || session.user.pseudonym.length > 64 || !session.user.pseudonym.isWellFormed()
    || typeof session.csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf) || !instant(session.expiresAt) || session.expiresAt <= now) return false;
  if (state.session && (state.session.user.id !== session.user.id || state.session.csrf !== session.csrf)) return false;
  state.session = session; return true;
}
export function parseLibraryAsset(value, kind) {
  if (!value || !libraryId(value.id) || !instant(value.createdAt)) invalid();
  if (kind === "photos") {
    if (!integer(value.width, 2048) || !integer(value.height, 2048) || !integer(value.thumbnailWidth, 480) || !integer(value.thumbnailHeight, 480)
      || !integer(value.bytes, 10485760) || !integer(value.thumbnailBytes, 524288)
      || value.fullUrl !== `/api/media/admin/assets/${value.id}/full` || value.thumbnailUrl !== `/api/media/admin/assets/${value.id}/thumb`
      || typeof value.sharedHere !== "boolean") invalid();
    return { id: value.id, kind, createdAt: value.createdAt, bytes: value.bytes, width: value.width, height: value.height,
      thumbnailWidth: value.thumbnailWidth, thumbnailHeight: value.thumbnailHeight, thumbnailBytes: value.thumbnailBytes,
      fullUrl: value.fullUrl, thumbnailUrl: value.thumbnailUrl, sharedHere: value.sharedHere };
  }
  if (kind !== "videos" || value.mime !== "video/mp4" || !integer(value.bytes, 104857600) || typeof value.cleanupPending !== "boolean"
    || value.contentUrl !== (value.cleanupPending ? null : `/api/video/admin/assets/${value.id}/content`)) invalid();
  return { id: value.id, kind, createdAt: value.createdAt, bytes: value.bytes, mime: value.mime,
    cleanupPending: value.cleanupPending, contentUrl: value.contentUrl };
}
export function parseLibraryPage(value, kind, after = null) {
  if (!value || !Array.isArray(value.assets) || value.assets.length > LIBRARY_PAGE_SIZE || typeof value.hasMore !== "boolean"
    || value.nextCursor !== null && !libraryId(value.nextCursor) || after !== null && !libraryId(after)) invalid();
  const rows = value.assets.map(row => parseLibraryAsset(row, kind));
  if (rows.some((row, index) => row.id <= (index ? rows[index - 1].id : after ?? ""))
    || value.hasMore && (!rows.length || value.nextCursor !== rows.at(-1).id) || !value.hasMore && value.nextCursor !== null) invalid();
  return { rows, cursor: value.nextCursor, more: value.hasMore };
}
