# Technical architecture — draft

## Current development: opt-in access, messaging, CRM and client recovery

A Node.js 24 HTTP server serves a neutral bilingual landing page and liveness endpoint by default. Private flags enable administrator MFA and then invitations, registration, email verification and separate restricted client sessions. Verification and optional password-reset workers start with the listener. They share one SMTP transport; shutdown waits for both active batches, closes the transport once, then closes the pool. An age declaration never opens access; independently recorded assurance and administrator approval are required. A separate chat flag enables private text conversations, transactional authorization and encrypted message bodies. An additional media flag enables normalized JPEG photo storage, encrypted outside the checkout, with per-request owner/delivery authorization. CRM 0.8 adds administrator-only profiles, tags/groups and filtered contacts behind its own flag/key; it requires chat, while media remains optional. Recovery 0.9 requires enabled access/mail and adds no dependency on chat, media or CRM. External provider integrations remain pending.

The initial code is **not** a production chat service.

Twenty-two migrations provide those foundation and administrator tables plus client authentication, email verification, client session state, an encrypted mail outbox, messages, per-participant read receipts and per-conversation change events, owner media assets, audited message attachments, three CRM tables, hashed client reset challenges and a separate encrypted reset outbox. The HTTP runtime uses separate DML credentials and checks applied migration history, required columns, indexes, foreign keys and checks before enabling configured features. Migrations remain a separate explicit CLI with TLS, database-scoped locks, immutable checksums and inspected recovery. CI targets disposable MariaDB 10.11 and 11.4; CRM passes the [verified CRM CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864). Recovery 0.9 CI is pending. See [database](DATABASE.md) and [private administrator setup](auth-admin.md).

## Planned application

- Frontend: modularize the approved HTML/CSS/JavaScript interface while preserving its design; deliver the mobile-first PWA over HTTPS.
- API: Node.js 24; request validation; centralized policy enforcement and granular authorization.
- Initial updates: authenticated REST and bounded polling while visible; evaluate a persistent connection after measuring host limits and actual needs.
- Database: dedicated MariaDB schema on Infomaniak, using migrations committed to Git.
- Media: non-public file/object storage with per-request authorization and short-lived download permissions.
- Background queue: durable MariaDB jobs and bounded batches for bulk sends and notifications.
- Web Push: VAPID keys as deployment secrets, never in the public Git repository except the public key.
- Email: transactional verification and recovery via a provider approved for the use case.
- Installation: manifest, appropriate PNG icons and service worker caching **only** public static assets; never cache private media or messages.
- Localization: French/English from the outset; extensible translation keys.

## Logical entities

- `users`: account identity, account status and policy flags.
- `invitations`: hashed token, created by, expiry, consumed/revoked status.
- `age_assurance`: minimal necessary verification status/reference without ID copies.
- `sessions`: revocable, secure browser sessions.
- `admin_mfa`, `admin_recovery_codes`, `auth_session_state`, `auth_rate_limits`: implemented administrator authentication state.
- `client_auth_state`, `email_verifications`, `client_session_state`, `mail_outbox`: implemented client onboarding, restricted sessions and encrypted verification jobs.
- `client_password_resets`, `password_reset_outbox`: implemented version/email-bound client reset challenges and separate encrypted delivery jobs.
- `conversations`: only a client and a permitted creator/admin.
- `messages`, `chat_receipts`, `chat_events`: implemented encrypted text, sender-scoped idempotency, monotonic read receipts and deletion synchronization.
- `media_assets`: implemented owner-scoped digest/deduplication, private encrypted storage handle, normalized dimensions, deletion state.
- `message_media`: implemented one-image-per-message references; the message and conversation bind each delivery.
- `crm_profiles`: implemented owner/conversation-scoped nickname, encrypted notes, reminder date, optimistic version and internal note-encryption revision.
- `crm_labels`: implemented owner-scoped tags/groups with normalized names and optimistic versions.
- `crm_memberships`: implemented composite-owner bindings between a client profile and its private labels.
- Saved automatic segments: planned recipient-selection rules, separate from current explicit group memberships.
- `campaigns` and `campaign_recipients`: bulk send idempotency and delivery status.
- `notification_subscriptions`: user/device Push subscriptions with consent.
- `tasks` and `audit_events`: limited operational tracking.

