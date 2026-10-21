#!/usr/bin/env python3
"""Record release 1.5.0 metadata and its prepared compatible rollback only.

Runtime identity comes from the user's admin readiness report, not a PID probe.
No service, SQL, migration, delivery, erasure or backup operation is performed.
"""
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

PRIVATE = Path('/srv/customer/jessiemessage-private')
CHECKPOINT = PRIVATE / 'jm0702-existing-pc-update.json'
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-150-abca467c')
SHA = 'abca467c45c9385371a9095ab359e78c99140370'
TREE = '3238dd2224ea768e3ab2f8bcb7594cc3890dd5e4'
LAUNCHER = PRIVATE / 'start-primary-release150-abca467c.sh'
LAUNCHER_SHA = '3620b656f528f3ad031bb4ad5f709df5ced0a21ff4326b4e5a5c4cdc6994105b'
CHECK_LAUNCHER = PRIVATE / 'check-primary-release150-abca467c.sh'
CHECK_LAUNCHER_SHA = 'e06b8356074a0980975f71d2d9cf88bf463a4f6fb583bb0b40346c005dc29770'
NODE = PRIVATE / 'runtime-node-v24.22.0/bin/node'
NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
PRECHECK_LOG = PRIVATE / 'jm150-preflight-abca467c.log'
# Exact canonical successful CHECK receipt from the pinned launcher code; not a staging-file observation.
PRECHECK_SHA_AFTER_SUCCESS = 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6'
EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
# Runtime identity comes from the user's actual 1.5.0 admin readiness report.
# Preserve the exact display without assuming its timezone or epoch.
ACTIVATION_ATTESTATION = 'admin_readiness_user_report'
REPORTED_STARTED_AT_DISPLAY = '21/10/2026 17:58:07'
# Exact CURRENT_ACTIVE of the pinned 1.4.0 recorder. Unknown top-level
# extensions are retained; 1.4.0 is not a usable rollback after schema32.
OLD_ACTIVE = {'source': '56d4595059df9292fc54ba4d4e948eeb793bae96',
 'tree': '8129e76c9817e79c062a4437eadee4b7ce4d90a1',
 'checkout': '/srv/customer/jessiemessage-operator/production-140-56d45950',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release140-56d45950.sh',
 'launcherSha256': '45f99cac50dc057f9be61f7db420dd7e64f92f76f67a8eaade1463780edff3b0',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release140-56d45950.sh',
 'checkLauncherSha256': '38e655a8e1e2be696707650aabc5e26c11ca9f7b1ac74d7b17ff23f6016deb4c',
 'log': '/srv/customer/jessiemessage-private/jm140-node2422.log',
 'release': '1.4.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 15:31:41',
              'precheckLogSha256AtStaging': 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6',
              'schemaEvidence': 'operator_reported_release140_joint_staged_prechecks_passed_schema31_unchanged',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}
ROLLBACK = {
    'source': 'bf022233fcb76ee4db89e0c33c64b9498adb9d50',
    'tree': 'a2f29930fe8ead853db6b6e8b76b613891ae4a04',
    'checkout': '/srv/customer/jessiemessage-operator/production-141-bf022233',
    'launcher': str(PRIVATE / 'start-primary-release141-bf022233.sh'),
    'launcherSha256': 'bf8a44e8560dd6f564f974d02349859e88fde539fe0cbe21dec9fa047917669d',
    'checkLauncher': str(PRIVATE / 'check-primary-release141-bf022233.sh'),
    'checkLauncherSha256': '1418da8240789d95cb494e65d01f97e2e319c491b6672d81984f1db013c724e7',
    'log': str(PRIVATE / 'jm141-node2422.log'),
    'precheckLog': str(PRIVATE / 'jm141-preflight-bf022233.log'),
    'precheckLogSha256': PRECHECK_SHA_AFTER_SUCCESS,
    'release': '1.4.1', 'nodeVersion': 'v24.22.0', 'schemaMigrations': 32,
    'mode': 'start-local-closures', 'closuresEnabled': True, 'port': 3000,
    'launcherMode': '0700', 'logMode': '0600',
    'status': 'hosted_precheck_passed_not_started', 'identityVerified': False,
    'announcementsEnabled': False, 'announcementsCompatible': True,
    'compactBroadcastsCompatible': True,
    'evidence': {'provenance': 'operator_release150_schema32_prechecks_user_report',
        'bothPrechecksPassed': True, 'rollback141HostedQualified': True,
        'schema32Confirmed': True, 'pendingClosures': False, 'runtimeStarted': False,
        'nodeBinarySha256': NODE_SHA,
        'limitations': ['runtime_identity_not_observed', 'pid_not_qualified',
            'socket_not_qualified', 'executed_binary_hash_not_qualified']}}
