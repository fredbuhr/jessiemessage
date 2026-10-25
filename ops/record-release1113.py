#!/usr/bin/env python3
"""Record1113 metadata after exact startup, public HTTP and CHECK receipts.

Same SQL38 and locked dependencies as active1112. No SQL, startup or Manager operation.
The complete prior checkpoint and rollback185 evidence are preserved.
"""
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
import urllib.request

PRIVATE = Path('/srv/customer/jessiemessage-private')
OPERATOR = Path('/srv/customer/jessiemessage-operator')
DEPENDENCY_ROOT = Path('/srv/customer/jessiemessage-operator/production-1101-9eb99f1f/node_modules')
SOURCE = '89571636d6fde97b28b5e8aec9257801c1b71f8b'
TREE = 'e16a22043ea00908afa37cad64e5f9b421f4e5ae'
OLD_SOURCE = 'af352607ff7e12c41185f42b8232c72219a304cd'
OLD_TREE = '655f759079979d608b0ec1c62a7c892311899515'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
CHECKPOINT_SHA = '3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f'
STAGING_SHA = '7c1a51e0033e329b3daaf3ee8895a989f67e13c42199f7c4e6ac2907afbd8282'
OLD_STAGING_SHA = 'eef0d3f64599ee5ccfdd1e0a5bd996daf035fa3e79cab957ef7e97a3afaea628'
ROLLBACK185_SOURCE = '7a40de9742bdbedc5c0829d820882ca08bf23a91'
ROLLBACK185_TREE = '7ec449cb3a63a091c5233993923ceb69f8314366'
ROLLBACK185_STAGING_SHA = '8b3cb7d8b40d26ce16fa3b453a2f1fda265021a5b9f4584ec5533905f87ca11e'
BUNDLE_SHA = 'bcca2f3fd91ffc0dec51a7077eb9e192a53b6e653b60c7db7159e473b83aac85'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
PRECHECK = dict(version=2, type='local_closure_precheck', status='passed', scope='local_application',
    pendingClosures=False, started=False, erased=False, externalContinuityVerified=False)
BUNDLE_NAMES = sorted(['runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json', 'runtime-video.json'])
VIDEO_DDL = ['0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql']
EXPERIENCE_DDL = ['0037_profile_preferences.sql', '0038_reply_tracking.sql']
LIMIT = 2 * 1024 * 1024
RELEASE_ID = 423658747
RELEASE_TAG = 'v1.11.3'
# User UI: 25/10/2026 23:17:23 Europe/Paris (UTC+01).
REPORTED_STARTUP_SECOND = 1792966643

class RecordError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise RecordError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def render(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'DUPLICATE_KEY')
        value[key] = item
    return value


def parse(data):
    return json.loads(data, object_pairs_hook=unique_object,
        parse_constant=lambda _: require(False, 'JSON_CONSTANT'))


