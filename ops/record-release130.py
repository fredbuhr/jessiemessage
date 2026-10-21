#!/usr/bin/env python3
"""Align only the existing private delivery JSON. Never starts a service."""
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
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-130-afd0e98c')
SHA = 'afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b'
TREE = '37b3b2e9358972c95581fc0bcf16896e4074d5f9'
LAUNCHER = PRIVATE / 'start-primary-release130-afd0e98c.sh'
LAUNCHER_SHA = '7bc16887caa01e0644ef200f9ab099049963af9fa1f6db0ad7a1c37bec7232d5'
CHECK_LAUNCHER = PRIVATE / 'check-primary-release130-afd0e98c.sh'
CHECK_LAUNCHER_SHA = 'af327346122802092763969269e17e3f48b73b2bf704bb04d06d78c1dfdd3815'
NODE = PRIVATE / 'runtime-node-v24.22.0/bin/node'
NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
OLD_ACTIVE = {'source': '763b632185ce13eb875110c9107687b2d278ff67',
 'tree': 'c7dce7bcdb99b298ffc43c9e31dd22ee87453926',
 'checkout': '/srv/customer/jessiemessage-operator/production-120-763b6321',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh',
 'launcherSha256': 'f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release120-763b6321.sh',
 'checkLauncherSha256': 'b5e7a6ef89c3fca613944757699ecb26b80a53838234fb84302ef1466fff3810',
 'log': '/srv/customer/jessiemessage-private/jm120-node2422.log',
 'release': '1.2.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 00:21:24',
              'schemaEvidence': 'operator_reported_schema31_prechecks_passed',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}
ROLLBACK = copy.deepcopy(OLD_ACTIVE)
EVIDENCE = {'provenance': 'admin_readiness_user_report',
    'reportedStartedAtDisplay': '21/10/2026 01:50:02',
    'schemaEvidence': 'operator_reported_release130_staged_precheck_passed_schema31_unchanged',
    'limitations': ['pid_not_qualified', 'socket_not_qualified', 'executed_binary_hash_not_qualified',
        'runtime_private_configs_not_qualified', 'pc_not_qualified', 'backups_not_qualified',
        'reported_start_time_timezone_and_epoch_not_supplied']}
CURRENT_ACTIVE = {'source': SHA, 'tree': TREE, 'checkout': str(CHECKOUT),
    'launcher': str(LAUNCHER), 'launcherSha256': LAUNCHER_SHA,
    'checkLauncher': str(CHECK_LAUNCHER), 'checkLauncherSha256': CHECK_LAUNCHER_SHA,
    'log': str(PRIVATE / 'jm130-node2422.log'), 'release': '1.3.0', 'nodeAfterDeployment': 'v24.22.0',
    'schemaMigrations': 31, 'mode': 'start-local-closures', 'closuresEnabled': True, 'port': 3000,
    'launcherMode': '0700', 'logMode': '0600', 'status': 'identity_verified_via_admin_report', 'evidence': EVIDENCE}


class RecordError(Exception):
    pass


def require(ok, code):
    if not ok: raise RecordError(code)


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
    for path in (Path(CURRENT_ACTIVE['log']), Path(ROLLBACK['log'])):
        regular(path.lstat(), 0o600)


def old_identity(value):
    return isinstance(value, dict) and all(type(value.get(key)) is type(expected) and value[key] == expected for key, expected in OLD_ACTIVE.items())


def rollback_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def prepare(document, recorded_at):
    require(isinstance(document, dict) and isinstance(document.get('developmentSimplification'), dict), 'CHECKPOINT_SHAPE')
    active = document.get('activeService')
    section = document['developmentSimplification'].get('release130')
    if section is not None:
        require(isinstance(section, dict) and isinstance(section.get('recordedAt'), str), 'EXISTING_SECTION')
        instant = datetime.fromisoformat(section['recordedAt'].replace('Z', '+00:00'))
        require(instant.tzinfo is not None and instant.utcoffset().total_seconds() == 0, 'EXISTING_DATE')
        prior = section.get('priorActiveService')
        expected = {'status': 'identity_verified_via_admin_report', 'recordedAt': section['recordedAt'], **EVIDENCE,
            'priorActiveService': prior, 'priorActiveServiceSha256': rollback_digest(prior),
            'priorActiveServiceUsableRollback': True,
            'rollback': prior, 'rollbackSha256': rollback_digest(prior)}
        require(old_identity(prior) and rollback_digest(section) == rollback_digest(expected)
            and rollback_digest(active) == rollback_digest(CURRENT_ACTIVE), 'EXISTING_SECTION_DIVERGENT')
        return copy.deepcopy(document), True
    require('release130' not in document['developmentSimplification'] and old_identity(active), 'OLD_IDENTITY')
    updated = copy.deepcopy(document)
    updated['developmentSimplification']['release130'] = {'status': 'identity_verified_via_admin_report',
        'recordedAt': recorded_at, **copy.deepcopy(EVIDENCE),
        'priorActiveService': copy.deepcopy(active), 'priorActiveServiceSha256': rollback_digest(active),
        'priorActiveServiceUsableRollback': True,
        'rollback': copy.deepcopy(active), 'rollbackSha256': rollback_digest(active)}
    updated['activeService'] = copy.deepcopy(CURRENT_ACTIVE)
    require(updated['developmentSimplification']['release130']['priorActiveService'] == active
        and updated['developmentSimplification']['release130']['rollback'] == active, 'PRIOR_ACTIVE_CHANGED')
    preserved = copy.deepcopy(updated)
    preserved['activeService'] = active
    del preserved['developmentSimplification']['release130']
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
            out_fd, temporary = tempfile.mkstemp(prefix='.release130-', dir=path.parent)
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
        return {'status': 'release130_metadata_already_recorded' if already else 'release130_metadata_recorded',
            'source': SHA, 'version': '1.3.0', 'metadataOnly': True, 'noRestart': True,
            'rollbackPreserved': True, 'rollbackRelease': '1.2.0', 'schemaMigrations': 31,
            'priorActivePreserved': True, 'otherBlocksPreserved': True}
    finally:
        if temporary is not None: os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'USAGE')
        result = record(); exit_code = 0
    except RecordError as error:
        result = {'status': 'release130_metadata_unconfirmed', 'code': str(error), 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    except Exception:
        result = {'status': 'release130_metadata_unconfirmed', 'code': 'RECORD_UNAVAILABLE', 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    print(json.dumps(result, separators=(',', ':')))
    sys.exit(exit_code)
