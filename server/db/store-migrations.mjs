import { loadMigrations } from "./migrations.mjs";

/** Only an explicit assertion may inspect the authored video candidate. The
 * normal loader and all assertions without this option remain schema33-only. */
export async function loadStoreMigrations(options = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).some(name => name !== "video")) throw new TypeError("A fixed store schema profile is required.");
  const selected = Object.getOwnPropertyDescriptor(options, "video");
  if (selected && (!Object.hasOwn(selected, "value") || typeof selected.value !== "boolean")) throw new TypeError("A fixed store schema profile is required.");
  return selected?.value === true ? (await import("../video/migrations.mjs")).loadVideoMigrations() : loadMigrations();
}
