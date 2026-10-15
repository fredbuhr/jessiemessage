# JessieMessage — Product scope (draft)

Status: **development 0.24.0; isolated authentication rehearsal**. The official site email is `contact@jessiemessage.com`. Administrator MFA, invitations, restricted client sessions, private text/photo chat, CRM, recovery and opted-in individual broadcasts remain behind explicit configuration. Access renewal, complete administrator lists, private interface lifecycle checks, media capacity, clone backup recovery and cached operations monitoring are implemented. Offline operator tools provide scoped inventory/content export and a non-executable deletion simulation; retention decisions and destructive execution remain open. The [application entry](pwa-entry.md) connects installed launches to existing client/admin routes with explicit role choices and FR/EN entry text. The [private UI language layer](private-ui-languages.md) translates interface text in place while preserving user content, requests and session lifecycles. Only a `fr`/`en` preference is retained in session storage. The [chat accessibility layer](chat-accessibility.md) adds neutral received-message counts, guarded keyboard focus and real Chrome CI with synthetic API fixtures. Screen-reader and actual-device acceptance remain separate. An [operator preflight](preproduction-preflight.md) checks the initial authentication-only configuration, local platform capabilities and read-only database metadata without starting private services. Its reports never approve publication. A dedicated [authentication rehearsal](authentication-rehearsal.md) combines real Chrome, loopback HTTPS and the configured authentication-only server with disposable MariaDB and a synthetic administrator. It does not attest hosting configuration. The [preproduction procedure](preproduction-acceptance.md) distinguishes automated checks from real acceptance. Hosting, actual email reception, external age assurance, browser/device acceptance and translated service emails remain pending. Private features stay disabled by default. Web Push, GIF/sticker integrations and automatic saved segments remain planned.

## Purpose

An invitation-only private messaging application between Jessie (creator/admin) and each invited client. The public site must be neutral and have no payments, public gallery or public chat room. The client only sees their own conversations and media.

`contact@jessiemessage.com` is the public contact/help address and the official-domain identity for outgoing service mail, replies and the SMTP envelope. This choice does not create a mailbox or activate delivery.

## Intended scale

- Initial target: a few hundred registered users.
- Architecture should be ready to scale to thousands after load testing.
- Interfaces: mobile-first web app, installable as a PWA, desktop-compatible.
- Languages: French and English first; translations should be extendable.

## Invitations and onboarding

- An admin manually verifies eligibility before issuing an invite.
- Invite link: unique, random, single-use, revocable and short-lived.
- Invite does not count as age verification.
- Client selects a pseudonym, verifies their email address and completes whatever legal age-assurance process is required.
- Only after all checks may an admin grant access.
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
- French/EU legal classification and suitable age-assurance solution.
- Privacy notice, legal notices, terms, complaint/reporting process and retention policy.
- Security review, backups and successful restoration test.
- Do not use real accounts/media in development or automated tests.
