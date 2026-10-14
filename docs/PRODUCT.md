# JessieMessage — Product scope (draft)

Status: **development 0.7**. Registration, private text/photo chat, conversation galleries and an owner media library are implemented behind explicit private configuration. The default server stays neutral. CRM, diffusion and Web Push remain planned; production access gates still require external integration and acceptance.

## Purpose

An invitation-only private messaging application between Jessie (creator/admin) and each invited client. The public site must be neutral and have no payments, public gallery or public chat room. The client only sees their own conversations and media.

## Intended scale

- Initial target: a few hundred registered users.
- Architecture should be ready to scale to thousands after load testing.
- Interfaces: mobile-first web app, installable as a PWA, desktop-compatible.
- Languages: French and English first; translations should be extendable.

## Invitations and onboarding

- An admin manually verifies eligibility before issuing an invite.
- Invite link: unique, random, single-use, revocable and short-lived.
- Invite does not count as age verification.
- Client selects a pseudonym, verifies their email address and completes whatever legal age-assurance process is required.
- Only after all checks may an admin grant access.
- Admin can revoke a session or access at any time.

## Client experience

- One private conversation with Jessie, no client-to-client discovery.
- Messages, emojis and images, later GIF/sticker integrations after provider approval.
- Photo and message history in their own conversation.
- Web Push notifications opt-in, neutral text on lock screen; iOS instructions if installation is required.
- Account preferences, data download and deletion requests.
- No payment on the site.

## Admin experience

- Inbox with search, filters, unread status and reminders.
- Private client file: nickname, verified contact, status, last activity, account notes.
- Arbitrary admin-only tags (avoid gratuitous intimate profiling).
- Internal groups, including saved tag-based segments, invisible to clients.
- One-to-many sends, always delivered as **individual messages**, never a shared group chat.
- Distinguish requested service deliveries from optional promotional messages. Respect consent/opt-outs.
- Queue bulk deliveries; track queued, delivered and failed recipients; retry safely.
- Shared media library with one stored master per asset plus derivative previews.
- Record delivery receipts at least by media ID + recipient ID; detect repeat sends.
- Support limited-term access and admin tasks without displaying payment data.

## Media deduplication

- Compute a SHA-256 content digest when importing a file, with unique stored file IDs.
- Separate media storage from message references.
- Track `campaign_id`, `recipient_id` and `media_id` for audit and idempotency.
- A logged send does **not** prove a client viewed or downloaded an image.
- Explicit re-send remains possible for an admin, with a warning.

## Deferred

- Voice/video calls.
- Multi-creator rooms.
- In-app payments or subscriptions.
- Public timelines or public image galleries.

## Must be resolved before real launch

- Written clarification of third-party platform rules for how invitations are distributed.
- Hosting terms for the actual use case.
- French/EU legal classification and suitable age-assurance solution.
- Privacy notice, legal notices, terms, complaint/reporting process and retention policy.
- Security review, backups and successful restoration test.
- Do not use real accounts/media in development or automated tests.
