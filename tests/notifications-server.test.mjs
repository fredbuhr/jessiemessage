import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import { createAppServer, createConfiguredServer } from "../server/index.mjs";
import { inspectPreproductionConfiguration, NOTIFICATIONS_CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";

const origin = "https://synthetic-preprod.jessiemessage.com";
function environment() {
  const curve = createECDH("prime256v1"); curve.generateKeys();
  const key = () => randomBytes(32).toString("base64url");
  return {
    ...Object.fromEntries(["AUTH", "MAIL_DELIVERY", "ACCESS", "CHAT", "MEDIA", "NOTIFICATIONS"].map((name) => [`JESSIEMESSAGE_ENABLE_${name}`, "1"])),
    ...Object.fromEntries(["CRM", "CLIENT_RECOVERY", "BROADCAST"].map((name) => [`JESSIEMESSAGE_ENABLE_${name}`, "0"])),
    JESSIEMESSAGE_SITE_ORIGIN: origin, JESSIEMESSAGE_MFA_KEY: key(), JESSIEMESSAGE_MAIL_KEY: key(),
    JESSIEMESSAGE_MESSAGE_KEY: key(), JESSIEMESSAGE_MEDIA_KEY: key(), JESSIEMESSAGE_NOTIFICATIONS_KEY: key(),
    JESSIEMESSAGE_MEDIA_ROOT: resolve(process.cwd(), "../synthetic-notifications-media"),
    JESSIEMESSAGE_VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"),
    JESSIEMESSAGE_VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), curve.getPrivateKey()]).subarray(-32).toString("base64url"),
    JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com",
    JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
    JESSIEMESSAGE_SMTP_USER: "synthetic-smtp-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-smtp-password",
    JESSIEMESSAGE_DB_NAME: "synthetic_preflight", JESSIEMESSAGE_APPLICATION_DATABASE: "synthetic_preflight",
    JESSIEMESSAGE_DB_HOST: "db.example.invalid", JESSIEMESSAGE_DB_PORT: "3306",
    JESSIEMESSAGE_RUNTIME_DB_USER: "synthetic_runtime", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-runtime-password",
    JESSIEMESSAGE_DB_USER: "synthetic_migrator",
  };
}
const inspect = (env) => inspectPreproductionConfiguration(env, { target: "messaging-photos-notify", expectedOrigin: origin });

test("notifications profile requires explicit photo, message and notification capabilities with independent valid keys", () => {
  const env = environment(), report = inspect(env);
  assert.equal(report.valid, true);
  assert.equal(report.target, "messaging-photos-notify");
  assert.deepEqual(report.checks.map(({name}) => name), [...NOTIFICATIONS_CONFIG_CHECK_NAMES]);
  assert.equal(report.checks.find(({name}) => name === "notifications").status, "pass");
  for (const feature of ["AUTH", "MAIL_DELIVERY", "ACCESS", "CHAT", "MEDIA", "NOTIFICATIONS"]) {
    assert.equal(inspect({ ...env, [`JESSIEMESSAGE_ENABLE_${feature}`]: "0" }).valid, false, feature);
  }
  for (const feature of ["CRM", "CLIENT_RECOVERY", "BROADCAST"]) {
    assert.equal(inspect({ ...env, [`JESSIEMESSAGE_ENABLE_${feature}`]: "1" }).valid, false, feature);
  }
  for (const name of ["MFA", "MAIL", "MESSAGE", "MEDIA"]) {
    assert.equal(inspect({ ...env, JESSIEMESSAGE_NOTIFICATIONS_KEY: env[`JESSIEMESSAGE_${name}_KEY`] }).valid, false, name);
  }
  const other = environment();
  assert.equal(inspect({ ...env, JESSIEMESSAGE_VAPID_PUBLIC_KEY: other.JESSIEMESSAGE_VAPID_PUBLIC_KEY }).valid, false);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|smtp|private|base64|mailto/);
});

test("invalid notification flags fail startup before any runtime pool is opened", async () => {
  await assert.rejects(createConfiguredServer({ JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "true" }), {code: "NOTIFICATIONS_CONFIG"});
  await assert.rejects(createConfiguredServer({ JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1" }), {code: "NOTIFICATIONS_CONFIG"});
});

test("root service worker is available only with the notification handler and has no-store scope headers", async (t) => {
  for (const enabled of [false, true]) {
    const server = createAppServer(enabled ? { notificationsHandler: () => false } : {});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${base}/sw.js`, {method});
      assert.equal(response.status, enabled ? 200 : 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
      if (enabled) {
        assert.match(response.headers.get("content-type"), /javascript/);
        assert.equal(response.headers.get("service-worker-allowed"), "/");
      }
      if (method === "HEAD") assert.equal(await response.text(), "");
      else await response.text();
    }
  }
});
