// One policy is shared by the HTTP login, SQL rechecks and device list.
export const ADMIN_SESSION_SECONDS = 180 * 24 * 60 * 60;
export const CLIENT_SESSION_SECONDS = 180 * 24 * 60 * 60;
// Messaging devices retain their login between visits. Zero disables only the
// inactivity cutoff; persisted expiry, credential generations and revocation
// are still checked before a valid session can be renewed.
export const CLIENT_IDLE_SECONDS = 0;
export const SESSION_TOUCH_MILLISECONDS = 60000;
export const MAX_SESSION_INSTANT = 253402300799999;

export function sessionInstant(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SESSION_INSTANT) throw new RangeError("Invalid session clock.");
  return value;
}

// Production supplies a shared clock. Direct persistence callers can retain an
// explicit synthetic instant; injected clocks are read only after awaited locks.
export function createSessionClock(clock) {
  if (clock !== undefined && typeof clock !== "function") throw new TypeError("A session clock is required.");
  let previous = 0;
  return (fallback) => {
    if (clock === undefined) return sessionInstant(fallback);
    const current = sessionInstant(clock());
    previous = Math.max(previous, current);
    return previous;
  };
}

export function sessionIsValid({ role, createdAt, lastSeenAt, expiresAt, now, idleSeconds = CLIENT_IDLE_SECONDS }) {
  for (const value of [createdAt, lastSeenAt, expiresAt, now]) sessionInstant(value);
  return ["admin", "client"].includes(role) && createdAt <= now && lastSeenAt >= createdAt && lastSeenAt <= now
    && expiresAt > now && (role === "admin" || idleSeconds === 0 || now < lastSeenAt + idleSeconds * 1000);
}

export function adminSessionExpiry(now) {
  return sessionInstant(sessionInstant(now) + ADMIN_SESSION_SECONDS * 1000);
}

export function clientSessionExpiry(now) {
  return sessionInstant(sessionInstant(now) + CLIENT_SESSION_SECONDS * 1000);
}
