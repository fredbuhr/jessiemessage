# JessieMessage

Invitation-only private messaging PWA. Public source, private user data.

**Resume development:** the [15 October recovery audit](docs/AUDIT-REPRISE-2026-10-15.md) fixes the audit reference at 0.16 (`0ecb31e`). The [chat correction](docs/chat-stable-history.md) preserves unchanged controls/photos. [0.17a supervision](docs/operations-readiness.md) adds cached service availability, safe worker events and private capped queue observations. [0.17b private data tools](docs/private-data-export.md) add an offline operator inventory and client-content export. [0.17c deletion simulation](docs/data-deletion-rollback.md) adds scoped dependency observations and history compatibility regressions. [The application entry](docs/pwa-entry.md) now connects installed launches to the existing private routes. [Private interface translations](docs/private-ui-languages.md) now cover the served client and administrator journeys. Retention decisions, destructive execution and real rollback acceptance remain open.

> **Hosted state: neutral HTTPS rechecked, recipe migrations applied (application 0.24.0, stage 0.25).** The existing Infomaniak Node.js project serves [jessiemessage.com](https://jessiemessage.com/) from revision `55fb30aa191fb75f898e5818324c4ec35341ac74`. After an unexpected 502 and a tool disconnection, Chrome and seven hosted HTTPS GETs succeeded again at 15:26:39 and 15:39:51 UTC on 15 October, without a restart. The cause of the earlier 502 remains unknown; this bounded check does not establish long-term availability. All eight private flags remain disabled. A dedicated empty database was then created without users; the Manager reports MariaDB 10.11.19, and a certificate-verified TLS 1.3 handshake succeeded. At 17:05:47 UTC, the owner ran the reviewed memory-only migrator at `3a52a9e014e5f20a72be3e29521817dc822edb1f`: the saved report confirms 27/27 applied, verified Node SQL transport and engine, and a conforming final history. The runtime SQL connection, persistence across provider redeployments and administrator setup remain unverified. See [hosted evidence](docs/first-hosted-start.md) and [SQL preparation](docs/hosted-database-preparation.md). `contact@jessiemessage.com` remains the official address.

**Hosting follow-up — stages 0.23–0.25:** the [initial inventory](docs/hosting-inventory-2026-10-15.md) and [first start](docs/first-hosted-start.md) preserve the earlier observations. The [SQL preparation](docs/hosted-database-preparation.md) records the later empty database, TLS proof and outstanding least-privilege requirements. The existing Node capacity is 1/1; the temporary alias serves the same process. No private client service is open. **Migration follow-up:** the owner has since created the dedicated migration user; the [masked credential input and migration wrapper](docs/private-migration-configuration.md) prepare explicit execution with credentials held only in memory. The owner has now completed execution; its saved non-secret report was independently read and validated. The migration sub-step is complete; stage 0.25 continues with runtime privileges and persistent private storage.

**Runtime follow-up — stage 0.25:** the [remaining hosted prerequisites](docs/hosted-runtime-prerequisites.md) record the Manager limitations observed. At the owner’s request, the support route was abandoned without sending a message. The default SQL preflight rejects ledger writes, other named scopes and database-wide grants; it still does not certify all effective privileges. The [explicit Infomaniak SQL profile and anchored Linux private paths](docs/infomaniak-runtime-profile.md) now provide an implementation adapted to the documented offer, keeping strict modes as defaults and declaring the writable ledger honestly. The runtime account has since been created with read/write permissions only; its actual SQL connection remains to be checked through the [masked private runtime configuration](docs/private-runtime-configuration.md). Administrator activation remains pending.

## Try without a terminal

Open the latest successful **CI** run on the development branch in GitHub Actions. Download **JessieMessage-apercu-…**, extract it and open **JessieMessage.html** in a browser.

Explore Welcome, Messages and Admin. The client gets one simple conversation. Admin tools include messages, media library, bulk sends and access management, plus fictional invitations, groups, tags and notes. All data resets on reload. The client/admin switch is a preview control, not authentication.

The Nuit theme uses warm black, plum, burgundy and champagne. Mobile chat follows the visible screen height; desktop has a secondary portrait/gallery panel. Photos supplied for private review are **not** included in this repository or its build artifacts. The Photo button loads a reference locally.

- [Approved identity and exact PNG assets](docs/IDENTITE-VALIDEE.md)
- [Nuit V2 delivery, design and test scope](docs/NUIT-V2.md)
- [Previous management workbench V0.2](docs/WORKBENCH-V02.md)
- [Product scope](docs/PRODUCT.md)
- [Planned architecture](docs/ARCHITECTURE.md)
- [Security and privacy launch gates](docs/SECURITY.md)
- [Administrator authentication and private setup](docs/auth-admin.md)
- [Invitations, client access and remaining gates](docs/invitations-client-access.md)
- [Private administrator recovery](docs/admin-recovery.md)
- [Encrypted verification email queue](docs/verification-mail.md)
- [Official contact, private SMTP check and remaining mail acceptance](docs/mail-readiness.md)
- [Opt-in client password recovery](docs/client-recovery.md)
- [Private text messaging and operational limits](docs/private-messaging.md)
- [Private images, gallery and storage setup](docs/private-media.md)
- [Private client files, labels and inbox filters](docs/private-crm.md)
- [Individual broadcasts, consent and durable queue](docs/targeted-broadcasts.md)
- [Private interface corrections and regression coverage](docs/private-ui-reliability.md)
- [Request admission, read/upload budgets and bounded shutdown](docs/server-availability.md)
- [Approved access renewal and complete administrator lists](docs/access-renewal-pagination.md)
- [Media capacity, offline initialization and private inventory](docs/media-capacity-inventory.md)
- [Offline client inventory/export and undecided retention policy](docs/private-data-export.md)
- [Read-only deletion simulation and rollback safeguards](docs/data-deletion-rollback.md)
- [Application entry, installation and role choices](docs/pwa-entry.md)
- [Private interfaces in French and English](docs/private-ui-languages.md)
- [Chat announcements, keyboard focus and Chrome CI](docs/chat-accessibility.md)
- [Offline preproduction configuration, platform and SQL diagnostics](docs/preproduction-preflight.md)
- [Real Chrome/HTTPS/MariaDB authentication rehearsal](docs/authentication-rehearsal.md)
- [Isolated preproduction acceptance](docs/preproduction-acceptance.md)
- [Audit findings, current state and launch plan](docs/NEXT-STEPS.md)

## Maintainer checks

Node.js 24. Runtime and migration credentials are separate; migrations never run on server startup. Run `npm ci --ignore-scripts` to install the pinned lockfile. `npm run check` validates syntax, `npm test` runs unit/HTTP/model tests (database integration is opt-in), and `npm run build` generates the self-contained offline preview. CI targets disposable MariaDB 10.11 and 11.4, real HTTP flows and DML-only runtime privileges. Twenty-three database groups run sequentially, including isolated backup recovery on two disposable schemas, operations readiness, offline client data tools and deletion simulation. Version 0.16 implementation `6a4504a1d5c4d895227f4d258ff8cdfca69b016b` passes the [verified 0.16 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38703160199) under Node.js 24.21.0 with 991 general tests (19 DB wrappers explicitly skipped without a database) and 287 real tests without skips on each MariaDB version. The [draft PR #15](https://github.com/fredbuhr/jessiemessage/pull/15) remains stacked on #14. CRM ownership, ciphertext, version conflicts, filters and revocation are covered by the earlier [verified 0.8 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864). Only the three explicit public preview files are uploaded. A separate `npm run test:browser` job uses the runner’s installed Chrome/ChromeDriver against local synthetic fixtures; it requires those binaries and never silently skips when they are missing. It does not certify a screen reader, mobile OS or production backend. A separate `npm run test:auth-browser` job combines Chrome with the real configured server, loopback HTTPS and disposable MariaDB 10.11; see its isolated prerequisites and limits in the rehearsal guide. Static checks are not accessibility certification.

`npm start` defaults to the original neutral page and liveness endpoint. Private authentication enables administrator access. Additional access/mail flags and SMTP configuration enable invitation tools and `/access`, whose client account remains restricted until its gates are satisfied. Mail workers start with the HTTP listener. With recovery enabled, verification and reset workers share one SMTP transport. Shutdown stops all producers immediately, allows five seconds to drain, then cancels remaining HTTP/SMTP connections, with a fifteen-second total budget including pool closure; a deadline exits with failure and uncertain operations remain recoverable. Enabled authentication refuses startup when configuration or required tables are missing. The design and artifact directories are not served. No changes to Infomaniak, ZTIKIX or `main` are made by this development branch.

With administrator authentication enabled, `/admin/readiness` provides the private **Préparer le site** page, including when client access is disabled. Its optional SMTP verification uses a fresh transport, a 20-second deadline and current administrator authentication; it never uses the delivery workers' shared transport or sends a message. The default contact address does not enable SMTP or provide credentials. See [mail preparation and its exact limits](docs/mail-readiness.md).

## First server foundation

The development branch adds a dedicated MariaDB 10.11+ schema for users, hashed invitations, revocable sessions and one conversation per client. A migration ledger detects source drift and interrupted DDL, serializes migrators with a database-scoped lock and requires explicit recovery. See [database configuration, migration and recovery](docs/DATABASE.md).

`npm run db:migrate -- status` is read-only apart from connection session settings and a temporary advisory lock; `npm run db:migrate -- up` initializes/applies the reviewed schema in an explicitly confirmed dedicated database. No migration runs on server startup. CI uses disposable, synthetic MariaDB 10.11 and 11.4 databases.

Administrator sign-in now combines an exact password with a fresh authenticator code or a single-use recovery code. Sessions use a Secure/HttpOnly host cookie, an eight-hour maximum, a thirty-minute idle timeout, database revocation, strict Origin/CSRF checks and persistent rate limits. The one-time private setup CLI creates no default credentials. See [setup and operational limits](docs/auth-admin.md). Invitations, atomic registration and encrypted verification mail jobs are implemented. Verified email permits a limited client session; active access additionally requires independently recorded age assurance and administrator approval. No API converts an age declaration into verification. The separately enabled text chat checks live conversation ownership, session generation and client gates inside each database transaction. `/messages` gives an active client one conversation; `/admin/messages` gives the assigned administrator a private inbox. An additional media flag/key/private directory enables photo messages, a private gallery and reusable owner assets.

`JESSIEMESSAGE_ENABLE_CRM=1` requires chat and a separate `JESSIEMESSAGE_CRM_KEY`; media is optional. The key must differ from MFA, mail, message and any configured media key. Three additional reviewed migrations (`0018`–`0020`) supply private profiles, labels and memberships. Only a current assigned administrator can read or edit a client file: up to 8,000 characters of encrypted notes, 32 labels and a private reminder date. Labels allow 100 tags and 100 groups per administrator. Search and tag/group, access, unread and reminder filters apply on the server. Dates do not trigger notifications; groups do not create shared rooms. Individual broadcasts are separately enabled; Web Push remains a later milestone.

`JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY=1` requires enabled access and its mail configuration, independently of chat, media or CRM. It reuses the private mail key with cryptographically distinct verification/reset purposes. Two new reviewed migrations (`0021`–`0022`) provide hashed reset challenges and a separate encrypted outbox. An eligible email-verified pending or active client receives a single-use, 30-minute link. A successful reset atomically changes the password and revokes all client sessions; it grants no session or access. Opening the link consumes nothing. See [configuration, transaction guarantees and remaining release work](docs/client-recovery.md).

`JESSIEMESSAGE_ENABLE_BROADCAST=1` requires the CRM and therefore active chat/access configuration. Three new migrations (`0023`–`0025`) store client preferences, encrypted immutable campaigns and durable recipients. Preferences default to false and only the client can change them. The worker reuses the message key with a separate cryptographic purpose and shares normal chat send quotas. A confirmed campaign continues after logout, while current administrator status/MFA changes, recipient opt-out, expiry or revocation prevent further delivery. See [configuration, guarantees and release limits](docs/targeted-broadcasts.md).

## Data rules

Never commit real messages, client data, private media, passwords, API keys, production logs or database dumps. Development uses fictional data. The 18+ declaration is not reported as verified adulthood. Legal pages and production privacy/access controls remain unfinished.

## License

No open-source license has been granted. Public repository visibility does not itself grant permission to reuse the source code.
