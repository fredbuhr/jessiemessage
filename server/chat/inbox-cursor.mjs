function valid(value) {
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== 2
    || typeof value[1] !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value[1])
    || typeof value[2] !== "string" || !/^[a-f0-9]{32}$/.test(value[2])) return false;
  // Keep all SQL microseconds in the cursor but round-trip the calendar at
  // millisecond precision; Date.parse otherwise normalizes impossible dates.
  const milliseconds = value[1].slice(0, 23).replace(" ", "T") + "Z";
  const instant = Date.parse(milliseconds);
  return Number.isSafeInteger(instant) && instant >= 0 && instant <= 253402300799999
    && new Date(instant).toISOString() === milliseconds;
}
export function encodeInboxCursor(value) {
  if (!valid(value)) throw new TypeError("Invalid inbox cursor");
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeInboxCursor(raw) {
  if (typeof raw !== "string" || raw.length > 160 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new TypeError("Invalid inbox cursor");
  const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  if (!valid(value) || encodeInboxCursor(value) !== raw) throw new TypeError("Invalid inbox cursor");
  return value;
}
