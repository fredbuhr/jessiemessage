# JessieMessage

Invitation-only private messaging PWA. Public source, private user data.

> **Current delivery: private images 0.7.0 + Nuit workbench 0.3.1.** Explicit configuration enables private text/photo messages, a conversation gallery and a reusable owner library. Photos are normalized without source metadata, encrypted outside the checkout and served only after live authorization. The offline preview remains fictional. Real SMTP, age-assurance integration and HTTPS/mobile acceptance remain launch work; no automatic Infomaniak deployment.

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
- [Private text messaging and operational limits](docs/private-messaging.md)
- [Private images, gallery and storage setup](docs/private-media.md)

## Maintainer checks

Node.js 24. Runtime and migration credentials are separate; migrations never run on server startup. Run `npm ci --ignore-scripts` to install the pinned lockfile. `npm run check` validates syntax, `npm test` runs the preview and authentication tests (database integration is opt-in), and `npm run build` generates the self-contained offline preview. CI runs the disposable MariaDB migration and authentication groups sequentially on 10.11 and 11.4, including a real HTTP/login/session/logout flow and DML-only runtime privileges. Only the three explicit public preview files are uploaded. Test results depend on the actual CI run; static checks are not a browser or accessibility certification.

`npm start` defaults to the original neutral page and liveness endpoint. Private authentication enables administrator access. Additional access/mail flags and SMTP configuration enable invitation tools and `/access`, whose client account remains restricted until its gates are satisfied. The mail worker starts with the HTTP listener and stops before the pool closes. Enabled authentication refuses startup when configuration or required tables are missing. The design and artifact directories are not served. No changes to Infomaniak, ZTIKIX or `main` are made by this development branch.

## First server foundation

The development branch adds a dedicated MariaDB 10.11+ schema for users, hashed invitations, revocable sessions and one conversation per client. A migration ledger detects source drift and interrupted DDL, serializes migrators with a database-scoped lock and requires explicit recovery. See [database configuration, migration and recovery](docs/DATABASE.md).

`npm run db:migrate -- status` is read-only apart from connection session settings and a temporary advisory lock; `npm run db:migrate -- up` initializes/applies the reviewed schema in an explicitly confirmed dedicated database. No migration runs on server startup. CI uses disposable, synthetic MariaDB 10.11 and 11.4 databases.

Administrator sign-in now combines an exact password with a fresh authenticator code or a single-use recovery code. Sessions use a Secure/HttpOnly host cookie, an eight-hour maximum, a thirty-minute idle timeout, database revocation, strict Origin/CSRF checks and persistent rate limits. The one-time private setup CLI creates no default credentials. See [setup and operational limits](docs/auth-admin.md). Invitations, atomic registration and encrypted verification mail jobs are implemented. Verified email permits a limited client session; active access additionally requires independently recorded age assurance and administrator approval. No API converts an age declaration into verification. The separately enabled text chat checks live conversation ownership, session generation and client gates inside each database transaction. `/messages` gives an active client one conversation; `/admin/messages` gives the assigned administrator a private inbox. An additional media flag/key/private directory enables photo messages, a private gallery and reusable owner assets. CRM, bulk sends and Web Push remain separate milestones.

## Data rules

Never commit real messages, client data, private media, passwords, API keys, production logs or database dumps. Development uses fictional data. The 18+ declaration is not reported as verified adulthood. Legal pages and production privacy/access controls remain unfinished.

## License

No open-source license has been granted. Public repository visibility does not itself grant permission to reuse the source code.
