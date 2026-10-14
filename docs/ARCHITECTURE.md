# Technical architecture — draft

## Current development: opt-in administrator authentication

A Node.js 24 HTTP server serves a neutral bilingual landing page and liveness endpoint by default. With explicit private configuration it adds administrator login, MFA and revocable MariaDB sessions. Client registration, chat and media routes remain pending.

The initial code is **not** a production chat service.

Eight migrations provide the original users/invitations/sessions/conversations tables plus MFA, recovery codes, session state and anti-abuse counters. The HTTP runtime uses separate DML credentials and checks applied migration history, required columns and keys before enabling authentication. Migrations remain a separate explicit CLI with TLS, database-scoped locks, immutable checksums and inspected recovery. CI covers disposable MariaDB 10.11 and 11.4, including a real authentication flow. See [database](DATABASE.md) and [private administrator setup](auth-admin.md).

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
- `conversations`: only a client and a permitted creator/admin.
- `messages`: sender, recipient conversation, kind, timestamps and deletion state.
- `media_assets`: content digest, storage handle, dimensions, MIME, owner.
- `message_media`: per-message references to reusable media assets.
- `tags` and `user_tags`: private internal labels.
- `segments` and `segment_members`: private admin-managed recipient sets.
- `campaigns` and `campaign_recipients`: bulk send idempotency and delivery status.
- `notification_subscriptions`: user/device Push subscriptions with consent.
- `tasks` and `audit_events`: limited operational tracking.

Subject to data minimization, retention and legal review before schema stabilization.

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
3. Administrator authentication implemented; complete recovery/rotation and add invitations.
4. Email verification, age-assurance integration and account onboarding.
5. One-to-one text chat with strict per-conversation access checks.
6. Private file upload, per-recipient media audit and retention controls.
7. Tags, segments, bulk sends and tasks.
8. Web Push notifications and PWA installation.
9. Legal pages, i18n, pen-testing, restore and load tests.
10. Controlled production rollout.

**Do not** deploy real user chat functionality ahead of the legal and security gates.
