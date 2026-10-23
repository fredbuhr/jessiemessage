import { createPrivateJsonStore } from "../files/private-json.mjs";
import { MAX_PUBLIC_PROFILE_BYTES, PublicProfileError, emptyPublicProfile, failPublicProfile, validatePublicProfileState } from "./validation.mjs";

export function createPublicProfileStore(directory, internal = {}) {
  if (typeof directory !== "string" || !directory.startsWith("/")) throw new TypeError("A private public-profile directory is required.");
  const files = createPrivateJsonStore({ name: "jessie-public-profile.json", lock: "jessie-public-profile.lock", maxBytes: MAX_PUBLIC_PROFILE_BYTES,
    validate: validatePublicProfileState, empty: emptyPublicProfile, isKnownError: error => error instanceof PublicProfileError,
    fail: code => failPublicProfile(({ changed: "PUBLIC_PROFILE_CONFLICT", busy: "PUBLIC_PROFILE_BUSY", input: "PUBLIC_PROFILE_INPUT" })[code] ?? "PUBLIC_PROFILE_UNAVAILABLE") });
  return Object.freeze({
    read: () => files.read(directory, internal),
    save: (value, expectedRevision, beforeCommit) => files.save(directory, value, expectedRevision, { ...internal, beforeCommit }),
  });
}
