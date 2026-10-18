(() => {
  "use strict";

  // Long-lived cookies exceed the browser's signed 32-bit timer range. Wake
  // periodically to ask the server for the current session instead of treating
  // a timer firing as proof that the account has been disconnected.
  function scheduleSessionCheck(expiresAt, callback, {
    maxDelayMs = 300000,
    clock = Date.now,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout
  } = {}) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0 || typeof callback !== "function"
      || typeof clock !== "function" || typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function"
      || !Number.isSafeInteger(maxDelayMs) || maxDelayMs < 1000 || maxDelayMs > 2147483647) {
      throw new TypeError("Invalid session check.");
    }
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid session clock.");
    const delay = Math.max(1000, Math.min(maxDelayMs, expiresAt - now));
    let active = true;
    const timer = setTimeoutFn(() => {
      if (!active) return;
      active = false;
      callback();
    }, delay);
    return () => {
      if (!active) return;
      active = false;
      clearTimeoutFn(timer);
    };
  }

  globalThis.JessieSessionClock = Object.freeze({ scheduleSessionCheck });
})();
