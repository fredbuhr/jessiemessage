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
].map(([name, manifestVersion, receiptVersion]) => Object.freeze({
  name, manifestProfile: `messaging-${name}`, manifestVersion, receiptVersion,
  notifications: name !== "photos", recovery: name.includes("-recovery"), crm: name.includes("-crm"), application: name.endsWith("-application"),
}));
export const PHOTO_BACKUP_PROFILES = Object.freeze(definitions.map(value => value.name));
export const CHECKPOINT_RUNTIME_PROFILES = Object.freeze(["photos-notify-recovery", "photos-notify-recovery-crm"]);
export const photoBackupProfile = name => definitions.find(value => value.name === name) ?? null;
export const manifestBackupProfile = name => definitions.find(value => value.manifestProfile === name) ?? null;
export function checkpointBackupProfile(name, application = false) {
  if (name !== undefined && !CHECKPOINT_RUNTIME_PROFILES.includes(name) || typeof application !== "boolean") return null;
  return photoBackupProfile(`${name ?? "photos-notify"}${application ? "-application" : ""}`);
}
