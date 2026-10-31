export class AccessPaginationError extends Error {
  constructor() {
    super("Invalid administrator access page.");
    this.name = "AccessPaginationError";
    this.code = "ACCESS_INPUT";
  }
}

const invalid = () => { throw new AccessPaginationError(); };
const kindValue = (kind) => { if (kind !== "invitations" && kind !== "clients") invalid(); return kind; };

function positionValue(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)
    || Object.keys(position).length !== 2 || !Object.hasOwn(position, "createdAt") || !Object.hasOwn(position, "id")
    || typeof position.id !== "string" || position.id.length !== 32 || !/^[a-f0-9]{32}$/.test(position.id)
    || typeof position.createdAt !== "string" || position.createdAt.length !== 26 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(position.createdAt)) invalid();
  // Date.parse silently normalizes dates such as 30 February. Round-tripping
  // every calendar component rejects those while keeping all six SQL decimals.
  const milliseconds = position.createdAt.slice(0, 23).replace(" ", "T") + "Z";
  const instant = Date.parse(milliseconds);
  if (!Number.isSafeInteger(instant) || instant < 0 || instant > 253402300799999
    || new Date(instant).toISOString() !== milliseconds) invalid();
  return { createdAt: position.createdAt, id: position.id };
}

function stateValue(kind, state) {
  if (typeof state !== "string" || !(kind === "invitations" ? ["all", "pending", "used", "expired", "revoked"] : ["all"]).includes(state)) invalid();
  return state;
}

export function encodeAccessCursor(kind, position, state = "all") {
  kindValue(kind); stateValue(kind, state);
  const { createdAt, id } = positionValue(position);
  return Buffer.from(JSON.stringify(state === "all" ? [1, kind, createdAt, id] : [2, kind, state, createdAt, id]), "utf8").toString("base64url");
}

export function decodeAccessCursor(kind, cursor, state = "all") {
  kindValue(kind); stateValue(kind, state);
  if (typeof cursor !== "string" || !cursor.length || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) invalid();
  const decoded = Buffer.from(cursor, "base64url");
  if (decoded.toString("base64url") !== cursor) invalid();
  let value;
  try { value = JSON.parse(decoded.toString("utf8")); } catch { invalid(); }
  if (!Array.isArray(value) || (state === "all" ? value.length !== 4 || value[0] !== 1 || value[1] !== kind : value.length !== 5 || value[0] !== 2 || value[1] !== kind || value[2] !== state)) invalid();
  const offset = state === "all" ? 2 : 3;
  const position = positionValue({ createdAt: value[offset], id: value[offset + 1] });
  // One spelling avoids padded Base64, trailing JSON whitespace, alternate
  // escapes and malformed UTF-8 aliases for the same pagination position.
  if (encodeAccessCursor(kind, position, state) !== cursor) invalid();
  return position;
}

export function validateAccessPage(kind, options = {}) {
  kindValue(kind);
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "cursor" && key !== "limit" && !(kind === "invitations" && key === "state"))) invalid();
  const { cursor = null, limit = 50, state = "all" } = options;
  stateValue(kind, state);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid();
  return { limit, position: cursor === null ? null : decodeAccessCursor(kind, cursor, state), ...(state === "all" ? {} : { state }) };
}
