# Technical architecture — draft

## Current runtime — 18 October 2026

Application 0.50 (`0a1cafd8`, schema 30) serves the primary and retained recipe origins with invitations, private text/photos, durable administrator/client sessions, Web Push, primary-only client recovery, private CRM and individually delivered campaigns. Recipients have no separate broadcast opt-in. The retained recipe shares the application's runtime and data; it is not an isolated staging database.

The active 0.54.0 runtime and supervisor share source `6cfce890` (tree `9308cb4d`) in one pinned checkout. The complete application and independent probe history are consolidated into main without rewriting older branches; the probe files are preserved. Daily coherent encrypted checkpoints remain at 05:15 UTC, with minute journal observations and a private atomic FIFO for incident/recovery SMTP delivery. The owner confirmed both synthetic emails received on 18 October at 15:54 Europe/Paris; prior negative IMAPS checks retain their historical scope. PC decryption of the new archive and recurring independent copy remain open. See [release and evidence](stable-release-054.md), [mail semantics](backup-email-alerts-053.md), [recovery entry point](REPRISE.md) and [operational plan](production-readiness-2026-10-17.md). The sections below describe historical scope where a version is named.

## Historical development: media capacity and private inventory

Version 0.15 adds a durable storage journal and a singleton capacity lock, with file-length quotas bound to the configured private directory and ceilings. Acknowledged reservations precede writes; metadata registration and journal transitions share a transaction. Uncertain proposals and failed erasures remain charged, with release only after durable unlink. A bounded read-only inventory gates explicit offline initialization of all historical assets. Its envelope checks are structural, not GCM authentication. See [protocol, operator procedure and remaining recovery work](media-capacity-inventory.md).

Version 0.14 adds exact-expiry compare-and-set renewal for already-approved, finite client access. It preserves the first approval, conversation ownership, credentials and sessions. Administrator client/invitation lists use descending creation-time/id keyset pages with exact SQL microseconds and bounded browser state. Current session proofs and persistent user/global budgets apply. See [renewal rules, pagination and validation](access-renewal-pagination.md).

Version 0.13 adds bounded in-memory admission before private SQL, persistent chat/library read budgets and upload admission before collecting a body. Owned SMTP sockets make verification and shutdown cancellation effective; all producers stop before draining HTTP and SQL, with a five-second grace and fifteen-second total process budget. See [limits, shutdown and validation](server-availability.md).

Version 0.12 binds private browser state to the current user, role and session CSRF, checks identity before adopting private responses and prevents old operations from altering a newer page/session. It fixes recovery availability after transient errors and access administration cleanup when hidden. A bounded administrator activity feed contains the latest 20 campaigns plus all active campaigns (maximum 10), while the complete archive remains paginated. See [behavior, regression coverage and limits](private-ui-reliability.md). No migration, dependency, encryption key or approved identity asset changes in this lot.

A Node.js 24 HTTP server serves a neutral bilingual landing page and liveness endpoint by default. Private flags enable administrator MFA and then invitations, registration, email verification and separate restricted client sessions. Verification and optional password-reset workers start with the listener. They share one SMTP transport; shutdown stops all producers immediately, drains already-started work and cancels remaining connections after the grace period. The pool closes after asynchronous handlers and producers, or the CLI exits with an uncertain-result failure at the global deadline. An age declaration never opens access. The current `manual_invitation` policy requires a consumed invitation, verified email and explicit administrator admission; it does not fabricate independent age assurance. A separate chat flag enables private text conversations, transactional authorization and encrypted message bodies. An additional media flag enables normalized JPEG photo storage, encrypted outside the checkout, with per-request owner/delivery authorization. CRM 0.8 adds administrator-only profiles, tags/groups and filtered contacts behind its own flag/key; it requires chat, while media remains optional. Recovery 0.9 requires enabled access/mail and adds no dependency on chat, media or CRM. External provider integrations remain pending.

Version 0.10 centralizes `contact@jessiemessage.com` as the public site contact and official-domain From, Reply-To and SMTP-envelope identity. It also adds administrator preparation routes whenever private administrator authentication is enabled, including before client access is configured. The default server exposes neither these routes nor their assets. Mail configuration is parsed for an enabled administrator server; an enabled but invalid mail configuration fails startup. No new dependency or migration is added; the schema remains at 22 migrations. The [verified 0.10 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38657493833) passes, including a fifteenth sequential database group for its authenticated HTTP flow.

