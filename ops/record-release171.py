#!/usr/bin/env python3
"""Record the single 1.6.0 -> 1.7.1 metadata transition after real observation.

The exact merged source/tree are qualified and pinned below. No network, service
start, Manager change, SQL or backup operation. Three private JSON receipts are
required: staging171, preparation160/Node24221, and a root-supplied observation.
Startup identity is read from the real new log, never inferred from public HTTP.
"""
import argparse
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

SOURCE = 'c2d7b3b31c6d0955892829f808dc4135d7d8debf'
TREE = 'd4945207f25375abb5d89c3a23ae91b6e34ea115'
PRIVATE = Path('/srv/customer/jessiemessage-private')
OLD = Path('/srv/customer/jessiemessage-operator/production-160-9590741e')
OLD_SHA = '9590741e7065067aee9d1ad5d1206739cc27eb6b'
OLD_TREE = '38e72545ab4fd6feb4a04e934b2eb8685f82b970'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
OLD_NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
START_PIN = '39015e53147112981203b5172f11f52563311be7e92a92f2b78bf4dca744f1b4'
CHECK_PIN = '13362ac14caa4795a4fbf3ee3fc50e94188938179c1cde119d6d968427a50971'
CHECKPOINT_SHA = 'ba219d76069d8f1eca1a91c7ca2ba085b0eb1b926189c6a26e7ff5ecf22c4629'
RELEASE160_SHA = 'd95a0d4e5175f00631613c3649b6c4a8205bf0f2c1285bb532931004e291fd96'
PRECHECK = dict(version=1, type='local_closure_precheck', status='passed', scope='local_application',
    pendingClosures=False, started=False, erased=False, externalContinuityVerified=False)
LIMIT = 2 * 1024 * 1024
EMPTY_SHA = hashlib.sha256(b'').hexdigest()
# Exact CURRENT_ACTIVE from ops/record-release160.py; historical evidence stays historical.
CURRENT_ACTIVE = {'source': '9590741e7065067aee9d1ad5d1206739cc27eb6b',
 'tree': '38e72545ab4fd6feb4a04e934b2eb8685f82b970',
 'checkout': '/srv/customer/jessiemessage-operator/production-160-9590741e',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release160-9590741e.sh',
 'launcherSha256': '39015e53147112981203b5172f11f52563311be7e92a92f2b78bf4dca744f1b4',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release160-9590741e.sh',
 'checkLauncherSha256': '13362ac14caa4795a4fbf3ee3fc50e94188938179c1cde119d6d968427a50971',
 'log': '/srv/customer/jessiemessage-private/jm160-node2422.log',
 'release': '1.6.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 33,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'tasksEnabled': True,
 'announcementsEnabled': True,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 19:56:14',
              'precheckLogExpectedSha256AfterSuccessfulCheck': 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6',
              'schemaEvidence': 'operator_reported_schema33_prechecks_passed',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}


class RecordError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise RecordError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'DUPLICATE_KEY')
        value[key] = item
    return value


def parse(data):
    return json.loads(data, object_pairs_hook=unique_object,
        parse_constant=lambda _: require(False, 'JSON_CONSTANT'))


def metadata(value, mode):
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1
        and not value.st_mode & 0o022 and (mode is None or stat.S_IMODE(value.st_mode) == mode), 'FILE_METADATA')


