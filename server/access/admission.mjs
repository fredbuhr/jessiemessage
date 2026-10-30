// The administrator selects recipients by issuing invitations. Confirming the
// mailbox activates that invitation without a second administrator approval.
// This policy is not an independent age-assurance claim.
export const CLIENT_ADMISSION_POLICY = "manual_invitation";

// A scalar subquery deliberately fails closed if a manually altered database
// associates more than one consumed invitation with the same account. Normal
// registration creates the user and consumes exactly one invitation atomically.
export function invitationConsumptionProjection(alias = "users") {
  if (!["users", "u"].includes(alias)) throw new TypeError("Invalid admission projection.");
  return `(SELECT admission_invitation.consumed_at FROM invitations admission_invitation
    WHERE admission_invitation.consumed_by_id = ${alias}.id AND admission_invitation.consumed_at IS NOT NULL) AS invitation_consumed_at`;
}

export function hasConsumedInvitation(user, now, timestamp) {
  return user?.invitation_consumed_at != null && timestamp(user.invitation_consumed_at) <= now;
}

export function manuallyAdmittedClient(user, now, timestamp) {
  return Boolean(user && user.role === "client" && user.status === "active"
    && hasConsumedInvitation(user, now, timestamp)
    && user.email_verified_at != null && timestamp(user.email_verified_at) <= now
    && user.access_approved_at != null && timestamp(user.access_approved_at) <= now
    && timestamp(user.access_approved_at) >= timestamp(user.invitation_consumed_at)
    && (user.access_expires_at === null || timestamp(user.access_expires_at) > now));
}
