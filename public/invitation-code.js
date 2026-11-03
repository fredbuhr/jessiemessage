const allowed = /^[0-9A-Za-z \t\r\n\u00a0\u202f\u2010-\u2014\u2212-]+$/;
const separators = /[ \t\r\n\u00a0\u202f\u2010-\u2014\u2212-]/g;
const codePattern = /^[0-9A-HJKMNP-TV-Z]{20}$/;

export function normalizeInvitationCode(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 64 || !allowed.test(value)) return null;
  // Copying a code may change its separators. Crockford aliases affect only
  // ASCII O/I/L; every other symbol must already belong to the code alphabet.
  const normalized = value.replace(separators, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return codePattern.test(normalized) ? normalized : null;
}
