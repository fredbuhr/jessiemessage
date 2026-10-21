# Private client files and labels — development 0.8

**Bilan historique.** Les versions, plafonds et états ci-dessous décrivent cette étape. Pour l’usage actuel, lire le [guide quotidien](guide-jessie.md) ; pour la production et son repli, lire [REPRISE](REPRISE.md).

**Stage 0.43 validated preparation (`42bc5eff`):** [shared-administrator collaboration and lifecycle corrections](crm-collaboration.md) reject obsolete failures as well as obsolete successes, preserve the current label-action lock after resume and add real-module Chrome collaboration fixtures. Existing SQL version/ownership checks are retained. CRM remains disabled in the hosted 0.42 profile; private configuration and backup support precede activation. The original 0.8 evidence below remains historical.

This lot adds administrator-only client files and inbox filtering to the persistent private chat. A client file contains a private nickname, encrypted notes, optional reminder date and explicit tag/group memberships. The approved Nuit interface is preserved. The downloadable offline workbench remains fictional and does not contain real CRM data.

Implementation `9e399e6dd5589d21597fb35b0a3fe6d2d2856ee0` passed [verified CRM CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864) under Node.js 24.21.0: 402 general tests, 12 explicitly skipped database groups in that job, then 159 real tests without skips on each of MariaDB 10.11 and 11.4. [Draft PR #7](https://github.com/fredbuhr/jessiemessage/pull/7) is stacked on private media. All automated fixtures are synthetic; no real contact, note, account, photograph or email delivery is supplied by this lot.

## Private configuration

Apply all 20 reviewed migrations explicitly with the dedicated migration account. New files are `0018_crm_profiles.sql`, `0019_crm_labels.sql` and `0020_crm_memberships.sql`. Startup checks the applied history and required columns, indexes, foreign keys, CHECK clauses and enforcement; it does not create or migrate tables. The application account retains DML privileges and read-only ledger access.

Set these values through private runtime configuration:

| Variable | Meaning |
| --- | --- |
| `JESSIEMESSAGE_ENABLE_CRM` | Absent or `0`: CRM disabled, routes/assets unregistered. Only `1` enables it. |
| `JESSIEMESSAGE_CRM_KEY` | New random 32-byte key encoded as canonical 43-character base64url. |

Enabled CRM requires enabled administrator authentication, client access and text chat, including their existing private configuration. Media is optional. The CRM key must differ from the MFA, mail and message keys, and from `JESSIEMESSAGE_MEDIA_KEY` whenever that value is supplied. Invalid/missing enabled configuration refuses startup. There are no generated defaults or committed keys.

Back up the CRM key privately and separately with the encrypted database backup. Do not put populated configuration, notes, production logs or dumps in Git, Actions, issues or screenshots. Key rotation/re-encryption tooling and a full restoration procedure remain release work. See [database operations](DATABASE.md) and [security gates](SECURITY.md).

## Administrator ownership and client isolation

Every CRM endpoint and source asset requires `__Host-jessie_session` and a currently active administrator with confirmed current MFA. A client cookie, including one renamed to the administrator cookie, provides no CRM access. The CRM browser module and stylesheet load only in the authenticated administrator chat view after the capability check succeeds.

The service derives the administrator identity from the session. The store checks the live session, MFA generation and assigned conversation through the chat transaction hooks. An administrator cannot read or update an unassigned conversation, another owner's label, or another owner's memberships by guessing IDs. Label counts include only currently assigned conversations for their owner.

An assigned administrator may retain and edit a client file after client access expires, is suspended or is revoked. This permission does not reactivate the client or authorize a new text/photo send. Existing chat/media authorization remains in force. No CRM profile is created merely by reading an empty file.

The selected profile may disclose the client's canonical email and decrypted private notes to its assigned administrator. Inbox contacts include neither email nor notes. Shared chat/access/media DTOs contain no private nickname, label, reminder or note, including the client's own view.

## Fields and limits

| Field | Current behavior |
| --- | --- |
| Private nickname | Up to 64 JavaScript string characters; Unicode NFC, trimmed/collapsed spaces; empty allowed. It does not replace the shared pseudonym. |
| Notes | Exact text, up to 8,000 JavaScript string characters and 32,768 UTF-8 bytes; whitespace and literal markup preserved. Disallowed controls and malformed Unicode are rejected. |
| Reminder | Optional UTC timestamp; displayed/edited in the browser's local time. It supports follow-up filters without any scheduled notification. |
| Tag/group name | Up to 64 JavaScript string characters; canonical display spaces/NFC and NFKC/lowercase uniqueness per owner and kind. |
| Labels per kind | At most 100 tags and 100 groups per administrator. A canonical create retry returns the existing label. |
| Labels on a file | At most 32 unique owned labels, across both kinds. |
| Search | Up to 80 JavaScript string characters and 320 UTF-8 bytes. |
| List page | At most 100 records; defaults are 50 contacts or 100 labels. |

An empty group is valid. Groups are private sets of memberships, not shared rooms, automatic saved segments or delivery campaigns. Tags and groups have separate name spaces. The same display name can exist once in each kind for the same owner. Names, notes and search text are rendered as text; markup is not interpreted.

## Encryption and profile revisions

Nonempty notes use native AES-256-GCM with a fresh nonce. Authenticated context binds each ciphertext to the administrator, conversation and internal `notes_revision`. Empty notes are stored as `NULL`. Decoding validates the authenticated payload and exact UTF-8 text. The authorized server decrypts profile reads: this is at-rest encryption, not end-to-end encryption.

`crm_profiles` stores two different internal counters:

| Counter | Purpose |
| --- | --- |
| `version` | Optimistic version of the complete profile and membership set. Absent profiles are exposed as version `"0"`. |
| `notes_revision` | Revision used in note encryption context. Positive for stored profiles and no greater than `version`; absent profiles use internal zero. |

An explicit profile save requires the expected version, validates every selected owned label, and atomically replaces nickname, notes, reminder and memberships. It advances `version`, assigns that same value to `notes_revision`, and encrypts notes for the new revision. Two saves based on one version produce one successful write and one `409 record_changed`, with no partial field or membership update.

Deleting a label removes all its bindings and advances every affected profile's `version` in the same transaction. It leaves `notes_revision` and ciphertext unchanged. Existing notes therefore remain decryptable, while an older draft containing the removed label conflicts instead of overwriting the current file. Renaming a label advances only that label's version. Missing/foreign labels and version overflow roll back the entire operation.

Neither ciphertext nor `notes_revision` is included in browser DTOs. The public `version` token is used internally by the browser for saves, without being shown as a product field. Private nicknames, label names, memberships and reminder dates remain plaintext database metadata; encrypted backups and restricted operational access are still necessary.

## Inbox search and filters

Server queries restrict contacts to the current assigned administrator, then combine all supplied filters:

- Literal case-insensitive substring search across pseudonym, private nickname and known canonical email. `%` and `_` are ordinary characters, not SQL wildcards. Notes are never searched or decrypted.
- One tag and one group, combined with **AND**. Missing, foreign or wrong-kind filter IDs return a neutral not-found error.
- Current access state: all, active, pending, expired, revoked, suspended or deleted.
- Unread incoming messages, excluding sender-owned messages and tombstones, compared with the administrator's persisted read cursor.
- Reminder state: all, due (`<= now`), upcoming (`> now`) or none.

Pages use ascending conversation-ID cursors; the UI may sort loaded contacts by activity. Label reads are batched for the page. Filter changes discard obsolete list responses and preserve the explicitly selected conversation: selecting a filter does not move a pending send to another client. A selected contact may remain open while excluded from the filtered inbox.

## Browser editing and conflicts

Notes, drafts and selections stay in memory; no CRM data is written to localStorage or a service-worker cache. Search is debounced, and context/filter tickets reject stale responses. Changing the selected conversation clears the visible private fields before loading the next profile. Requests and private DOM/drafts are cleared when authentication fails or the administrator signs out.

A `409` profile conflict preserves the draft and retrieves the current saved file for comparison. The operator must explicitly choose to reload or save against the fresh version; there is no automatic overwrite. A removed/missing label refreshes label choices with an error, rather than silently dropping selected labels and resubmitting. The label manager shows owned labels and assigned member counts, and supports create, rename and confirmed removal.

The reminder is a private date and filter. No browser alarm, email, Push, automatic message or scheduled task is created.

## HTTP contract

All routes below require the current administrator host cookie and return no-store responses. Mutations additionally require the canonical site Origin, the current session CSRF token and JSON. Extra fields, unknown/duplicate query parameters, noncanonical lowercase IDs and noncanonical version/cursor values are rejected. Profiles have a 65,536-byte JSON receipt budget; other CRM mutations retain the 4,096-byte budget.

| Route | Behavior |
| --- | --- |
| `GET /api/admin/crm/capabilities` | Enabled capability and supported label/note limits. |
| `GET /api/admin/crm/labels` | Owned labels; optional `kind`, `afterId`, `limit`. |
| `POST /api/admin/crm/labels` | `{kind,name}`; 201 new or 200 canonical duplicate. |
| `POST /api/admin/crm/labels/{id}/rename` | `{name,expectedVersion}`; versioned rename. |
| `POST /api/admin/crm/labels/{id}/delete` | `{expectedVersion}`; atomic binding removal, affected profile version changes and label deletion. |
| `GET /api/admin/crm/contacts` | Optional `q`, `tagId`, `groupId`, `access`, `unread=1`, `reminder`, `afterId`, `limit`. No email or notes in contacts. |
| `GET /api/admin/crm/conversations/{id}` | Assigned private client profile, including email and decrypted notes. |
| `POST /api/admin/crm/conversations/{id}` | Full atomic `{expectedVersion,nickname,notes,reminderAt,labelIds}` save. |
| `GET/HEAD /crm.js`, `/crm-model.js`, `/crm.css` | Protected source assets, authenticated before file reads. |

Authenticated data reads have persistent HMAC-derived budgets of 300/minute globally and 180/minute per administrator. Mutations allow 120/minute per administrator. Buckets contain no raw note, search query or client email. Errors are neutral: authentication required, not found, record changed, name in use, limit reached or a generic unavailable/retry response; database and crypto details are not echoed.

## Verification and remaining work

Unit/HTTP/model tests cover validation, encryption context, explicit DTOs, private assets, Origin/CSRF, memory drafts, filter pagination and conflict behavior. Two sequential MariaDB groups cover real store/HTTP ownership, assignment, canonical labels, atomic rollback, simultaneous saves, ciphertext privacy, note-revision preservation after label deletion, combined literal filters, expiry and revocation. They require explicit loopback opt-in, a disposable `jessiemessage_test…` schema, DML-only runtime credentials and all 20 migrations. They never run concurrently with the other groups against the same schema.

The verified database run executes twelve sequential groups: migrations 12, administrator authentication 16, recovery 8, client access 13, mail queue 11, HTTP access 9, chat persistence 19, HTTP chat 12, media persistence 16, HTTP media 10, CRM persistence 19 and HTTP CRM 14. Syntax and build also pass; no new dependency or approved icon change is included. No browser visual, HTTPS/mobile, penetration, load, restore, hosting or production deployment validation is claimed.

The next application lots remain individual queued bulk sends, consent/opt-out behavior, Web Push and installable PWA behavior. Real SMTP, independently verified majority integration, client password recovery acceptance (implementation added in [0.9](client-recovery.md)), legal/privacy acceptance, retention/export/erasure, key rotation, encrypted backup/restore drills and photo reconciliation/orphan cleanup remain before release. No automatic notifications or delivery campaigns are supplied by the current CRM lot.