def file(path, mode=0o600, limit=LIMIT, hash_only=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'FILE_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd); metadata(before, mode)
        require(before.st_size <= limit, 'FILE_LIMIT')
        with os.fdopen(fd, 'rb') as source:
            fd = None
            if hash_only:
                result = hashlib.sha256()
                while chunk := source.read(262144):
                    result.update(chunk)
                result = result.hexdigest()
            else:
                result = source.read(limit + 1)
                require(len(result) == before.st_size, 'FILE_CHANGED')
            require(fingerprint(os.fstat(source.fileno())) == fingerprint(before)
                == fingerprint(path.lstat()), 'FILE_CHANGED')
            return result
    finally:
        if fd is not None:
            os.close(fd)


def fingerprint(value):
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def qualified():
    require(re.fullmatch('[a-f0-9]{40}', SOURCE) and re.fullmatch('[a-f0-9]{40}', TREE), 'QUALIFICATION_REQUIRED')


def target():
    return OLD.parent / ('production-171-' + SOURCE[:8])


def git(root, *args):
    env = dict(PATH='/usr/bin:/bin', LANG='C', LC_ALL='C', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null')
    result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-C', str(root), *args], env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    require(result.returncode == 0 and len(result.stdout) <= 8192, 'SOURCE_UNAVAILABLE')
    return result.stdout.decode().strip()


def source(root, sha, tree, version):
    require(root.resolve(strict=True) == root and root.is_dir(), 'SOURCE_DIRECTORY')
    require(git(root, 'rev-parse', '--show-toplevel') == str(root)
        and git(root, 'rev-parse', 'HEAD') == sha and git(root, 'rev-parse', 'HEAD^{tree}') == tree
        and git(root, 'status', '--porcelain', '--untracked-files=normal') == ''
        and git(root, 'rev-parse', 'HEAD') == sha, 'SOURCE_IDENTITY')
    package = parse(file(root / 'package.json', mode=None))
    lock = parse(file(root / 'package-lock.json', mode=None))
    require(package['version'] == lock['version'] == lock['packages']['']['version'] == version, 'SOURCE_VERSION')
    normalized = copy.deepcopy(lock)
    normalized['version'] = normalized['packages']['']['version'] = 'VERSION'
    migrations = sorted((root / 'db/migrations').glob('*.sql'))
    require(len(migrations) == 33, 'MIGRATION_COUNT')
    return normalized, [(p.name, file(p, mode=None, hash_only=True)) for p in migrations]


def launcher_plans():
    plans171, plans160 = [], []
    for kind, pin, old_log, new_log in (
        ('start', START_PIN, 'jm160-node2422.log', 'jm171-node24221.log'),
        ('check', CHECK_PIN, 'jm160-preflight-9590741e.log', 'jm171-preflight-node24221-' + SOURCE[:8] + '.log')):
        content = file(PRIVATE / f'{kind}-primary-release160-9590741e.sh', 0o700)
        require(digest(content) == pin, 'ORIGINAL_LAUNCHER_PIN')
        text = content.decode()
        replacements = ((str(PRIVATE / 'runtime-node-v24.22.0/bin/node'), str(PRIVATE / 'runtime-node-v24.22.1/bin/node'), 3),
            (OLD_NODE_SHA, NODE_SHA, 1), ('v24.22.0', 'v24.22.1', 1))
        for before, after, count in replacements:
            require(text.count(before) == count, 'ORIGINAL_LAUNCHER_SHAPE')
            text = text.replace(before, after)
        rollback_log = 'jm160-node24221.log' if kind == 'start' else 'jm160-preflight-node24221-9590741e.log'
        require(text.count(old_log) == 1, 'ORIGINAL_LAUNCHER_SHAPE')
        rollback_text = text.replace(old_log, rollback_log)
        plans160 += [(PRIVATE / f'{kind}-primary-release160-node24221-9590741e.sh', rollback_text.encode(), 0o700),
            (PRIVATE / rollback_log, b'', 0o600)]
        for before, after, count in ((OLD_SHA, SOURCE, 2), (OLD_TREE, TREE, 2), (str(OLD), str(target()), 2),
                (old_log, new_log, 1)):
            require(text.count(before) == count, 'ORIGINAL_LAUNCHER_SHAPE')
            text = text.replace(before, after)
        plans171 += [(PRIVATE / f'{kind}-primary-release171-{SOURCE[:8]}.sh', text.encode(), 0o700),
            (PRIVATE / new_log, b'', 0o600)]
    return plans171, plans160


def receipt(path, expected):
    path = Path(path)
    require(path.parent == PRIVATE, 'RECEIPT_PATH')
    data = file(path)
    value = parse(data)
    require(type(value) is dict and all(key in value and canonical(value[key]) == canonical(item)
        for key, item in expected.items()), 'PREPARATION_RECEIPT')
    return dict(path=str(path), sha256=digest(data))


def files_receipt(plans):
    return [dict(path=str(p), sha256=digest(data), mode=f'{mode:04o}') for p, data, mode in plans]


def precheck(path):
    data = file(path, limit=65536)
    lines = data.splitlines()
    require(1 <= len(lines) <= 16 and all(canonical(parse(line)) == canonical(PRECHECK) for line in lines), 'PRECHECK_NOT_PASSED')
    return dict(path=str(path), sha256=digest(data), passedReceipts=len(lines), pendingClosures=False)


def instant(value):
    require(type(value) is str and len(value) <= 40, 'OBSERVATION_DATE')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(result.utcoffset() is not None and result.utcoffset().total_seconds() == 0, 'OBSERVATION_DATE')
        return result
    except (ValueError, OverflowError):
        raise RecordError('OBSERVATION_DATE') from None


def observation(path):
    require(Path(path).parent == PRIVATE, 'RECEIPT_PATH')
    data = file(path); value = parse(data)
    require(type(value) is dict and value.get('version') == 1 and type(value.get('version')) is int
        and value.get('type') == 'hosted_release_observation'
        and value.get('provenance') == 'hosted_startup_log_and_public_http'
        and value.get('source') == SOURCE and value.get('tree') == TREE, 'OBSERVATION_IDENTITY')
    observed = instant(value.get('observedAtUTC'))
    log = PRIVATE / 'jm171-node24221.log'
    log_bytes = file(log, limit=8 * 1024 * 1024)
    records = []
    for line in log_bytes.splitlines():
        if line.lstrip().startswith(b'{'):
            try:
                item = parse(line)
            except (ValueError, RecordError):
                require(b'application_started' not in line, 'STARTUP_RECORD')
                continue
            if type(item) is dict and item.get('type') == 'application_started':
                records.append(item)
    require(len(records) == 1, 'STARTUP_RECORD_COUNT')
    item = records[0]; release = item.get('release')
    require(type(release) is dict and set(release) == {'version', 'commit', 'nodeVersion', 'startedAt'}
        and release.get('version') == '1.7.1' and release.get('commit') == SOURCE
        and release.get('nodeVersion') == 'v24.22.1' and type(release.get('startedAt')) is int
        and 0 <= release['startedAt'] <= 253402300799999
        and set(item) == {'version', 'type', 'release'} and type(item['version']) is int and item['version'] == 1,
        'STARTUP_IDENTITY')
    require(release['startedAt'] <= observed.timestamp() * 1000
        and observed <= datetime.now(timezone.utc), 'OBSERVATION_DATE')
    require(canonical(value.get('release')) == canonical(release)
        and value.get('startupLog') == str(log) and value.get('startupLogSha256') == digest(log_bytes), 'OBSERVATION_LOG')
    http = value.get('http')
    require(type(http) is dict and set(http) == {'health', 'ready', 'home', 'entry'}, 'PUBLIC_HTTP')
    for key, suffix in (('health', '/api/health'), ('ready', '/api/ready'), ('home', '/'), ('entry', '/api/entry')):
        require(type(http[key]) is dict and http[key].get('url') == 'https://jessiemessage.com' + suffix, 'PUBLIC_HTTP')
    require(http['health'].get('status') == 200 and http['health'].get('body') == {'status': 'ok'}, 'PUBLIC_HEALTH')
    require((http['ready'].get('status'), http['ready'].get('body')) in
        ((200, {'status': 'ready'}), (503, {'status': 'unavailable'})), 'PUBLIC_READY')
    require(http['home'].get('status') == 200 and http['home'].get('sha256') ==
        file(target() / 'public/index.html', mode=None, hash_only=True), 'PUBLIC_HOME')
    require(http['entry'].get('status') == 200 and 'administrator' in http['entry']
        and http['entry']['administrator'] is None, 'PUBLIC_ENTRY')
    return dict(provenance=value['provenance'], observedAtUTC=value['observedAtUTC'], release=release,
        startupLog=str(log), startupLogSha256=digest(log_bytes), publicHttp=copy.deepcopy(http),
        observationReceipt=dict(path=str(path), sha256=digest(data)),
        publicHttpIdentityExposed=False, publicReady=http['ready']['status'] == 200,
        limitations=['public_http_does_not_expose_commit', 'admin_session_not_qualified', 'pid_not_qualified',
            'socket_not_qualified', 'executed_binary_hash_not_qualified', 'runtime_private_configs_not_qualified',
            'pc_not_qualified', 'backups_not_qualified'] + ([] if http['ready']['status'] == 200 else
                ['public_readiness_unavailable_at_observation']))


def verify_evidence(staging171, staging160, observed):
    qualified()  # Refuse the draft before touching any host path.
    require(PRIVATE.resolve(strict=True) == PRIVATE and PRIVATE.is_dir()
        and PRIVATE.stat().st_uid == os.getuid() and stat.S_IMODE(PRIVATE.stat().st_mode) == 0o700, 'PRIVATE_DIRECTORY')
    require(source(OLD, OLD_SHA, OLD_TREE, '1.6.0') == source(target(), SOURCE, TREE, '1.7.1'), 'DEPENDENCIES_OR_MIGRATIONS')
    for name, pin in (('runtime-node-v24.22.0', OLD_NODE_SHA), ('runtime-node-v24.22.1', NODE_SHA)):
        require(file(PRIVATE / name / 'bin/node', 0o700, limit=128 * 1024 * 1024, hash_only=True) == pin, 'NODE_PIN')
    plans171, plans160 = launcher_plans()
    common = dict(nodeVersion='v24.22.1', nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'),
        nodeBinarySha256=NODE_SHA, precheckPassed=False, runtimeStarted=False, managerChanged=False,
        checkpointChanged=False, migrated=False, noRestart=True)
    prepared171 = receipt(staging171, dict(**common, status='release171_staged_not_checked', version='1.7.1',
        source=SOURCE, tree=TREE, checkout=str(target()), files=files_receipt(plans171),
        schemaMigrationsExpected=33, migrationsUnchanged=True, dependenciesUnchanged=True,
        preservedSource160=OLD_SHA, rollback160Node24221PrecheckRequired=True, rollback151AndOriginal160Preserved=True))
    prepared160 = receipt(staging160, dict(**common, status='node24221_prepared_not_started', source=OLD_SHA,
        tree=OLD_TREE, applicationVersion='1.6.0', files=files_receipt(plans160),
        preservedNode=str(PRIVATE / 'runtime-node-v24.22.0/bin/node'),
        preservedLaunchers=[str(PRIVATE / f'{kind}-primary-release160-9590741e.sh') for kind in ('start', 'check')]))
    for path, expected, mode in plans171 + plans160:
        if mode == 0o700:
            require(file(path, mode) == expected, 'LAUNCHER_PIN')
        else:
            file(path, mode, limit=8 * 1024 * 1024)
    require(file(PRIVATE / 'jm160-node24221.log') == b'', 'ROLLBACK_ALREADY_STARTED')
    checks = dict(release171=precheck(PRIVATE / ('jm171-preflight-node24221-' + SOURCE[:8] + '.log')),
        rollback160=precheck(PRIVATE / 'jm160-preflight-node24221-9590741e.log'))
    identity = observation(observed)
    return dict(identity=identity, preparation171=prepared171, preparation160Node24221=prepared160,
        prechecks=checks, launcher171Sha256=digest(plans171[0][1]), check171Sha256=digest(plans171[2][1]),
        launcher160Sha256=digest(plans160[0][1]), check160Sha256=digest(plans160[2][1]))


def prepare(document, evidence, recorded_at, original_sha):
    require(type(document) is dict and type(document.get('developmentSimplification')) is dict, 'CHECKPOINT_SHAPE')
    development = document['developmentSimplification']
    require(digest(canonical(development.get('release160'))) == RELEASE160_SHA, 'RELEASE160_DRIFT')
    prior = copy.deepcopy(document)
    existing = development.get('release171')
    if 'release171' in development:
        require(type(existing) is dict and 'recordedAt' in existing, 'EXISTING_SECTION')
        instant(existing['recordedAt'])
        recorded_at = existing['recordedAt']
        prior['activeService'] = copy.deepcopy(CURRENT_ACTIVE)
        del prior['developmentSimplification']['release171']
    else:
        require(original_sha == CHECKPOINT_SHA, 'CHECKPOINT_PIN')
        require(canonical(document.get('activeService')) == canonical(CURRENT_ACTIVE), 'CURRENT_ACTIVE_DRIFT')
    rollback = dict(source=OLD_SHA, tree=OLD_TREE, checkout=str(OLD), release='1.6.0', nodeVersion='v24.22.1',
        nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'), nodeBinarySha256=NODE_SHA,
        launcher=str(PRIVATE / 'start-primary-release160-node24221-9590741e.sh'),
        launcherSha256=evidence['launcher160Sha256'], checkLauncher=str(PRIVATE / 'check-primary-release160-node24221-9590741e.sh'),
        checkLauncherSha256=evidence['check160Sha256'], log=str(PRIVATE / 'jm160-node24221.log'),
        precheck=evidence['prechecks']['rollback160'], schemaMigrations=33, mode='start-local-closures', closuresEnabled=True,
        port=3000, tasksEnabled=True, announcementsEnabled=True, launcherMode='0700', logMode='0600',
        status='hosted_precheck_passed_not_started', identityVerified=False)
    active = dict(source=SOURCE, tree=TREE, checkout=str(target()), release='1.7.1', nodeAfterDeployment='v24.22.1',
        nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'), nodeBinarySha256=NODE_SHA,
        launcher=str(PRIVATE / f'start-primary-release171-{SOURCE[:8]}.sh'), launcherSha256=evidence['launcher171Sha256'],
        checkLauncher=str(PRIVATE / f'check-primary-release171-{SOURCE[:8]}.sh'), checkLauncherSha256=evidence['check171Sha256'],
        log=str(PRIVATE / 'jm171-node24221.log'), schemaMigrations=33, mode='start-local-closures', closuresEnabled=True,
        port=3000, tasksEnabled=True, announcementsEnabled=True, launcherMode='0700', logMode='0600',
        status='identity_observed_via_startup_log_and_public_http', evidence=copy.deepcopy(evidence['identity']))
    section = dict(status=active['status'], recordedAt=recorded_at, evidence=copy.deepcopy(evidence),
        priorCheckpointSha256=CHECKPOINT_SHA, priorCheckpointDocumentSha256=digest(canonical(prior)),
        release160SectionSha256=RELEASE160_SHA, priorActiveService=copy.deepcopy(CURRENT_ACTIVE),
        priorActiveServiceSha256=digest(canonical(CURRENT_ACTIVE)), rollback=rollback,
        rollbackSha256=digest(canonical(rollback)), historicalRollback151Preserved=True)
    updated = copy.deepcopy(prior)
    updated['activeService'] = active
    updated['developmentSimplification']['release171'] = section
    if existing is not None:
        require(canonical(document) == canonical(updated), 'EXISTING_SECTION_DIVERGENT')
        return updated, True
    restored = copy.deepcopy(updated)
    restored['activeService'] = copy.deepcopy(CURRENT_ACTIVE)
    del restored['developmentSimplification']['release171']
    require(canonical(restored) == canonical(document), 'OTHER_BLOCKS_CHANGED')
    return updated, False


def record(staging171, staging160, observed, path=None):
    evidence = verify_evidence(staging171, staging160, observed)
    path = PRIVATE / 'jm0702-existing-pc-update.json' if path is None else Path(path)
    require(path.is_absolute() and path.parent == PRIVATE and path.resolve(strict=True) == path, 'CHECKPOINT_PATH')
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    temporary = None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = os.fstat(fd); metadata(before, 0o600)
        require(before.st_size <= LIMIT, 'CHECKPOINT_LIMIT')
        original = os.pread(fd, LIMIT + 1, 0)
        require(len(original) == before.st_size, 'CHECKPOINT_CHANGED')
        updated, already = prepare(parse(original), evidence, datetime.now(timezone.utc).isoformat(), digest(original))
        def unchanged():
            metadata(path.lstat(), 0o600)
            require(fingerprint(path.lstat()) == fingerprint(before) == fingerprint(os.fstat(fd))
                and os.pread(fd, len(original) + 1, 0) == original, 'CHECKPOINT_CHANGED')
        unchanged()
        if not already:
            payload = (json.dumps(updated, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
            require(len(payload) <= LIMIT, 'CHECKPOINT_LIMIT')
            out_fd, temporary = tempfile.mkstemp(prefix='.release171-', dir=PRIVATE)
            with os.fdopen(out_fd, 'wb') as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(payload); output.flush(); os.fsync(output.fileno())
            unchanged()  # Drift detection immediately before replace, not universal CAS.
            os.replace(temporary, path); temporary = None
            directory = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            require(file(path) == payload, 'READBACK_MISMATCH')
        return dict(status='release171_metadata_already_recorded' if already else 'release171_metadata_recorded',
            version='1.7.1', source=SOURCE, tree=TREE, metadataOnly=True, noRestart=True, schemaMigrations=33,
            provenance=evidence['identity']['provenance'], publicReady=evidence['identity']['publicReady'],
            rollbackRelease='1.6.0', rollbackNodeVersion='v24.22.1', rollbackPrecheckedNotStarted=True,
            historicalRollback151Preserved=True, priorActivePreserved=True, otherBlocksPreserved=True)
    finally:
        if temporary is not None:
            os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('staging171', type=Path)
    parser.add_argument('preparation160_node24221', type=Path)
    parser.add_argument('observation', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(record(args.staging171, args.preparation160_node24221, args.observation), separators=(',', ':')))
    except Exception as error:
        code = str(error) if isinstance(error, RecordError) else 'RECORD_UNAVAILABLE'
        print(json.dumps(dict(status='release171_metadata_unconfirmed', code=code, metadataOnly=True, noRestart=True), separators=(',', ':')))
        raise SystemExit(1)
