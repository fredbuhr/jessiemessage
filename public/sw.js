"use strict";
// Notifications only. This worker never intercepts a fetch, opens a private
// API, or stores messages, photos, account data or credentials in a cache.
self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
function notificationTarget(data) {
  if (!["admin", "client"].includes(data?.role) || typeof data.notification !== "string" || !/^[a-f0-9]{32}$/.test(data.notification)) return "/app";
  return `${data.role === "admin" ? "/admin/messages" : "/messages"}#notification=${data.notification}`;
}
self.addEventListener("push", (event) => {
  let language = "fr", target = "/app";
  try { const data = event.data?.json(); if (data?.language === "en") language = "en"; target = notificationTarget(data); } catch { /* A visible, generic alert is still required. */ }
  event.waitUntil(self.registration.showNotification("Jessie", {
    body: language === "en" ? "A new message is waiting for you." : "Un nouveau message t’attend.",
    lang: language, tag: "jessie-new-message", renotify: false,
    icon: "/brand/icon-192.png", badge: "/brand/icon-192.png", data: { url: target },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const hint = event.notification.data?.url;
    const path = typeof hint === "string" && /^\/(?:admin\/)?messages#notification=[a-f0-9]{32}$/.test(hint) ? hint : "/app";
    const target = new URL(path, self.location.origin).href;
    const existing = windows.find((client) => client.url === target && typeof client.focus === "function");
    if (existing) return existing.focus();
    if (path !== "/app" && typeof MessageChannel === "function") {
      const route = path.split("#")[0];
      const candidates = windows.filter((client) => { try { const url = new URL(client.url); return url.origin === self.location.origin && url.pathname === route; } catch { return false; } });
      const live = candidates.find((client) => client.focused) ?? candidates[0];
      if (live && typeof live.postMessage === "function" && typeof live.focus === "function") {
        // A supporting chat queues the intent without reloading its drafts.
        // An older tab that cannot acknowledge it remains open and untouched.
        await live.focus();
        const accepted = await new Promise((resolve) => {
          const channel = new MessageChannel();
          const done = (value) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
          const timer = setTimeout(() => done(false), 600);
          channel.port1.onmessage = (message) => done(message.data?.accepted === true);
          try { live.postMessage({ type: "jessie-open-notification", role: route === "/messages" ? "client" : "admin", notification: path.split("=")[1] }, [channel.port2]); }
          catch { done(false); }
        });
        if (accepted) return live;
      }
    }
    return self.clients.openWindow(path);
  })());
});