def fingerprint(value):
    return tuple(getattr(value, key) for key in ('st_dev', 'st_ino', 'st_mode', 'st_uid',
        'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


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
        with os.fdopen(fd, 'rb') as handle:
            fd = None
            if hash_only:
                result = hashlib.sha256(); length = 0
                while chunk := handle.read(65536):
                    length += len(chunk); require(length <= limit, 'FILE_LIMIT'); result.update(chunk)
                require(length == before.st_size, 'FILE_CHANGED'); result = result.hexdigest()
            else:
                result = handle.read(limit + 1)
                require(len(result) == before.st_size, 'FILE_CHANGED')
            after = os.fstat(handle.fileno()); final = path.lstat()
            metadata(after, mode); metadata(final, mode)
            require(fingerprint(before) == fingerprint(after) == fingerprint(final), 'FILE_CHANGED')
            return result
    finally:
        if fd is not None:
            os.close(fd)


def private_directory(path):
    value = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(value.st_mode)
        and value.st_uid == os.getuid() and stat.S_IMODE(value.st_mode) == 0o700, 'PRIVATE_DIRECTORY')


def release(version):
    require(version in ('1.11.2', '1.8.5', '1.11.3'), 'RELEASE_VERSION')
    sha, tree = {'1.11.2': (OLD_SOURCE, OLD_TREE), '1.8.5': (ROLLBACK185_SOURCE, ROLLBACK185_TREE), '1.11.3': (SOURCE, TREE)}[version]
    number = version.replace('.', ''); suffix = number + '-' + sha[:8]
    return dict(version=version, source=sha, tree=tree, checkout=OPERATOR / ('production-' + suffix),
        launcher=PRIVATE / ('start-primary-release' + suffix + '.sh'),
        checkLauncher=PRIVATE / ('check-primary-release' + suffix + '.sh'),
        log=PRIVATE / ('jm' + number + '-node24221.log'),
        precheckLog=PRIVATE / ('jm' + number + '-preflight-node24221-' + sha[:8] + '.log'))


def git(root, *args):
    env = dict(PATH='/usr/bin:/bin', LANG='C', LC_ALL='C', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null')
    result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-C', str(root), *args], env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    require(result.returncode == 0 and len(result.stdout) <= 1048576, 'SOURCE_UNAVAILABLE')
    return result.stdout.decode().strip()


def source(root, sha, tree, version):
    require(root.resolve(strict=True) == root and root.is_dir(), 'SOURCE_DIRECTORY')
    require(git(root, 'rev-parse', '--show-toplevel') == str(root)
        and git(root, 'rev-parse', 'HEAD') == sha and git(root, 'rev-parse', 'HEAD^{tree}') == tree
        and git(root, 'rev-parse', 'refs/tags/v' + version + '^{commit}') == sha
        and git(root, 'status', '--porcelain', '--untracked-files=normal') == '', 'SOURCE_IDENTITY')
    package = parse(file(root / 'package.json', mode=None)); lock = parse(file(root / 'package-lock.json', mode=None))
    require(package['version'] == lock['version'] == lock['packages']['']['version'] == version, 'SOURCE_VERSION')
    normalized = copy.deepcopy(lock); normalized['version'] = normalized['packages']['']['version'] = 'VERSION'
    ordinary = [(p.name, file(p, mode=None, hash_only=True)) for p in sorted((root / 'db/migrations').glob('*.sql'))]
    video = [(p.name, file(p, mode=None, hash_only=True)) for p in sorted((root / 'server/video/migrations').glob('*.sql'))]
    require(len(ordinary) == 33, 'MIGRATION_COUNT')
    experience = [(p.name, file(p, mode=None, hash_only=True)) for p in sorted((root / 'server/experience/migrations').glob('*.sql'))]
    return normalized, ordinary, video, experience


def pinned_json(path, expected_sha, code):
    data = file(path); require(digest(data) == expected_sha, code)
    value = parse(data); require(type(value) is dict, code)
    return value


def precheck(path):
    data = file(path, limit=65536); lines = data.splitlines()
    # Manager may append a valid receipt for each build or short-lived check.
    # The strict 64 KiB file bound limits parsing; every retained line must pass.
    require(lines and all(canonical(parse(line)) == canonical(PRECHECK) for line in lines), 'PRECHECK_NOT_PASSED')
    return dict(path=str(path), sha256=digest(data), passedReceipts=len(lines), pendingClosures=False, version=2)


def startup(log):
    records = []
    for line in file(log, limit=8 * 1024 * 1024).splitlines():
        if not line.lstrip().startswith(b'{'):
            require(b'application_started' not in line, 'STARTUP_RECORD'); continue
        try:
            value = parse(line)
        except (ValueError, RecordError):
            require(b'application_started' not in line, 'STARTUP_RECORD'); continue
        if type(value) is dict and value.get('type') == 'application_started':
            records.append(value)
    require(len(records) == 1, 'STARTUP_RECORD_COUNT')
    value = records[0]; observed = value.get('release')
    require(set(value) == {'version', 'type', 'release'} and type(value['version']) is int and value['version'] == 1
        and type(observed) is dict and set(observed) == {'version', 'commit', 'nodeVersion', 'startedAt'}
        and observed.get('version') == '1.11.3' and observed.get('commit') == SOURCE
        and observed.get('nodeVersion') == 'v24.22.1' and type(observed.get('startedAt')) is int
        and observed['startedAt'] // 1000 == REPORTED_STARTUP_SECOND
        and 0 < observed['startedAt'] <= datetime.now(timezone.utc).timestamp() * 1000, 'STARTUP_IDENTITY')
    # Pin the exact semantic startup record. Other live-log appends are preserved
    # and do not turn an identical metadata retry into a new operation.
    return dict(provenance='hosted_startup_log_and_public_http', release=observed,
        startupLog=str(log), startupRecordSha256=digest(canonical(value)),
        publicHttpIdentityExposed=False, limitations=['public_http_does_not_expose_commit',
            'pid_not_qualified', 'socket_not_qualified', 'executed_process_binary_not_qualified',
            'admin_session_not_qualified', 'physical_phone_not_qualified', 'manual_restore_cli_not_qualified'])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RecordError('PUBLIC_HTTP_REDIRECT')


def collect_http():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    report = {}
    for name, suffix in (('health', '/api/health'), ('ready', '/api/ready'), ('home', '/'), ('entry', '/api/entry')):
        url = 'https://jessiemessage.com' + suffix
        try:
            with opener.open(url, timeout=15) as response:
                limit = LIMIT if name == 'home' else 16384
                body = response.read(limit + 1)
                require(response.status == 200 and response.geturl() == url and len(body) <= limit, 'PUBLIC_HTTP')
        except RecordError:
            raise
        except Exception:
            raise RecordError('PUBLIC_HTTP_UNAVAILABLE') from None
        item = dict(url=url, status=200)
        if name == 'home':
            item['sha256'] = digest(body)
        elif name == 'entry':
            parsed = parse(body); require(type(parsed) is dict and 'administrator' in parsed, 'PUBLIC_ENTRY')
            item['administrator'] = parsed['administrator']
        else:
            item['body'] = parse(body)
        report[name] = item
    return report


def collect_published_release():
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.11.3'
        and all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE)), 'PUBLICATION_PIN_REQUIRED')
    root = 'https://api.github.com/repos/fredbuhr/jessiemessage'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    values = []
    for suffix in ('/releases/' + str(RELEASE_ID), '/git/ref/tags/' + RELEASE_TAG, '/releases/latest'):
        url = root + suffix
        request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JessieMessage-release1113-metadata-check'}, method='GET')
        try:
            with opener.open(request, timeout=15) as response:
                body = response.read(LIMIT + 1)
                require(response.status == 200 and response.geturl() == url and len(body) <= LIMIT, 'PUBLISHED_RELEASE_HTTP')
                values.append(parse(body))
        except RecordError:
            raise
        except Exception:
            raise RecordError('PUBLISHED_RELEASE_UNAVAILABLE') from None
    published, tag, latest = values
    for item in (published, latest):
        require(type(item) is dict and item.get('id') == RELEASE_ID and item.get('tag_name') == RELEASE_TAG
            and item.get('target_commitish') == SOURCE and item.get('draft') is False
            and item.get('prerelease') is False, 'PUBLISHED_RELEASE_IDENTITY')
    require(type(tag) is dict and tag.get('ref') == 'refs/tags/' + RELEASE_TAG
        and type(tag.get('object')) is dict and tag['object'].get('type') == 'commit'
        and tag['object'].get('sha') == SOURCE, 'PUBLISHED_TAG_IDENTITY')
    return dict(repository='fredbuhr/jessiemessage', releaseId=RELEASE_ID, tag=RELEASE_TAG,
        source=SOURCE, tagObjectType='commit', latest=RELEASE_TAG, latestSource=SOURCE,
        draft=False, prerelease=False, transport='anonymous_https_get_only')



