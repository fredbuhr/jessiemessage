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
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-100-70b48aa8')
SHA = '70b48aa845b70ca960724c8d37a6e94b3d5f47a8'
TREE = '485cade0aeeee41cb4c34f913cd98f6078c4636b'
LAUNCHER = PRIVATE / 'start-primary-release100-70b48aa8.sh'
LAUNCHER_SHA = 'aa400abaa54033308acce7f4b28649b33d4ecc5f7098eec7b020c05631123248'
NODE = PRIVATE / 'runtime-node-v24.22.0/bin/node'
NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
OLD_ACTIVE = {'source': 'c61d1eecfefe786254416652877ba82d30cf4c90',
    'tree': '78c8e46224503b0691b381bf07c5aefd51ca5c7f',
    'checkout': '/srv/customer/jessiemessage-operator/production-086-c61d1eec',
    'launcher': str(PRIVATE / 'start-primary-node2422-c61d1eec.sh'),
    'launcherSha256': 'e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881',
    'release': '0.86.0', 'nodeAfterDeployment': 'v24.22.0'}
EVIDENCE = {'provenance': 'admin_readiness_user_report',
    'reportedStartedAtDisplay': '20/10/2026 21:16:28',
    'limitations': ['pid_not_qualified', 'socket_not_qualified', 'executed_binary_hash_not_qualified',
        'runtime_private_configs_not_qualified', 'pc_not_qualified', 'backups_not_qualified',
        'reported_start_time_timezone_and_epoch_not_supplied']}
CURRENT_ACTIVE = {'source': SHA, 'tree': TREE, 'checkout': str(CHECKOUT),
    'launcher': str(LAUNCHER), 'launcherSha256': LAUNCHER_SHA,
    'log': str(PRIVATE / 'jm100-node2422.log'), 'release': '1.0.0', 'nodeAfterDeployment': 'v24.22.0',
    'mode': 'start-local-closures', 'closuresEnabled': True, 'port': 3000,
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
    require(CHECKOUT.is_dir() and not CHECKOUT.is_symlink(), 'SOURCE_DIRECTORY')
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    def git(*args):
        result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
            '-c', 'core.hooksPath=/dev/null', '-C', str(CHECKOUT), *args], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        require(result.returncode == 0 and len(result.stdout) <= 8192, 'SOURCE_UNAVAILABLE')
        return result.stdout.decode('utf-8').strip()
    require(git('rev-parse', '--show-toplevel') == str(CHECKOUT.resolve()), 'SOURCE_ROOT')
    require(git('rev-parse', 'HEAD') == SHA and git('rev-parse', 'HEAD^{tree}') == TREE, 'SOURCE_IDENTITY')
    require(git('status', '--porcelain', '--untracked-files=normal') == '' and git('rev-parse', 'HEAD') == SHA, 'SOURCE_CHANGED')
    for path, expected in ((LAUNCHER, LAUNCHER_SHA), (NODE, NODE_SHA)):
        regular(path.lstat(), 0o700)
        require(digest(path) == expected, 'PIN_MISMATCH')


def old_identity(value):
    return isinstance(value, dict) and all(type(value.get(key)) is type(expected) and value[key] == expected for key, expected in OLD_ACTIVE.items())


def rollback_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def prepare(document, recorded_at):
    require(isinstance(document, dict) and isinstance(document.get('developmentSimplification'), dict), 'CHECKPOINT_SHAPE')
    active = document.get('activeService')
    section = document['developmentSimplification'].get('release100')
    if section is not None:
        require(isinstance(section, dict) and isinstance(section.get('recordedAt'), str), 'EXISTING_SECTION')
        instant = datetime.fromisoformat(section['recordedAt'].replace('Z', '+00:00'))
        require(instant.tzinfo is not None and instant.utcoffset().total_seconds() == 0, 'EXISTING_DATE')
        rollback = section.get('rollback')
        expected = {'status': 'identity_verified_via_admin_report', 'recordedAt': section['recordedAt'], **EVIDENCE,
            'rollback': rollback, 'rollbackSha256': rollback_digest(rollback)}
        require(old_identity(rollback) and section == expected and active == CURRENT_ACTIVE, 'EXISTING_SECTION_DIVERGENT')
        return copy.deepcopy(document), True
    require('release100' not in document['developmentSimplification'] and old_identity(active), 'OLD_IDENTITY')
    updated = copy.deepcopy(document)
    updated['developmentSimplification']['release100'] = {'status': 'identity_verified_via_admin_report',
        'recordedAt': recorded_at, **copy.deepcopy(EVIDENCE), 'rollback': copy.deepcopy(active), 'rollbackSha256': rollback_digest(active)}
    updated['activeService'] = copy.deepcopy(CURRENT_ACTIVE)
    require(updated['developmentSimplification']['release100']['rollback'] == active, 'ROLLBACK_CHANGED')
    preserved = copy.deepcopy(updated)
    preserved['activeService'] = active
    del preserved['developmentSimplification']['release100']
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
            out_fd, temporary = tempfile.mkstemp(prefix='.release100-', dir=path.parent)
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
        return {'status': 'release100_metadata_already_recorded' if already else 'release100_metadata_recorded',
            'source': SHA, 'version': '1.0.0', 'metadataOnly': True, 'noRestart': True,
            'rollbackPreserved': True, 'otherBlocksPreserved': True}
    finally:
        if temporary is not None: os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'USAGE')
        result = record(); exit_code = 0
    except RecordError as error:
        result = {'status': 'release100_metadata_unconfirmed', 'code': str(error), 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    except Exception:
        result = {'status': 'release100_metadata_unconfirmed', 'code': 'RECORD_UNAVAILABLE', 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    print(json.dumps(result, separators=(',', ':')))
    sys.exit(exit_code)
