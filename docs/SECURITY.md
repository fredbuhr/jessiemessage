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

Version 0.7 adds optional private text/photo chat to administrator MFA/recovery, invitations and restricted client sessions. Live SQL checks bind every conversation operation to its assigned participants and current session generation. Clients need current email/age/approval gates and unexpired access; an administrator can retain authorized history after a client expires but cannot send to that client. Message bodies use AES-256-GCM with a separate private key; this is server-side at-rest encryption, not end-to-end encryption. Deletion removes the body from the live row and synchronizes a tombstone; backup retention and data export are still to implement. Real SMTP, age-provider integration, client password recovery, key rotation and browser HTTPS acceptance remain launch work; JPEG/PNG/WebP uploads are normalized by an isolated bounded decoder, stripped of metadata, encrypted with a fourth distinct key and kept in a private directory outside the checkout. Every photo URL is authorized against its live owner or message delivery; an author tombstone revokes that delivery on subsequent reads. Browser screenshots, already authorized transfers and backups cannot be recalled. See [media configuration and limits](private-media.md). **This development lot has not undergone a penetration test or legal approval and must not be presented as a production messenger.** See [messaging scope](private-messaging.md).
