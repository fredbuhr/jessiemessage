/** Stop admission and producers together, then drain within one process budget. */
export function createShutdown({ server, pool, mailWorker, diagnostics,
  graceMilliseconds = 5000, deadlineMilliseconds = 15000 } = {}) {
  if (typeof server?.close !== "function" || typeof server.closeAllConnections !== "function"
    || !Number.isSafeInteger(graceMilliseconds) || graceMilliseconds < 1
    || !Number.isSafeInteger(deadlineMilliseconds) || deadlineMilliseconds <= graceMilliseconds
    || deadlineMilliseconds > 60000) throw new TypeError("A bounded application shutdown is required.");
  let closing;
  return function shutdown() {
    if (closing) return closing;
    let resolveClosing;
    closing = new Promise((resolve) => { resolveClosing = resolve; });
    let failed = false, forced = false, finished = false, poolClosing;
    const run = (operation) => {
      try { return Promise.resolve(operation()).catch(() => { failed = true; }); }
      catch { failed = true; return Promise.resolve(); }
    };
    const endPool = () => {
      if (!poolClosing) poolClosing = run(() => pool?.end());
      return poolClosing;
    };
    const force = () => {
      if (forced) return;
      forced = true;
      try { server.closeAllConnections(); } catch { failed = true; }
      // Cancel SMTP sockets before waiting for workers which may be inside send.
      void run(() => mailWorker?.abort());
    };
    const finish = (timedOut) => {
      if (finished) return;
      finished = true;
      clearTimeout(graceTimer); clearTimeout(deadlineTimer);
      resolveClosing({ timedOut, forced, failed });
    };
    const graceTimer = setTimeout(force, graceMilliseconds);
    const deadlineTimer = setTimeout(() => {
      force();
      // A query or commit may remain uncertain. Never manufacture completion.
      // The CLI exits with failure after this result; leases remain recoverable.
      void endPool();
      finish(true);
    }, deadlineMilliseconds);
    try { server.beginDrain?.(); } catch { failed = true; }
    // Invoke every stop synchronously, before awaiting any individual producer.
    const workers = run(() => mailWorker?.stop());
    const diagnostic = run(() => diagnostics?.close());
    const connections = new Promise((resolve) => {
      try {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") failed = true;
          resolve();
        });
        server.closeIdleConnections?.();
      } catch { failed = true; resolve(); }
    });
    // Socket closure alone does not settle a filesystem operation or SQL commit
    // already started by a request whose client has disconnected.
    const requests = run(() => server.waitForRequests?.())
      .then(() => run(() => server.closeIdleConnections?.()));
    const http = Promise.all([connections, requests]);
    void Promise.all([workers, diagnostic, http])
      .then(() => run(() => mailWorker?.close()))
      .then(endPool)
      .then(() => finish(false));
    return closing;
  };
}
