# MariaDB foundation — development only

Twenty-seven immutable migrations now supply the foundation/administrator tables plus client state, email verification, client sessions, encrypted mail jobs, encrypted text messages, read receipts, change events, media assets, message attachments, private CRM profiles/labels/memberships, client password-reset challenges, a separate encrypted reset outbox, client broadcast preferences, encrypted immutable campaigns and durable recipients, plus persistent media capacity and storage-object accounting. The migration command remains explicit. Version 0.9 separately enables administrator authentication/recovery and [invited client onboarding](invitations-client-access.md). Optional [private text chat](private-messaging.md) uses the existing conversations. Optional [photo transfer and gallery](private-media.md) use separate encrypted files outside the checkout. Optional [private CRM](private-crm.md) uses administrator-owned tables. No default credentials, age-assurance provider, real messages or photos are supplied. All fixtures are synthetic and use `example.invalid` addresses. CRM passed the [verified 0.8 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864); recovery 0.9 passes the [verified recovery CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) with 461 general tests and 190 real tests per MariaDB version.

## Dedicated database and compatibility

Provision a new **empty database reserved for JessieMessage** in the hosting control panel. Never use the existing ZTIKIX database or its credentials. Use a migration account scoped to that one database; it needs table/index/constraint DDL and ledger read/write privileges, but no global, `FILE`, user-administration or database-creation privileges. The default, strict application profile has only the required data privileges and read-only `SELECT` on the migration ledger to validate startup. It cannot change the schema or ledger; exact grants are documented in [auth-admin.md](auth-admin.md). The explicitly selected shared-hosting diagnostic profile below records a different permission boundary, including a writable ledger.

The runner requires MariaDB 10.11 or later. CI exercises disposable MariaDB 10.11 and 11.4. The [hosted preparation at stage 0.25](hosted-database-preparation.md) records a new empty database without users, MariaDB 10.11.19 in the Manager and a certificate/hostname-verified TLS 1.3 handshake from hosting SSH. The later owner-run migrator at `3a52a9e014e5f20a72be3e29521817dc822edb1f` produced a saved report at 17:05:47 UTC confirming the Node TLS connection, engine checks, the migration runner’s locking/history checks and all 27 migrations applied. The report was independently read and validated. Hosted runtime grants and all physical-schema constraints **remain unverified**. MySQL is explicitly refused. This batch does not deploy or migrate production.

The pinned `mariadb` connector is used by the dedicated migration connection and, only when authentication is enabled, the bounded application pool. Pinned `otpauth` provides TOTP; pinned `nodemailer` provides SMTP with mandatory TLS. Passwords use Node's native scrypt. The default neutral HTTP server opens no database connection.

The [masked migration helper](private-migration-configuration.md) accepts the password through a hidden Bash read and stdin, retaining credentials only in the operator process. It provides explicitly confirmed `status` and fresh `initialize` operations using the existing migration machinery; it neither stores the password nor configures the public HTTP server.

### Explicit Infomaniak shared-hosting diagnostic profile

`JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE` selects the offline SQL preflight policy. An absent value means `strict`; an explicit `strict` is equivalent. An empty or unknown value is refused before opening a pool. This setting only changes the diagnostic permission policy: it does not provision an account, alter privileges, enable HTTP authentication or replace the configured server's physical schema assertions.