Version 0.11 adds individually delivered broadcasts behind an additional flag requiring CRM. Clients opt in themselves; immutable approvals survive logout, while delivery rechecks current access, consent, ownership and MFA in the same transaction as message/event/recipient persistence. The [verified 0.11 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38659783930) passes 624 general tests and 243 real tests per MariaDB version. Production hosting and device acceptance remain pending.

At stage 0.15, twenty-seven migrations provided those foundation and administrator tables plus client authentication, email verification, client session state, an encrypted mail outbox, messages, per-participant read receipts and per-conversation change events, owner media assets, audited message attachments, three CRM tables, hashed client reset challenges a separate encrypted reset outbox, client broadcast preferences, encrypted immutable campaigns and durable recipients, plus persistent media capacity state and a storage-object journal. The HTTP runtime uses separate DML credentials and checks applied migration history, required columns, indexes, foreign keys and checks before enabling configured features. Migrations remain a separate explicit CLI with TLS, database-scoped locks, immutable checksums and inspected recovery. CI targets disposable MariaDB 10.11 and 11.4; CRM passes the [verified CRM CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864). Recovery 0.9 passes the [verified recovery CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255). See [database](DATABASE.md) and [private administrator setup](auth-admin.md).

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
- `push_subscriptions` and `push_outbox`: implemented user/device Push subscriptions, encrypted delivery configuration and durable jobs with consent.
- Additional generic `tasks` and `audit_events` tables are planned concepts; they are not physical tables in the current schema.

Subject to data minimization, retention and legal review before schema stabilization.

## Private CRM boundary

`JESSIEMESSAGE_ENABLE_CRM=1` requires enabled chat and a distinct 32-byte `JESSIEMESSAGE_CRM_KEY`; the key must differ from MFA, mail, message and any supplied media key. CRM assets and endpoints require the administrator host cookie and a current MFA session. Database hooks recheck the actor and assigned conversation inside each transaction. The client chat module does not import the CRM module or request its data.

Profile updates replace nickname, notes, reminder and memberships atomically against an expected version. Notes use AES-256-GCM bound to the administrator, conversation and internal `notes_revision`. Explicit saves advance both versions. Removing a label advances affected profile versions, while retaining the note revision and ciphertext so notes still decrypt and stale drafts conflict. Public DTOs never expose this internal revision or ciphertext.

The contacts query searches pseudonym, nickname and email as literal substrings and combines tag/group, live access, unread and reminder filters. Results contain no email or notes; only the private selected profile includes them. Pages use stable conversation-ID cursors and bounded batch label reads. The reminder is a date used by filters, with no background notification job. Full contracts and operational limits are in [private-crm.md](private-crm.md).

## Client recovery boundary

`JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY=1` requires enabled access and SMTP configuration. It reuses `JESSIEMESSAGE_MAIL_KEY`; purpose-specific AES-GCM authenticated context prevents verification and password-reset payloads from being interchanged. Reset jobs use their own table and worker purpose. Each worker sends sequentially; enabling both permits at most two concurrent sends in one process. Delivery remains at least once, and a revocation after a job is claimed may still deliver a now-unusable link.

A recovery request returns a generic accepted response for eligible and ineligible addresses. Database transactions lock the current user, client authentication state and reset challenge. A challenge binds a SHA-256 token digest to the current credential version and canonical email hash, with a 30-minute expiry. Reissuing cancels older outstanding links/jobs without changing the password or sessions. Successful consumption changes the password, advances the credential version, consumes the chosen challenge, revokes other links and all client sessions, and cancels reset jobs in one transaction. Current status, email proof and the snapshots are checked again after password hashing. No session or chat/access gate is created.

The public enabled-only `/recover` page reads the canonical token from a fragment, removes the fragment/query before API calls, and keeps the token only in memory. Page loads never inspect or consume the challenge. Only explicit same-origin JSON submission completes a reset. APIs refuse query parameters and return fixed DTOs with no email, token or account ID. Persistent HMAC rate buckets and the existing bounded scrypt queue constrain abuse. See [client-recovery.md](client-recovery.md) for precise scope and remaining operational work.

