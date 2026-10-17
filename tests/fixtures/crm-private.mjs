import fs from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createECDH } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
  writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration } from "../../server/config/runtime-database-file.mjs";

export const PRIMARY = Object.freeze({ originProfile: "primary" });
export const origin = "https://jessiemessage.com";
export const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
export const key = n => Buffer.alloc(32, n).toString("base64url");
export const names = ["runtime-database.json", "runtime-auth.json", "runtime-messaging.json", "runtime-media.json", "runtime-notifications.json", "runtime-crm.json"];
export const supportedFiles = process.platform === "linux" && fs.existsSync("/proc/self/fd");
export const supportedGpg = supportedFiles && fs.existsSync("/usr/bin/gpg");
const repository = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export function bundle(mediaRoot = path.resolve(repository, "../synthetic-crm-media")) {
  const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.alloc(32, 9));
  return {
    database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306", database: "synthetic_crm_test",
      user: "synthetic_crm_runtime", password: "synthetic-only-never-real", privilegeProfile: "strict" },
    authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
    messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
      smtpHost: "smtp.example.invalid", smtpPort: "465", smtpUser: "contact@jessiemessage.com", smtpPassword: "synthetic-mail-only" },
    media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot,
      ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" },
    notifications: { version: 1, origin, notificationKey: key(5), vapidPublicKey: curve.getPublicKey(undefined, "uncompressed").toString("base64url"),
      vapidPrivateKey: curve.getPrivateKey().toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" },
    crm: { version: 1, origin, crmKey: key(6) }
  };
}
export function baseBundle(value = bundle()) { const { crm, ...base } = value; return base; }
export async function fixture(t, { crm = true } = {}) {
  const parent = path.resolve(repository, "../audit"); await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, "crm-private-")); await chmod(root, 0o700);
  const directory = path.join(root, "private"); await mkdir(directory, { mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = bundle(path.join(root, "media"));
  const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
    writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration];
  const values = Object.values(records);
  for (let i = 0; i < (crm ? 6 : 5); i++) await writers[i](directory, values[i], PRIMARY);
  return { root, directory, records, before: await Promise.all(names.slice(0, 5).map(name => readFile(path.join(directory, name)))) };
}
