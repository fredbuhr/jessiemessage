# MariaDB foundation — development only

Twenty-two immutable migrations now supply the foundation/administrator tables plus client state, email verification, client sessions, encrypted mail jobs, encrypted text messages, read receipts, change events, media assets, message attachments, private CRM profiles/labels/memberships, client password-reset challenges and a separate encrypted reset outbox. The migration command remains explicit. Version 0.9 separately enables administrator authentication/recovery and [invited client onboarding](invitations-client-access.md). Optional [private text chat](private-messaging.md) uses the existing conversations. Optional [photo transfer and gallery](private-media.md) use separate encrypted files outside the checkout. Optional [private CRM](private-crm.md) uses administrator-owned tables. No default credentials, age-assurance provider, real messages or photos are supplied. All fixtures are synthetic and use `example.invalid` addresses. CRM passed the [verified 0.8 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864); recovery 0.9 CI is pending.

## Dedicated database and compatibility

Provision a new **empty database reserved for JessieMessage** in the hosting control panel. Never use the existing ZTIKIX database or its credentials. Use a migration account scoped to that one database; it needs table/index/constraint DDL and ledger read/write privileges, but no global, `FILE`, user-administration or database-creation privileges. The separate application account has only the required data privileges and read-only `SELECT` on the migration ledger to validate startup. It cannot change the schema or ledger; exact grants are documented in [auth-admin.md](auth-admin.md).

The runner requires MariaDB 10.11 or later. CI exercises disposable MariaDB 10.11 and 11.4. Infomaniak's actual database engine/version, TLS certificate chain, available grants and `GET_LOCK` capability for this account **have not been verified**. Verify them in the Manager and on a disposable dedicated schema before any hosting integration. MySQL is explicitly refused. This batch does not deploy or migrate production.

The pinned `mariadb` connector is used by the dedicated migration connection and, only when authentication is enabled, the bounded application pool. Pinned `otpauth` provides TOTP; pinned `nodemailer` provides SMTP with mandatory TLS. Passwords use Node's native scrypt. The default neutral HTTP server opens no database connection.

## Configuration

Configure these values privately; never commit a populated environment file or copy production values into Actions, issues or screenshots. The command does not load `.env` files automatically.

| Variable | Meaning |
|---|---|
| `JESSIEMESSAGE_DB_HOST` | Explicit MariaDB host; no default host. |
| `JESSIEMESSAGE_DB_PORT` | Optional TCP port; default `3306`. |
| `JESSIEMESSAGE_DB_NAME` | Exact dedicated schema name; no default schema. |
| `JESSIEMESSAGE_MIGRATION_DATABASE` | Repeat the exact schema name to confirm the migration target. A mismatch stops before connecting. |
| `JESSIEMESSAGE_DB_USER` | Dedicated migration user. |
| `JESSIEMESSAGE_DB_PASSWORD` | Nonempty private password. |
| `JESSIEMESSAGE_DB_TLS_CA_PATH` | Optional local PEM CA path for a hosting certificate chain. |
| `JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL` | Only `1`, and only literal `127.0.0.1`, `::1` or `localhost`; for a disposable local/CI database. |

TLS with certificate verification and TLS 1.2 minimum is the default. There is no remote plaintext override or option to disable certificate verification. Confirm that the hosting connection supports this before using it. The connection uses UTC, strict SQL mode, enabled foreign-key/CHECK enforcement, disabled multi-statements and one physical connection without reconnect or automatic retries. Driver errors and query parameters are not forwarded into CLI logs.

After configuration:

```sh
node scripts/migrate.mjs status
node scripts/migrate.mjs up
```

`status` reads migration history without creating tables in an empty schema. `up` initializes only an empty schema, creates the verified `schema_migrations` ledger and applies pending files in order. No automatic migration runs on HTTP startup or ordinary deployment. Review a backup and restore procedure before using this command with any data that matters.

## Tables and guarantees

