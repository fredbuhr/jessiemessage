import { randomBytes } from "node:crypto";
import { readBackupAlertState, saveBackupAlertState } from "./alert-files.mjs";
import { createPrivateBackupAlertDelivery, sendBoundedBackupAlert } from "./alert-delivery.mjs";
import { BackupAlertError, failAlert, alertInstant, validateBackupAlertState, backupMonitorAlertObservation, enqueueBackupAlert, backupAlertRetryDue } from "./alert-state.mjs";

/** One parent owns the queue. SMTP is independent of the runtime/capture lifecycle. */
export function createBackupAlertWorker({ operationsDirectory, privateDirectory }, { read = readBackupAlertState,
  save = saveBackupAlertState, makeDelivery = createPrivateBackupAlertDelivery, send = sendBoundedBackupAlert,
  clock = Date.now, makeId = () => randomBytes(16).toString("hex"), emit = () => {} } = {}) {
  let busy = null, closed = false, lastClock = null;
  const cancellation = new AbortController();
  const notice = (event, code, state = null, alert = null, checkedAt = null) => {
    const report = Object.freeze({ version: 1, type: "private_backup_alert", event, code, checkedAt,
      alertId: alert?.id ?? null, alertEvent: alert?.event ?? null, pending: state?.pending.length ?? null,
      notificationStatus: event === "smtp_accepted" ? "smtp_accepted" : "not_confirmed", inboxStatus: "not_checked" });
    try { Promise.resolve(emit(report)).catch(() => {}); } catch {}
    return report;
  };
  const active = () => { if (closed) failAlert("ALERT_UNAVAILABLE"); };
  async function observe(snapshot) {
    if (closed || busy) return null;
    busy = (async () => {
      let state = null, alert = null, now = null;
      try {
        now = clock();
        if (!alertInstant(now) || lastClock !== null && now < lastClock) failAlert("ALERT_INPUT");
        lastClock = now;
        const observation = backupMonitorAlertObservation(snapshot, now);
        state = validateBackupAlertState(await read(operationsDirectory)); active();
        if ([state.lastObservedAt, state.lastAttemptAt, state.lastAcceptedAt].some(time => time !== null && time > now)) failAlert("ALERT_INPUT");
        let next = state;
        try { next = enqueueBackupAlert(state, observation, makeId); }
        catch (error) {
          if (!(error instanceof BackupAlertError) || error.code !== "ALERT_QUEUE_FULL") throw error;
          // A bounded backlog must still drain when SMTP returns. Keep its
          // records intact; re-observe the current transition on the next tick.
          notice("unavailable", "ALERT_QUEUE_FULL", state, null, now);
        }
        if (next !== state && JSON.stringify(next) !== JSON.stringify(state)) {
          state = validateBackupAlertState(await save(operationsDirectory, next, state.revision)); active();
        }
        if (!backupAlertRetryDue(state, now)) return notice("observed", "OK", state, null, now);
        alert = state.pending[0];
        // Persist the attempt before opening a socket. A crash cannot cause
        // minute-by-minute retries; SMTP acceptance before ack may duplicate
        // the SAME Message-ID, an unavoidable at-least-once boundary.
        state = validateBackupAlertState(await save(operationsDirectory, { ...state, lastAttemptAt: now,
          consecutiveFailures: Math.min(1000000, state.consecutiveFailures + 1) }, state.revision)); active();
        if (await send(() => makeDelivery(privateDirectory), alert, { signal: cancellation.signal }) !== true) failAlert("ALERT_SMTP_FAILED");
        active();
        state = validateBackupAlertState(await save(operationsDirectory, { ...state, pending: state.pending.slice(1),
          lastAttemptAt: null, consecutiveFailures: 0, lastAcceptedId: alert.id, lastAcceptedAt: now }, state.revision)); active();
        return notice("smtp_accepted", "OK", state, alert, now);
      } catch (error) {
        if (closed) return null;
        return notice("unavailable", error instanceof BackupAlertError ? error.code : "ALERT_UNAVAILABLE", state, alert, now);
      }
    })();
    try { return await busy; } finally { busy = null; }
  }
  async function close() {
    closed = true; cancellation.abort();
    await busy;
  }
  return Object.freeze({ observe, close });
}
