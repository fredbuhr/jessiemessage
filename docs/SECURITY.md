# Security and privacy launch gates

Public source code is compatible with a secure product only if every release handles secrets and data correctly. Treat all externally submitted data as untrusted.

## Must be true before invite links are activated

- Strong, hashed, one-time invitation tokens with expiry and revocation.
- Separate verification of invitation eligibility, email ownership and lawful adulthood.
- No real image exchange until the applicable age verification and hosting conditions are satisfied.
- Administrator two-factor authentication.
- Secure, HttpOnly, SameSite session cookies; CSRF defenses for state-changing requests.
- Rate limits, account enumeration protections, email verification expiry and anti-abuse measures.
- Every API, media URL and real-time event verifies authorization **server-side**.
- Client-to-client isolation is tested: users cannot access other conversations via guessed IDs.
- Image uploads are size/type restricted; verify actual file format; re-encode/strip metadata; quarantine/reject unsafe content.
- Media lives outside the public web root; never publish raw storage paths.
- Appropriate transport and at-rest encryption; key lifecycle and restricted admin access.
- Discreet Push notifications with no intimate previews.
- Explicit disclosure that normal HTTPS chat is not end-to-end encrypted unless that feature is separately implemented and audited.
- Configure retention, deletion, exports, consents and lawful handling of sensitive personal data.
- No automatic marketing to imported/contact lists; promotional sends require the applicable permission.
- Encrypted, geographically appropriate backups, separate from the same hosting account; periodic restore drill.
- Access logs and error reports must not include invite tokens, message bodies or private file URLs.
- Legal notice, privacy policy, terms, content reporting, applicable age-assurance compliance and provider terms are reviewed.
- No secrets, API keys, production database data, client screenshots or intimate files in GitHub issues, commits, Actions logs or artifacts.

## GitHub rules

- Source may be public. Production credentials remain in Infomaniak's secret/configuration controls.
- Development uses fictional accounts and harmless test images only.
- Pull requests are reviewed before merging to `main`.
- CI has read-only token permissions and no deploy credentials on ordinary PRs.
- Do not automatically deploy every push to production.

## Current status

Version 0.9 adds opt-in client password recovery to private text/photo chat, administrator MFA/recovery, invitations, restricted client sessions and administrator-only CRM. Live SQL checks bind every conversation operation to its assigned participants and current session generation. Clients need current email/age/approval gates and unexpired access; an administrator can retain authorized history after a client expires but cannot send to that client. Message bodies use AES-256-GCM with a separate private key; this is server-side at-rest encryption, not end-to-end encryption. Deletion removes the body from the live row and synchronizes a tombstone; backup retention and data export are still to implement. JPEG/PNG/WebP uploads are normalized by an isolated bounded decoder, stripped of metadata, encrypted with a fourth distinct key and kept in a private directory outside the checkout. Every photo URL is authorized against its live owner or message delivery; an author tombstone revokes that delivery on subsequent reads. Browser screenshots, already authorized transfers and backups cannot be recalled. See [media configuration and limits](private-media.md) and [messaging scope](private-messaging.md).

CRM requires enabled chat, a separate flag and its own 32-byte key, distinct from MFA, mail, message and any configured media key. Every CRM asset/API requires the administrator host cookie and current MFA; store transactions recheck current assigned ownership. Private nicknames, labels, reminders and notes are absent from shared client chat/access/media DTOs. Contacts contain no email or notes; the selected administrator-only profile can return both. Search is bounded and literal, and never searches or decrypts notes. Notes are at most 8,000 characters and encrypted with AES-256-GCM bound to administrator, conversation and internal note revision. Nicknames, labels and reminder dates are not encrypted fields, so database/backups still contain private metadata. At-rest encryption does not protect data from the authorized runtime or an operator who has the key.

Atomic profile saves enforce optimistic versions. Deleting a label advances affected profile versions while retaining note revisions and ciphertext, preventing a stale membership draft from silently replacing current notes. Returned errors contain no note, query, email, ciphertext, key or raw database details. Browser CRM requests, drafts and plaintext notes remain in memory and are cleared on authentication failure/sign-out; the client view does not load CRM assets. Private reminder dates send no automatic notification. See [CRM scope and operational limits](private-crm.md).

Client recovery is disabled by default and requires enabled access/mail. It accepts only eligible email-verified pending/active clients, including expired active access without extending it. Administrators, unverified accounts and suspended/revoked/deleted clients are excluded. Ordinary request responses contain only a generic accepted status; syntax errors, rate limits and infrastructure failures retain fixed error responses. This does not claim perfectly equal database timing or protection against all email-side observations.

Reset challenges use 32 random token bytes, a 30-minute expiry, single-use consumption and SHA-256 storage, bound to the current credential version and canonical email hash. The token also exists temporarily inside the encrypted delivery payload and the recipient's mailbox. Reset and verification payloads reuse the mail key with different authenticated purposes/job bindings, preventing interchange. A new request invalidates older links without altering the password or sessions. Successful completion atomically replaces the exact-password scrypt hash, increments the credential version, revokes every client session and outstanding link, and cancels reset jobs. It creates no session and changes no email proof, age/access gate or account status. Administrator recovery remains a separate private CLI.

Reset mutations require exact Origin, permitted fetch metadata, JSON and `X-Jessie-Request: 1` before reading the bounded body. APIs reject all query fields. `/recover` accepts a canonical fragment token only in browser memory, removes the address fragment/query before API calls, and does not inspect or consume it on page load. Passwords, tokens and drafts are not persisted by this UI. Response DTOs and errors expose no token, address, password, account ID, hash or raw database details. Persistent keyed rate limits and the shared bounded scrypt queue constrain requests and reset attempts. An already claimed SMTP message may still be delivered after concurrent revocation, but its revoked link is unusable.

The earlier CRM passes the [verified 0.8 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864), including real MariaDB ownership, conflict and revocation checks. Recovery 0.9 CI is pending. No browser visual, HTTPS/mobile, penetration, load, restore or actual hosting validation is claimed. Real SMTP, age-provider integration, bulk-send/Push consent, retention/export, reset-token retention, media reconciliation/cleanup, separate encrypted backups and key rotation/restore tooling remain launch work. Reset cleanup currently covers only outbox jobs older than seven days; challenge rows remain until a reviewed retention process is added. **This development lot has not undergone a penetration test or legal approval and must not be presented as a production messenger.**