# Evidence and checkpoint transition below remain bounded to this release.
def instant(value):
    require(type(value) is str and len(value) <= 40, 'RECORD_DATE')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0
            and parsed <= datetime.now(timezone.utc), 'RECORD_DATE')
        return parsed
    except (ValueError, OverflowError):
        raise RecordError('RECORD_DATE') from None


def staging(version, expected_sha):
    pin = release(version)
    staged = pinned_json(PRIVATE / ('jm' + version.replace('.', '') + '-staging.json'), expected_sha, 'STAGING_PIN')
    require(staged.get('format') == 'jessiemessage-release' + version.replace('.', '') + '-staging'
        and staged.get('version') == 1 and staged.get('release') == version
        and staged.get('status') == 'release' + version.replace('.', '') + '_sources_staged_not_qualified'
        and staged.get('schemaMigrationsExpected') == 38 and staged.get('applicationTablesExpected') == 37
        and staged.get('experienceEnabled') is True and staged.get('profile') == PROFILE
        and staged.get('nodeVersion') == 'v24.22.1' and staged.get('nodeBinarySha256') == NODE_SHA
        and all(staged.get(key) == str(pin[key]) for key in ('source', 'tree', 'checkout', 'launcher', 'checkLauncher', 'log', 'precheckLog')), 'STAGING_SCOPE')
    for key in ('launcher', 'checkLauncher'):
        require(file(pin[key], 0o700, hash_only=True) == staged.get(key + 'Sha256'), 'LAUNCHER_PIN')
    if version == '1.8.5':
        require(staged.get('preferencesEnabled') is False and staged.get('replyTrackingEnabled') is False, 'ROLLBACK_FEATURE_SCOPE')
    return staged


