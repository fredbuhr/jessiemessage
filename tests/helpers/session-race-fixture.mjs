// Real HTTP handlers, synthetic services only. No SQL, SMTP or backup operation.
import { createNotificationsHttpHandler } from "../../server/notifications/http.mjs";
import { createAuthHandler } from "../../server/auth/http.mjs";
import { createAccessHandler } from "../../server/access/http.mjs";
import { createChatHandler } from "../../server/chat/http.mjs";
import { createMediaHandler } from "../../server/media/http.mjs";
import { createVideoHandler } from "../../server/video/http.mjs";
import { createProfileHandler } from "../../server/profile/http.mjs";
import { createReadinessHandler } from "../../server/readiness/http.mjs";
import { createCrmHandler } from "../../server/crm/http.mjs";
import { createBroadcastHandler } from "../../server/broadcast/http.mjs";
import { createAnnouncementsHandler } from "../../server/announcements/http.mjs";
import { createTasksHttpHandler } from "../../server/tasks/http.mjs";
import { createQuickRepliesHandler } from "../../server/quick-replies/http.mjs";
import { createBackupCopyHandler } from "../../server/backup/copy-http.mjs";
import { createManualBackupHandler } from "../../server/backup/manual-backup-http.mjs";

export const oldToken = Buffer.alloc(32, 1).toString("base64url"), newToken = Buffer.alloc(32, 2).toString("base64url");
const csrf = Buffer.alloc(32, 3).toString("base64url"), cid = "c".repeat(32);
export function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
export const raceCases = [
  ...["chat", "media", "video", "profile"].flatMap(kind => ["admin", "client"].map(role => ({ kind, role }))),
  ...["auth", "access-admin", "readiness", "crm", "broadcast", "announcements", "tasks", "quick-replies", "copy", "manual"].map(kind => ({ kind, role: "admin" })),
  { kind: "access", role: "client" }, { kind: "announcements", role: "client" },
  { kind: "notifications", role: "admin" }, { kind: "notifications", role: "client" },
];

export function sessionRace({ kind, role }, origin = "https://jessiemessage.com") {
  const arrived = deferred(), release = deferred();
  const cookie = role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
  const actor = async () => ({ user: { id: "a".repeat(32), role, pseudonym: "Synthetic" }, csrf, expiresAt: Date.now() + 3600000,
    access: { state: "active", admissionPolicy: "manual_invitation", emailVerified: true, invitationConsumed: true, approved: true } });
  const delayed = async () => { arrived.resolve(); await release.promise; throw Object.assign(new Error("Synthetic revoked session"), { code: "CHAT_UNAUTHORIZED" }); };
  const denied = async () => { arrived.resolve(); await release.promise; return null; };
  // Constructors require complete service contracts, but these tests reach only
  // authentication or the named delayed read. Other operations must never run.
  const names = ["login", "session", "logout", "logoutAll", "adminSession", "inspectInvitation", "createInvitation", "listInvitations", "revokeInvitation", "register",
    "verifyEmail", "resendVerification", "listClients", "approveClient", "revokeClient", "renewClient", "actor", "listConversations", "clientConversation", "messages", "events",
    "send", "markRead", "delete", "admitUpload", "releaseUpload", "upload", "listAssets", "asset", "messageAsset", "gallery", "removeAsset", "open", "openMessage", "listOwned", "remove",
    "profile", "save", "avatar", "peerAvatar", "summary", "verifySmtp", "listLabels", "createLabel", "renameLabel", "deleteLabel", "saveProfile", "contacts",
    "preview", "create", "activity", "list", "get", "cancel", "current", "read", "close", "capabilities", "status", "subscribe", "disable"];
  const service = Object.fromEntries(names.map(name => [name, async () => { throw new Error(`Unexpected synthetic operation: ${name}`); }]));
  service.close = () => {};
  service.actor = ["chat", "media", "video", "profile"].includes(kind) ? actor : denied;
  let handler, path;
  if (kind === "chat") { service.messages = delayed; handler = createChatHandler(service, { origin }); path = `/api/chat/${role}/conversations/${cid}/messages`; }
  else if (kind === "media") { service.listAssets = delayed; handler = createMediaHandler(service, { origin }); path = `/api/media/${role}/assets`; }
  else if (kind === "video") { service.listOwned = delayed; handler = createVideoHandler(service, { origin }); path = `/api/video/${role}/assets`; }
  else if (kind === "profile") { service.profile = delayed; handler = createProfileHandler(service, { origin }); path = `/api/profile/${role}`; }
  else if (kind === "auth") { service.session = denied; handler = createAuthHandler(service, { origin }); path = "/api/auth/session"; }
  else if (kind === "access" || kind === "access-admin") {
    service.session = denied; service.adminSession = denied;
    handler = createAccessHandler(service, { origin }); path = kind === "access" ? "/api/access/session" : "/api/admin/clients";
  } else if (kind === "readiness") { handler = createReadinessHandler(service, { origin }); path = "/api/admin/readiness"; }
  else if (kind === "crm") { handler = createCrmHandler(service, { origin }); path = "/api/admin/crm/contacts"; }
  else if (kind === "broadcast") { handler = createBroadcastHandler(service, { origin }); path = "/api/broadcast/admin/campaigns"; }
  else if (kind === "announcements") { handler = createAnnouncementsHandler(service, { origin }); path = `/api/announcements/${role}/current`; }
  else if (kind === "tasks") { handler = createTasksHttpHandler(service, { origin }); path = "/api/admin/crm/tasks"; }
  else if (kind === "quick-replies") { handler = createQuickRepliesHandler(service, { origin }); path = "/api/admin/quick-replies"; }
  else if (kind === "copy") { handler = createBackupCopyHandler(service, { origin, actor: denied }); path = "/api/admin/backups"; }
  else if (kind === "notifications") { service.actor = delayed; handler = createNotificationsHttpHandler(service, { origin }); path = `/api/notifications/${role}/capabilities`; }
  else if (kind === "manual") { handler = createManualBackupHandler(service, { origin, actor: denied }); path = "/api/admin/backups"; }
  else throw new Error("Unknown synthetic surface");
  return { handler, path, cookie, arrived: arrived.promise, release: release.resolve };
}
