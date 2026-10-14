# JessieMessage

Invitation-only private messaging PWA. Public source, private user data.

> **Development status: interactive workbench V0.2, not a production messenger.** No real accounts, database connection, messaging delivery, email or push notifications are enabled. No automatic deployment to Infomaniak.

## Try the interface without a terminal

Open the latest successful **CI** run on the development branch in GitHub Actions. Download the artifact named **JessieMessage-apercu-…**, extract it and open **JessieMessage.html** in your browser.

The self-contained preview includes Welcome, Client view and Administration. The admin workspace has Messages / Media library / Broadcast / Access. It supports fictional conversations, emojis, media history, private notes and tags, manual groups, one-time invitation simulation, access expiry/suspension and targeted deliveries with duplicate protection.

Everything is kept in memory and resets on reload. Example invitation links are inactive. No real clients or intimate files belong in this workshop. The client/admin switch is a presentation control, **not authentication**.

- [V0.2 delivery notes and checks](docs/WORKBENCH-V02.md)
- [Product scope](docs/PRODUCT.md)
- [KISS direction and initial design](docs/DESIGN-KISS.md)
- [Planned architecture](docs/ARCHITECTURE.md)
- [Security and privacy launch gates](docs/SECURITY.md)

## Code and checks

The neutral public placeholder remains served by a minimal Node.js 24 HTTP server with no runtime npm dependencies. It serves only explicit public files and a health endpoint; `design/` and generated `artifacts/` are not publicly served.

- `npm start`: start the placeholder using `PORT` (default 3000).
- `npm run check`: verify JavaScript syntax.
- `npm test`: run 28 tests on the placeholder and workshop rules.
- `npm run build`: assemble the downloadable, offline HTML workbench.

GitHub Actions performs these checks and prepares the download automatically. These commands are for maintainers; normal interface review needs only the downloaded HTML file.

## Data and deployment rules

Never commit credentials, real messages, client lists, personal photos, database dumps or production logs. The public preview uses fictional data and has no embedded portrait. Its Photo button can load an image locally without uploading it.

Production will run separately on Infomaniak. The existing site, ZTIKIX and the `main` branch are unchanged by a proposal on the development branch. Real access requires server-side authorization, durable private storage and completion of the security/legal launch gates. A declarative 18+ checkbox is not labelled as verified adulthood.

## License

No open-source license has been granted. Public repository visibility does not itself grant permission to reuse the source code.
