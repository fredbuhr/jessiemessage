"use strict";
// An opaque notification reference is a navigation hint, never a login token.
// It stays in the fragment until the authenticated conversation consumes it.
(() => {
  const valid = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
  const paths = { admin: "/admin/messages", client: "/messages" };
  function read(hash = location.hash) {
    if (typeof hash !== "string" || !/^#notification=[a-f0-9]{32}$/.test(hash)) return null;
    return hash.slice(14);
  }
  function destination(role, reference, login = false) {
    if (!Object.hasOwn(paths, role) || !valid(reference)) return null;
    return `${login ? role === "admin" ? "/admin/login" : "/access" : paths[role]}#notification=${reference}`;
  }
  globalThis.JessieNotificationLink = Object.freeze({ valid, read, destination });
})();