def reused_dependencies(previous, current, staged):
    target = DEPENDENCY_ROOT
    private_directory(target)
    for pin in (previous, current):
        private_directory(pin['checkout'])
        link = pin['checkout'] / 'node_modules'
        value = link.lstat()
        require(stat.S_ISLNK(value.st_mode) and value.st_uid == os.getuid()
            and os.readlink(link) == str(target) and link.resolve(strict=True) == target
            and fingerprint(value) == fingerprint(link.lstat()), 'REUSED_DEPENDENCIES')
    require(staged.get('dependenciesReused') is True and staged.get('dependencyDirectory') == str(target)
        and staged.get('checkoutMode') == '0700', 'REUSED_DEPENDENCIES')
    return dict(strategy='reuse-active-private-directory', directory=str(target))


def verify_evidence():
    require(all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE)), 'QUALIFICATION_REQUIRED')
    require(all(re.fullmatch('[a-f0-9]{64}', pin) for pin in (NODE_SHA, CHECKPOINT_SHA, STAGING_SHA, OLD_STAGING_SHA, BUNDLE_SHA)), 'RECEIPT_PINS_REQUIRED')
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.11.3', 'PUBLICATION_PIN_REQUIRED')
    require(type(REPORTED_STARTUP_SECOND) is int and REPORTED_STARTUP_SECOND > 0, 'STARTUP_PIN_REQUIRED')
    private_directory(PRIVATE)
    previous, current = release('1.11.2'), release('1.11.3')
    baseline = source(previous['checkout'], OLD_SOURCE, OLD_TREE, '1.11.2')
    candidate = source(current['checkout'], SOURCE, TREE, '1.11.3')
    require(baseline == candidate and [name for name, _ in candidate[2]] == VIDEO_DDL
        and [name for name, _ in candidate[3]] == EXPERIENCE_DDL, 'DEPENDENCIES_OR_MIGRATIONS')
    require(file(PRIVATE / 'runtime-node-v24.22.1/bin/node', 0o700, limit=256 * 1024 * 1024, hash_only=True) == NODE_SHA, 'NODE_PIN')
    staged = staging('1.11.3', STAGING_SHA)
    require(staged.get('preservedActiveCheckpointSha256') == CHECKPOINT_SHA, 'STAGING_PRIOR_CHECKPOINT')
    require(staged.get('priorActiveStagingSha256') == OLD_STAGING_SHA, 'STAGING_PRIOR_RECEIPT')
    staging('1.11.2', OLD_STAGING_SHA)
    dependencies = reused_dependencies(previous, current, staged)
    bundle = PRIVATE / 'runtime-video-180'; private_directory(bundle)
    require(sorted(path.name for path in bundle.iterdir()) == BUNDLE_NAMES, 'VIDEO_BUNDLE')
    aggregate = hashlib.sha256()
    for name in BUNDLE_NAMES:
        content = file(bundle / name, limit=16384)
        require(bool(content), 'VIDEO_BUNDLE')
        aggregate.update(name.encode()); aggregate.update(b'\0'); aggregate.update(str(len(content)).encode()); aggregate.update(b'\0'); aggregate.update(content)
    require(aggregate.hexdigest() == BUNDLE_SHA, 'VIDEO_BUNDLE')
    check = precheck(current['precheckLog'])
    rollback = None
    rollback_pins = (ROLLBACK185_SOURCE, ROLLBACK185_TREE, ROLLBACK185_STAGING_SHA)
    if rollback_pins != ('QUALIFICATION_PENDING', 'QUALIFICATION_PENDING', 'STAGING_PENDING'):
        require(all(re.fullmatch('[a-f0-9]{40}', pin) for pin in rollback_pins[:2])
            and re.fullmatch('[a-f0-9]{64}', rollback_pins[2]), 'ROLLBACK_PINS_REQUIRED')
        pin = release('1.8.5'); inventory = source(pin['checkout'], pin['source'], pin['tree'], pin['version'])
        require(inventory[1:] == candidate[1:], 'ROLLBACK_MIGRATIONS')
        prepared = staging('1.8.5', ROLLBACK185_STAGING_SHA)
        require(file(pin['log']) == b'', 'ROLLBACK_ALREADY_STARTED')
        rollback = dict(release='1.8.5', source=pin['source'], tree=pin['tree'], checkout=str(pin['checkout']),
            launcher=str(pin['launcher']), launcherSha256=prepared['launcherSha256'],
            checkLauncher=str(pin['checkLauncher']), checkLauncherSha256=prepared['checkLauncherSha256'],
            schemaMigrations=38, applicationTables=37, status='hosted_precheck_passed_not_started',
            identityVerified=False, precheck=precheck(pin['precheckLog']), stagingReceiptSha256=ROLLBACK185_STAGING_SHA,
            preferencesEnabled=False, replyTrackingEnabled=False)
    identity = startup(current['log']); http = collect_http(); published = collect_published_release()
    require(type(http) is dict and set(http) == {'health', 'ready', 'home', 'entry'}, 'PUBLIC_HTTP')
    for name, suffix in (('health', '/api/health'), ('ready', '/api/ready'), ('home', '/'), ('entry', '/api/entry')):
        require(type(http[name]) is dict and http[name].get('url') == 'https://jessiemessage.com' + suffix and http[name].get('status') == 200, 'PUBLIC_HTTP')
    require(http['health'].get('body') == {'status': 'ok'} and http['ready'].get('body') == {'status': 'ready'}, 'PUBLIC_READY')
    require(http['entry'].get('administrator', 'missing') is None, 'PUBLIC_ENTRY')
    require(http['home'].get('sha256') == file(current['checkout'] / 'public/access.html', mode=None, hash_only=True), 'PUBLIC_HOME')
    require(published == dict(repository='fredbuhr/jessiemessage', releaseId=RELEASE_ID, tag=RELEASE_TAG,
        source=SOURCE, tagObjectType='commit', latest=RELEASE_TAG, latestSource=SOURCE,
        draft=False, prerelease=False, transport='anonymous_https_get_only'), 'PUBLISHED_RELEASE_IDENTITY')
    identity.update(publicHttp=http, publicReady=True, publishedRelease=published)
    return dict(identity=identity, precheck=check, stagingReceiptSha256=STAGING_SHA, schemaUnchanged=True, schemaMigrations=38,
        dependencies=dependencies, bundleFingerprintSha256=BUNDLE_SHA, launchers={key: staged[key] for key in ('launcherSha256', 'checkLauncherSha256')},
        rollback185=rollback)


