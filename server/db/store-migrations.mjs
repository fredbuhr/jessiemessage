import { loadMigrations } from "./migrations.mjs";

/** Only an explicit assertion may inspect the authored video candidate. The
 * normal loader and all assertions without this option remain schema33-only. */
export async function loadStoreMigrations(options = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).some(name => !["video", "experience"].includes(name))) throw new TypeError("A fixed store schema profile is required.");
  const selected = Object.getOwnPropertyDescriptor(options, "video");
  if (selected && (!Object.hasOwn(selected, "value") || typeof selected.value !== "boolean")) throw new TypeError("A fixed store schema profile is required.");
  const experience = Object.getOwnPropertyDescriptor(options, "experience");
  if (experience && (!Object.hasOwn(experience, "value") || typeof experience.value !== "boolean")
    || experience?.value === true && selected?.value !== true) throw new TypeError("A fixed store schema profile is required.");
  if (experience?.value === true) return (await import("../experience/migrations.mjs")).loadExperienceMigrations();
  return selected?.value === true ? (await import("../video/migrations.mjs")).loadVideoMigrations() : loadMigrations();
}
