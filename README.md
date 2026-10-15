# JessieMessage

Invitation-only private messaging PWA. Public source, private user data.

> **Current development: server availability 0.13.0 + Nuit workbench 0.3.1.** This lot adds bounded admission before private SQL, upload admission before body collection, persistent read budgets, cancellable SMTP sockets and a shared shutdown deadline. The final 0.13 CI evidence is pending. The [verified 0.12 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38663130943) passed 711 general tests and 245 real tests per MariaDB version. `contact@jessiemessage.com` remains the official contact, sender and reply address. Hosting, actual mail delivery, age assurance, storage/restore readiness and HTTPS/mobile acceptance remain launch work; no deployment has occurred.

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
- [Audit findings, current state and launch plan](docs/NEXT-STEPS.md)

## Maintainer checks

Node.js 24. Runtime and migration credentials are separate; migrations never run on server startup. Run `npm ci --ignore-scripts` to install the pinned lockfile. `npm run check` validates syntax, `npm test` runs unit/HTTP/model tests (database integration is opt-in), and `npm run build` generates the self-contained offline preview. CI targets disposable MariaDB 10.11 and 11.4, real HTTP flows and DML-only runtime privileges. Eighteen database groups run sequentially, including separate broadcast chat hooks, campaign persistence and real HTTP flows. Version 0.12 implementation `0cf3b0faf9d95f49c6dc3ad963f05f08b0cb2fd9` passes the [verified 0.12 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38663130943) under Node.js 24.21.0 with 711 general tests (18 DB wrappers explicitly skipped without a database) and 245 real tests without skips on each MariaDB version. The [draft PR #11](https://github.com/fredbuhr/jessiemessage/pull/11) remains stacked on #10. CRM ownership, ciphertext, version conflicts, filters and revocation are covered by the earlier [verified 0.8 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864). Only the three explicit public preview files are uploaded. Static checks are not browser or accessibility certification.

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