| Table | Database guarantees |
|---|---|
| `users` | Exact 16-byte IDs; `admin`/`client` roles; pending/active/suspended/revoked/deleted status; unique binary-collated email; recorded email/age/approval gates required for an active client; optional access expiry requires approval. |
| `invitations` | Unique exact 32-byte token digest; administrator issuer and client consumer enforced by composite foreign keys; expiry; mutually exclusive consumption/revocation; consumed user/timestamp pair; optional `access_days` of 1–3650, independent of invitation expiry. |
| `sessions` | Unique exact 32-byte token digest; valid user; absolute expiry and per-session revocation. |
| `conversations` | Exactly one conversation at most per client; administrator/client participant roles enforced by composite foreign keys; no client-to-client conversation. |
| `admin_mfa` | Administrator owner; encrypted TOTP secret, MFA version and last accepted time step. First valid TOTP confirms enrollment. |
| `admin_recovery_codes` | Per-administrator recovery digests, MFA version and consumption timestamp. Application row locking makes consumption single-use. |
| `auth_session_state` | Session linkage, last recognized activity, MFA confirmation and version. The service checks absolute and idle expiry plus current administrator status/version. |
| `auth_rate_limits` | Exact bucket digest, start timestamp and positive attempt count; indexed bounded cleanup of old windows. |
| `client_auth_state` | Client role, credential version and age declaration timestamp; declaration supplies no age assurance. |
| `email_verifications` | Unique challenge digest, owner, expiry, single consumption and revocation. |
| `client_session_state` | Client session activity and credential version. |
| `mail_outbox` | Encrypted challenge linked to its intended owner, leased delivery, bounded attempts and terminal states. |
| `messages` | Conversation sequence, authenticated sender, sender-scoped retry key, encrypted body/fingerprint and deletion tombstone. |
| `chat_receipts` | Per-conversation participant read cursor, advanced monotonically by the application. |
| `chat_events` | Per-conversation message/deletion cursor bound to the actual message. |
| `media_assets` | Owner-scoped normalized-image digest, encrypted private storage handle, dimensions and deletion state. |
| `message_media` | Audited image attachment bound to its actual message/conversation and owner. |
| `crm_profiles` (`0018`) | Composite administrator/conversation key; nickname, encrypted notes, optional reminder, positive optimistic version and `1 <= notes_revision <= version`. |
| `crm_labels` (`0019`) | Administrator owner, `tag`/`group` kind, unique owner/kind/normalized name and positive optimistic version. |
| `crm_memberships` (`0020`) | Composite profile and label foreign keys enforce one owner; indexed label-to-conversation membership. |
| `client_password_resets` (`0021`) | Client-auth owner, unique 32-byte token hash, credential version and canonical email hash snapshots; at most 30-minute lifetime; exclusive consumption/revocation. |
| `password_reset_outbox` (`0022`) | Composite challenge/recipient foreign key, encrypted payload, fixed delivery states, bounded attempts and lease pairs, indexed ready/expiry/sent dates. |

The administrator service generates cryptographic IDs and opaque session tokens, stores SHA-256 token digests and uses fixed-parameter scrypt hashes. Cookie handling, administrator MFA, anti-replay transactions, session revocation and persistent anti-abuse limits are implemented in this development lot. Invitation redemption, pending-account registration and the encrypted verification job are atomic. Verified clients can sign in to a restricted account-status view; active access additionally requires the recorded age/approval gates. Password hashes stay nullable for pending accounts. Tokens, addresses and passwords must never appear in logs.

Administrator setup and login currently validate ASCII email addresses and canonicalize them to lowercase. Client registration applies the same canonical policy before writing the unique value; binary comparison itself provides neither normalization nor mailbox equivalence. Pseudonyms are display values, not account identifiers.