def prepare(document, evidence, recorded_at, original_sha):
    require(type(document) is dict and type(document.get('developmentSimplification')) is dict, 'CHECKPOINT_SHAPE')
    development = document['developmentSimplification']; existing = development.get('release1113')
    prior = copy.deepcopy(document)
    if existing is not None:
        require(type(existing) is dict and type(existing.get('priorActiveService')) is dict, 'EXISTING_SECTION')
        instant(existing.get('recordedAt')); recorded_at = existing['recordedAt']
        prior['activeService'] = copy.deepcopy(existing['priorActiveService'])
        del prior['developmentSimplification']['release1113']
        require(digest(render(prior)) == CHECKPOINT_SHA, 'EXISTING_PRIOR_DRIFT')
    else:
        require(original_sha == CHECKPOINT_SHA, 'CHECKPOINT_PIN')
    old = prior.get('activeService')
    require(type(old) is dict and old.get('release') == '1.11.2' and old.get('source') == OLD_SOURCE
        and old.get('tree') == OLD_TREE and old.get('nodeAfterDeployment') == 'v24.22.1'
        and old.get('schemaMigrations') == 38 and all(type(prior['developmentSimplification'].get(name)) is dict for name in ('release1112', 'release1111', 'release1110', 'release1101', 'release1100', 'release190', 'release184')), 'CURRENT_ACTIVE_DRIFT')
    pin = release('1.11.3')
    active = {key: str(pin[key]) for key in ('source', 'tree', 'checkout', 'launcher', 'checkLauncher', 'log')}
    active.update(release='1.11.3', nodeAfterDeployment='v24.22.1', nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'),
        nodeBinarySha256=NODE_SHA, schemaMigrations=38, applicationTables=37, profile=PROFILE,
        launcherSha256=evidence['launchers']['launcherSha256'], checkLauncherSha256=evidence['launchers']['checkLauncherSha256'],
        mode='start-local-closures', closuresEnabled=True, port=3000, tasksEnabled=True, announcementsEnabled=True,
        launcherMode='0700', logMode='0600', manualBackupsEnabled=True, backupMode='manual-admin',
        dependencyStrategy=evidence['dependencies']['strategy'], dependencyDirectory=evidence['dependencies']['directory'],
        videoEnabled=True, videoCreationEnabled=True, clientVideoCreationEnabled=False, quickRepliesWritable=True,
        experienceEnabled=True, preferencesEnabled=True, replyTrackingEnabled=True, publicProfileEnabled=True,
        status='identity_observed_via_startup_log_and_public_http', evidence=copy.deepcopy(evidence['identity']))
    section = dict(status=active['status'], recordedAt=recorded_at, evidence=copy.deepcopy(evidence),
        priorCheckpointSha256=CHECKPOINT_SHA, priorActiveService=copy.deepcopy(old), priorActiveServiceSha256=digest(canonical(old)),
        historicalRelease1112Preserved=True, historicalRelease1111Preserved=True, historicalRelease1110Preserved=True, historicalRelease1101Preserved=True, historicalRelease1100Preserved=True, historicalRelease190Preserved=True, historicalRelease184Preserved=True, schemaUnchanged=True, restart184Allowed=False, restart172Allowed=False,
        priorRelease1112SqlCompatible=True, publicProfileDowngradeQualified=False,
        publicSnapshotDowngradeLimit='backend1111_cannot_read_new_public_snapshot_format2',
        rollbackAfterMigrationQualified=evidence['rollback185'] is not None,
        rollbackQualificationScope='sql38_precheck_only', rollback=copy.deepcopy(evidence['rollback185']))
    updated = copy.deepcopy(prior); updated['activeService'] = active
    updated['developmentSimplification']['release1113'] = section
    if existing is not None:
        require(canonical(document) == canonical(updated), 'EXISTING_SECTION_DIVERGENT')
        return updated, True
    restored = copy.deepcopy(updated); restored['activeService'] = copy.deepcopy(old)
    del restored['developmentSimplification']['release1113']
    require(canonical(restored) == canonical(document), 'OTHER_BLOCKS_CHANGED')
    return updated, False




