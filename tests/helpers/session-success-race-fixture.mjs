// Real auth/access handlers with synthetic accounts. No SQL or mail delivery.
import { createAuthHandler } from "../../server/auth/http.mjs";
import { createAccessHandler } from "../../server/access/http.mjs";
import { ADMIN_SESSION_SECONDS, CLIENT_SESSION_SECONDS } from "../../server/auth/session-policy.mjs";
import { deferred, oldToken, newToken } from "./session-race-fixture.mjs";

export const successRaceCases = ["admin", "client"].flatMap(role =>
  ["session", "logout", "logout-all", ...(role === "admin" ? ["revoke-current"] : [])].map(operation => ({ role, operation })));

export function successfulSessionRace({ role, operation }, origin = "https://jessiemessage.com") {
  const now = Date.now(), seconds = role === "admin" ? ADMIN_SESSION_SECONDS : CLIENT_SESSION_SECONDS;
  const cookie = role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
  const prefix = role === "admin" ? "/api/auth" : "/api/access";
  const deviceId = "a".repeat(32), arrived = deferred(), release = deferred();
  let revoked = false;
  const session = token => ({
    user: { id: (token === oldToken ? "a" : "b").repeat(32), role, pseudonym: "Synthetic account" },
    csrf: token, expiresAt: now + seconds * 1000,
    ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true,
      emailVerified: true, ageAssured: false, approved: true, expiresAt: null } } : {}),
  });
  const revoke = async () => { revoked = true; arrived.resolve(); await release.promise; };
  const service = {
    async login() { return { ...session(newToken), token: newToken }; },
    async session(token) {
      if (token === oldToken) {
        if (revoked) return null;
        const authenticated = session(oldToken);
        if (operation === "session") { arrived.resolve(); await release.promise; }
        return authenticated;
      }
      return token === newToken ? session(newToken) : null;
    },
    logout: revoke, logoutAll: revoke,
    async revokeDevice() { await revoke(); return { status: "device_revoked", current: true }; },
  };
  for (const name of ["adminSession", "inspectInvitation", "createInvitation", "listInvitations", "revokeInvitation", "register", "verifyEmail",
    "resendVerification", "listClients", "approveClient", "revokeClient", "renewClient"]) service[name] = async () => { throw new Error(`Unexpected synthetic operation: ${name}`); };
  const handler = (role === "admin" ? createAuthHandler : createAccessHandler)(service, { origin, clock: () => now });
  const path = operation === "revoke-current" ? `${prefix}/devices/${deviceId}/revoke` : `${prefix}/${operation}`;
  const request = operation === "session" ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": oldToken }, body: "{}",
  };
  const loginRequest = {
    method: "POST", headers: { "Content-Type": "application/json", "X-Jessie-Request": "1" },
    body: JSON.stringify({ email: "synthetic@example.invalid", password: "synthetic-password", ...(role === "admin" ? { factor: "123456" } : {}) }),
  };
  return { handler, path, cookie, request, loginRequest, prefix, seconds, arrived: arrived.promise, release: release.resolve, oldRevoked: () => revoked };
}
