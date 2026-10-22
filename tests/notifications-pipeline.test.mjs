// Synthetic message enqueue -> worker -> push event -> click. SQL and provider
// boundaries are explicit in-memory adapters; no real account or push is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { enqueueNotification } from "../server/notifications/store.mjs";
import { createNotificationWorker } from "../server/notifications/worker.mjs";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const now = Date.UTC(2026, 9, 22, 21), sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

for (const origin of ["https://jessiemessage.com", "https://recette.jessiemessage.com"]) for (const role of ["admin", "client"]) {
  test(`unread ${role} messages reach generic successive alerts and the latest role link on ${new URL(origin).hostname}`, async () => {
    const admin = { id: Buffer.alloc(16, 1) }, client = { id: Buffer.alloc(16, 2) }, subscriptionId = Buffer.alloc(16, 3);
    const recipient = role === "admin" ? admin : client, sender = role === "admin" ? client : admin;
    const jobs = [], settled = [], sent = [], shown = [], opened = [], listeners = new Map();
    const connection = { async query(sql, parameters) {
      if (sql.startsWith("SELECT id, generation FROM push_subscriptions")) {
        assert.deepEqual(parameters, [recipient.id]); return [{ id: subscriptionId, generation: 1 }];
      }
      assert.match(sql, /^INSERT INTO push_outbox/);
      const [jobId, messageId, selectedSubscription, generation, availableAt, createdAt, expiresAt] = parameters;
      assert.deepEqual(selectedSubscription, subscriptionId); assert.equal(generation, 1);
      assert.equal(availableAt, sqlDate(now)); assert.equal(createdAt, sqlDate(now));
      jobs.push({ jobId, messageId, leaseToken: Buffer.alloc(16, 4), attempts: 1,
        expiresAt: Date.parse(expiresAt.replace(" ", "T") + "Z") });
    } };
    const context = { actor: { id: sender.id, role: role === "admin" ? "client" : "admin" }, admin, client, now };
    const messages = [{ id: Buffer.alloc(16, 5) }, { id: Buffer.alloc(16, 6), notificationExpiresAt: now + 45000 }];
    for (const message of messages) await enqueueNotification(connection, context, message);
    assert.equal(jobs.length, 2); assert.deepEqual(jobs.map(job => job.messageId), messages.map(message => message.id));
    assert.equal(jobs[0].expiresAt, now + 86400000); assert.equal(jobs[1].expiresAt, now + 45000);

    vm.runInNewContext(source, { URL, self: { location: { origin },
      addEventListener(name, callback) { listeners.set(name, callback); },
      registration: { async showNotification(title, options) { shown.push({ title, options }); } },
      clients: { async matchAll() { return []; }, async openWindow(path) { opened.push(new URL(path, origin).href); } },
    } });
    const worker = createNotificationWorker({ config: { enabled: true }, clock: () => now + 2000,
      store: { async claimDue() { return jobs; }, async prepareDelivery() {
        return { subscription: { synthetic: true }, role, locale: "fr", expiresAt: now + 86400000 };
      }, async settleDelivery(input) { settled.push(input); return true; } },
      transport: { async send(subscription, payload, options) {
        assert.deepEqual(subscription, { synthetic: true }); sent.push({ payload: JSON.parse(payload), options });
        let displayed;
        listeners.get("push")({ data: { json: () => JSON.parse(payload) }, waitUntil(work) { displayed = work; } });
        await displayed; return { statusCode: 201 };
      } },
    });
    try {
      assert.deepEqual(await worker.runOnce(), { sent: 2, failed: 0, deferred: 0, skipped: 0 });
      assert.deepEqual(sent.map(value => value.options.ttl), [86398, 43]);
      assert.equal(settled.length, 2); assert.ok(settled.every(value => value.result.status === "accepted"));
      assert.equal(shown.length, 2); assert.ok(shown.every(value => value.options.renotify === true));
      assert.equal(shown[0].options.tag, shown[1].options.tag);
      assert.doesNotMatch(JSON.stringify(shown), /messageId|conversationId|subscription|endpoint|synthetic/);
      const path = `${role === "admin" ? "/admin/messages" : "/messages"}#notification=${jobs[1].jobId.toString("hex")}`;
      assert.equal(shown[1].options.data.url, path);
      let clicked;
      listeners.get("notificationclick")({ notification: { data: shown[1].options.data, close() {} }, waitUntil(work) { clicked = work; } });
      await clicked; assert.deepEqual(opened, [origin + path]);
    } finally { await worker.stop(); }
  });
}
