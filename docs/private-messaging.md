# Private text messaging — development 0.6

The real chat is separate from the fictional offline workbench. It has no default accounts, messages, public gallery or client/admin role switch. The approved Nuit colors and exact brand icons remain; personal portraits are not included in public source or artifacts.

## Explicit configuration

Keep the existing private administrator, database, access and verification-mail configuration. Set `JESSIEMESSAGE_ENABLE_CHAT=1` and provide `JESSIEMESSAGE_MESSAGE_KEY`: a separately generated cryptographically random 32-byte key encoded as canonical base64url (43 characters). It must differ from the MFA and mail keys. Missing/invalid configuration refuses startup; absent/`0` leaves chat pages, routes and assets unregistered. Never put any key in Git, screenshots, logs or the offline preview. Preserve keys separately with encrypted database backups; changing this key without a planned re-encryption makes existing bodies unreadable. Rotation tooling is not implemented.

Run reviewed migrations 0013–0015 through the separate migration CLI before enabling chat. Startup only verifies schema and applied history. The HTTP database account remains DML-only.

## Access and data

`/messages` exposes one conversation to an active client. `/admin/messages` lists only conversations assigned to the authenticated administrator. Client access requires email verification, independently recorded age assurance, approval, active status and unexpired entitlement. A declaration alone never qualifies. Cookies, session revocation, credential/MFA versions, absolute and idle expiry are checked again under SQL locks for every read/write, including incremental polling.

An assigned administrator may read history after a client's access expires or is revoked, but may send only while the client is eligible and the conversation is open. A client cannot use a guessed conversation ID to read, send, acknowledge or delete another client's messages. Private CRM fields and email addresses are excluded from chat DTOs.

Text is limited to 4,096 JavaScript characters and 16,384 UTF-8 bytes; controls, malformed Unicode and invisible-only bodies are rejected. Spaces and newlines are preserved. The browser renders text through `textContent`, including literal markup. Message bodies are AES-256-GCM encrypted with identifiers bound as authenticated data. This protects a database-only copy; the server decrypts authorized reads. **This is not end-to-end encryption.** Participant identifiers, sequence numbers, timestamps, receipts and deletion state remain database metadata.

A sender supplies a random 16-byte idempotency ID. Concurrent/repeated requests with the same sender/conversation/ID and exact body return the original message; different text conflicts. A private HMAC fingerprint survives deletion so a retry cannot resurrect content. Send budgets are 300 attempts/minute globally and 30/minute per authenticated user; receipt/deletion updates share 120/minute per user. Oversized requests and pool concurrency are bounded separately.

## Read receipts and deletion

Per-conversation sequence numbers stay decimal strings across SQL and HTTP, avoiding JavaScript precision loss. History is keyset-paginated. An ordered event feed reports new messages and deletions, including deletion of an older loaded message. It returns the current message state, never an old plaintext snapshot.

The UI polls serially while visible, backs off on failure, cancels requests when hidden or the conversation changes, and stores state/drafts in memory only. Read receipts advance monotonically only for actually visible incoming messages near the bottom. “Envoyé” means persisted by the server; “Lu” means the peer acknowledged the sequence. Neither label claims push or external delivery.

Only the author can delete a message. Deletion clears its encrypted body in the live database row and leaves a synchronized “Message supprimé” marker. Repeating deletion is safe. This does not purge backups, exports, previously viewed screens or recipient copies. Retention, backups, export and account-erasure procedures remain launch work.

## API surface

All chat responses are no-store; there is no CORS grant. Mutations require the role's host cookie, canonical HTTPS Origin, JSON and current CSRF token. Paths below use `role` = `admin` or `client` and lowercase 32-hex identifiers.

| Route | Purpose |
| --- | --- |
| `GET /api/chat/admin/conversations` | Assigned inbox, `afterId` and `limit` |
| `GET /api/chat/client/conversation` | Client's sole conversation |
| `GET /api/chat/{role}/capabilities` | Authenticated navigation availability |
| `GET /api/chat/{role}/conversations/{id}/messages` | Initial/older/newer history, `before` or `after`, `limit` |
| `GET /api/chat/{role}/conversations/{id}/events` | Incremental changes after event cursor, `limit` |
| `POST …/{id}/messages` | `{clientMessageId, body}`; 201 new / 200 repeated |
| `POST …/{id}/read` | `{throughSequence}`; own monotonic receipt |
| `POST …/{id}/messages/{messageId}/delete` | `{}`; author deletion |

Unknown/duplicate parameters, extra JSON fields, noncanonical IDs/cursors and malformed bodies are rejected. Errors are generic and never echo plaintext, encrypted bodies or database exceptions.

## Verification and remaining limits

Unit/HTTP tests cover encryption binding and tampering, DTO filtering, role cookies/CSRF, request limits and the pure UI state model. Separate sequential real-MariaDB tests cover transactional isolation, concurrency, rollback, receipts/deletion, live session/access gates and actual HTTP exchanges with synthetic accounts. CI runs MariaDB 10.11 and 11.4; consult the exact successful run before treating a code revision as verified.

Browser rendering, accessibility, HTTPS/mobile acceptance and load testing are still to perform. No real account, message, SMTP recipient or production database is used by these tests. Media, Web Push, client password recovery, age-provider integration, real SMTP acceptance and the broader privacy/legal release gates remain unfinished. No Infomaniak deployment or merge is part of this lot.

All conversations assigned to one administrator currently share its authorization row lock. The inbox refresh is slower than selected-conversation polling and queries are bounded by page, but this is a small-pilot implementation; measure contention and host latency before scaling. Time-based eligibility uses the request's sampled authorization time, while persisted revocation is rechecked under locks. A request accepted just before an expiry can finish after a lock wait; strict deadlines sampled after every lock wait remain an improvement to evaluate with load/deadline tests.
