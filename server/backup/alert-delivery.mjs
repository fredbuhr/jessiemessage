import { loadRuntimeMessagingEnvironment, clearRuntimeMessagingSecrets } from "../config/runtime-messaging.mjs";
import { mailConfiguration } from "../mail/config.mjs";
import { createVerificationTransport } from "../mail/transport.mjs";
import { BackupAlertError, failAlert } from "./alert-state.mjs";

/** Uses the existing protected bundle; never exports credentials or raw SMTP errors. */
export async function createPrivateBackupAlertDelivery(privateDirectory, { load = loadRuntimeMessagingEnvironment,
  configure = mailConfiguration, makeTransport = createVerificationTransport } = {}) {
  let environment, config, transport;
  try {
    environment = await load(privateDirectory, { originProfile: "primary" });
    config = configure(environment);
    if (config.enabled !== true || config.origin !== "https://jessiemessage.com") failAlert("ALERT_INPUT");
    transport = await makeTransport(config);
    return Object.freeze({ send: value => transport.sendBackupAlert(value), close: () => transport.close() });
  } catch { try { await transport?.close(); } catch {} throw new BackupAlertError("ALERT_UNAVAILABLE"); }
  finally { clearRuntimeMessagingSecrets(environment); config?.key?.fill(0); }
}

export async function sendBoundedBackupAlert(makeDelivery, alert, { timeoutMilliseconds = 20000, signal } = {}) {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 20000) failAlert("ALERT_INPUT");
  let timer, abort, delivery, closing, stopped = false;
  const close = () => {
    if (!delivery) return Promise.resolve();
    closing ??= Promise.resolve().then(() => delivery.close());
    return closing;
  };
  const cancel = () => { stopped = true; void close().catch(() => {}); };
  try {
    if (signal?.aborted) failAlert("ALERT_UNAVAILABLE");
    const cancelled = new Promise((_, reject) => {
      abort = () => { cancel(); reject(new BackupAlertError("ALERT_UNAVAILABLE")); };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { cancel(); reject(new BackupAlertError("ALERT_TIMEOUT")); }, timeoutMilliseconds);
      timer.unref();
    });
    const result = await Promise.race([Promise.resolve().then(async () => {
      if (signal?.aborted || stopped) failAlert("ALERT_UNAVAILABLE");
      delivery = await makeDelivery();
      if (signal?.aborted || stopped) { await close(); failAlert("ALERT_UNAVAILABLE"); }
      const accepted = await delivery.send(alert);
      await close();
      return accepted;
    }), cancelled]);
    if (result !== true || signal?.aborted) failAlert("ALERT_SMTP_FAILED");
    return true;
  } catch (error) { if (error instanceof BackupAlertError) throw error; failAlert("ALERT_SMTP_FAILED"); }
  finally { stopped = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); void close().catch(() => {}); }
}
