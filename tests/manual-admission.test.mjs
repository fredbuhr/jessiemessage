import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_ADMISSION_POLICY, hasConsumedInvitation, invitationConsumptionProjection, manuallyAdmittedClient } from "../server/access/admission.mjs";

const now = Date.UTC(2026, 9, 16, 12);
const timestamp = (value) => Number(value);
const client = (overrides = {}) => ({ role: "client", status: "active", invitation_consumed_at: now - 1000,
  email_verified_at: now - 500, access_approved_at: now, access_expires_at: null, age_assured_at: null, ...overrides });

test("manual admission names its policy and requires no invented independent age observation", () => {
  assert.equal(CLIENT_ADMISSION_POLICY, "manual_invitation");
  const row = client();
  assert.equal(manuallyAdmittedClient(row, now, timestamp), true);
  assert.equal(row.age_assured_at, null);
  assert.equal(manuallyAdmittedClient(client({ age_assured_at: now + 1000 }), now, timestamp), true);
});

test("manual admission fails closed without the consumed invitation, email or explicit current approval", () => {
  for (const patch of [
    { role: "admin" }, { status: "pending" }, { status: "suspended" }, { status: "revoked" }, { status: "deleted" },
    { invitation_consumed_at: null }, { invitation_consumed_at: undefined }, { invitation_consumed_at: now + 1 },
    { email_verified_at: null }, { email_verified_at: now + 1 }, { access_approved_at: null },
    { access_approved_at: now + 1 }, { access_approved_at: now - 1001 }, { access_expires_at: now },
  ]) assert.equal(manuallyAdmittedClient(client(patch), now, timestamp), false, JSON.stringify(patch));
  assert.equal(manuallyAdmittedClient(client({ access_expires_at: now + 1 }), now, timestamp), true);
  assert.equal(hasConsumedInvitation(client(), now, timestamp), true);
  assert.equal(hasConsumedInvitation(null, now, timestamp), false);
});

test("invitation SQL projection accepts only the authored user aliases and preserves scalar uniqueness", () => {
  for (const alias of ["users", "u"]) assert.match(invitationConsumptionProjection(alias), new RegExp(`consumed_by_id = ${alias}\\.id`));
  assert.doesNotMatch(invitationConsumptionProjection(), /LIMIT|MAX\(|MIN\(|COALESCE/i);
  for (const alias of ["u; DROP TABLE users", "other", "users.id", null]) assert.throws(() => invitationConsumptionProjection(alias));
});
