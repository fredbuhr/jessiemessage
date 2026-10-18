# JessieMessage — Product scope (draft)

Status on 17 October 2026: **stage 0.42 active**, runtime `ed78b55e`, schema 30, profile `messaging-photos-notify-recovery`, primary origin `https://jessiemessage.com`. Invitations, verified email, manual admission, private text/photos, durable administrator/client sessions, per-device Push, password recovery and FR/EN help are deployed. Recovery, photos and notification reception have owner acceptance; detailed all-device coverage is not inferred. The schema-30 isolated application restore was accepted at stage 0.36. The private diagnostic passes exact-source CI and anonymous hosted checks; its authenticated online download remains unverified in the operator browser without a session. [Stage 0.43](crm-collaboration.md) prepares the disabled private-file module for shared-administrator use; private runtime configuration and backup support precede its activation. Individual broadcasts remain disabled. See the [current delivery record](operations-diagnostic.md) and [audit](AUDIT-2026-10-17.md).

JessieMessage records an administrator’s manual admission of invited adults. It does not receive an independent age-verification proof or certify adulthood. No external invitation source or identity-verification provider is part of this implementation lot.

## Purpose

An invitation-only private messaging application between Jessie and each invited person. The public site must be neutral and have no payments, public gallery or public chat room. The client only sees their own conversations and media.

**Operating model:** Jessie’s private space uses a shared administrator account with independent device sessions. Actions belong to that application identity, without identifying which authorised person performed them. User-facing text names Jessie and describes authorised access without implying that only one person can read the exchanges. No commercial purpose or external invitation source is assigned to the service. See [stage 0.41 preparation](data-privacy-preparation.md).

`contact@jessiemessage.com` is the public contact/help address and the official-domain identity for outgoing service mail, replies and the SMTP envelope. This choice does not create a mailbox or activate delivery.

## Intended scale

- Initial target: a few hundred registered users.
- Architecture should be ready to scale to thousands after load testing.
- Interfaces: mobile-first web app, installable as a PWA, desktop-compatible.
- Languages: French and English first; translations should be extendable.

## Invitations and onboarding

- Jess selects each invitee before issuing a personal invitation, then confirms the registered account belongs to that invitee before approval.
- Invite link: unique, random, single-use, revocable and short-lived.
- Invite does not count as age verification.
- Client selects a pseudonym and verifies their email address.
- Only a consumed invitation, verified email and explicit administrator approval grant access under the `manual_invitation` policy. No `age_assured_at` value is fabricated.
- Admin can revoke a session or access at any time.

## Client experience

- One private conversation with Jessie, no client-to-client discovery.
- Messages, emojis and images, later GIF/sticker integrations after provider approval.
- Photo and message history in their own conversation.
- Web Push notifications opt-in, neutral text on lock screen; iOS instructions if installation is required.
- Account preferences, data download and deletion requests.
- No payment on the site.
- Optional password recovery by email for an email-verified pending or active client. The request confirms neither account existence nor eligibility. A reset link expires after 30 minutes and is usable once; opening it changes nothing.
- After an explicit successful reset, all client sessions are revoked and the client signs in again. An expired access period is not renewed; verification, the current admission policy, administrator approval and account status are unchanged. Suspended, revoked/deleted accounts and administrators cannot recover through this client flow. See [client recovery](client-recovery.md).

## Admin experience

- **Préparer le site** shows which features and email delivery are configured, with admission-policy limitations and the remaining operational/device acceptance kept visible. It does not certify readiness for production.
- An explicit **Vérifier la connexion e-mail** action checks encrypted SMTP connection/authentication without sending an email. A successful result still requires a separate reception test. No password, recipient or SMTP-server input is exposed in this page. See [mail preparation](mail-readiness.md).
- Implemented CRM inbox search across pseudonym, private nickname and known email, with tag **and** group, access, unread and reminder filters.
- Private client file: nickname, contact email, status, up to 8,000 characters of encrypted notes and an optional reminder date. The inbox includes neither email nor notes.
- Up to 100 tags and 100 groups per administrator, with at most 32 labels on one client file. Avoid gratuitous intimate profiling.
- Internal groups are invisible to clients and collect private memberships; they do not create shared chat rooms. Saved automatic segments remain planned.
- Reminder dates support private follow-up filters; they do not send notifications or create scheduled tasks.
- Profile saves are atomic and detect concurrent edits. A conflict preserves the draft for explicit review rather than overwriting a newer file.
- Deleting a label removes its memberships and invalidates stale profile saves while preserving the private notes.
- One-to-many sends, always delivered as **individual messages**, never a shared group chat.
- Distinguish requested service deliveries from optional promotional messages. Respect consent/opt-outs.
- Queue bulk deliveries; track queued, delivered and failed recipients; retry safely.
- Shared media library with one stored master per asset plus derivative previews.
- Record delivery receipts at least by media ID + recipient ID; detect repeat sends.
- Support limited-term access and admin tasks without displaying payment data.

Individual broadcast queues and client opt-in are implemented in 0.11. The latest interface uses a bounded recent/active activity view plus paginated archives. Automatic saved segments remain planned. CRM is available only to a currently authenticated administrator assigned to the conversation. The client receives no private nickname, label, reminder or note through their chat/access/media APIs. An expired or revoked client can retain an assigned administrator file without regaining chat access or permitting a new send. See [current CRM behavior and limits](private-crm.md).

## Media deduplication

- Compute a SHA-256 content digest when importing a file, with unique stored file IDs.
- Separate media storage from message references.
- Track `campaign_id`, `recipient_id` and `media_id` for audit and idempotency.
- A logged send does **not** prove a client viewed or downloaded an image.
- Explicit re-send remains possible for an admin, with a warning.

## Deferred

- Voice/video calls.
- Multi-creator rooms.
- In-app payments or subscriptions.
- Public timelines or public image galleries.

## Remaining delivery work

- Prepare the explicit private CRM profile, separate key and backup/restore coverage, then perform its targeted activation checks.
- Keep broadcasts separate, with recipient preview, individual deliveries and the existing consent/opt-out rules.
- Decide retention and deletion behavior before implementing an irreversible purge; the incomplete information draft stays unserved.
- Complete the device matrix through targeted observations while preserving accepted journeys.
- Continue security and restoration checks with synthetic development fixtures; real accounts/media do not enter automated tests.
