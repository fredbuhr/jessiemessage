# Private photos and gallery — development 0.15 (foundation 0.7)

This lot adds one still image per message, an optional caption (up to 1,000 characters), conversation galleries and a reusable owner library. It extends the real private chat; the downloadable offline workbench remains fictional. No real photo or customer data is supplied in Git or CI.

## Private configuration

Keep administrator/access/chat configuration and apply all 27 reviewed migrations separately. Set `JESSIEMESSAGE_ENABLE_MEDIA=1`, `JESSIEMESSAGE_MEDIA_KEY` and `JESSIEMESSAGE_MEDIA_ROOT` explicitly. The key is a new cryptographically random 32-byte canonical base64url value (43 characters), different from the MFA, mail and message keys. No key is generated on startup or included in source. Missing/invalid configuration refuses startup; absent/`0` leaves media routes unregistered.

The media root must already exist as an owner-controlled `0700` absolute directory outside the entire checkout and public web root, with safe ancestor permissions. It cannot be an ancestor of the checkout either. Symlinks, unsafe ownership/modes and a root replaced after startup are rejected. Files are `0600`; the server never serves arbitrary filesystem paths. Provision this directory through the host's private filesystem controls, not inside `public`, `artifacts`, `design` or a Git checkout.

Both variants are encrypted with AES-256-GCM, a fresh nonce and authenticated asset/variant identifiers. Files are published exclusively and atomically from encrypted temporary content; there is no plaintext temporary image. Save this key separately with encrypted backups. Key rotation/re-encryption tooling is not yet provided. **The server decrypts authorized reads; this is not end-to-end encryption.**

Version 0.15 additionally requires explicit offline capacity initialization before starting enabled media, even for an empty directory. Defaults are 1 GiB per owner, 10 GiB globally and 512 MiB free margin, with configuration bound to the private directory identity. See [capacity reservations, inventory and initialization](media-capacity-inventory.md) before enabling this version.

## Input and processing

Only JPEG, PNG and WebP still images are accepted, with matching declared MIME and binary signature. Sources are at most 10 MiB, 16 million pixels, and 8,192 pixels per axis. Animated WebP/APNG, GIF, SVG, TIFF, HEIC and other formats are refused. Do not assume that every iPhone photo export matches an accepted format; device acceptance remains to test.

Sharp 0.35.5 is pinned with its native dependencies. A separate Node process permits only JPEG/PNG/WebP buffer loaders, rejects decoder warnings, applies EXIF orientation, converts/flattens to JPEG and removes metadata. The full variant is at most 2,048 pixels per axis, without enlargement (quality 85); the thumbnail is at most 480 (quality 80). Encoded bounds are 10 MiB and 512 KiB respectively. The source and filename are not retained. SHA-256 of the normalized full image supports deduplication scoped to the owner, without revealing cross-owner matches.

The decoder has one active job, two queued jobs and a 10-second active deadline. Hung/crashed jobs are killed and release their budget. Three complete upload requests at most are admitted simultaneously, including normalization and persistence; binary receipt is separately bounded to eight seconds. Upload rate budgets are 30/minute globally and 10/minute per authenticated owner; full reads are 20/minute per user, thumbnail reads 120/minute, asset removals 30/minute. The host must still supply appropriate CPU/memory, proxy and process limits; subprocess isolation is not a separate operating-system security boundary.

## Authorization and delivery

Every operation checks current role, session and account/access state through the same SQL transaction policies as chat. Clients need active, unexpired, independently assured access and a live creator; administrators need current MFA. Owner URLs cannot serve another user's assets. Delivery URLs additionally bind the assigned conversation, live message, attachment and its actual sender/owner. Received images cannot be resent by guessing their asset ID; uploading a copy is a separate owner asset.

An image send inserts the message, attachment and event atomically. The encrypted caption binds the attachment ID, and idempotency compares body fingerprint and attachment type/ID. A retry of a persisted photo returns the original message, including its tombstone after deletion. An explicit new send may reuse an owned asset; “Déjà envoyée ici” warns from that conversation's delivery history. A stored delivery or read receipt does not prove a photo was downloaded or viewed.

Only the author can delete a message. Its ciphertext is removed and the attachment disappears from future history/events/gallery and authorized delivery reads. The file remains if another live message needs it. The owner can remove an asset only after no live message references it; metadata is marked deleted before files are unlinked. Repeating removal can finish interrupted unlinking. Historical links remain for idempotency/audit, and re-uploading after removal can create a fresh active asset.

No deletion recalls screenshots, prior recipient copies, a transfer already authorized or backups. Retention, account export/erasure, backup deletion and operational cleanup policies remain release work.