The [official Infomaniak permissions guide](https://www.infomaniak.com/fr/support/faq/1981/gerer-les-utilisateurs-et-bases-de-donnees-mysqlmariadb) and [shared-hosting actions table](https://www.infomaniak.com/fr/support/faq/2588/comprendre-les-actions-mysql-possibles), consulted on 15 October 2026, document three permission groups per database. The read/write group supplies `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TEMPORARY TABLES` and `LOCK TABLES`. It does not supply permanent-table administration. The shared-hosting administrator group does not document `GRANT OPTION`; MariaDB requires that permission for [GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant) and targeted [REVOKE](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/revoke). No documented fine-grained hosting API or phpMyAdmin procedure was found during this review; that is not proof that none exists.

Selecting `infomaniak-shared` explicitly accepts exactly those six read/write permissions on **one confirmed JessieMessage database**, plus global `USAGE`. The database grant must be exact: each underscore in a database-level grant is escaped as `\_`; raw underscores, percent wildcards, other escapes, other databases, table-scoped additions, global data privileges, administrator permissions, roles, PROXY and delegation are refused. The six rights may be split among statements for that same exact database. A separate migration account remains required; its administration rights fail both runtime policies.

Native account components may use apostrophes or backticks. Global `USAGE` may also carry native-password evidence, `REQUIRE SSL` and a single `WITH MAX_USER_CONNECTIONS` resource suffix containing a canonical integer from 0 through 2147483647. Other resource clauses, signs, decimal values, duplicates, unknown suffixes and delegation remain refused. This resource limit does not grant data or administration privileges. The [Infomaniak connection-limit guide](https://www.infomaniak.com/fr/support/faq/471/comprendre-les-limites-de-connexions-simultanees-a-mysql-mariadb) documents 38 connections per account for the current offer; CI configures only its synthetic shared-profile account to 38 and checks the resulting native `SHOW GRANTS` suffix. No hosted limit is changed, and the application pool remains bounded independently.

The fixed `privilegeObservation` report object includes `profile`, `source`, `ledgerWritable`, `tempTables`, `tableLocks` and `permanentDdl`. When the observed grants match this profile, it records `source: "show_grants"`, the first three booleans as `true`, and `permanentDdl: false`. Under a matching strict profile all four are `false`. Before a complete matching observation the source is `unverified` and all permission values are `null`; a failed connection or unexpected grant never claims absent permissions. These describe the inspected `SHOW GRANTS` evidence, not a certificate of every effective grant or hosting isolation. MariaDB can resolve rights from different matching host entries; see its [account matching rules](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant#account-name-matching-for-privilege-checks).

**This shared-hosting profile is not DML-only and does not protect the migration ledger from runtime writes.** A compromised SQL identity could modify ledger rows. Source checksum/history validation and the server's independent column, index, foreign-key and CHECK assertions remain mandatory, but do not make the ledger immutable. Temporary tables are [session-local and can shadow existing table names](https://mariadb.com/docs/server/server-usage/tables/create-table.md); [explicit table locks](https://mariadb.com/docs/server/reference/sql-statements/transactions/lock-tables) can affect availability. The application does not use either extra permission. Dedicated credentials, verified TLS, disabled multiple statements and parameterized application queries remain unchanged. A separate read-only ledger database would preserve a stronger boundary, but requires a separately reviewed runner, configuration, assertion and backup design; this lot does not move the existing ledger or change immutable migrations.

CI provisions a separate synthetic `jessiemessage_shared_test` account with exactly the six rights on the escaped disposable database pattern. Real SQL assertions exercise application DML and ledger INSERT/UPDATE/DELETE, rolling back row changes, and verify temporary-table/lock capability while permanent CREATE/ALTER/DROP/TRUNCATE are denied against known disposable fixture objects. The strict diagnostic still rejects that account. These fixtures never target hosting; actual hosted grants and acceptance remain to verify before any activation.

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
| `broadcast_preferences` (`0023`) | Client credential owner, explicit boolean choice, positive optimistic uint64 version and ordered dates. |
| `broadcast_campaigns` (`0024`) | Administrator owner, unique caller retry ID, MFA approval epoch, ciphertext/fingerprint, optional media and maximum seven-day lifetime. |
| `broadcast_recipients` (`0025`) | Immutable target and message IDs, constrained states/reasons/leases, bounded failures and ordinary delivered-message foreign key. |
| `media_storage_state` (`0026`) | Singleton capacity lock, configured ceilings, private directory fingerprint and held-byte total. |
| `media_storage_objects` (`0027`) | Reserved/registered/cleanup/released objects, exact encrypted-file lengths, owner/asset bindings and durable release history. |

The administrator service generates cryptographic IDs and opaque session tokens, stores SHA-256 token digests and uses fixed-parameter scrypt hashes. Cookie handling, administrator MFA, anti-replay transactions, session revocation and persistent anti-abuse limits are implemented in this development lot. Invitation redemption, pending-account registration and the encrypted verification job are atomic. Verified clients can sign in to a restricted account-status view; active access additionally requires the recorded age/approval gates. Password hashes stay nullable for pending accounts. Tokens, addresses and passwords must never appear in logs.

Administrator setup and login currently validate ASCII email addresses and canonicalize them to lowercase. Client registration applies the same canonical policy before writing the unique value; binary comparison itself provides neither normalization nor mailbox equivalence. Pseudonyms are display values, not account identifiers.

Schema timestamps record gate completion; they do not prove lawful age assurance or administrator review. `access_days` is a proposed grant duration: the approval transaction computes expiry from approval time only after email and age-assurance gates succeed, then creates one conversation atomically. A static CHECK cannot enforce expiry as time passes. Every future client request must check expiry/revocation and current account status, access expiry and onboarding gates. Administrator requests already check session expiry/revocation, current active status and confirmed MFA version. Controlled administrator password/TOTP recovery is implemented in a private CLI. Opt-in client password recovery is implemented; its [verified recovery CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) passes. Master-key rotation and HTTPS browser acceptance remain launch work.

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

The migration group covers ordered/repeatable application, read-only status, competing lock owners, immutable history, foundation constraints and interrupted DDL/recovery. Separate authentication/access/chat/media groups cover live authorization, transaction rollback and actual HTTP flows with DML-only runtime privileges. CRM adds store and HTTP groups for owner/assignment isolation, encrypted notes, optimistic conflicts, label-deletion revisions, literal combined filters and live revocation. Recovery adds two groups for reset transactions, delivery leases and actual HTTP flows; its [verified recovery CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) passes. `npm run test:db` runs all twenty-three groups sequentially; configure its separate synthetic runtime credentials as described in [auth-admin.md](auth-admin.md). The groups reset the same disposable fixtures and must not run concurrently. CRM is verified by the [verified CRM CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864); these checks do not constitute browser, penetration, load or hosting validation.

The preflight integration group additionally requires `JESSIEMESSAGE_PREFLIGHT_DB_USER` and `JESSIEMESSAGE_PREFLIGHT_DB_PASSWORD`, separate from both the migrator and the shared test runtime. Precreate this synthetic account without privileges (`jessiemessage_preflight_test`, optionally followed by underscore-separated lowercase alphanumeric suffixes, at host `%`). Only in disposable CI, root repeats the migrator's existing database `ALL PRIVILEGES` with `GRANT OPTION` on the escaped, exact test-database pattern; repeating its existing rights avoids masking a less-specific original grant with a grant-option-only entry. No global account-administration privileges are granted. After applying the migrations, the fixture grants DML on each of the 27 known application tables and only `SELECT` on `schema_migrations`. Its session explicitly enables `NO_AUTO_CREATE_USER` and its grants contain no authentication information, so a missing account is refused rather than created; see the [MariaDB GRANT reference](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant). Real SQL assertions verify that application DML succeeds, ledger `INSERT`/`UPDATE`/`DELETE` fail, and the checks leave rows unchanged. This extra test account and delegation never target hosting or change the shared runtime credentials used by other groups.

The same group also requires `JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER` and `JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD`, identifying the distinct precreated `jessiemessage_shared_test` fixture (optional lowercase alphanumeric suffixes). Root grants that fixture only the six documented read/write permissions on the escaped exact disposable database. No global rights, delegation, access to the restore database or persistent-schema DDL are added to this identity.

Official technical references: [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit), [GET_LOCK](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock), [CHECK and foreign-key constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint), [Node connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options).

## Individual broadcasts (0.11)

Migrations 0023–0025 add `broadcast_preferences`, `broadcast_campaigns` and `broadcast_recipients`; earlier migrations are unchanged. Preferences reference client credentials, default to disabled when absent and use optimistic uint64 versions. Campaign ownership is role constrained and retry IDs are unique per administrator. The approval stores a current MFA epoch rather than a browser session or cookie. Recipient rows persist proposed message and retry IDs, a recoverable lease and bounded failure state. Delivered message bindings reference the ordinary chat table. CHECK constraints bind states to reason, lease and delivery metadata.

Message, attachment, chat event and delivered recipient metadata commit together. Worker operations take live chat account/conversation locks before queue locks; confirmation and cancellation serialize through the same administrator row. Client preference writes take the client row before the preference. Runtime remains DML-only; `assertSchema()` checks the full migration history, constraints, indices and foreign keys without applying migrations. The eighteen DB test groups run sequentially against a guarded disposable loopback schema. Broadcast history retention/purge is an explicit remaining operating decision.

## Media capacity initialization (0.15)

Migrations 0026–0027 create tables only. Enabling media requires a separate explicit offline initialization after a complete private inventory, even for an empty database/directory. All historical media assets are imported, including tombstones whose old physical erasure is not proven. The application uses DML credentials; it never initializes counters or runs DDL at startup. Capacity reservations serialize on the singleton after current actor locks, and uncertain operations retain their charge. A different root identity or configured ceiling is refused; controlled rebinding and restore tooling remain to implement. See [operator procedure, structural-only inventory and recovery limits](media-capacity-inventory.md).
