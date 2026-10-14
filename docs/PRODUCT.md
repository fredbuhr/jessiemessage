# JessieMessage — Product scope (draft)

Status: **development 0.8**. Registration, private text/photo chat, conversation galleries, an owner media library and private administrator client files are implemented behind explicit private configuration. CRM CI verification is pending for this revision. The default server stays neutral. Diffusion and Web Push remain planned; production access gates still require external integration and acceptance.

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

- Implemented CRM inbox search across pseudonym, private nickname and known email, with tag **and** group, access, unread and reminder filters.
- Private client file: nickname, contact email, status, up to 8,000 characters of encrypted notes and an optional reminder date. The inbox includes neither email nor notes.
- Up to 100 tags and 100 groups per administrator, with at most 32 labels on one client file. Avoid gratuitous intimate profiling.
- Internal groups are invisible to clients and collect private memberships; they do not create shared chat rooms. Saved automatic segments remain planned.
- Reminder dates support private follow-up filters; they do not send notifications or create scheduled tasks.
- Profile saves are atomic and detect concurrent edits. A conflict preserves the draft for explicit review rather than overwriting a newer file.
- Deleting a label removes its memberships and invalidates stale profile saves while preserving the private notes.
- One-to-many sends, always delivered as **individual messages**, never a shared group chat.
- Distinguish requested service deliveries from optional promotional messages. Respect consent/opt-outs.
- Queue bulk deliveries; track queued, delivered and failed recipients; retry safely.
- Shared media library with one stored master per asset plus derivative previews.
- Record delivery receipts at least by media ID + recipient ID; detect repeat sends.
- Support limited-term access and admin tasks without displaying payment data.

Queued bulk sends, automatic saved segments and promotional consent handling remain planned. CRM is available only to a currently authenticated administrator assigned to the conversation. The client receives no private nickname, label, reminder or note through their chat/access/media APIs. An expired or revoked client can retain an assigned administrator file without regaining chat access or permitting a new send. See [current CRM behavior and limits](private-crm.md).

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