def record(path=None):
    evidence = verify_evidence()
    path = PRIVATE / 'jm0702-existing-pc-update.json' if path is None else Path(path)
    require(path.is_absolute() and path.parent == PRIVATE and path.resolve(strict=True) == path, 'CHECKPOINT_PATH')
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK); temporary = None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = os.fstat(fd); metadata(before, 0o600); require(before.st_size <= LIMIT, 'CHECKPOINT_LIMIT')
        original = os.pread(fd, LIMIT + 1, 0); require(len(original) == before.st_size, 'CHECKPOINT_CHANGED')
        updated, already = prepare(parse(original), evidence, datetime.now(timezone.utc).isoformat(), digest(original))
        def unchanged():
            metadata(path.lstat(), 0o600)
            require(fingerprint(path.lstat()) == fingerprint(before) == fingerprint(os.fstat(fd))
                and os.pread(fd, len(original) + 1, 0) == original, 'CHECKPOINT_CHANGED')
        unchanged()
        if not already:
            payload = render(updated); require(len(payload) <= LIMIT, 'CHECKPOINT_LIMIT')
            out_fd, temporary = tempfile.mkstemp(prefix='.release1113-', dir=PRIVATE)
            with os.fdopen(out_fd, 'wb') as output:
                os.fchmod(output.fileno(), 0o600); output.write(payload); output.flush(); os.fsync(output.fileno())
            unchanged()  # Last drift observation, not universal compare-and-swap.
            os.replace(temporary, path); temporary = None
            directory = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            require(file(path) == payload, 'READBACK_MISMATCH')
        return dict(status='release1113_metadata_already_recorded' if already else 'release1113_metadata_recorded',
            version='1.11.3', source=SOURCE, tree=TREE, metadataOnly=True, noRestart=True, schemaMigrations=38,
            applicationTables=37, release=evidence['identity']['release'], publicReady=True,
            rollbackRelease='1.8.5' if evidence['rollback185'] is not None else None,
            rollbackAfterMigrationQualified=evidence['rollback185'] is not None,
            rollbackQualificationScope='sql38_precheck_only', publicProfileDowngradeQualified=False,
            restart184Allowed=False, restart172Allowed=False, historicalRelease1112Preserved=True, historicalRelease1111Preserved=True, historicalRelease1110Preserved=True, historicalRelease1101Preserved=True, historicalRelease1100Preserved=True, historicalRelease190Preserved=True, historicalRelease184Preserved=True,
            priorActivePreserved=True, otherBlocksPreserved=True,
            checkpointSha256=digest(file(path)))
    finally:
        if temporary is not None:
            os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    try:
        require(len(__import__('sys').argv) == 1, 'USAGE')
        print(json.dumps(record(), separators=(',', ':')))
    except Exception as error:
        code = str(error) if isinstance(error, RecordError) else 'RECORD_UNAVAILABLE'
        print(json.dumps(dict(status='release1113_metadata_unconfirmed', code=code,
            metadataOnly=True, noRestart=True, noAutomaticRetry=True), separators=(',', ':')))
        raise SystemExit(1)
