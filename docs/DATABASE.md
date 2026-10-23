# MariaDB — schema and runtime policies

The active experience profile, introduced in **1.9.0**, composes **33 immutable base migrations plus 3 immutable video migrations plus 2 immutable experience migrations: schema 38**. The sources remain in `db/migrations`, `server/video/migrations` and `server/experience/migrations`; `loadExperienceMigrations()` composes the plans. Their `CREATE TABLE` statements define **32 base application tables plus 3 video tables plus 1 preference table**; migration 0038 alters the existing task table. With the migration ledger separate, this is **36 application tables and 37 physical tables in the source plan**, without a new physical inventory of hosting. The ordinary and video loaders intentionally retain their separate schema 33 and 36 plans. Application version, migration count and encrypted-format versions are distinct; do not move, renumber or rewrite published migrations.

[REPRISE](REPRISE.md) records **application, private checkpoint and latest aligned at1.10.0 / Node v24.22.1**, according to the [final USER_REPORTED metadata receipt](verification-proofs/jm1100-hosted-metadata.json), `release1100_metadata_recorded`, source `51b0cf22e3adbad7ed26653e96706ba707aaf839`. The [UI identity](verification-proofs/jm1100-hosted-identity.json) retains displayed startup `23/10/2026 19:43:39`. **SQL38 is unchanged without a migration; final recording changed metadata only, without a restart. The delivery is closed: do not repeat preparation, CHECK, activation or the writer.** The reported field `applicationTables: 37` is retained as received. Neither this receipt nor this guide establishes a new physical inventory or complete hosted functional coverage. **Schema 33 or 36 runtimes must not start on the migrated database.** The compatible SQL38 rollback **1.8.5** is preserved, prechecked on the host and never started; older 1.8.4/1.7.2 must not start on SQL38. Commands below describe their explicit normal-profile or isolated setup scope; use only the pinned operator commands in REPRISE for the existing service. No migration runs at application startup.

[REPRISE](REPRISE.md) is the only current deployment record, including the active commit, hosting receipts, commands and compatible rollback. The [product scope](PRODUCT.md) and [daily guide](guide-jessie.md) describe available features. No default credentials, age-assurance provider, real messages or photos are supplied; fixtures are synthetic and use `example.invalid` addresses.

Historical qualification remains attributable to its original stage: CRM passed the [0.8 CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864); the [0.9 recovery CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) reported **461 general tests and 190 native tests per MariaDB version**. These historical results do not qualify later sources; their own evidence is linked from REPRISE.

## Dedicated database and compatibility

For a new installation or an isolated migration target, provision a new **empty database reserved for JessieMessage** in the hosting control panel. The existing production database is already initialized; these setup instructions are not a request to recreate it. Never use the existing ZTIKIX database or its credentials. Use a migration account scoped to that one database; it needs table/index/constraint DDL and ledger read/write privileges, but no global, `FILE`, user-administration or database-creation privileges. The default, strict application profile has only the required data privileges and read-only `SELECT` on the migration ledger to validate startup. It cannot change the schema or ledger; exact grants are documented in [auth-admin.md](auth-admin.md). The explicitly selected shared-hosting diagnostic profile below records a different permission boundary, including a writable ledger.

The runner requires MariaDB 10.11 or later and explicitly refuses MySQL. CI uses disposable MariaDB 10.11 and 11.4 instances. The production schema and current runtime identity are recorded in [REPRISE](REPRISE.md); no hosting check is inferred from this document.

**Historical hosting milestones.** The [stage-0.25 preparation](hosted-database-preparation.md) recorded a new empty database without users, MariaDB 10.11.19 in the Manager and a certificate/hostname-verified TLS 1.3 handshake from hosting SSH. The later owner-run migrator at `3a52a9e014e5f20a72be3e29521817dc822edb1f` produced a saved report at **17:05:47 UTC** confirming the Node TLS connection, engine checks, locking/history checks and **27 applied migrations**; that report was independently read and validated. The historical 0.33 runtime used schema 30, with thirty physical tables including the ledger, because migration 0028 changed a policy CHECK rather than adding a table. Its `photos-notify` preflight succeeded again on **17 October 2026**, as recorded in the [dated audit](AUDIT-2026-10-17.md), without starting another server. Those milestones and their former pending work do not describe the current deployment.

