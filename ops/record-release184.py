#!/usr/bin/env python3
"""Record qualified 1.8.4 metadata after startup and public HTTP checks.

Source/tree are pinned to qualified main. Published release ID and hosted staging
receipt remain pending; missing pins refuse before private or network access.
No SQL, Manager, runtime start, key write,
archive or backup action. Only the existing checkpoint is replaced atomically.
Historical sections, staging receipts and prior active state are preserved.
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
SOURCE = '1a41e08abc87c3a29d9163fbf8cd2342eb04693c'
TREE = 'e0964b50c03d3881d851f01f86f58777d22b2c10'
ROLLBACK_SOURCE = '6b3319a77c307ed7d6b003fe33de36807c70c266'
ROLLBACK_TREE = '924d500375a69ae50bc63414b15df71271e2bf8a'
OLD_SOURCE = '48fd42b808b2bc4d95d3f3ba21244c032d0a938f'
LEGACY182_SOURCE = '78e6b8b2f6b19020c060345b9313a81829e9c8da'
LEGACY181_SOURCE = '1ae4c75152795ea6f31c2ff364e337a1d5a04e31'
LEGACY180_SOURCE = 'fd6e53b14b520231b0b307a2761331dd8c740a5b'
OLD_TREE = '1070a2d4db52e92aa020e4cb8c6d4bacaaf06a58'
LEGACY182_TREE = '7b722ca1fbd3416acecffa3c122e967511184d4c'
LEGACY181_TREE = 'eb427f887248fa9db5c656c3773e016f8688efc9'
LEGACY180_TREE = '324c3563fc6b1cfce669bcf58d90962c23c966b8'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
CHECKPOINT_SHA = '17f575ebe83d0a9d9acf74e9436bff59eabcf8b5ed1bb8f0f99897c867c78a22'
CHECKPOINT182_SHA = '148b1e0f1ef0e585aa0e0be99ba4e65517b30d2827e3dc26768684bfc5afa280'
STAGING180_SHA = 'c43b16b305be8be861c65dfae2881634a28beec6d0067ee0d6c26f6c274d9a74'
STAGING181_SHA = '606c28375d3a6b483fab4cc99481487308923cd5b048927a085c56ddceaf3f93'
STAGING182_SHA = 'ba1aa8d0527dd8bbff76c86e274c9681ce9b6546bfd997a47e44988a92e3157f'
STAGING183_SHA = '4a30e3c82d3cb8bc54b13e24aa8dcf9a9ca5800843f8dac39f96c41eaf0f0a09'
STAGING_SHA = 'STAGING_PENDING'
VIDEO_RECEIPT_SHA = '9ba65419109c16b7bc94101c63becee5c156b611e6f8f917a210fe7d216b2ff4'
BUNDLE_SHA = 'bcca2f3fd91ffc0dec51a7077eb9e192a53b6e653b60c7db7159e473b83aac85'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
PRECHECK = dict(version=2, type='local_closure_precheck', status='passed', scope='local_application',
    pendingClosures=False, started=False, erased=False, externalContinuityVerified=False)
BASE_NAMES = sorted(['runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json'])
BUNDLE_NAMES = sorted(BASE_NAMES + ['runtime-video.json'])
VIDEO_DDL = ['0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql']
LIMIT = 2 * 1024 * 1024
RELEASE_ID = None
RELEASE_TAG = 'v1.8.4'


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
    require(version in ('1.7.2', '1.8.0', '1.8.1', '1.8.2', '1.8.3', '1.8.4'), 'RELEASE_VERSION')
    sha, tree = {'1.8.0': (LEGACY180_SOURCE, LEGACY180_TREE), '1.7.2': (ROLLBACK_SOURCE, ROLLBACK_TREE),
        '1.8.1': (LEGACY181_SOURCE, LEGACY181_TREE), '1.8.2': (LEGACY182_SOURCE, LEGACY182_TREE), '1.8.3': (OLD_SOURCE, OLD_TREE), '1.8.4': (SOURCE, TREE)}[version]
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
    return normalized, ordinary, video


def pinned_json(path, expected_sha, code):
    data = file(path); require(digest(data) == expected_sha, code)
    value = parse(data); require(type(value) is dict, code)
    return value


def precheck(path):
    data = file(path, limit=65536); lines = data.splitlines()
    require(1 <= len(lines) <= 16 and all(canonical(parse(line)) == canonical(PRECHECK) for line in lines), 'PRECHECK_NOT_PASSED')
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
        and observed.get('version') == '1.8.4' and observed.get('commit') == SOURCE
        and observed.get('nodeVersion') == 'v24.22.1' and type(observed.get('startedAt')) is int
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
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.8.4'
        and all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE)), 'PUBLICATION_PIN_REQUIRED')
    root = 'https://api.github.com/repos/fredbuhr/jessiemessage'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    values = []
    for suffix in ('/releases/' + str(RELEASE_ID), '/git/ref/tags/' + RELEASE_TAG, '/releases/latest'):
        url = root + suffix
        request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JessieMessage-release184-metadata-check'}, method='GET')
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


def verify_evidence():
    require(all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE, OLD_SOURCE, OLD_TREE, LEGACY182_SOURCE, LEGACY182_TREE, LEGACY180_SOURCE, LEGACY180_TREE, LEGACY181_SOURCE, LEGACY181_TREE, ROLLBACK_SOURCE, ROLLBACK_TREE)), 'QUALIFICATION_REQUIRED')
    require(all(re.fullmatch('[a-f0-9]{64}', pin) for pin in (NODE_SHA, CHECKPOINT_SHA, CHECKPOINT182_SHA,
        STAGING180_SHA, STAGING181_SHA, STAGING182_SHA, STAGING183_SHA, STAGING_SHA, VIDEO_RECEIPT_SHA, BUNDLE_SHA)), 'RECEIPT_PINS_REQUIRED')
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.8.4', 'PUBLICATION_PIN_REQUIRED')
    private_directory(PRIVATE)
    pins = [release(version) for version in ('1.7.2', '1.8.0', '1.8.1', '1.8.2', '1.8.3', '1.8.4')]
    inventories = [source(pin['checkout'], pin['source'], pin['tree'], pin['version']) for pin in pins]
    require(all(item[:2] == inventories[0][:2] for item in inventories), 'DEPENDENCIES_OR_MIGRATIONS')
    require([name for name, _ in inventories[0][2]] == VIDEO_DDL
        and all(item[2] == inventories[0][2] for item in inventories), 'VIDEO_MIGRATIONS')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(file(node, 0o700, limit=256 * 1024 * 1024, hash_only=True) == NODE_SHA, 'NODE_PIN')
    staged180 = pinned_json(PRIVATE / 'jm180-staging.json', STAGING180_SHA, 'STAGING180_PIN')
    require(staged180.get('format') == 'jessiemessage-release180-staging' and staged180.get('version') == 1
        and staged180.get('status') == 'release180_sources_staged_not_qualified'
        and staged180.get('nodeVersion') == 'v24.22.1' and staged180.get('nodeBinarySha256') == NODE_SHA
        and staged180.get('schemaMigrationsExpected') == 36 and staged180.get('baselineMigrationFiles') == 33
        and staged180.get('normalMigrationsPreserved') is True and staged180.get('candidateVideoMigrationsIdentical') is True
        and staged180.get('videoConfigurationDirectory') == str(PRIVATE / 'runtime-video-180')
        and staged180.get('operationsDirectory') == str(PRIVATE / 'recurring-backup-052')
        and [item.get('version') for item in staged180.get('releases', [])] == ['1.7.2', '1.8.0'], 'STAGING180_RECEIPT')
    staged_patches = []
    for version, expected_previous, expected_sha in (('1.8.1', '1.8.0', STAGING181_SHA), ('1.8.2', '1.8.1', STAGING182_SHA), ('1.8.3', '1.8.2', STAGING183_SHA), ('1.8.4', '1.8.3', STAGING_SHA)):
        staged = pinned_json(PRIVATE / ('jm' + version.replace('.', '') + '-staging.json'), expected_sha, 'STAGING_PIN')
        require(staged.get('format') == 'jessiemessage-release' + version.replace('.', '') + '-staging' and staged.get('version') == 1
            and staged.get('status') == 'release' + version.replace('.', '') + '_sources_staged_not_qualified'
            and staged.get('release') == version and staged.get('nodeVersion') == 'v24.22.1'
            and staged.get('nodeBinarySha256') == NODE_SHA and staged.get('schemaMigrationsExpected') == 36
            and staged.get('baselineMigrationFiles') == 33 and staged.get('normalMigrationsPreserved') is True
            and staged.get('videoMigrationsIdentical') is True and staged.get('priorActivePreserved') is True
            and staged.get('expectedActiveServiceVersion') == expected_previous
            and staged.get('existingConfigurationUntouched') is True
            and staged.get('videoConfigurationDirectory') == str(PRIVATE / 'runtime-video-180')
            and staged.get('operationsDirectory') == str(PRIVATE / 'recurring-backup-052')
            and all(staged.get(key) is False for key in ('sqlStatusChecked', 'configurationPrepared', 'hostedQualified',
                'precheckPassed', 'started', 'migrated', 'runtimeStarted', 'managerChanged', 'checkpointChanged'))
            and staged.get('noRestart') is True, 'STAGING_RECEIPT')
        if version == '1.8.3':
            require(staged.get('preservedActiveCheckpointSha256') == CHECKPOINT182_SHA, 'STAGING183_ACTIVE_CHECKPOINT')
        if version == '1.8.4':
            require(staged.get('preservedActiveCheckpointSha256') == CHECKPOINT_SHA, 'STAGING_ACTIVE_CHECKPOINT')
        staged_patches.append(staged)
    prepared = {}
    for pin, receipt in zip(pins, staged180['releases'] + staged_patches):
        version_field = 'release' if pin['version'] in ('1.8.1', '1.8.2', '1.8.3', '1.8.4') else 'version'
        require(receipt.get(version_field) == pin['version']
            and all(receipt.get(key) == str(pin[key]) for key in ('source', 'tree', 'checkout', 'launcher', 'checkLauncher', 'log', 'precheckLog'))
            and receipt.get('profile') == PROFILE and receipt.get('videoConfigurationDirectory') == str(PRIVATE / 'runtime-video-180'), 'STAGING_RELEASE')
        for key in ('launcher', 'checkLauncher'):
            require(file(pin[key], 0o700, hash_only=True) == receipt.get(key + 'Sha256'), 'LAUNCHER_PIN')
        prepared[pin['version']] = receipt
    runtime = pinned_json(PRIVATE / 'jm180-video-runtime-preparation.json', VIDEO_RECEIPT_SHA, 'VIDEO_RECEIPT_PIN')
    require(runtime.get('status') == 'video180_runtime_prepared' and runtime.get('files') == 7
        and runtime.get('source') == LEGACY180_SOURCE and runtime.get('tree') == LEGACY180_TREE
        and runtime.get('stagingReceiptSha256') == STAGING180_SHA
        and runtime.get('bundleFingerprintSha256') == BUNDLE_SHA
        and all(runtime.get(key) is True for key in ('existingConfigurationsByteExact', 'keysPreserved', 'independentVideoKey', 'emptyVideoRoot')), 'VIDEO_RECEIPT')
    bundle = PRIVATE / 'runtime-video-180'; source6 = PRIVATE / 'primary-origin-candidate-4a355851'
    private_directory(bundle); private_directory(source6)
    require(sorted(path.name for path in bundle.iterdir()) == BUNDLE_NAMES, 'VIDEO_BUNDLE')
    aggregate = hashlib.sha256()
    for name in BUNDLE_NAMES:
        content = file(bundle / name, limit=16384)
        require(bool(content), 'VIDEO_BUNDLE')
        aggregate.update(name.encode()); aggregate.update(b'\0'); aggregate.update(str(len(content)).encode()); aggregate.update(b'\0'); aggregate.update(content)
        if name in BASE_NAMES:
            require(content == file(source6 / name, limit=16384), 'SOURCE_CONFIG_DRIFT')
    require(aggregate.hexdigest() == BUNDLE_SHA, 'VIDEO_BUNDLE')
    require(file(pins[0]['log']) == b'', 'ROLLBACK_ALREADY_STARTED')
    checks = {'rollback172': precheck(pins[0]['precheckLog']),
        'release180': precheck(pins[1]['precheckLog']), 'release181': precheck(pins[2]['precheckLog']), 'release182': precheck(pins[3]['precheckLog']), 'release183': precheck(pins[4]['precheckLog']), 'release184': precheck(pins[5]['precheckLog'])}
    identity = startup(pins[5]['log']); http = collect_http(); published = collect_published_release()
    require(type(http) is dict and set(http) == {'health', 'ready', 'home', 'entry'}, 'PUBLIC_HTTP')
    for name, suffix in (('health', '/api/health'), ('ready', '/api/ready'), ('home', '/'), ('entry', '/api/entry')):
        require(type(http[name]) is dict and http[name].get('url') == 'https://jessiemessage.com' + suffix and http[name].get('status') == 200, 'PUBLIC_HTTP')
    require(http['health'].get('body') == {'status': 'ok'}, 'PUBLIC_HEALTH')
    require(http['ready'].get('body') == {'status': 'ready'}, 'PUBLIC_READY')
    require(http['entry'].get('administrator', 'missing') is None, 'PUBLIC_ENTRY')
    require(http['home'].get('sha256') == file(pins[5]['checkout'] / 'public/access.html', mode=None, hash_only=True), 'PUBLIC_HOME')
    require(published == dict(repository='fredbuhr/jessiemessage', releaseId=RELEASE_ID, tag=RELEASE_TAG,
        source=SOURCE, tagObjectType='commit', latest=RELEASE_TAG, latestSource=SOURCE,
        draft=False, prerelease=False, transport='anonymous_https_get_only'), 'PUBLISHED_RELEASE_IDENTITY')
    identity['publicHttp'] = http; identity['publicReady'] = True; identity['publishedRelease'] = published
    return dict(identity=identity, prechecks=checks, stagingReceiptSha256=STAGING_SHA,
        preservedStaging180ReceiptSha256=STAGING180_SHA, preservedStaging181ReceiptSha256=STAGING181_SHA,
        preservedStaging182ReceiptSha256=STAGING182_SHA, preservedStaging183ReceiptSha256=STAGING183_SHA,
        videoRuntimeReceiptSha256=VIDEO_RECEIPT_SHA, bundleFingerprintSha256=BUNDLE_SHA,
        launchers={version: {key: value[key] for key in ('launcherSha256', 'checkLauncherSha256')} for version, value in prepared.items()})


def instant(value):
    require(type(value) is str and len(value) <= 40, 'RECORD_DATE')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0
            and parsed <= datetime.now(timezone.utc), 'RECORD_DATE')
        return parsed
    except (ValueError, OverflowError):
        raise RecordError('RECORD_DATE') from None


def service(pin, evidence, *, rollback=False):
    hashes = evidence['launchers'][pin['version']]
    value = {key: str(pin[key]) for key in ('source', 'tree', 'checkout', 'launcher', 'checkLauncher', 'log')}
    value.update(release=pin['version'], nodeAfterDeployment='v24.22.1',
        nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'), nodeBinarySha256=NODE_SHA,
        launcherSha256=hashes['launcherSha256'], checkLauncherSha256=hashes['checkLauncherSha256'],
        schemaMigrations=36, profile=PROFILE, mode='start-local-closures', closuresEnabled=True,
        port=3000, tasksEnabled=True, announcementsEnabled=True, launcherMode='0700', logMode='0600',
        manualBackupsEnabled=True, backupMode='manual-admin', videoEnabled=True,
        videoCreationEnabled=not rollback, quickRepliesWritable=not rollback)
    if rollback:
        value.update(status='hosted_precheck_passed_not_started', identityVerified=False,
            precheck=evidence['prechecks']['rollback172'])
    else:
        value.update(status='identity_observed_via_startup_log_and_public_http', evidence=copy.deepcopy(evidence['identity']))
    return value


def prepare(document, evidence, recorded_at, original_sha):
    require(type(document) is dict and type(document.get('developmentSimplification')) is dict, 'CHECKPOINT_SHAPE')
    development = document['developmentSimplification']; existing = development.get('release184')
    prior = copy.deepcopy(document)
    if 'release184' in development:
        require(type(existing) is dict and type(existing.get('priorActiveService')) is dict, 'EXISTING_SECTION')
        instant(existing.get('recordedAt')); recorded_at = existing['recordedAt']
        prior['activeService'] = copy.deepcopy(existing['priorActiveService'])
        del prior['developmentSimplification']['release184']
        require(digest(render(prior)) == CHECKPOINT_SHA, 'EXISTING_PRIOR_DRIFT')
    else:
        require(original_sha == CHECKPOINT_SHA, 'CHECKPOINT_PIN')
    old = prior.get('activeService'); historical = prior['developmentSimplification']
    require(type(old) is dict and old.get('release') == '1.8.3' and old.get('source') == OLD_SOURCE
        and old.get('tree') == OLD_TREE and old.get('nodeAfterDeployment') == 'v24.22.1'
        and old.get('schemaMigrations') == 36 and all(type(historical.get(key)) is dict
            for key in ('release183', 'release182', 'release181', 'release180', 'release171', 'release160')), 'CURRENT_ACTIVE_DRIFT')
    active = service(release('1.8.4'), evidence)
    rollback = copy.deepcopy(historical['release183'].get('rollback'))
    require(type(rollback) is dict and rollback.get('release') == '1.7.2'
        and rollback.get('source') == ROLLBACK_SOURCE and rollback.get('tree') == ROLLBACK_TREE
        and rollback.get('schemaMigrations') == 36 and rollback.get('identityVerified') is False
        and rollback.get('status') == 'hosted_precheck_passed_not_started'
        and rollback.get('precheck') == evidence['prechecks']['rollback172'], 'ROLLBACK_DRIFT')
    section = dict(status=active['status'], recordedAt=recorded_at, evidence=copy.deepcopy(evidence),
        priorCheckpointSha256=CHECKPOINT_SHA, priorCheckpointDocumentSha256=digest(canonical(prior)),
        priorActiveService=copy.deepcopy(old), priorActiveServiceSha256=digest(canonical(old)),
        rollback=rollback, rollbackSha256=digest(canonical(rollback)),
        historicalRelease183Preserved=True, historicalRelease182Preserved=True, historicalRelease181Preserved=True, historicalRelease180Preserved=True, historicalRelease171Preserved=True, historicalRelease160Preserved=True,
        schemaUnchanged=True, restart171Allowed=False, restart160Allowed=False)
    updated = copy.deepcopy(prior); updated['activeService'] = active
    updated['developmentSimplification']['release184'] = section
    if existing is not None:
        require(canonical(document) == canonical(updated), 'EXISTING_SECTION_DIVERGENT')
        return updated, True
    restored = copy.deepcopy(updated); restored['activeService'] = copy.deepcopy(old)
    del restored['developmentSimplification']['release184']
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
            out_fd, temporary = tempfile.mkstemp(prefix='.release184-', dir=PRIVATE)
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
        return dict(status='release184_metadata_already_recorded' if already else 'release184_metadata_recorded',
            version='1.8.4', source=SOURCE, tree=TREE, metadataOnly=True, noRestart=True, schemaMigrations=36,
            release=evidence['identity']['release'], publicReady=True, rollbackRelease='1.7.2',
            rollbackPrecheckedNotStarted=True, historicalRelease183Preserved=True, historicalRelease182Preserved=True, historicalRelease181Preserved=True, historicalRelease180Preserved=True, historicalRelease171Preserved=True,
            historicalRelease160Preserved=True, priorActivePreserved=True, otherBlocksPreserved=True,
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
        print(json.dumps(dict(status='release184_metadata_unconfirmed', code=code,
            metadataOnly=True, noRestart=True, noAutomaticRetry=True), separators=(',', ':')))
        raise SystemExit(1)
