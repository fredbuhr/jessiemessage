#!/usr/bin/env python3
"""Bounded read-only account/runtime diagnosis for the last reported active 1.11.3.

No login, password request, mail delivery, migration, restart or persistent output.
The checkpoint identity is observed separately; no live process is qualified.
The selected email is entered locally without echo and sent to Node only by stdin.
Only enum states, booleans, counts and public process identity leave this script.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import termios
import urllib.error
import urllib.request

PRIVATE = Path('/srv/customer/jessiemessage-private')
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1113-89571636')
DEPENDENCIES = Path('/srv/customer/jessiemessage-operator/production-1101-9eb99f1f/node_modules')
SOURCE = '89571636d6fde97b28b5e8aec9257801c1b71f8b'
TREE = 'e16a22043ea00908afa37cad64e5f9b421f4e5ae'
CHECKPOINT_SHA = '3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f'
STAGING_SHA = '7c1a51e0033e329b3daaf3ee8895a989f67e13c42199f7c4e6ac2907afbd8282'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
BUNDLE_SHA = 'bcca2f3fd91ffc0dec51a7077eb9e192a53b6e653b60c7db7159e473b83aac85'
BUNDLE_NAMES = sorted(['runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json', 'runtime-video.json'])
CURRENT_STEP = 'not_started'
REFUSAL_CODES = frozenset({
    'FILE_PATH', 'FILE_METADATA', 'FILE_IDENTITY', 'FILE_CHANGED', 'FILE_SIZE', 'DIRECTORY',
    'COMMAND_UNCONFIRMED', 'COMMAND_OUTPUT_SIZE', 'ACTIVE_CHECKPOINT_CHANGED', 'STAGING_CHANGED',
    'NODE_CHANGED', 'NODE_VERSION', 'CHECKOUT', 'SOURCE', 'TREE', 'TRACKED_FILES_CHANGED',
    'DEPENDENCY_LINK', 'CONFIGURATION_FILES', 'CONFIGURATION_CHANGED', 'STARTUP_RECORD',
    'TERMINAL_REQUIRED', 'TERMINAL_IDENTITY', 'EMAIL_INPUT', 'ACCOUNT_OUTPUT', 'PRIVATE_OUTPUT',
    'CHECKPOINT_CHANGED_DURING_READ'})

# This module has no top-level side effects. Native tests exercise the same SELECTs
# against disposable migrated databases. The production entry is appended below.
NODE_MODULE = r'''
export const sql = Object.freeze({
  clock: "SELECT UTC_TIMESTAMP(6) AS utc_now, @@session.time_zone AS session_timezone",
  user: `SELECT u.id, u.role, u.status, u.password_hash IS NOT NULL AS password_present,
    u.email_verified_at, u.access_approved_at, u.access_expires_at, c.credential_version
    FROM users u LEFT JOIN client_auth_state c ON c.user_id = u.id WHERE u.email = ? LIMIT 1`,
  invitations: `SELECT COUNT(*) AS total, MIN(consumed_at) AS first_consumed, MAX(consumed_at) AS last_consumed
    FROM invitations WHERE consumed_by_id = ? AND consumed_at IS NOT NULL`,
  sessions: `SELECT COUNT(*) AS total,
    COALESCE(SUM(s.created_at >= ?), 0) AS created_last_hour,
    COALESCE(SUM(c.session_id IS NULL), 0) AS missing_client_state,
    COALESCE(SUM(c.credential_version <> ?), 0) AS credential_mismatch,
    COALESCE(SUM(s.revoked_at IS NOT NULL), 0) AS revoked,
    COALESCE(SUM(s.expires_at <= ?), 0) AS expired,
    COALESCE(SUM(s.created_at > ? OR c.last_seen_at > ? OR c.last_seen_at < s.created_at), 0) AS invalid_chronology,
    COALESCE(SUM(s.revoked_at IS NULL AND s.expires_at > ? AND s.created_at <= ?
      AND c.last_seen_at >= s.created_at AND c.last_seen_at <= ? AND c.credential_version = ?), 0) AS usable_persisted
    FROM sessions s LEFT JOIN client_session_state c ON c.session_id = s.id WHERE s.user_id = ?`,
  verifications: `SELECT COUNT(*) AS total,
    COALESCE(SUM(consumed_at IS NOT NULL), 0) AS consumed,
    COALESCE(SUM(revoked_at IS NOT NULL), 0) AS revoked,
    COALESCE(SUM(consumed_at IS NULL AND revoked_at IS NULL AND expires_at <= ?), 0) AS expired_unused,
    COALESCE(SUM(consumed_at IS NULL AND revoked_at IS NULL AND created_at <= ? AND expires_at > ?), 0) AS available
    FROM email_verifications WHERE user_id = ?`,
  mail: `SELECT COUNT(*) AS total,
    COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'sending'), 0) AS sending,
    COALESCE(SUM(status = 'sent'), 0) AS sent, COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
    COALESCE(SUM(status = 'failed'), 0) AS failed,
    COALESCE(SUM(last_error = 'MAIL_DELIVERY_FAILED'), 0) AS delivery_error,
    COALESCE(SUM(last_error = 'PAYLOAD_INVALID'), 0) AS payload_error,
    COALESCE(SUM(status <> 'sent' AND expires_at <= ?), 0) AS expired_unsent
    FROM mail_outbox WHERE recipient_user_id = ?`
});
const count = value => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw Error('COUNT'); return n;
};
const counts = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, count(v)]));
const instant = value => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(value)) throw Error('DATE');
  const result = Date.parse(value.replace(' ', 'T') + 'Z');
  if (!Number.isSafeInteger(result)) throw Error('DATE'); return result;
};
const date = value => new Date(value).toISOString().replace('T', ' ').replace('Z', '000');
export async function inspectAccount(connection, email, clock = Date.now) {
  // No SELECT FOR UPDATE and no calls to application stores: even their session
  // readers may touch last_seen_at. Server-enforced READ ONLY is an extra guard.
  await connection.query('SET TRANSACTION READ ONLY');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  try {
    const before = clock();
    const [time] = await connection.query(sql.clock);
    const now = clock(); const dbNow = instant(time.utc_now);
    const rows = await connection.query(sql.user, [email]);
    const output = { clock: { observedAt: now, databaseSkewMilliseconds: Math.round(dbNow - (before + now) / 2),
      sessionUtc: time.session_timezone === '+00:00' }, account: { found: rows.length === 1 }, passwordMatchChecked: false };
    if (!rows.length) return output;
    const u = rows[0];
    if (!['admin', 'client'].includes(u.role) || !['pending', 'active', 'suspended', 'revoked', 'deleted'].includes(u.status)) throw Error('STATE');
    const [inv] = await connection.query(sql.invitations, [u.id]);
    const verified = instant(u.email_verified_at), approved = instant(u.access_approved_at), expiry = instant(u.access_expires_at);
    const consumed = instant(inv.last_consumed), invitationCount = count(inv.total);
    const credential = u.credential_version === null ? null : count(u.credential_version);
    const loginEligible = u.role === 'client' && ['pending', 'active'].includes(u.status)
      && verified !== null && verified <= now && Boolean(u.password_present) && credential > 0;
    const admission = invitationCount === 1 && consumed <= now;
    const approval = approved !== null && approved <= now && consumed !== null && approved >= consumed;
    output.account = { found: true, role: u.role, status: u.status, authStatePresent: credential !== null,
      credentialVersionValid: credential > 0, passwordPresent: Boolean(u.password_present),
      emailVerified: verified !== null, verificationNotFuture: verified !== null && verified <= now,
      approved: approved !== null, approvalNotFuture: approved !== null && approved <= now,
      invitationCount, invitationNotFuture: consumed !== null && consumed <= now,
      approvalAfterInvitation: approval, accessExpired: expiry !== null && expiry <= now,
      loginEligibleWithoutPasswordCheck: loginEligible,
      freshLoginAccountGatesPass: loginEligible && admission && (u.status !== 'active' || approval),
      resendVerificationEligibleWithoutPasswordCheck: u.role === 'client' && u.status === 'pending'
        && verified === null && Boolean(u.password_present) && credential > 0 };
    const stamp = date(now);
    const [sessions] = await connection.query(sql.sessions, [date(now - 3600000), credential ?? 0,
      stamp, stamp, stamp, stamp, stamp, stamp, credential ?? 0, u.id]);
    const [verifications] = await connection.query(sql.verifications, [stamp, stamp, stamp, u.id]);
    const [mail] = await connection.query(sql.mail, [stamp, u.id]);
    output.sessions = counts(sessions); output.verifications = counts(verifications); output.verificationMail = counts(mail);
    return output;
  } finally { await connection.query('ROLLBACK'); }
}
'''

NODE_ENTRY = r'''
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
let pool, connection;
try {
  const root = pathToFileURL(process.argv[1] + '/');
  const config = await import(new URL('server/config/runtime-database-file.mjs', root));
  const { canonicalEmail } = await import(new URL('server/auth/config.mjs', root));
  const { createRuntimePool } = await import(new URL('server/db/runtime.mjs', root));
  const input = JSON.parse(await readFile('/dev/stdin', 'utf8'));
  const email = canonicalEmail(input.email);
  const value = await config.readRuntimeDatabaseConfiguration(process.argv[2]);
  pool = await createRuntimePool(config.runtimeDatabaseEnvironment(value));
  connection = await pool.getConnection();
  await connection.query('SET SESSION max_statement_time = 5');
  const result = await inspectAccount(connection, email);
  await connection.release(); connection = null;
  await pool.end(); pool = null;
  process.stdout.write(JSON.stringify(result));
} catch {
  process.exitCode = 1; process.stderr.write('ACCOUNT_READ_ONLY_UNCONFIRMED\n');
} finally {
  try { if (connection) await connection.release(); } catch { process.exitCode = 1; }
  try { if (pool) await pool.end(); } catch { process.exitCode = 1; }
}
'''


class Refused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Refused(code)


def file(path, mode=0o600, limit=2 * 1024 * 1024, growing=False, hash_only=False):
    require(path.is_absolute() and path.resolve() == path, 'FILE_PATH')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
        and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == mode and before.st_size <= limit, 'FILE_METADATA')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        first = os.fstat(handle.fileno())
        require((before.st_dev, before.st_ino) == (first.st_dev, first.st_ino), 'FILE_IDENTITY')
        if hash_only:
            aggregate = hashlib.sha256()
            while chunk := handle.read(262144):
                aggregate.update(chunk)
            data = aggregate.hexdigest()
        else:
            data = handle.read(before.st_size if growing else limit + 1)
        last = os.fstat(handle.fileno())
    after = path.lstat()
    keys = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink') if growing else (
        'st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(all(len({getattr(s, k) for s in (before, first, last, after)}) == 1 for k in keys), 'FILE_CHANGED')
    require(hash_only or len(data) <= limit, 'FILE_SIZE')
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_directory(path):
    s = path.lstat()
    require(path.resolve() == path and stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid()
        and stat.S_IMODE(s.st_mode) == 0o700, 'DIRECTORY')


def command(args, *, data=None, timeout=25):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, check=False,
        env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
             'GIT_TERMINAL_PROMPT': '0', 'JESSIEMESSAGE_PRIVATE_PATH_MODE': 'linux-dirfd'})
    require(result.returncode == 0, 'COMMAND_UNCONFIRMED')
    require(len(result.stdout) <= 65536, 'COMMAND_OUTPUT_SIZE')
    return result.stdout


# Exact narrow baseline reader qualified separately; no file writes at import.
BASELINE_MODULE = '#!/usr/bin/env python3\n"""Read only the narrow checkpoint identity before preparing release 1.12.0.\n\nNo SQL, authentication, mail, network, logs, subprocesses or file writes.\nThis observation neither qualifies the running process nor updates metadata.\n"""\nimport hashlib\nimport json\nimport os\nfrom pathlib import Path\nimport re\nimport stat\nimport sys\n\nCHECKPOINT_PATH = Path(\'/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json\')\nLIMIT = 1024 * 1024\nFORMAT = \'jessiemessage-release1120-baseline\'\nIDENTITIES = {\n    \'1.11.2\': (\'af352607ff7e12c41185f42b8232c72219a304cd\', \'655f759079979d608b0ec1c62a7c892311899515\'),\n    \'1.11.3\': (\'89571636d6fde97b28b5e8aec9257801c1b71f8b\', \'e16a22043ea00908afa37cad64e5f9b421f4e5ae\'),\n}\n\n\nclass InspectionRefused(Exception):\n    pass\n\n\ndef require(ok):\n    if not ok:\n        raise InspectionRefused(\'BASELINE_CHECK_FAILED\')\n\n\ndef fingerprint(value):\n    return tuple(getattr(value, name) for name in (\'st_dev\', \'st_ino\', \'st_mode\',\n        \'st_uid\', \'st_nlink\', \'st_size\', \'st_mtime_ns\', \'st_ctime_ns\'))\n\n\ndef file_metadata(value, uid):\n    require(stat.S_ISREG(value.st_mode) and value.st_uid == uid\n        and stat.S_IMODE(value.st_mode) == 0o600 and value.st_nlink == 1\n        and 0 < value.st_size <= LIMIT)\n\n\ndef unique_object(pairs):\n    result = {}\n    for key, value in pairs:\n        require(key not in result)\n        result[key] = value\n    return result\n\n\ndef reject_constant(_value):\n    raise InspectionRefused(\'BASELINE_CHECK_FAILED\')\n\n\ndef read(path, uid):\n    """Return only validated public identity fields; never return raw JSON."""\n    try:\n        require(type(uid) is int and uid >= 0)\n        path = Path(path)\n        require(path.is_absolute() and path.resolve(strict=True) == path)\n        before = path.lstat()\n        file_metadata(before, uid)\n        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)\n        try:\n            opened = os.fstat(fd)\n            file_metadata(opened, uid)\n            require(fingerprint(before) == fingerprint(opened))\n            with os.fdopen(fd, \'rb\') as handle:\n                fd = None\n                raw = handle.read(LIMIT + 1)\n                after = os.fstat(handle.fileno())\n                final = path.lstat()\n                file_metadata(after, uid)\n                file_metadata(final, uid)\n                require(len(raw) == before.st_size\n                    and fingerprint(before) == fingerprint(after) == fingerprint(final))\n        finally:\n            if fd is not None:\n                os.close(fd)\n        document = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)\n        require(type(document) is dict)\n        active = document.get(\'activeService\')\n        development = document.get(\'developmentSimplification\')\n        require(type(active) is dict and type(development) is dict)\n        release = active.get(\'release\')\n        require(type(release) is str and release in IDENTITIES)\n        source, tree = IDENTITIES[release]\n        require(active.get(\'source\') == source and active.get(\'tree\') == tree\n            and active.get(\'nodeAfterDeployment\') == \'v24.22.1\'\n            and type(active.get(\'schemaMigrations\')) is int and active[\'schemaMigrations\'] == 38)\n        present = \'release1113\' in development\n        section = development.get(\'release1113\')\n        require(not present or type(section) is dict)\n        result = dict(format=FORMAT, version=1, status=\'release1120_read_only_baseline\',\n            noPersistentWrite=True, checkpointSha256=hashlib.sha256(raw).hexdigest(),\n            activeService={key: active[key] for key in (\'release\', \'source\', \'tree\', \'nodeAfterDeployment\', \'schemaMigrations\')},\n            release1113MetadataPresent=present)\n        if present and \'priorCheckpointSha256\' in section:\n            prior = section[\'priorCheckpointSha256\']\n            require(type(prior) is str and re.fullmatch(\'[a-f0-9]{64}\', prior) is not None)\n            result[\'priorCheckpointSha256\'] = prior\n        return result\n    except InspectionRefused:\n        raise\n    except Exception:\n        raise InspectionRefused(\'BASELINE_CHECK_FAILED\') from None\n\n\ndef main(argv=None):\n    try:\n        require(not (sys.argv[1:] if argv is None else argv))\n        result = read(CHECKPOINT_PATH, os.getuid())\n        print(json.dumps(result, separators=(\',\', \':\'), allow_nan=False))\n        return 0\n    except Exception:\n        print(json.dumps(dict(format=FORMAT, version=1, status=\'release1120_baseline_unconfirmed\',\n            noPersistentWrite=True, code=\'BASELINE_CHECK_FAILED\'), separators=(\',\', \':\')))\n        return 1\n\n\nif __name__ == \'__main__\':\n    raise SystemExit(main())\n'

def baseline_namespace():
    ns = {"__name__": "jm1120_embedded_baseline"}
    exec(compile(BASELINE_MODULE, "<embedded-read-only-baseline>", "exec"), ns)
    return ns

def read_baseline_checkpoint():
    try:
        return baseline_namespace()["read"](PRIVATE / "jm0702-existing-pc-update.json", os.getuid())
    except Exception:
        raise Refused("ACTIVE_CHECKPOINT_CHANGED") from None


def preflight():
    global CURRENT_STEP
    CURRENT_STEP = 'private_directory'
    private_directory(PRIVATE)
    checkpoint = PRIVATE / 'jm0702-existing-pc-update.json'
    CURRENT_STEP = 'active_checkpoint'
    baseline = read_baseline_checkpoint()
    CURRENT_STEP = 'staging_receipt'
    require(digest(file(PRIVATE / 'jm1113-staging.json')) == STAGING_SHA, 'STAGING_CHANGED')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    CURRENT_STEP = 'node_binary'
    require(file(node, 0o700, 256 * 1024 * 1024, hash_only=True) == NODE_SHA, 'NODE_CHANGED')
    CURRENT_STEP = 'node_version'
    require(command([str(node), '--version']).strip() == b'v24.22.1', 'NODE_VERSION')
    CURRENT_STEP = 'checkout_source'
    require(CHECKOUT.resolve() == CHECKOUT and CHECKOUT.is_dir(), 'CHECKOUT')
    base = ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', str(CHECKOUT)]
    require(command(base + ['rev-parse', 'HEAD']).decode().strip() == SOURCE, 'SOURCE')
    require(command(base + ['rev-parse', 'HEAD^{tree}']).decode().strip() == TREE, 'TREE')
    require(command(base + ['status', '--porcelain', '--untracked-files=no']).strip() == b'', 'TRACKED_FILES_CHANGED')
    CURRENT_STEP = 'dependency_link'
    link = CHECKOUT / 'node_modules'
    require(link.is_symlink() and link.resolve() == DEPENDENCIES, 'DEPENDENCY_LINK')
    bundle = PRIVATE / 'runtime-video-180'
    CURRENT_STEP = 'configuration_bundle'
    private_directory(bundle)
    require(sorted(p.name for p in bundle.iterdir()) == BUNDLE_NAMES, 'CONFIGURATION_FILES')
    aggregate = hashlib.sha256()
    for name in BUNDLE_NAMES:
        data = file(bundle / name, limit=16384)
        aggregate.update(name.encode() + b'\0' + str(len(data)).encode() + b'\0' + data)
    require(aggregate.hexdigest() == BUNDLE_SHA, 'CONFIGURATION_CHANGED')
    return node, bundle, baseline


def startup_summary():
    data = file(PRIVATE / 'jm1113-node24221.log', limit=16 * 1024 * 1024, growing=True)
    records = []
    malformed = 0
    for line in data.splitlines():
        if b'application_started' not in line:
            continue
        try:
            value = json.loads(line)
            r = value['release']
            require(value.get('type') == 'application_started' and type(r) is dict
                and r.get('version') == '1.11.2' and r.get('commit') == SOURCE
                and r.get('nodeVersion') == 'v24.22.1' and type(r.get('startedAt')) is int
                and 0 < r['startedAt'] < 253402300800000, 'STARTUP_RECORD')
            records.append(r['startedAt'])
        except (ValueError, KeyError, TypeError, Refused):
            malformed += 1
    return {'matchingStartupRecords': len(records), 'otherOrMalformedStartupRecords': malformed,
        'firstStartedAt': min(records) if records else None, 'lastStartedAt': max(records) if records else None,
        'originalStartupPresent': 1792946135648 in records, 'liveProcessIdentityProven': False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def classify_http(status, body, location=''):
    lower = body.lower()
    provider = b'infomaniak' in lower and (b'undergoing maintenance' in lower or b'under maintenance' in lower)
    if provider:
        kind = 'provider_maintenance'
    elif body.strip() == b'{"status":"ok"}':
        kind = 'app_health'
    elif body.strip() == b'{"status":"ready"}':
        kind = 'app_ready'
    elif body.strip() in (b'{"status":"unavailable"}', b'{"error":"service_unavailable"}'):
        kind = 'app_unavailable'
    elif b'access.js' in body and b'jessiemessage' in lower:
        kind = 'app_access_html'
    elif b'auth.js' in body and b'jessiemessage' in lower:
        kind = 'app_auth_html'
    elif status == 404 and body.strip() == b'Not found':
        kind = 'app_not_found'
    else:
        kind = 'other'
    return {'status': status, 'kind': kind, 'redirect': location if location in ('/admin/login', '/access') else bool(location)}


def public_http():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    results = {}
    for route in ('/api/health', '/api/ready', '/access', '/admin', '/admin/', '/admin/login'):
        try:
            request = urllib.request.Request('https://jessiemessage.com' + route,
                headers={'Accept': 'text/html' if route.startswith('/admin') else '*/*', 'Cache-Control': 'no-cache'})
            try:
                response = opener.open(request, timeout=6)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                results[route] = classify_http(response.status, response.read(32768), response.headers.get('Location', ''))
        except (OSError, ValueError):
            results[route] = {'status': None, 'kind': 'network_unconfirmed', 'redirect': False}
    return results


def local_email():
    # Heredoc consumes stdin. Web SSH can also lack a controlling /dev/tty while
    # stderr/stdout still use a real PTY. Borrow that terminal without assigning
    # a controlling terminal; never fall back to echoed input or a pipe.
    terminal = next((fd for fd in (2, 1) if os.isatty(fd)), None)
    path = os.ttyname(terminal) if terminal is not None else '/dev/tty'
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NOFOLLOW)
    try:
        require(os.isatty(fd), 'TERMINAL_REQUIRED')
        if terminal is not None:
            require(os.fstat(fd).st_rdev == os.fstat(terminal).st_rdev, 'TERMINAL_IDENTITY')
        original = termios.tcgetattr(fd)
        hidden = original[:]
        hidden[3] = (hidden[3] | termios.ICANON) & ~(termios.ECHO | termios.ECHONL)
        try:
            termios.tcsetattr(fd, termios.TCSAFLUSH, hidden)
            os.write(fd, 'Adresse e-mail du compte à examiner (saisie masquée) : '.encode())
            raw = os.read(fd, 1024)
        finally:
            termios.tcsetattr(fd, termios.TCSAFLUSH, original)
            os.write(fd, b'\n')
        require(raw.endswith(b'\n') and len(raw) <= 255, 'EMAIL_INPUT')
        value = raw[:-1].decode('ascii')
    finally:
        os.close(fd)
    require(0 < len(value) <= 254 and value == value.strip() and '\n' not in value and '\r' not in value, 'EMAIL_INPUT')
    return value


def inspect():
    global CURRENT_STEP
    node, bundle, baseline = preflight()
    CURRENT_STEP = 'local_email_terminal'
    email = local_email()
    CURRENT_STEP = 'account_read_only_node'
    raw = command([str(node), '--input-type=module', '--eval', NODE_MODULE + NODE_ENTRY, str(CHECKOUT), str(bundle)],
        data=json.dumps({'email': email}).encode(), timeout=60)
    result = json.loads(raw)
    CURRENT_STEP = 'account_output_validation'
    require(type(result) is dict and set(result) <= {'clock', 'account', 'passwordMatchChecked', 'sessions', 'verifications', 'verificationMail'}
        and type(result.get('account')) is dict and result.get('passwordMatchChecked') is False, 'ACCOUNT_OUTPUT')
    # The email and all potential secret column names/values are never printed.
    require(email.casefold() not in raw.decode().casefold(), 'PRIVATE_OUTPUT')
    CURRENT_STEP = 'final_checkpoint'
    require(digest(file(PRIVATE / 'jm0702-existing-pc-update.json')) == baseline['checkpointSha256'], 'CHECKPOINT_CHANGED_DURING_READ')
    return {'status': 'access1113_read_only_diagnostic', 'source': SOURCE, 'noLogin': True,
        'noMail': True, 'noRestart': True, 'noMigration': True, 'noPersistentWrite': True, 'runtimeIdentityChecked': False, 'baseline': baseline, 'checks': result}


def main():
    try:
        print(json.dumps(inspect(), ensure_ascii=True, separators=(',', ':')), flush=True)
        return 0
    except (Exception, KeyboardInterrupt) as error:
        # Never print the exception message, SQL, subprocess stderr or a path.
        if isinstance(error, Refused) and error.args and error.args[0] in REFUSAL_CODES:
            reason = error.args[0]
        else:
            kind = type(error).__name__
            reason = kind if kind in ('OSError', 'FileNotFoundError', 'PermissionError',
                'UnsupportedOperation', 'TimeoutExpired', 'JSONDecodeError', 'UnicodeDecodeError',
                'KeyboardInterrupt', 'ValueError') else 'UNEXPECTED_EXCEPTION'
        result = {'status': 'access1113_read_only_diagnostic_not_confirmed', 'step': CURRENT_STEP,
            'reason': reason, 'noAccountMutation': True, 'noMail': True, 'noRestart': True}
        if isinstance(error, OSError) and type(error.errno) is int and 0 < error.errno < 4096:
            result['errno'] = error.errno
        print(json.dumps(result, separators=(',', ':')), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
