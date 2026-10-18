// Versions describe the authenticated scope, never merely a display label.
// Existing profiles keep their exact versions, key sets and coverage.
const definitions = [
  ["photos", 2, null],
  ["photos-notify", 3, 1],
  ["photos-notify-application", 4, 2],
  ["photos-notify-recovery", 5, 3],
  ["photos-notify-recovery-application", 6, 4],
  ["photos-notify-recovery-crm", 7, 5],
  ["photos-notify-recovery-crm-application", 8, 6],
  ["photos-notify-recovery-crm-broadcast", 9, 7],
  ["photos-notify-recovery-crm-broadcast-application", 10, 8],
].map(([name, manifestVersion, receiptVersion]) => Object.freeze({
  name, manifestProfile: `messaging-${name}`, manifestVersion, receiptVersion,
  notifications: name !== "photos", recovery: name.includes("-recovery"), crm: name.includes("-crm"), broadcast: name.includes("-broadcast"), application: name.endsWith("-application"),
}));
export const PHOTO_BACKUP_PROFILES = Object.freeze(definitions.map(value => value.name));
export const CHECKPOINT_RUNTIME_PROFILES = Object.freeze(["photos-notify-recovery", "photos-notify-recovery-crm", "photos-notify-recovery-crm-broadcast"]);
export const photoBackupProfile = name => definitions.find(value => value.name === name) ?? null;
export const manifestBackupProfile = name => definitions.find(value => value.manifestProfile === name) ?? null;
export function checkpointBackupProfile(name, application = false) {
  if (name !== undefined && !CHECKPOINT_RUNTIME_PROFILES.includes(name) || typeof application !== "boolean") return null;
  return photoBackupProfile(`${name ?? "photos-notify"}${application ? "-application" : ""}`);
}

// Operational capsules extend only the broadcast checkpoint receipt. The SQL
// manifest, six existing keys and all historical receipt versions stay intact.
export function checkpointReceiptVersion(profile, operations = false) {
  if (operations && !profile?.broadcast) return null;
  return operations ? profile.application ? 10 : 9 : profile?.receiptVersion ?? null;
}
export function matchesCheckpointReceipt(profile, value) {
  return Boolean(profile && value && value.profile === profile.manifestProfile
    && value.version === checkpointReceiptVersion(profile, Object.hasOwn(value, "operations")));
}
export function sameCheckpointReceiptScope(before, after) {
  if (before?.version !== after?.version || before?.profile !== after?.profile
    || Object.hasOwn(before ?? {}, "operations") !== Object.hasOwn(after ?? {}, "operations")) return false;
  if (!Object.hasOwn(before ?? {}, "operations")) return true;
  return ["file", "bytes", "sha256"].every(name => before.operations?.[name] === after.operations?.[name])
    && [before, after].every(value => value.operationsCovered === true && value.operationalRestorationPending === true
      && value.externalRegistryContinuityVerified === false);
}
