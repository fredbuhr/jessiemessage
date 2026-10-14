# MariaDB foundation — development only

Eight immutable migrations now supply the four original foundation tables plus administrator MFA, recovery codes, session state and persistent rate limits. The migration command remains explicit. Version 0.4 can separately enable MariaDB-backed administrator authentication and its one-time private setup CLI; see [administrator configuration](auth-admin.md). No default administrator, active invitation links, client signup or private messages/media are supplied. All fixtures are synthetic and use `example.invalid` addresses.

## Dedicated database and compatibility

Provision a new **empty database reserved for JessieMessage** in the hosting control panel. Never use the existing ZTIKIX database or its credentials. Use a migration account scoped to that one database; it needs table/index/constraint DDL and ledger read/write privileges, but no global, `FILE`, user-administration or database-creation privileges. The separate application account has only the required data privileges and read-only `SELECT` on the migration ledger to validate startup. It cannot change the schema or ledger; exact grants are documented in [auth-admin.md](auth-admin.md).

The runner requires MariaDB 10.11 or later. CI exercises disposable MariaDB 10.11 and 11.4. Infomaniak's actual database engine/version, TLS certificate chain, available grants and `GET_LOCK` capability for this account **have not been verified**. Verify them in the Manager and on a disposable dedicated schema before any hosting integration. MySQL is explicitly refused. This batch does not deploy or migrate production.

The pinned `mariadb` connector is used by the dedicated migration connection and, only when authentication is enabled, the bounded application pool. Pinned `otpauth` provides TOTP; passwords use Node's native scrypt. The default neutral HTTP server opens no database connection.

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

The administrator service generates cryptographic IDs and opaque session tokens, stores SHA-256 token digests and uses fixed-parameter scrypt hashes. Cookie handling, administrator MFA, anti-replay transactions, session revocation and persistent anti-abuse limits are implemented in this development lot. Invitation redemption and client authentication remain pending. Password hashes stay nullable for pending accounts. Tokens, addresses and passwords must never appear in logs.

Administrator setup and login currently validate ASCII email addresses and canonicalize them to lowercase. The future client service must apply a deliberate compatible policy before writing the unique value; binary comparison itself provides neither normalization nor mailbox equivalence. Pseudonyms are display values, not account identifiers.

Schema timestamps record gate completion; they do not prove lawful age assurance or administrator review. `access_days` is a proposed grant duration, not automatic access: a future activation transaction must calculate the actual account access expiry after all gates succeed. A static CHECK cannot enforce expiry as time passes. Every future client request must check expiry/revocation and current account status, access expiry and onboarding gates. Administrator requests already check session expiry/revocation, current active status and confirmed MFA version. Password recovery, MFA rotation and HTTPS browser acceptance remain launch work.

Single-use redemption must use a transaction with row locking or a conditional consumed/revoked/expiry update and verify exactly one affected row. Account/conversation creation and consumption need to succeed together. The schema alone does not prevent a privileged writer from replacing a consumption record. There are no cascade deletes: retention, exports and account deletion need a separate reviewed policy.

Messages, media, assurance-provider references, notes, tags, segments, bulk sends and Push subscriptions are intentionally deferred.

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

The migration group covers ordered/repeatable application, read-only status, competing lock owners, immutable history, foundation constraints and interrupted DDL/recovery. The separate authentication group covers concurrent MFA/recovery consumption, transaction rollback, revocation, expiry, schema validation, DML-only privileges and a real HTTP login/session/logout path. `npm run test:db` runs these groups sequentially; configure its separate synthetic runtime credentials as described in [auth-admin.md](auth-admin.md). The groups reset the same disposable fixtures and must not run concurrently. These checks do not constitute browser, penetration, load or hosting validation.

Official technical references: [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit), [GET_LOCK](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock), [CHECK and foreign-key constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint), [Node connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options).
