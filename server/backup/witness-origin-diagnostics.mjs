// Only these fixed technical codes may cross the private operator boundary.
// Never forward error messages, causes, properties or provider/SQL codes.
const CODES = new Set([
  ...["UNAVAILABLE", "INPUT", "MISSING", "CHANGED", "EXPIRED", "NOT_EMPTY", "PAIRING", "ABORTED", "MAINTENANCE", "CONTEXT"].map(code => `WITNESS_ORIGIN_${code}`),
  ...["UNAVAILABLE", "INPUT", "UNSAFE", "CHANGED", "ABORTED", "AUTHENTICATION", "PAIRING", "BINDING", "NOT_EMPTY", "EXISTS"].map(code => `WITNESS_GENESIS_${code}`),
  ...["START", "STOP", "CLOSED", "BUSY", "CONFIGURATION"].map(code => `MANAGED_RUNTIME_${code}`),
  ...["INPUT", "UNSAFE", "CHANGED", "LIMIT", "IO", "LOCKED", "ABORTED"].map(code => `RECURRING_FILES_${code}`),
]);

export function witnessOriginErrorCode(error, fallback = "WITNESS_ORIGIN_UNAVAILABLE") {
  try {
    const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (CODES.has(code)) return code;
  } catch {}
  return CODES.has(fallback) ? fallback : "WITNESS_ORIGIN_UNAVAILABLE";
}

export function witnessOriginFailure(error, fallback) {
  return Object.assign(new Error("The initial witness origin operation was not confirmed."), { code: witnessOriginErrorCode(error, fallback) });
}
