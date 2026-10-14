const NAME_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const NOTE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const UNICODE_SPACES = /\p{White_Space}+/gu;
const ONLY_INVISIBLE = /^[\p{C}\p{Z}]*$/u;
const MAX_VERSION = 4294967295n;
const MAX_REMINDER = 253402300799999;

export class CrmInputError extends Error {
  constructor() {
    super("Invalid private record data.");
    this.name = "CrmInputError";
    this.code = "CRM_INPUT";
  }
}

function invalid() { throw new CrmInputError(); }

function stringInput(value, limit, maxBytes, controls) {
  if (typeof value !== "string" || value.length > limit || !value.isWellFormed()
    || Buffer.byteLength(value, "utf8") > maxBytes || controls.test(value)) invalid();
  return value;
}

function displayName(value, allowEmpty) {
  stringInput(value, 64, 256, NAME_CONTROLS);
  const name = value.normalize("NFC").replace(UNICODE_SPACES, " ").trim();
  if (name.length > 64 || Buffer.byteLength(name, "utf8") > 256
    || (!allowEmpty && name.length === 0) || (name.length > 0 && ONLY_INVISIBLE.test(name))) invalid();
  return name;
}

export function validateLabelName(value) {
  const name = displayName(value, false);
  const normalizedName = name.normalize("NFKC").toLowerCase();
  if (normalizedName.length === 0 || normalizedName.length > 128
    || Buffer.byteLength(normalizedName, "utf8") > 512
    || NAME_CONTROLS.test(normalizedName) || ONLY_INVISIBLE.test(normalizedName)) invalid();
  return { name, normalizedName };
}

export function validateNickname(value) { return displayName(value, true); }

export function validateNotes(value) {
  // Preserve exact whitespace, normalization, markup and permitted newlines.
  return stringInput(value, 8000, 32768, NOTE_CONTROLS);
}

export function validateSearch(value) {
  stringInput(value, 80, 320, NAME_CONTROLS);
  const query = value.normalize("NFC").trim();
  if (query.length > 80 || Buffer.byteLength(query, "utf8") > 320) invalid();
  // SQL callers treat this as literal text, including percent and underscore.
  return query;
}

export function validateId(value) {
  if (typeof value !== "string" || value.length !== 32 || !/^[0-9a-f]{32}$/u.test(value)) invalid();
  return Buffer.from(value, "hex");
}

export function validateVersion(value, { allowZero = true } = {}) {
  if (typeof value !== "string" || value.length < 1 || value.length > 10
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)) invalid();
  const version = BigInt(value);
  if (version.toString() !== value || version > MAX_VERSION || (!allowZero && version === 0n)) invalid();
  return value;
}

export function validateLabelIds(value) {
  if (!Array.isArray(value) || value.length > 32) invalid();
  // Array.from also visits sparse slots, so holes cannot bypass ID validation.
  const ids = Array.from(value, (item) => ({ hex: item, bytes: validateId(item) }));
  if (new Set(ids.map(({ hex }) => hex)).size !== ids.length) invalid();
  return ids.sort((left, right) => left.hex < right.hex ? -1 : left.hex > right.hex ? 1 : 0)
    .map(({ bytes }) => bytes);
}

export function validateReminder(value) {
  if (value !== null && (typeof value !== "number" || !Number.isInteger(value)
    || value < 0 || value > MAX_REMINDER)) invalid();
  return value;
}
