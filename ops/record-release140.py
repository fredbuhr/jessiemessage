#!/usr/bin/env python3
"""Record release 1.4.0 metadata and its prepared compatible rollback only.

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
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-140-56d45950')
SHA = '56d4595059df9292fc54ba4d4e948eeb793bae96'
TREE = '8129e76c9817e79c062a4437eadee4b7ce4d90a1'
LAUNCHER = PRIVATE / 'start-primary-release140-56d45950.sh'
LAUNCHER_SHA = '45f99cac50dc057f9be61f7db420dd7e64f92f76f67a8eaade1463780edff3b0'
CHECK_LAUNCHER = PRIVATE / 'check-primary-release140-56d45950.sh'
CHECK_LAUNCHER_SHA = '38e655a8e1e2be696707650aabc5e26c11ca9f7b1ac74d7b17ff23f6016deb4c'
NODE = PRIVATE / 'runtime-node-v24.22.0/bin/node'
NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
PRECHECK_LOG = PRIVATE / 'jm140-preflight-56d45950.log'
PRECHECK_SHA_AT_STAGING = 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6'
EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
# Exact CURRENT_ACTIVE of the pinned 1.3.3 recorder. Unknown extensions are
# retained under priorActiveService, but this version cannot read compact v2.
OLD_ACTIVE = {'source': 'ca0d40648036d57fdee55b91d47d5d5a874a626e',
 'tree': 'b1fe882ede0450cbf135d2ff8cb19e780d18a0e5',
 'checkout': '/srv/customer/jessiemessage-operator/production-133-ca0d4064',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release133-ca0d4064.sh',
 'launcherSha256': '88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release133-ca0d4064.sh',
 'checkLauncherSha256': '80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623',
 'log': '/srv/customer/jessiemessage-private/jm133-node2422.log',
 'release': '1.3.3',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 13:20:11',
              'schemaEvidence': 'operator_reported_release133_staged_precheck_passed_schema31_unchanged',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}
ROLLBACK = {
    'source': '4538148660fbf1487807fb1518747d8f5753cd3b',
    'tree': '248477f9c63064a57445e5b15023e58fdde8e02c',
    'checkout': '/srv/customer/jessiemessage-operator/production-134-45381486',
    'launcher': str(PRIVATE / 'start-primary-release134-45381486.sh'),
    'launcherSha256': '7d44f4b0a51f86e3d9de98609a8c9c2aa30b6027d2823fea681f8971a791a179',
    'checkLauncher': str(PRIVATE / 'check-primary-release134-45381486.sh'),
    'checkLauncherSha256': '7a621c42a22bb7fd5a46c5a5512c4daa5cfdd83c7e3a454412abb8d6899cb669',
    'log': str(PRIVATE / 'jm134-node2422.log'),
    'precheckLog': str(PRIVATE / 'jm134-preflight-45381486.log'),
    'precheckLogSha256': PRECHECK_SHA_AT_STAGING,
    'release': '1.3.4', 'nodeVersion': 'v24.22.0', 'schemaMigrations': 31,
    'mode': 'start-local-closures', 'closuresEnabled': True, 'port': 3000,
    'launcherMode': '0700', 'logMode': '0600',
    'status': 'hosted_precheck_passed_not_started', 'identityVerified': False,
    'largeAudiencesEnabled': False, 'compactBroadcastsCompatible': True,
    'evidence': {'provenance': 'operator_release140_joint_staging_user_report',
        'bothPrechecksPassed': True, 'rollback134HostedQualified': True,
        'pendingClosures': False, 'runtimeStarted': False,
        'nodeBinarySha256': NODE_SHA,
        'limitations': ['runtime_identity_not_observed', 'pid_not_qualified',
            'socket_not_qualified', 'executed_binary_hash_not_qualified']}}
EVIDENCE = {'provenance': 'admin_readiness_user_report',
    'reportedStartedAtDisplay': '21/10/2026 15:31:41',
    'precheckLogSha256AtStaging': PRECHECK_SHA_AT_STAGING,
    'schemaEvidence': 'operator_reported_release140_joint_staged_prechecks_passed_schema31_unchanged',
    'limitations': ['pid_not_qualified', 'socket_not_qualified', 'executed_binary_hash_not_qualified',
        'runtime_private_configs_not_qualified', 'pc_not_qualified', 'backups_not_qualified',
        'reported_start_time_timezone_and_epoch_not_supplied']}
CURRENT_ACTIVE = {'source': SHA, 'tree': TREE, 'checkout': str(CHECKOUT),
    'launcher': str(LAUNCHER), 'launcherSha256': LAUNCHER_SHA,
    'checkLauncher': str(CHECK_LAUNCHER), 'checkLauncherSha256': CHECK_LAUNCHER_SHA,
    'log': str(PRIVATE / 'jm140-node2422.log'), 'release': '1.4.0', 'nodeAfterDeployment': 'v24.22.0',
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
    # Manager Build may append another successful receipt to the active precheck
    # log after staging. Its recorded staging hash is evidence, not a current pin.
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
    require(isinstance(document, dict) and isinstance(document.get('developmentSimplification'), dict), 'CHECKPOINT_SHAPE')
    active = document.get('activeService')
    section = document['developmentSimplification'].get('release140')
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
    require('release140' not in document['developmentSimplification'] and old_identity(active), 'OLD_IDENTITY')
    updated = copy.deepcopy(document)
    updated['developmentSimplification']['release140'] = {'status': 'identity_verified_via_admin_report',
        'recordedAt': recorded_at, **copy.deepcopy(EVIDENCE),
        'priorActiveService': copy.deepcopy(active), 'priorActiveServiceSha256': rollback_digest(active),
        'priorActiveServiceUsableRollback': False,
        'rollback': copy.deepcopy(ROLLBACK), 'rollbackSha256': rollback_digest(ROLLBACK)}
    updated['activeService'] = copy.deepcopy(CURRENT_ACTIVE)
    require(updated['developmentSimplification']['release140']['priorActiveService'] == active
        and updated['developmentSimplification']['release140']['rollback'] == ROLLBACK, 'PRIOR_ACTIVE_CHANGED')
    preserved = copy.deepcopy(updated)
    preserved['activeService'] = active
    del preserved['developmentSimplification']['release140']
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
            out_fd, temporary = tempfile.mkstemp(prefix='.release140-', dir=path.parent)
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
        return {'status': 'release140_metadata_already_recorded' if already else 'release140_metadata_recorded',
            'source': SHA, 'version': '1.4.0', 'metadataOnly': True, 'noRestart': True,
            'rollbackPreserved': True, 'rollbackRelease': '1.3.4', 'schemaMigrations': 31,
            'priorActivePreserved': True, 'priorActiveUsableRollback': False,
            'rollback134HostedQualified': True, 'otherBlocksPreserved': True}
    finally:
        if temporary is not None: os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'USAGE')
        result = record(); exit_code = 0
    except RecordError as error:
        result = {'status': 'release140_metadata_unconfirmed', 'code': str(error), 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    except Exception:
        result = {'status': 'release140_metadata_unconfirmed', 'code': 'RECORD_UNAVAILABLE', 'metadataOnly': True, 'noRestart': True}; exit_code = 1
    print(json.dumps(result, separators=(',', ':')))
    sys.exit(exit_code)
