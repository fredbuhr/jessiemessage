# JessieMessage

Invitation-only private messaging PWA. Public source, private user data.

> **Current delivery: Nuit + approved identity / workbench 0.3.1.** A dark mobile-first interactive prototype, not a production messenger. No real accounts, database connection, email, notifications or message delivery. No automatic Infomaniak deployment.

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

## Maintainer checks

Node.js 24; no runtime npm dependencies. `npm run check` validates syntax, `npm test` runs 47 tests, and `npm run build` generates the self-contained HTML. GitHub Actions performs these checks and publishes the artifact. Test results depend on the actual CI run; screenshots and static contrast checks are not a security or accessibility certification.

`npm start` still serves only the original neutral public placeholder and health endpoint. The design and artifact directories are not served by that application. No changes to Infomaniak, ZTIKIX or `main` are made by this development branch.

## Data rules

Never commit real messages, client data, private media, passwords, API keys, production logs or database dumps. Development uses fictional data. The 18+ declaration is not reported as verified adulthood. Legal pages and production privacy/access controls remain unfinished.

## License

No open-source license has been granted. Public repository visibility does not itself grant permission to reuse the source code.