EVIDENCE = {'provenance': 'admin_readiness_user_report',
    'reportedStartedAtDisplay': REPORTED_STARTED_AT_DISPLAY,
    'precheckLogExpectedSha256AfterSuccessfulCheck': PRECHECK_SHA_AFTER_SUCCESS,
    'schemaEvidence': 'operator_reported_schema32_prechecks_passed',
    'limitations': ['pid_not_qualified', 'socket_not_qualified', 'executed_binary_hash_not_qualified',
        'runtime_private_configs_not_qualified', 'pc_not_qualified', 'backups_not_qualified',
        'reported_start_time_timezone_and_epoch_not_supplied']}
CURRENT_ACTIVE = {'source': SHA, 'tree': TREE, 'checkout': str(CHECKOUT),
    'launcher': str(LAUNCHER), 'launcherSha256': LAUNCHER_SHA,
    'checkLauncher': str(CHECK_LAUNCHER), 'checkLauncherSha256': CHECK_LAUNCHER_SHA,
    'log': str(PRIVATE / 'jm150-node2422.log'), 'release': '1.5.0', 'nodeAfterDeployment': 'v24.22.0',
    'schemaMigrations': 32, 'mode': 'start-local-closures', 'closuresEnabled': True, 'port': 3000,
    'launcherMode': '0700', 'logMode': '0600', 'status': 'identity_verified_via_admin_report', 'evidence': EVIDENCE}


class RecordError(Exception):
    pass


def require(ok, code):
    if not ok: raise RecordError(code)


def verify_activation():
    require(ACTIVATION_ATTESTATION == 'admin_readiness_user_report', 'ACTIVATION_NOT_CONFIRMED')
    require(type(REPORTED_STARTED_AT_DISPLAY) is str, 'ACTIVATION_NOT_CONFIRMED')
    try:
        instant = datetime.strptime(REPORTED_STARTED_AT_DISPLAY, '%d/%m/%Y %H:%M:%S')
    except ValueError:
        raise RecordError('ACTIVATION_NOT_CONFIRMED') from None
    require(instant.strftime('%d/%m/%Y %H:%M:%S') == REPORTED_STARTED_AT_DISPLAY
            and EVIDENCE['reportedStartedAtDisplay'] == REPORTED_STARTED_AT_DISPLAY
            and CURRENT_ACTIVE['evidence'] == EVIDENCE, 'ACTIVATION_NOT_CONFIRMED')


def regular(value, mode):
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1
            and stat.S_IMODE(value.st_mode) == mode, 'FILE_METADATA')


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        while chunk := source.read(1024 * 1024): value.update(chunk)
    return value.hexdigest()


def verify_pins():
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    def verify_source(checkout, sha, tree):
        checkout = Path(checkout)
        require(checkout.is_dir() and not checkout.is_symlink(), 'SOURCE_DIRECTORY')
        def git(*args):
            result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                '-c', 'core.hooksPath=/dev/null', '-C', str(checkout), *args], env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            require(result.returncode == 0 and len(result.stdout) <= 8192, 'SOURCE_UNAVAILABLE')
            return result.stdout.decode('utf-8').strip()
        require(git('rev-parse', '--show-toplevel') == str(checkout.resolve()), 'SOURCE_ROOT')
        require(git('rev-parse', 'HEAD') == sha and git('rev-parse', 'HEAD^{tree}') == tree, 'SOURCE_IDENTITY')
        require(git('status', '--porcelain', '--untracked-files=normal') == '' and git('rev-parse', 'HEAD') == sha, 'SOURCE_CHANGED')
    verify_source(CHECKOUT, SHA, TREE)
    verify_source(ROLLBACK['checkout'], ROLLBACK['source'], ROLLBACK['tree'])
    for path, expected in ((LAUNCHER, LAUNCHER_SHA), (CHECK_LAUNCHER, CHECK_LAUNCHER_SHA),
            (Path(ROLLBACK['launcher']), ROLLBACK['launcherSha256']),
            (Path(ROLLBACK['checkLauncher']), ROLLBACK['checkLauncherSha256']), (NODE, NODE_SHA)):
        regular(path.lstat(), 0o700)
        require(digest(path) == expected, 'PIN_MISMATCH')
    # Manager Build may append another successful receipt to the active precheck
    # log after CHECK. The canonical receipt hash is evidence, not its current pin.
    regular(PRECHECK_LOG.lstat(), 0o600)
    rollback_precheck = Path(ROLLBACK['precheckLog'])
    regular(rollback_precheck.lstat(), 0o600)
    require(digest(rollback_precheck) == ROLLBACK['precheckLogSha256'], 'PRECHECK_PIN_MISMATCH')
    for path in (Path(CURRENT_ACTIVE['log']), Path(ROLLBACK['log'])):
        regular(path.lstat(), 0o600)
    require(digest(Path(ROLLBACK['log'])) == EMPTY_SHA, 'ROLLBACK_RUNTIME_LOG_CHANGED')


def old_identity(value):
    return isinstance(value, dict) and all(type(value.get(key)) is type(expected) and value[key] == expected for key, expected in OLD_ACTIVE.items())


