# JessieMessage — Product scope (draft)

Status: **application 0.24.0; stages 0.26/0.27 accepted in recipe; stage 0.28 photos in preparation**. The [photo runtime note](private-photo-runtime.md) distinguishes code, tests and deployed state. Text remains active at `14a43104`; photos are not activated yet. The first usable perimeter is personal invitations, verified email, manual admission by Jess, one private text/photo conversation and revocation. CRM and individual broadcasts remain planned after that core acceptance; Push is not implemented. Existing modules are reused.

The owner describes invitees whose age was checked upstream on Stripchat. JessieMessage records an administrator's manual admission, not an independent age verification or an automatically imported Stripchat proof. This product decision is not a legal certification of the upstream check. No new identity-verification provider is included in this implementation lot.

## Purpose

An invitation-only private messaging application between Jessie (creator/admin) and each invited client. The public site must be neutral and have no payments, public gallery or public chat room. The client only sees their own conversations and media.

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
- After an explicit successful reset, all client sessions are revoked and the client signs in again. An expired access period is not renewed; verification, age assurance, administrator approval and account status are unchanged. Suspended, revoked/deleted accounts and administrators cannot recover through this client flow. See [client recovery](client-recovery.md).

## Admin experience

- **Préparer le site** shows which features and email delivery are configured, with age assurance, actual email reception and device acceptance kept visibly pending. It does not certify readiness for production.
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

## Must be resolved before real launch

- Written clarification of third-party platform rules for how invitations are distributed.
- Hosting terms for the actual use case.
- Legal classification and the scope of upstream eligibility checks remain outside this code acceptance; do not present manual admission as independently verified adulthood.
- Privacy notice, legal notices, terms, complaint/reporting process and retention policy.
- Security review, backups and successful restoration test.
- Do not use real accounts/media in development or automated tests.
