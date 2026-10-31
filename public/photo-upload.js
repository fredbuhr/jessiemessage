// Only a definitive admission refusal is safe to repeat. A lost response or a
// server error may follow a stored upload and must remain an explicit retry.
export async function uploadPhotoWithBackoff(operation, { signal, current = () => true } = {}) {
  const active = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!current()) throw Object.assign(new Error("stale_response"), { stale: true });
  };
  for (let attempt = 0; ; attempt += 1) {
    active();
    try { const result = await operation(); active(); return result; }
    catch (error) {
      active();
      const seconds = error.retryAfter;
      if (attempt >= 2 || error.status !== 429
        || !["try_again_later", "media_busy", "rate_limited"].includes(error.code)
        || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60) throw error;
      await new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, seconds * 1000);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    }
  }
}
