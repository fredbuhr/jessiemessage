"use strict";
// Notifications only. This worker never intercepts a fetch, opens a private
// API, or stores messages, photos, account data or credentials in a cache.
self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", (event) => {
  let language = "fr";
  try { if (event.data?.json()?.language === "en") language = "en"; } catch { /* A visible, generic alert is still required. */ }
  event.waitUntil(self.registration.showNotification("Jessie", {
    body: language === "en" ? "A new message is waiting for you." : "Un nouveau message t’attend.",
    lang: language, tag: "jessie-new-message", renotify: false,
    icon: "/brand/icon-192.png", badge: "/brand/icon-192.png", data: { url: "/app" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = new URL("/app", self.location.origin).href;
    // Reuse an entry window; opening /app separately preserves any unsent
    // draft already being composed in a conversation window.
    const existing = windows.find((client) => client.url === target && typeof client.focus === "function");
    if (existing) return existing.focus();
    return self.clients.openWindow("/app");
  })());
});
