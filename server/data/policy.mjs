const catalogue = [
  ["users", "subject", "Account identity and access dates; credentials excluded."],
  ["invitations", "subject", "Consumed invitations only; token digests excluded."],
  ["sessions", "subject", "Owned session count only; identifiers and token digests excluded."],
  ["conversations", "subject", "The selected client's conversation."],
  ["admin_mfa", "administrator", "Administrator factors are outside client content."],
  ["admin_recovery_codes", "administrator", "Administrator recovery material is outside client content."],
  ["auth_session_state", "administrator", "Administrator session state is outside client content."],
  ["auth_rate_limits", "global", "Keyed shared counters cannot be attributed to a client safely."],
  ["client_auth_state", "subject", "Age declaration date; credential generation excluded."],
  ["email_verifications", "subject", "Owned verification count only; challenges excluded."],
  ["client_session_state", "subject", "Count linked through the client's sessions."],
  ["mail_outbox", "subject", "Owned job count only; payload, destination and lease material excluded."],
  ["messages", "subject", "Visible conversation content and deletion tombstones."],
  ["chat_receipts", "subject", "Conversation receipt counts for offline operator inventory; client content includes only the client's own read cursor."],
  ["chat_events", "subject", "Conversation event count; no duplicate content export."],
  ["media_assets", "subject", "Owned library count; active owned or visible delivered images only in content export."],
  ["message_media", "subject", "Delivery count in the selected conversation; deleted deliveries give no image access."],
  ["crm_profiles", "subject", "Related profile count only; administrator notes and names never exported."],
  ["crm_labels", "administrator", "Administrator label catalogue is outside client content."],
  ["crm_memberships", "subject", "Related membership count only; no label names or other clients."],
  ["client_password_resets", "subject", "Owned challenge count only; tokens and hashes excluded."],
  ["password_reset_outbox", "subject", "Owned job count only; encrypted recovery material excluded."],
  ["broadcast_preferences", "subject", "The client's current consent and update date."],
  ["broadcast_campaigns", "administrator", "Campaign bodies and audiences are outside client content."],
  ["broadcast_recipients", "subject", "Count scoped to both selected client and conversation; no campaign details."],
  ["media_storage_state", "global", "Shared storage accounting cannot be attributed to one client."],
  ["media_storage_objects", "subject", "Owned allocation count only; storage handles and unregistered files excluded."],
  ["push_subscriptions", "subject", "Owned device subscription count only; endpoints, browser keys, ciphertext and session identifiers excluded."],
  ["push_outbox", "subject", "Delivery count for owned device subscriptions or the selected conversation; no endpoint or provider response."],
];

function freeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

/** A decision inventory, not an activated retention policy or legal determination. */
export const DATA_POLICY = freeze(catalogue.map(([table, scope, description]) => ({ table, scope, description, retentionDays: null, decisionRequired: true })));
export const DATA_POLICY_METADATA = freeze({
  version: 1,
  purpose: "Offline operator inventory and client-visible content export; no deletion or automatic purge.",
  retentionDecided: false,
  existingCleanup: [
    { table: "mail_outbox", days: 7, meaning: "Existing worker removes jobs whose expiry or sent date is older than seven days, in bounded passes. This is code behavior, not a general retention decision." },
    { table: "password_reset_outbox", days: 7, meaning: "Existing worker removes jobs whose expiry or sent date is older than seven days, in bounded passes. Reset challenge rows are not removed by this cleanup." },
    { table: "push_outbox", days: 30, meaning: "Notification worker removes only terminal accepted, skipped or failed jobs whose finished date is older than thirty days, at most one hundred rows per pass. Subscriptions and conversation messages are not purged by this cleanup." },
    { table: "auth_rate_limits", days: 1, meaning: "Rate-limit consumption opportunistically removes at most two thousand shared buckets whose window start is older than twenty-four hours, no more than once per five minutes per store instance. This is neither a scheduled erasure deadline nor client-attributable cleanup." },
  ],
  exclusions: ["Credentials, tokens and hashes", "Notification endpoints, browser keys and encrypted subscriptions", "Administrator CRM content, labels and read cursors", "Other client data and campaign audiences", "Shared counters and the migration ledger", "Deleted message bodies and revoked media deliveries"],
  limitations: ["Content export is not a declaration that every category of personal data has been exported.", "Offline mode is an operator declaration; SQL snapshots do not freeze external filesystem producers.", "Retention periods and backup handling require an explicit decision before any future purge."],
});
