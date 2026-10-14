# JessieMessage

**Invitation-only private messaging PWA** — project website: [jessiemessage.com](https://jessiemessage.com)

> **Development status: initial scaffold only.** No logins, invitations, messaging, photo exchange, age checks or client data are enabled yet. Do not use this branch as a production messaging platform.

## What this repository contains today

- Minimal Node.js 24 HTTP server, with zero runtime npm dependencies.
- Mobile-friendly, neutral French/English public placeholder.
- PWA web manifest and provisional SVG icon.
- Basic browser-facing security headers, explicit public file allowlist, health check.
- GitHub Actions syntax checks and HTTP tests.

## Product vision

JessieMessage will provide private one-to-one conversations between Jessie and invited clients. Admin-only tools will manage expiring invitations, private tags and groups, scheduled tasks, targeted bulk messages and a media library tracking what was delivered to each client. All bulk deliveries should appear as individual conversations, never shared group chats. The application will have no in-app payments or public gallery.

**Read before developing:**

- [Product scope and milestones](docs/PRODUCT.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Security and privacy launch gates](docs/SECURITY.md)

## Running and deploying

The initial scaffold has no dependencies. It starts using `npm start` on Node.js 24 and listens on `process.env.PORT` (default: 3000). `npm test` verifies its public routes and security headers; `npm run build` verifies syntax. The GitHub Actions workflow runs these checks automatically.

**Production deployment is not automated yet.** The Infomaniak Node.js site already exists separately; no changes to Infomaniak or ZTIKIX are made by GitHub commits or pull requests. Only deploy reviewed versions when the required legal and security mechanisms are in place.

## Important repository rules

- Public code, private data: never commit personal information, real messages, photos, database dumps, authentication tokens, passwords or server access credentials.
- All automated tests use synthetic data.
- Real user onboarding and intimate media handling must remain disabled until applicable legal age controls, hosting terms, permissions, privacy information and security checks are completed.
- All code changes should be reviewed in pull requests before merging into `main`.

## License

No open-source license has been granted. Public repository visibility does not itself grant permission to reuse the source code.
