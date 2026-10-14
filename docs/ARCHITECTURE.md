# Technical architecture — draft

## Current development: public placeholder plus database foundation

A minimal zero-dependency Node.js 24 HTTP server serves **only** a neutral static, bilingual landing page and `/api/health`. This deliberately does not contain registration, chat, storage or authentication endpoints.

The initial code is **not** a production chat service.

The first server lot supplies four versioned MariaDB migrations (`users`, `invitations`, `sessions`, `conversations`) and an explicit migration CLI. This CLI alone imports the official connector; the HTTP server has no DB connection or migration-on-startup side effect. Migration operations require an exact dedicated database confirmation, TLS by default, a database-scoped advisory lock, immutable SHA-256 history and manual resolution of interrupted DDL. Integration tests run on disposable MariaDB 10.11 and 11.4 schemas. See `docs/DATABASE.md`. Session and invitation tables are storage groundwork, not implemented authentication.

## Planned application

- Frontend: React + TypeScript + Vite (mobile-first PWA), delivered over HTTPS.
- API: Node.js 24; request validation; centralized policy enforcement and granular authorization.
- Real-time: authenticated Socket.IO or equivalent after evaluating host limits.
- Database: dedicated MariaDB schema on Infomaniak, using migrations committed to Git.
- Media: non-public file/object storage with per-request authorization and short-lived download permissions.
- Background queue: process bulk sends and notification deliveries in bounded batches.
- Web Push: VAPID keys as deployment secrets, never in the public Git repository except the public key.
- Email: transactional verification and recovery via a provider approved for the use case.
- Installation: manifest, appropriate PNG icons and service worker caching **only** public static assets; never cache private media or messages.
- Localization: French/English from the outset; extensible translation keys.

## Logical entities

- `users`: account identity, account status and policy flags.
- `invitations`: hashed token, created by, expiry, consumed/revoked status.
- `age_assurance`: minimal necessary verification status/reference without ID copies.
- `sessions`: revocable, secure browser sessions.
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
- Production: separate Infomaniak Node.js 24 site at jessiemessage.com.
- Code deploy only from a reviewed release. Database migrations and storage backups are separate operations.
- Existing ZTIKIX deployment and database must remain untouched.
- Validate memory, connection limits, file storage, background processes and WebSockets on shared hosting with actual load tests.
- A service outage or a compromised shared hosting account can affect other sites; consider separate hosting for mature production.

## Next implementation order

1. Freeze key architecture and privacy assumptions.
2. Schema migrations + test database (all synthetic data).
3. Secure admin authentication and inviting.
4. Email verification, age-assurance integration and account onboarding.
5. One-to-one text chat with strict per-conversation access checks.
6. Private file upload, per-recipient media audit and retention controls.
7. Tags, segments, bulk sends and tasks.
8. Web Push notifications and PWA installation.
9. Legal pages, i18n, pen-testing, restore and load tests.
10. Controlled production rollout.

**Do not** deploy real user chat functionality ahead of the legal and security gates.