Schema timestamps record gate completion; they do not prove lawful age assurance or administrator review. `access_days` is a proposed grant duration: the approval transaction computes expiry from approval time only after email and age-assurance gates succeed, then creates one conversation atomically. A static CHECK cannot enforce expiry as time passes. Every future client request must check expiry/revocation and current account status, access expiry and onboarding gates. Administrator requests already check session expiry/revocation, current active status and confirmed MFA version. Controlled administrator password/TOTP recovery is implemented in a private CLI. Opt-in client password recovery is implemented; its 0.9 CI is pending. Master-key rotation and HTTPS browser acceptance remain launch work.

Registration locks the current issuer and invitation, creates the pending account, consumes the invitation and queues its encrypted challenge in one transaction. Approval separately locks the client, validates its gates and records access plus conversation together. The schema alone does not prevent a privileged writer from replacing a consumption record. There are no cascade deletes: retention, exports and account deletion need a separate reviewed policy.

CRM runtime transactions derive the administrator from the current session, then recheck assigned conversation ownership. A file may hold 32 labels; each administrator may create 100 labels of each kind. These application limits are enforced under the owner lock. Explicit full profile saves require the expected optimistic version and validate all owned labels before changing any fields or memberships. Notes are encrypted before persistence, with authenticated context including the administrator, conversation and next note revision; plaintext notes are absent from the database.

Deleting a label and its bindings increments each affected profile's optimistic `version` atomically. It leaves `notes_revision` and ciphertext unchanged: existing notes remain decryptable, and a draft based on an older label set cannot overwrite the file silently. A later explicit save increments the profile version and encrypts notes for that new revision. Label renames increment only the label version. Missing/foreign labels and version overflow roll back the entire mutation.

CRM contact search treats `%` and `_` literally and never searches notes. SQL filters combine tag and group membership, live access state, unread messages and reminder dates; returned contact pages contain neither email nor notes. The selected private profile may return its contact email and decrypted notes to its assigned administrator. See [private-crm.md](private-crm.md). Assurance-provider references, automatic segments, bulk-send queues, Push subscriptions and retention/export tooling remain deferred.

## Client password recovery transactions

Recovery is opt-in and limited to clients whose current pending/active account has a password, verified email and an incrementable `client_auth_state.credential_version`. Expired active access is eligible for password recovery without being renewed. Administrators, unverified accounts and suspended/revoked/deleted clients are ineligible. Reset challenges store only a token digest, plus an email digest and credential-version snapshot; the separate outbox temporarily stores an encrypted `{email, token}` payload. Neither table stores a new password in plaintext.

Requesting a new challenge locks the user and client authentication state, then atomically revokes older outstanding challenges, cancels their queued jobs and inserts the new challenge/job. The password, client sessions, identity and access gates are unchanged. Failure rolls back the complete reissue.

Completion rechecks current eligibility, email hash, credential version, expiry and one-use state under locks after password hashing. One transaction updates the password and `users.updated_at`, increments the credential version once, consumes the selected challenge, revokes all other challenges and all client sessions, and cancels reset jobs. It does not change email/email proof, age declaration/assurance, approval, status, access expiry, conversations, CRM or media. Invalid or conflicting consumption writes nothing and creates no session. A stale login based on the old credential version cannot issue a current client session.

The reset-mail worker rechecks eligibility and challenge snapshots before claiming delivery. Its bounded indexed cleanup removes old reset-outbox records after seven days; it does not yet prune `client_password_resets` records. Challenge retention and account deletion remain part of the release privacy policy. Foreign keys use restriction, with no cascade delete or general-purpose cleanup. See [client recovery](client-recovery.md).

## Versioning, locking and interrupted DDL

Files in `db/migrations/` are consecutive `0001_name.sql` files. Once recorded in a database, the filename and SHA-256 of the complete source, including comments/whitespace, are immutable. Restore original source when history drifts; do not replace a recorded checksum to make an edited file pass. Missing historical files, history gaps or later entries after a dirty migration also stop execution before new application DDL.

The supported SQL format is deliberately narrow: **one unqualified InnoDB `CREATE TABLE (...)` per file**, explicit default character set/collation, supported structural expressions, and no executable comments, qualified cross-schema names, copies, alternate engines, routines or ledger references. These files are reviewed source code, not an interface for untrusted SQL. Future `ALTER TABLE` support requires extending and testing the format explicitly; there is no general semicolon splitter.