Subject to data minimization, retention and legal review before schema stabilization.

## Private CRM boundary

`JESSIEMESSAGE_ENABLE_CRM=1` requires enabled chat and a distinct 32-byte `JESSIEMESSAGE_CRM_KEY`; the key must differ from MFA, mail, message and any supplied media key. CRM assets and endpoints require the administrator host cookie and a current MFA session. Database hooks recheck the actor and assigned conversation inside each transaction. The client chat module does not import the CRM module or request its data.

Profile updates replace nickname, notes, reminder and memberships atomically against an expected version. Notes use AES-256-GCM bound to the administrator, conversation and internal `notes_revision`. Explicit saves advance both versions. Removing a label advances affected profile versions, while retaining the note revision and ciphertext so notes still decrypt and stale drafts conflict. Public DTOs never expose this internal revision or ciphertext.

The contacts query searches pseudonym, nickname and email as literal substrings and combines tag/group, live access, unread and reminder filters. Results contain no email or notes; only the private selected profile includes them. Pages use stable conversation-ID cursors and bounded batch label reads. The reminder is a date used by filters, with no background notification job. Full contracts and operational limits are in [private-crm.md](private-crm.md).

## Client recovery boundary

`JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY=1` requires enabled access and SMTP configuration. It reuses `JESSIEMESSAGE_MAIL_KEY`; purpose-specific AES-GCM authenticated context prevents verification and password-reset payloads from being interchanged. Reset jobs use their own table and worker purpose. Each worker sends sequentially; enabling both permits at most two concurrent sends in one process. Delivery remains at least once, and a revocation after a job is claimed may still deliver a now-unusable link.

A recovery request returns a generic accepted response for eligible and ineligible addresses. Database transactions lock the current user, client authentication state and reset challenge. A challenge binds a SHA-256 token digest to the current credential version and canonical email hash, with a 30-minute expiry. Reissuing cancels older outstanding links/jobs without changing the password or sessions. Successful consumption changes the password, advances the credential version, consumes the chosen challenge, revokes other links and all client sessions, and cancels reset jobs in one transaction. Current status, email proof and the snapshots are checked again after password hashing. No session or chat/access gate is created.

The public enabled-only `/recover` page reads the canonical token from a fragment, removes the fragment/query before API calls, and keeps the token only in memory. Page loads never inspect or consume the challenge. Only explicit same-origin JSON submission completes a reset. APIs refuse query parameters and return fixed DTOs with no email, token or account ID. Persistent HMAC rate buckets and the existing bounded scrypt queue constrain abuse. See [client-recovery.md](client-recovery.md) for precise scope and remaining operational work.

## Hosting and deployment

- Source: public GitHub repository; **no** production secrets or user data.
- CI: non-privileged tests on GitHub Actions; no automatic deployment from untrusted branches.
- Hosting target: separate Infomaniak Node.js 24 site at jessiemessage.com; runtime configuration and deployment remain to be verified.
- Code deploy only from a reviewed release. Database migrations and storage backups are separate operations.
- Existing ZTIKIX deployment and database must remain untouched.
- Validate memory, connection limits, file storage, background processes and WebSockets on shared hosting with actual load tests.
- A service outage or a compromised shared hosting account can affect other sites; consider separate hosting for mature production.

## Next implementation order

1. Freeze key architecture and privacy assumptions.
2. Schema migrations + test database (all synthetic data).
3. Administrator authentication/recovery, invitations, client onboarding and opt-in client password recovery implemented; master-key rotation remains separate launch work.
4. Configure/test real SMTP, connect independently verified age assurance, and complete HTTPS acceptance; client password recovery is implemented with its CI pending.
5. One-to-one text chat implemented; browser/HTTPS acceptance, retention/export and key-rotation tooling remain release work.
6. Private photo upload/gallery and per-delivery audit implemented; retention/orphan cleanup, restore and storage load acceptance remain release work.
7. Private tags/groups, notes and reminders implemented; current CRM CI verified. Next: queued individual bulk sends and operational tasks.
8. Web Push notifications and PWA installation.
9. Legal pages, i18n, pen-testing, restore and load tests.
10. Controlled production rollout.

**Do not** deploy real user chat functionality ahead of the legal and security gates.