## Site mail identity and preparation boundary

`server/site.mjs` defines the public contact address and recognizes only canonical HTTPS origins at `jessiemessage.com` or its subdomains. Mail remains opt-in. An omitted SMTP From defaults to the contact address; an explicitly empty or invalid value fails. An official origin rejects a different sender, including on manually constructed transport configuration. Nonofficial origins may use explicit synthetic senders for isolated tests. Reply-To and SMTP-envelope From always follow the validated sender. SMTP host, port, username, password and the private mail key remain explicit; no address is converted into a credential automatically.

`/admin/readiness` and its assets require the current administrator host cookie. Its summary exposes only the contact identity, fixed feature booleans and remaining acceptance checks. It contains no SMTP hostname, credentials, filesystem paths, database configuration or keys. The SMTP POST accepts only an empty JSON object, checks exact Origin and current CSRF before reading its bounded body, and uses persistent keyed rate limits. Verification is limited to one active call per service process, ten calls per minute globally and three per fifteen minutes per administrator.

Each verification creates a separate transport, calls Nodemailer's `verify()` with a 20-second wall deadline, and closes that instance on success, error or timeout. It never sends mail and never closes the workers' shared delivery transport. The administrator session is checked again after network work and cleanup, so a session revoked during the request receives no success proof. A successful DTO reports `smtp_authentication` and `delivery: not_checked`; it is not stored as a delivery or publication approval. The UI clears its temporary result when hidden or signed out, reloads the session on return, and does not automatically repeat this network action after a CSRF refresh. See [mail-readiness.md](mail-readiness.md).

## Hosting and deployment

- Source: public GitHub repository; **no** production secrets or user data.
- CI: non-privileged tests on GitHub Actions; no automatic deployment from untrusted branches.
- Hosting: Infomaniak Node.js 24 is active on `recette.jessiemessage.com`; current configuration, constraints and served assets are verified. The final origin `jessiemessage.com`, device transition and launch acceptance remain planned.
- Code deploy only from a reviewed release. Database migrations and storage backups are separate operations.
- Existing ZTIKIX deployment and database must remain untouched.
- Validate memory, connection limits, file storage, background processes and WebSockets on shared hosting with actual load tests.
- A service outage or a compromised shared hosting account can affect other sites; consider separate hosting for mature production.

## Next implementation order

1. Freeze key architecture and privacy assumptions.
2. Schema migrations + test database (all synthetic data).
3. Administrator authentication/recovery, invitations, client onboarding and opt-in client password recovery implemented; master-key rotation remains separate launch work.
4. Private email preparation tools in development 0.10 pass the [verified 0.10 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38657493833). Verify the actual mailbox/DNS, SMTP and reception separately, connect independently verified age assurance, and complete HTTPS acceptance. Client recovery passed the historical [verified 0.9 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255).
5. One-to-one text chat implemented; browser/HTTPS acceptance, retention/export and key-rotation tooling remain release work.
6. Private photo upload/gallery and per-delivery audit implemented; retention/orphan cleanup, restore and storage load acceptance remain release work.
7. Private tags/groups, notes and reminders implemented; current CRM CI verified. Next: queued individual bulk sends and operational tasks.
8. Web Push notifications and PWA installation.
9. Legal pages, i18n, pen-testing, restore and load tests.
10. Controlled production rollout.

**Do not** deploy real user chat functionality ahead of the legal and security gates.

## Individual broadcast queue (0.11)

An additional explicit flag enables `/admin/broadcasts`, private campaign APIs and client-owned consent controls. Confirmation freezes at most 100 explicitly selected CRM conversations, an encrypted payload and stable per-recipient message IDs. The queue contains no raw session token. Current administrator status/MFA, assignment, recipient access, consent and media are checked under SQL locks again before ordinary chat insertion. A durable approval survives logout; cancellation removes outstanding work and a changed MFA epoch terminally pauses it. No shared audience metadata enters client DTOs.

The sequential worker shares normal chat quotas, defers rate-limited work without burning failures, reclaims expired leases and commits message/event/recipient together. Listener startup starts work; graceful shutdown awaits it before closing the pool. No email, Push or browser polling is required for server delivery. The preparation inventory includes the additional feature flag. See [contract and limitations](targeted-broadcasts.md).
