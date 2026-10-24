const valid = (value) => Array.isArray(value) && value.length === 3 && [0, 1].includes(value[0])
  && typeof value[1] === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value[1])
  && Number.isFinite(Date.parse(value[1].replace(" ", "T") + "Z"))
  && typeof value[2] === "string" && /^[a-f0-9]{32}$/.test(value[2]);
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