One database-specific MariaDB `GET_LOCK` covers ledger inspection, DDL, recovery and release on the same dedicated connection. The command refuses when another cooperating migration process holds it. Connections must be closed after a migration operation; no pool handoff may replace the lock-owning connection. Existing ledger columns, primary key, engine and CHECK expressions are checked before use. Keep the dedicated schema free of unrelated objects even after initialization; the ledger and exact-name confirmation are operational safeguards, not an ownership proof against a malicious database writer.

MariaDB DDL commits implicitly. A transaction wrapper would not roll it back. The runner durably inserts `running` **before** each DDL statement, marks `applied` only after it finishes, and records `failed` when possible. A crash, failed statement or lost connection may leave committed DDL plus a `running`/`failed` entry. Another `up` stops rather than blindly re-executing it.

Recovery is an explicit operator decision under the same lock:

1. Stop application writes. Inspect the failure privately, the database's actual tables/columns/indexes/foreign keys/CHECKs, and the exact immutable migration source. Restore from backup or manually finish the intended change using a reviewed repair plan. Do not assume that the presence of a table proves the whole migration succeeded.
2. Run `status` to identify the dirty version and its full checksum. Investigate checksum/history/ledger errors before any recovery action.
3. If the exact intended schema is fully present, mark the migration applied. If the prior schema has been fully restored and replaying the original source is safe, mark it retryable. These commands do not execute, reverse or infer DDL.

```sh
node scripts/migrate.mjs resolve --version 1 --checksum FULL_64_CHARACTER_SHA256 --outcome applied --confirm-inspected
node scripts/migrate.mjs resolve --version 1 --checksum FULL_64_CHARACTER_SHA256 --outcome retry --confirm-inspected
```

Choose only the outcome supported by inspection. The placeholder above must be replaced by the exact checksum reported by `status`. Recovery refuses incomplete confirmation, an incorrect checksum or a migration that is not dirty. A retry preserves source history and increments its attempt counter when `up` next runs. There is no automatic rollback, `down`, ledger deletion or production reset command.

## Verification

Pure unit tests need no database:

```sh
node --test tests/migrations.test.mjs
```

The integration suite additionally needs the connector installed and a disposable test schema provided by a local MariaDB server. Set the variables above with a synthetic password, matching confirmation, literal loopback host, and a schema named `jessiemessage_test` or `jessiemessage_test_suffix`. Then opt in:

```sh
JESSIEMESSAGE_DB_TEST=1 node --test tests/migrations.integration.test.mjs
```

Without opt-in it is explicitly skipped, not reported as a database pass. The suite refuses nonloopback or differently named targets. It creates/drops only its known synthetic fixture tables, refuses unrelated tables during cleanup, and needs no `CREATE DATABASE` privilege. Run it only against the disposable schema: the fixtures are reset during and after the suite. CI credentials are public synthetic constants usable only inside its temporary MariaDB service.

The migration group covers ordered/repeatable application, read-only status, competing lock owners, immutable history, foundation constraints and interrupted DDL/recovery. Separate authentication/access/chat/media groups cover live authorization, transaction rollback and actual HTTP flows with DML-only runtime privileges. CRM adds store and HTTP groups for owner/assignment isolation, encrypted notes, optimistic conflicts, label-deletion revisions, literal combined filters and live revocation. Recovery adds two groups for reset transactions, delivery leases and actual HTTP flows; its CI evidence is pending. `npm run test:db` runs all fourteen groups sequentially; configure its separate synthetic runtime credentials as described in [auth-admin.md](auth-admin.md). The groups reset the same disposable fixtures and must not run concurrently. CRM is verified by the [verified CRM CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864); these checks do not constitute browser, penetration, load or hosting validation.

Official technical references: [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit), [GET_LOCK](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock), [CHECK and foreign-key constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint), [Node connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options).