def rollback_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def prepare(document, recorded_at):
    verify_activation()
    require(isinstance(document, dict) and isinstance(document.get('developmentSimplification'), dict), 'CHECKPOINT_SHAPE')
    active = document.get('activeService')
    section = document['developmentSimplification'].get('release150')
    if section is not None:
        require(isinstance(section, dict) and isinstance(section.get('recordedAt'), str), 'EXISTING_SECTION')
        instant = datetime.fromisoformat(section['recordedAt'].replace('Z', '+00:00'))
        require(instant.tzinfo is not None and instant.utcoffset().total_seconds() == 0, 'EXISTING_DATE')
        prior = section.get('priorActiveService')
        expected = {'status': 'identity_verified_via_admin_report', 'recordedAt': section['recordedAt'], **EVIDENCE,
            'priorActiveService': prior, 'priorActiveServiceSha256': rollback_digest(prior),
            'priorActiveServiceUsableRollback': False,
            'rollback': ROLLBACK, 'rollbackSha256': rollback_digest(ROLLBACK)}
        require(old_identity(prior) and rollback_digest(section) == rollback_digest(expected)
            and rollback_digest(active) == rollback_digest(CURRENT_ACTIVE), 'EXISTING_SECTION_DIVERGENT')
        return copy.deepcopy(document), True
    require('release150' not in document['developmentSimplification'] and old_identity(active), 'OLD_IDENTITY')
    updated = copy.deepcopy(document)
    updated['developmentSimplification']['release150'] = {'status': 'identity_verified_via_admin_report',
        'recordedAt': recorded_at, **copy.deepcopy(EVIDENCE),
        'priorActiveService': copy.deepcopy(active), 'priorActiveServiceSha256': rollback_digest(active),
        'priorActiveServiceUsableRollback': False,
        'rollback': copy.deepcopy(ROLLBACK), 'rollbackSha256': rollback_digest(ROLLBACK)}
    updated['activeService'] = copy.deepcopy(CURRENT_ACTIVE)
    require(updated['developmentSimplification']['release150']['priorActiveService'] == active
        and updated['developmentSimplification']['release150']['rollback'] == ROLLBACK, 'PRIOR_ACTIVE_CHANGED')
    preserved = copy.deepcopy(updated)
    preserved['activeService'] = active
    del preserved['developmentSimplification']['release150']
    require(preserved == document, 'OTHER_BLOCKS_CHANGED')
    return updated, False


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_KEY')
        result[key] = value
    return result


def fingerprint(value):
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def record(path=CHECKPOINT):
    verify_activation()  # Require the complete pinned report before private-file reads.
    verify_pins()
    path = Path(path)
    regular(path.lstat(), 0o600)
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    temporary = None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = os.fstat(fd); regular(before, 0o600)
        require(before.st_size <= 2 * 1024 * 1024, 'CHECKPOINT_LIMIT')
        original = os.pread(fd, 2 * 1024 * 1024 + 1, 0)
        require(len(original) == before.st_size, 'CHECKPOINT_CHANGED')
        document = json.loads(original, object_pairs_hook=unique_object)
        updated, already = prepare(document, datetime.now(timezone.utc).isoformat())
        def unchanged():
            current = path.lstat(); regular(current, 0o600)
            require(fingerprint(current) == fingerprint(before) == fingerprint(os.fstat(fd))
                and os.pread(fd, len(original) + 1, 0) == original, 'CHECKPOINT_CHANGED')
        unchanged()
        if not already:
            payload = (json.dumps(updated, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
            require(len(payload) <= 2 * 1024 * 1024, 'CHECKPOINT_LIMIT')
            out_fd, temporary = tempfile.mkstemp(prefix='.release150-', dir=path.parent)
            with os.fdopen(out_fd, 'wb') as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(payload); output.flush(); os.fsync(output.fileno())
            unchanged()  # Detect drift immediately before replace; not a universal CAS.
            os.replace(temporary, path); temporary = None
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
            regular(path.lstat(), 0o600)
            require(json.loads(path.read_bytes(), object_pairs_hook=unique_object) == updated, 'READBACK_MISMATCH')
        return {'status': 'release150_metadata_already_recorded' if already else 'release150_metadata_recorded',
            'source': SHA, 'version': '1.5.0', 'metadataOnly': True, 'noRestart': True,
            'rollbackPreserved': True, 'rollbackRelease': '1.4.1', 'schemaMigrations': 32,
            'priorActivePreserved': True, 'priorActiveUsableRollback': False,
            'rollback141HostedQualified': True, 'otherBlocksPreserved': True}
    finally:
        if temporary is not None: os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'USAGE')
        result = record(); exit_code = 0
    except RecordError as error:
        result = {'status': 'release150_metadata_unconfirmed', 'code': str(error), 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    except Exception:
        result = {'status': 'release150_metadata_unconfirmed', 'code': 'RECORD_UNAVAILABLE', 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    print(json.dumps(result, separators=(',', ':')))
    sys.exit(exit_code)