The pinned `mariadb` connector is used by the dedicated migration connection and, only when authentication is enabled, the bounded application pool. Pinned `otpauth` provides TOTP; pinned `nodemailer` provides SMTP with mandatory TLS. Passwords use Node's native scrypt. The default neutral HTTP server opens no database connection.

The [masked migration helper](private-migration-configuration.md) accepts the password through a hidden Bash read and stdin, retaining credentials only in the operator process. It provides explicitly confirmed `status`, fresh `initialize`, and clean applied-prefix `upgrade` operations using the existing migration machinery; it neither stores the password nor configures the public HTTP server.

### Explicit Infomaniak shared-hosting diagnostic profile

`JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE` selects the offline SQL preflight policy. An absent value means `strict`; an explicit `strict` is equivalent. An empty or unknown value is refused before opening a pool. This setting only changes the diagnostic permission policy: it does not provision an account, alter privileges, enable HTTP authentication or replace the configured server's physical schema assertions.

The [official Infomaniak permissions guide](https://www.infomaniak.com/fr/support/faq/1981/gerer-les-utilisateurs-et-bases-de-donnees-mysqlmariadb) and [shared-hosting actions table](https://www.infomaniak.com/fr/support/faq/2588/comprendre-les-actions-mysql-possibles), consulted on 15 October 2026, document three permission groups per database. The read/write group supplies `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TEMPORARY TABLES` and `LOCK TABLES`. It does not supply permanent-table administration. The shared-hosting administrator group does not document `GRANT OPTION`; MariaDB requires that permission for [GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant) and targeted [REVOKE](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/revoke). No documented fine-grained hosting API or phpMyAdmin procedure was found during this review; that is not proof that none exists.

Selecting `infomaniak-shared` explicitly accepts exactly those six read/write permissions on **one confirmed JessieMessage database**, plus global `USAGE`. The database grant must be exact: each underscore in a database-level grant is escaped as `\_`; raw underscores, percent wildcards, other escapes, other databases, table-scoped additions, global data privileges, administrator permissions, roles, PROXY and delegation are refused. The six rights may be split among statements for that same exact database. A separate migration account remains required; its administration rights fail both runtime policies.

Native account components may use apostrophes or backticks. Global `USAGE` may also carry native-password evidence, `REQUIRE SSL` and a single `WITH MAX_USER_CONNECTIONS` resource suffix containing a canonical integer from 0 through 2147483647. Other resource clauses, signs, decimal values, duplicates, unknown suffixes and delegation remain refused. This resource limit does not grant data or administration privileges. The [Infomaniak connection-limit guide](https://www.infomaniak.com/fr/support/faq/471/comprendre-les-limites-de-connexions-simultanees-a-mysql-mariadb) documents 38 connections per account for the current offer; CI configures only its synthetic shared-profile account to 38 and checks the resulting native `SHOW GRANTS` suffix. No hosted limit is changed, and the application pool remains bounded independently.

The fixed `privilegeObservation` report object includes `profile`, `source`, `ledgerWritable`, `tempTables`, `tableLocks` and `permanentDdl`. When the observed grants match this profile, it records `source: "show_grants"`, the first three booleans as `true`, and `permanentDdl: false`. Under a matching strict profile all four are `false`. Before a complete matching observation the source is `unverified` and all permission values are `null`; a failed connection or unexpected grant never claims absent permissions. These describe the inspected `SHOW GRANTS` evidence, not a certificate of every effective grant or hosting isolation. MariaDB can resolve rights from different matching host entries; see its [account matching rules](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant#account-name-matching-for-privilege-checks).

**This shared-hosting profile is not DML-only and does not protect the migration ledger from runtime writes.** A compromised SQL identity could modify ledger rows. Source checksum/history validation and the server's independent column, index, foreign-key and CHECK assertions remain mandatory, but do not make the ledger immutable. Temporary tables are [session-local and can shadow existing table names](https://mariadb.com/docs/server/server-usage/tables/create-table.md); [explicit table locks](https://mariadb.com/docs/server/reference/sql-statements/transactions/lock-tables) can affect availability. The application does not use either extra permission. Dedicated credentials, verified TLS, disabled multiple statements and parameterized application queries remain unchanged. A separate read-only ledger database would preserve a stronger boundary, but requires a separately reviewed runner, configuration, assertion and backup design; this lot does not move the existing ledger or change immutable migrations.

CI provisions a separate synthetic `jessiemessage_shared_test` account with exactly the six rights on the escaped disposable database pattern. Real SQL assertions exercise application DML and ledger INSERT/UPDATE/DELETE, rolling back row changes, and verify temporary-table/lock capability while permanent CREATE/ALTER/DROP/TRUNCATE are denied against known disposable fixture objects. The strict diagnostic still rejects that account. These fixtures never target hosting. Historical hosted grant observations and their limits are recorded in [REPRISE](REPRISE.md) and the [shared-database scope record](observed-shared-database-scope.md); fixture success does not establish a fresh production grant observation.

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

For an explicitly selected new or upgrade target, after configuration:

```sh
node scripts/migrate.mjs status
node scripts/migrate.mjs up
```

`status` reads migration history without creating tables in an empty schema. `up` initializes only an empty schema, creates the verified `schema_migrations` ledger and applies pending files in order. No automatic migration runs on HTTP startup or ordinary deployment. Review a backup and restore procedure before using this command with any data that matters.

## Tables and guarantees

| Table | Database guarantees |
|---|---|
| `users` | Exact 16-byte IDs; `admin`/`client` roles; pending/active/suspended/revoked/deleted status; unique binary-collated email; recorded email and approval gates required for an active client under the manual-admission policy; optional access expiry requires approval. |
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
| `broadcast_preferences` (`0023`) | Retained client-linked preference metadata, boolean value, positive optimistic uint64 version and ordered dates. Current individual delivery does not require client opt-in. |
| `broadcast_campaigns` (`0024`) | Administrator owner, unique caller retry ID, MFA approval epoch, ciphertext/fingerprint, optional media and maximum seven-day lifetime. |
| `broadcast_recipients` (`0025`) | Immutable target and message IDs, constrained states/reasons/leases, bounded failures and ordinary delivered-message foreign key. |
| `media_storage_state` (`0026`) | Singleton capacity lock, configured ceilings, private directory fingerprint and held-byte total. |
| `media_storage_objects` (`0027`) | Reserved/registered/cleanup/released objects, exact encrypted-file lengths, owner/asset bindings and durable release history. |
| `push_subscriptions` (`0029`) | User/session binding, role and credential generation, endpoint digest, encrypted subscription, locale and enabled state. |
| `push_outbox` (`0030`) | Unique message/subscription delivery, bounded attempts, readiness/expiry dates and constrained leases/terminal states. |
| `user_profiles` (`0031`) | User-linked optimistic version and optional avatar reference; the application additionally checks media ownership and availability. |
| `announcements` (`0032`) | One row per administrator, unique announcement ID, positive uint64 revision, retry fingerprint, encrypted text, ordered period and optional campaign link. |
| `crm_tasks` (`0033`) | Administrator-role and conversation foreign keys, positive uint32 version, encrypted title, optional deadline, boolean completion state and ordered dates. The application rechecks that the conversation belongs to that administrator. |

The administrator service generates cryptographic IDs and opaque session tokens, stores SHA-256 token digests and uses fixed-parameter scrypt hashes. Cookie handling, administrator MFA, anti-replay transactions, session revocation and persistent anti-abuse limits are implemented. Invitation redemption, pending-account registration and the encrypted verification job are atomic. Verified clients can sign in to a restricted account-status view; active access additionally requires the current invitation, email and manual-approval gates. Password hashes stay nullable for pending accounts. Tokens, addresses and passwords must never appear in logs.

Administrator setup and login currently validate ASCII email addresses and canonicalize them to lowercase. Client registration applies the same canonical policy before writing the unique value; binary comparison itself provides neither normalization nor mailbox equivalence. Pseudonyms are display values, not account identifiers.

Schema timestamps record gate completion; they do not prove lawful age assurance or administrator review. `access_days` is a proposed grant duration: the approval transaction computes expiry from approval time after the current invitation, email and manual-admission checks, then creates one conversation atomically. A static CHECK cannot enforce expiry as time passes. Client requests recheck expiry/revocation, current account status, access expiry and admission gates. Administrator requests already check session expiry/revocation, current active status and confirmed MFA version. Controlled administrator password/TOTP recovery is implemented in a private CLI. Opt-in client password recovery is implemented; its [historical recovery CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) is preserved. Current HTTPS/browser qualification and its limits are recorded in REPRISE. This documentation update adds no master-key rotation or new qualification.

Registration locks the current issuer and invitation, creates the pending account, consumes the invitation and queues its encrypted challenge in one transaction. Approval separately locks the client, validates its gates and records access plus conversation together. The schema alone does not prevent a privileged writer from replacing a consumption record. There are no cascade deletes. The implemented export and journaled account-closure paths enforce their own scope and checks; retained copies and broader retention limits are described in [PRODUCT](PRODUCT.md) and REPRISE.

CRM runtime transactions derive the administrator from the current session, then recheck assigned conversation ownership. A file may hold 32 labels; each administrator may create 100 labels of each kind. These application limits are enforced under the owner lock. Explicit full profile saves require the expected optimistic version and validate all owned labels before changing any fields or memberships. Notes are encrypted before persistence, with authenticated context including the administrator, conversation and next note revision; plaintext notes are absent from the database.

Deleting a label and its bindings increments each affected profile's optimistic `version` atomically. It leaves `notes_revision` and ciphertext unchanged: existing notes remain decryptable, and a draft based on an older label set cannot overwrite the file silently. A later explicit save increments the profile version and encrypts notes for that new revision. Label renames increment only the label version. Missing/foreign labels and version overflow roll back the entire mutation.

CRM contact search treats `%` and `_` literally and never searches notes. SQL filters combine tag and group membership, live access state, unread messages and reminder dates; returned contact pages contain neither email nor notes. The selected private profile may return its contact email and decrypted notes to its assigned administrator. The [historical CRM specification](private-crm.md) describes the original profile domain. Individual broadcast queues, Push subscriptions, content export and journaled account closure are implemented separately; their current scope is in [PRODUCT](PRODUCT.md). Assurance-provider integration, automatic segments and the deferred operational work in REPRISE are not enabled by this schema.

Private tasks use the existing CRM key with a distinct authenticated namespace. Their encrypted title is bound to the administrator, conversation, task ID, version, deadline and completion state. Stored fingerprints recognize retries; expected versions prevent silent overwrites across devices. Tasks are included in backup verification and removed with their client conversation during account closure. Their title and deadline are excluded from client exports. Task reminders are in-app only; the message-linked Push outbox is not used to notify a closed application about tasks.

## Client password recovery transactions

Recovery is opt-in and limited to clients whose current pending/active account has a password, verified email and an incrementable `client_auth_state.credential_version`. Expired active access is eligible for password recovery without being renewed. Administrators, unverified accounts and suspended/revoked/deleted clients are ineligible. Reset challenges store only a token digest, plus an email digest and credential-version snapshot; the separate outbox temporarily stores an encrypted `{email, token}` payload. Neither table stores a new password in plaintext.

Requesting a new challenge locks the user and client authentication state, then atomically revokes older outstanding challenges, cancels their queued jobs and inserts the new challenge/job. The password, client sessions, identity and access gates are unchanged. Failure rolls back the complete reissue.

Completion rechecks current eligibility, email hash, credential version, expiry and one-use state under locks after password hashing. One transaction updates the password and `users.updated_at`, increments the credential version once, consumes the selected challenge, revokes all other challenges and all client sessions, and cancels reset jobs. It does not change email/email proof, age declaration/assurance, approval, status, access expiry, conversations, CRM or media. Invalid or conflicting consumption writes nothing and creates no session. A stale login based on the old credential version cannot issue a current client session.

The reset-mail worker rechecks eligibility and challenge snapshots before claiming delivery. Its bounded indexed cleanup removes old reset-outbox records after seven days; it does not yet prune `client_password_resets` records. Challenge retention and account deletion remain part of the release privacy policy. Foreign keys use restriction, with no cascade delete or general-purpose cleanup. See [client recovery](client-recovery.md).

## Versioning, locking and interrupted DDL

Files in `db/migrations/` are consecutive `0001_name.sql` files. Once recorded in a database, the filename and SHA-256 of the complete source, including comments/whitespace, are immutable. Restore original source when history drifts; do not replace a recorded checksum to make an edited file pass. Missing historical files, history gaps or later entries after a dirty migration also stop execution before new application DDL.

The supported SQL format is deliberately narrow: **one unqualified InnoDB `CREATE TABLE (...)` per file**, with explicit default character set/collation and supported structural expressions, or the single reviewed atomic `users_active_client_gates` CHECK replacement used by migration **0028**. The validator rejects generic `ALTER TABLE`, executable comments, qualified cross-schema names, copies, alternate engines, routines and ledger references. These files are reviewed source code, not an interface for untrusted SQL; there is no general semicolon splitter. A migration can change a policy without adding a table, so migration and table inventories are checked separately.

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

The migration group covers ordered/repeatable application, read-only status, competing lock owners, immutable history, foundation constraints and interrupted DDL/recovery. Separate authentication/access/chat/media groups cover live authorization, transaction rollback and actual HTTP flows with DML-only runtime privileges. CRM adds store and HTTP groups for owner/assignment isolation, encrypted notes, optimistic conflicts, label-deletion revisions, literal combined filters and live revocation. Recovery covers reset transactions, delivery leases and actual HTTP flows. Announcements and tasks add their own transactional, encryption, conflict, retry and lifecycle cases. The current `test:db` command in [package.json](../package.json) is the authoritative list of groups and runs them sequentially; configure its separate synthetic runtime credentials as described in [auth-admin.md](auth-admin.md). The groups reset the same disposable fixtures and must not run concurrently. Historical [recovery](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) and [CRM](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864) results retain their original source and scope. Current CI evidence is linked from REPRISE; SQL tests do not constitute penetration, load or hosting validation.

The preflight integration group additionally requires `JESSIEMESSAGE_PREFLIGHT_DB_USER` and `JESSIEMESSAGE_PREFLIGHT_DB_PASSWORD`, separate from both the migrator and the shared test runtime. Precreate this synthetic account without privileges (`jessiemessage_preflight_test`, optionally followed by underscore-separated lowercase alphanumeric suffixes, at host `%`). Only in disposable CI, root repeats the migrator's existing database `ALL PRIVILEGES` with `GRANT OPTION` on the escaped, exact test-database pattern; repeating its existing rights avoids masking a less-specific original grant with a grant-option-only entry. No global account-administration privileges are granted. After applying the migrations, the fixture grants DML on each application table created by the current migration plan and only `SELECT` on `schema_migrations`. Its session explicitly enables `NO_AUTO_CREATE_USER` and its grants contain no authentication information, so a missing account is refused rather than created; see the [MariaDB GRANT reference](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant). Real SQL assertions verify that application DML succeeds, ledger `INSERT`/`UPDATE`/`DELETE` fail, and the checks leave rows unchanged. This extra test account and delegation never target hosting or change the shared runtime credentials used by other groups.

The same group also requires `JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER` and `JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD`, identifying the distinct precreated `jessiemessage_shared_test` fixture (optional lowercase alphanumeric suffixes). Root grants that fixture only the six documented read/write permissions on the escaped exact disposable database. No global rights, delegation, access to the restore database or persistent-schema DDL are added to this identity.

Official technical references: [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit), [GET_LOCK](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock), [CHECK and foreign-key constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint), [Node connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options).

## Historical individual-broadcast schema milestone (0.11)

Migrations 0023–0025 added `broadcast_preferences`, `broadcast_campaigns` and `broadcast_recipients`; earlier migrations were unchanged. At the original 0.11 milestone, preference absence disabled delivery and the preference used optimistic uint64 versions. Client opt-in was subsequently removed from individual delivery; this historical table does not reintroduce that gate. Campaign ownership is role constrained and retry IDs are unique per administrator. The approval stores a current MFA epoch rather than a browser session or cookie. Recipient rows persist proposed message and retry IDs, a recoverable lease and bounded failure state. Delivered message bindings reference the ordinary chat table. CHECK constraints bind states to reason, lease and delivery metadata.

Message, attachment, chat event and delivered recipient metadata commit together. Worker operations take live chat account/conversation locks before queue locks; confirmation and cancellation serialize through the same administrator row. The historical preference write path takes the client row before the preference. `assertSchema()` checks migration history, constraints, indices and foreign keys without applying migrations; the runtime privilege profiles are distinguished above. The current sequential SQL command is defined in [package.json](../package.json) and targets only a guarded disposable loopback schema. Broadcast history retention/purge is an explicit remaining operating decision.

## Historical media-capacity milestone (0.15)

Migrations 0026–0027 create tables only. Enabling media requires a separate explicit offline initialization after a complete private inventory, even for an empty database/directory. All historical media assets are imported, including tombstones whose old physical erasure is not proven. The application uses DML credentials; it never initializes counters or runs DDL at startup. Capacity reservations serialize on the singleton after current actor locks, and uncertain operations retain their charge. A different root identity or configured ceiling is refused. The later [manual restore operator](manual-restore-operator-078.md) defines the isolated target and controlled recovery path; its limits and the deferred PC work remain in REPRISE. See [operator procedure, structural-only inventory and recovery limits](media-capacity-inventory.md).