## Browser behavior and routes

Photo controls appear only when the authenticated media capability is enabled. File selection and previews stay in memory. Upload happens before message send; retries keep the prepared asset and original message key. The library and gallery are paginated. Authorized thumbnail/full fetches are limited in the UI, with a bounded memory cache and revoked object URLs when hidden, switched, deleted or signed out. Images are not stored in localStorage, service-worker caches or the offline artifact.

All routes below use `role` = `admin` or `client`, the role's secure host cookie and no-store responses. Mutations require canonical Origin, current CSRF and JSON except the binary upload. Unknown/duplicate parameters, noncanonical identifiers/cursors, extra fields and oversized bodies are refused. There are no public asset URLs, raw storage handles or original filenames in DTOs.

| Route | Behavior |
| --- | --- |
| `GET /api/media/{role}/capabilities` | Formats and upload limit for current actor |
| `POST /api/media/{role}/assets` | Binary JPEG/PNG/WebP import; 201 new / 200 owned duplicate |
| `GET /api/media/{role}/assets` | Owner library; optional authorized `conversationId`, `afterId`, `limit` |
| `GET/HEAD …/assets/{id}/{full\|thumb}` | Live owner authorization and JPEG bytes |
| `POST …/assets/{id}/delete` | `{}`; reject while in use |
| `POST …/conversations/{id}/messages` | `{clientMessageId,mediaId,caption}`; atomic photo send |
| `GET …/conversations/{id}/gallery` | Newest-first live image deliveries; `before`, `limit` |
| `GET/HEAD …/conversations/{id}/messages/{messageId}/{full\|thumb}` | Per-delivery authorization and JPEG bytes |

JPEG responses have a neutral fixed filename, nosniff and no-store. Range requests receive the complete authorized resource, not partial-range storage access. Errors never echo decoder, database or filesystem details. Captions are rendered as text, including literal markup.

Eight binary reads/responses at most are admitted globally across roles. The slot stays held until processing and response completion; a client that closes while file processing is pending does not prematurely free it. Binary responses have a 15-second inactivity timeout. A busy upload/read returns a generic retry response before allocating another image buffer.

## Persistence and operational limits

Image files are written before the metadata transaction. A confirmed deduplication removes only that call's unused proposed files. If commit acknowledgement fails, encrypted files are preserved because metadata may already have committed. A bounded read-only inventory is implemented in 0.15; automatic orphan deletion and repair of uncertain reservations are not. Do not delete files merely because an HTTP request failed. Capacity is reserved before writing and retained through uncertain outcomes and failed erasure; only durable unlink followed by idempotent SQL release refunds it. Likewise, do not delete metadata or media keys without a backup/retention procedure. Cancelling an unsent photo leaves the owned asset available for explicit library removal.

Schema drift checks cover required columns, indexes, FKs, CHECK clauses and active deduplication. Unit/HTTP tests use real synthetic codecs and encrypted temporary storage. Separate sequential MariaDB 10.11/11.4 tests cover actual HTTP uploads, atomic delivery, owner/recipient isolation, expiry/revocation, deletion, deduplication and large cursors. Consult the exact successful CI revision before reporting this lot as verified.

No browser visual, HTTPS/mobile, penetration, load, restore or real Infomaniak acceptance is claimed. Production still needs SMTP, age-provider integration, client password recovery, legal/privacy gates and host configuration. No production migration, account or deployment is performed by this lot.

Implementation references: [Sharp security and resource guidance](https://sharp.pixelplumbing.com/security/), [allowed loaders/cache/concurrency](https://sharp.pixelplumbing.com/api-utility/), [metadata/output behavior](https://sharp.pixelplumbing.com/api-output/), [Node 24 HTTP timeouts](https://r2.nodejs.org/docs/latest-v24.x/api/http.html#serverrequesttimeout). Runtime input/processing policies above are stricter application choices, verified with synthetic tests.

Verified revision `6bec59cfda4c76b40adc45bc4916692ca121ca4c`: [CI 38650927708](https://github.com/fredbuhr/jessiemessage/actions/runs/38650927708) succeeds on Node.js 24.21.0 with 320 general tests (10 database groups skipped only in that no-database job), then 126 real tests without skips on each MariaDB 10.11 and 11.4. The added database groups contain 16 media persistence cases and 10 real media HTTP cases; codecs/storage use synthetic images only. Syntax/build pass, npm audit reports zero vulnerabilities, approved icon hashes are unchanged. [Draft PR #6](https://github.com/fredbuhr/jessiemessage/pull/6) is stacked on private messaging.
