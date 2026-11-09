#!/usr/bin/env python3
"""Record1160 metadata after exact startup, storage attestations, public HTTP and CHECK receipts.

Same SQL38 and dependency graph as finalized1151, which reuses the real 1.15.0 installation.
No SQL, startup, installation or Manager operation.
The complete prior checkpoint and its historical rollback evidence are preserved.
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
DEPENDENCY_ROOT = OPERATOR / 'production-1150-6712028e/node_modules'
SOURCE = 'd2b57fb88d58aacf64dd51c5d1952c65f5c327ae'
TREE = '632ec530d812fa75cf2aa4b603c91c81dcaf7e8e'
OLD_SOURCE = 'a4a07f9f31c47a7185b57d11b8277be1d87fd2c1'
OLD_TREE = '568530e702fa4d0a8a6b1743988c5e20b8656c40'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
CHECKPOINT_SHA = '0a2f64c3f77082f374289883b3607a27e3447bdcb37e4ca43faea2971e6267c3'
STAGING_SHA = '3f0839dc9153fc4b38dbcad7b8084690e6953c72e48127facab6eb47bb831827'
OLD_STAGING_SHA = '0323f8631bc6c0f4c6f1fee22e68a2bc1c5b8d730a6d2c93545f929518cb7216'
START_SHA = 'dd495e038de3b7afe3ca4bd60653a00243b55038ab68bd2440a8c566921f4386'
CHECK_SHA = '703beb28850f15095cecf89cd453118c20f9b776444336b223158e9bfccd0feb'
LOCK_SHA = 'a8654edc9dec990d4c48c554f1674c76295e7463ac89d20babb881240f3a6a8c'
OLD_LOCK_SHA = 'eb6203bd91ad9a740766e55a517f29bc7c2acd6a48ddc725dfb0f4ee092ff7ca'
INSTALL_LOCK_SHA = '1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1'
DEPENDENCY_INVENTORY = {'sha256': '4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152', 'entries': 1180, 'files': 988}
ROOT_DEPENDENCIES = {'libheif-js': '1.23.5', 'mariadb': '3.5.4', 'nodemailer': '10.1.4', 'otpauth': '9.5.2', 'sharp': '0.35.5', 'web-push': '3.6.7', '@imagemagick/magick-wasm': '0.0.45', '@phenomen/libavif-wasm': '1.4.203', 'heic-to': '1.6.7'}
CODEC_FILES = {'@imagemagick/magick-wasm/LICENSE': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', '@imagemagick/magick-wasm/NOTICE': '7cb6cf162ba965ed068dbc9e638c9b792b8a1a9f4dae51031e7a21ff1ebefc8d', '@imagemagick/magick-wasm/dist/index.js': '696370daea26ec9ccb1d53316e49eca464cd841678be0fdd550652cbcc73208e', '@imagemagick/magick-wasm/dist/x86/magick.wasm': '54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c', '@phenomen/libavif-wasm/LICENSE': '9c49270079649e9ca5017850706c7c7b6d3e55c87351f50db343c9cf8a3947ac', '@phenomen/libavif-wasm/THIRD_PARTY_NOTICES.md': '6f002f45208da417ea75f12759a151419e6472dc3c5a7718b422c652f65209f6', '@phenomen/libavif-wasm/dist/codec/decode.mjs': '9a005bb8209388479101680344c7ef2123625d08af699ff32bbcd85c198f0d07', '@phenomen/libavif-wasm/dist/decode.wasm': '10cd87f2c5cd865a3c4fcfde30cc9611387bebe91e4eae7d62b62ef17c27279e', '@phenomen/libavif-wasm/dist/versions.json': '48e014a6fe8aa1f6638c3a146f106b78a7c6c7bc98ec7df47af5b7bcdbbac477', 'heic-to/LICENSE': 'dbd7222d8026e5d6ca6991d1e6a205de927f300840433c2e90a60644a9980c75', 'heic-to/src/lib/libheif-without-unsafe-eval.js': '75aaf03816c22f8cf40dbcaeb22bee83f2e1c5da4b7417577a7883b296348734'}
BUNDLE_SHA = 'bcca2f3fd91ffc0dec51a7077eb9e192a53b6e653b60c7db7159e473b83aac85'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
PRECHECK = dict(version=2, type='local_closure_precheck', status='passed', scope='local_application',
    pendingClosures=False, started=False, erased=False, externalContinuityVerified=False)
BUNDLE_NAMES = sorted(['runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json', 'runtime-video.json'])
VIDEO_DDL = ['0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql']
EXPERIENCE_DDL = ['0037_profile_preferences.sql', '0038_reply_tracking.sql']
LIMIT = 2 * 1024 * 1024
RELEASE_ID = 439283371
RELEASE_TAG = 'v1.16.0'
# User Manager observation and read-only hosted proof: 2026-11-09T15:33:01.632Z.
REPORTED_STARTUP_SECOND = 1794238381
STARTUP_RECORD_SHA = '4e91260ced4d870a1aee6e899f0fb5e6f488c59c1a05ce92d5ea57d9c1ae0104'
PRECHECK_SHA = '6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712'
STORAGE_MARKER_SHAS = {'media': '77a469a9238ac286d6a2b5e5648a8ba866d524eaeb3788f9b506a2460910a7d4', 'video': '707ac04b285d9df2e45ec9a4847167efdc334b46c09072f3dbc21ec75dd4e2ac'}

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
    require(version in ('1.15.1', '1.16.0'), 'RELEASE_VERSION')
    sha, tree = {'1.15.1': (OLD_SOURCE, OLD_TREE), '1.16.0': (SOURCE, TREE)}[version]
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
    require(package.get('dependencies') == lock['packages'][''].get('dependencies'), 'SOURCE_DEPENDENCIES')
    normalized = copy.deepcopy(lock); normalized['version'] = normalized['packages']['']['version'] = 'VERSION'
    ordinary = [(p.name, file(p, mode=None, hash_only=True)) for p in sorted((root / 'db/migrations').glob('*.sql'))]
    video = [(p.name, file(p, mode=None, hash_only=True)) for p in sorted((root / 'server/video/migrations').glob('*.sql'))]
    require(len(ordinary) == 33, 'MIGRATION_COUNT')
    experience = [(p.name, file(p, mode=None, hash_only=True)) for p in sorted((root / 'server/experience/migrations').glob('*.sql'))]
    normalized_package = copy.deepcopy(package); normalized_package['version'] = 'VERSION'
    return normalized, ordinary, video, experience, normalized_package


def pinned_json(path, expected_sha, code):
    data = file(path); require(digest(data) == expected_sha, code)
    value = parse(data); require(type(value) is dict, code)
    return value


def precheck(path):
    data = file(path, limit=65536); lines = data.splitlines()
    # Manager may append a valid receipt for each build or short-lived check.
    # The strict 64 KiB file bound limits parsing; every retained line must pass.
    require(lines and all(canonical(parse(line)) == canonical(PRECHECK) for line in lines), 'PRECHECK_NOT_PASSED')
    checksum = digest(data)
    require(checksum == PRECHECK_SHA, 'PRECHECK_PIN')
    return dict(path=str(path), sha256=checksum, passedReceipts=len(lines), pendingClosures=False, version=2)


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
        and observed.get('version') == '1.16.0' and observed.get('commit') == SOURCE
        and observed.get('nodeVersion') == 'v24.22.1' and type(observed.get('startedAt')) is int
        and observed['startedAt'] // 1000 == REPORTED_STARTUP_SECOND
        and 0 < observed['startedAt'] <= datetime.now(timezone.utc).timestamp() * 1000, 'STARTUP_IDENTITY')
    require(digest(canonical(value)) == STARTUP_RECORD_SHA, 'STARTUP_RECORD_PIN')
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
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.16.0'
        and all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE)), 'PUBLICATION_PIN_REQUIRED')
    root = 'https://api.github.com/repos/fredbuhr/jessiemessage'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    values = []
    for suffix in ('/releases/' + str(RELEASE_ID), '/git/ref/tags/' + RELEASE_TAG, '/releases/latest'):
        url = root + suffix
        request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JessieMessage-release1160-metadata-check'}, method='GET')
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
    return staged


def locked_transition(baseline, candidate):
    require(baseline.get('packages', {}).get('', {}).get('dependencies') == ROOT_DEPENDENCIES
        and candidate.get('packages', {}).get('', {}).get('dependencies') == ROOT_DEPENDENCIES, 'DEPENDENCY_ROOT_VERSIONS')
    require(candidate == baseline, 'DEPENDENCY_OTHER_LOCK_CHANGED')


def dependency_inventory(root):
    private_directory(root)
    entries = []
    def identity(info):
        return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink',
                                                   'st_size', 'st_mtime_ns', 'st_ctime_ns'))
    def walk(directory):
        before = directory.lstat()
        for path in sorted(directory.iterdir()):
            info = path.lstat(); relative = path.relative_to(root).as_posix()
            require(info.st_uid == os.getuid() and not any(ord(c) < 32 for c in relative), 'dependency_metadata')
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                require(target and not os.path.isabs(target) and path.resolve(strict=True).is_relative_to(root),
                        'dependency_external_link')
                require(identity(info) == identity(path.lstat()), 'dependency_link_changed')
                entries.append([relative, 'link', target])
            elif stat.S_ISDIR(info.st_mode):
                require(not info.st_mode & 0o022, 'dependency_directory_permissions')
                entries.append([relative, 'directory', stat.S_IMODE(info.st_mode)])
                walk(path)
            else:
                require(stat.S_ISREG(info.st_mode), 'dependency_special_file')
                entries.append([relative, 'file', stat.S_IMODE(info.st_mode), info.st_size,
                                file(path, mode=None, limit=128 * 1024 * 1024, hash_only=True)])
        require(identity(before) == identity(directory.lstat()), 'dependency_directory_changed')
    walk(root)
    return dict(sha256=digest(canonical(entries) + b'\n'), entries=len(entries),
                files=sum(item[1] == 'file' for item in entries))



def reused_dependencies(previous, current, staged, prior_staged):
    target = DEPENDENCY_ROOT
    private_directory(target.parent); private_directory(target)
    links = [pin['checkout'] / 'node_modules' for pin in (previous, current)]
    snapshots = []
    for pin, link in zip((previous, current), links):
        private_directory(pin['checkout'])
        before = link.lstat()
        require(stat.S_ISLNK(before.st_mode) and before.st_uid == os.getuid()
            and os.readlink(link) == str(target) and link.resolve(strict=True) == target
            and fingerprint(before) == fingerprint(link.lstat()), 'REUSED_DEPENDENCY_LINK')
        snapshots.append(fingerprint(before))
    inventory = dependency_inventory(target)
    require(inventory == DEPENDENCY_INVENTORY, 'DEPENDENCY_INVENTORY_PIN')
    for checkout, checksum in ((target.parent, INSTALL_LOCK_SHA),
        (previous['checkout'], OLD_LOCK_SHA), (current['checkout'], LOCK_SHA)):
        require(file(checkout / 'package-lock.json', mode=None, hash_only=True) == checksum, 'DEPENDENCY_LOCK_PIN')
    for name, expected in ROOT_DEPENDENCIES.items():
        manifest = parse(file(target / name / 'package.json', mode=None))
        require(manifest.get('name') == name and manifest.get('version') == expected, 'INSTALLED_VERSION')
    for name, expected in CODEC_FILES.items():
        require(file(target / name, mode=None, limit=128 * 1024 * 1024, hash_only=True) == expected, 'INSTALLED_CODEC')
    for receipt in (prior_staged, staged):
        recorded = receipt.get('dependencies')
        require(receipt.get('dependenciesReused') is True and receipt.get('dependencyDirectory') == str(target)
            and receipt.get('checkoutMode') == '0700' and type(recorded) is dict
            and recorded.get('strategy') == 'reuse-exact-private-1150' and recorded.get('directory') == str(target)
            and recorded.get('lockSha256') == INSTALL_LOCK_SHA and recorded.get('inventory') == inventory
            and recorded.get('directVersions') == ROOT_DEPENDENCIES and recorded.get('codecSha256') == CODEC_FILES
            and recorded.get('scriptsExecuted') is False and recorded.get('installed') is False, 'DEPENDENCY_STAGING_BINDING')
    require(staged['dependencies'].get('activeApplicationLockSha256') == OLD_LOCK_SHA, 'DEPENDENCY_STAGING_BINDING')
    require(dependency_inventory(target) == inventory and [fingerprint(link.lstat()) for link in links] == snapshots, 'DEPENDENCIES_CHANGED')
    return dict(strategy='reuse-exact-private-1150', directory=str(target), lockSha256=INSTALL_LOCK_SHA,
        applicationLockSha256=LOCK_SHA, installationLockSha256=INSTALL_LOCK_SHA, baseLockSha256=OLD_LOCK_SHA,
        inventory=inventory, directVersions=ROOT_DEPENDENCIES, codecSha256=CODEC_FILES,
        installedFilesVerified=True, scriptsExecuted=False, installed=False)


def storage_markers(bundle):
    hashes = {}
    for kind in ('media', 'video'):
        settings = parse(file(bundle / ('runtime-' + kind + '.json'), limit=16384))
        root_value = settings.get(kind + 'Root')
        require(type(root_value) is str and 1 < len(root_value) <= 4096
            and not re.search(r'[\x00-\x1f\x7f]', root_value) and '\\' not in root_value, 'STORAGE_MARKER_ROOT')
        root = Path(root_value)
        require(str(root) == root_value and root != root.parent, 'STORAGE_MARKER_ROOT')
        private_directory(root); private_directory(root.parent)
        name_input = json.dumps([kind, root_value], ensure_ascii=False, separators=(',', ':')).encode()
        sidecar = root.parent / ('binding-' + digest(name_input) + '.json')
        checksum = file(sidecar, limit=512, hash_only=True)
        require(checksum == STORAGE_MARKER_SHAS[kind], 'STORAGE_MARKER_PIN')
        hashes[kind] = checksum
    return dict(sha256=hashes, installedMarkersVerified=2, sqlReadByWriter=False)


def verify_evidence():
    require(all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE, OLD_SOURCE, OLD_TREE)), 'QUALIFICATION_REQUIRED')
    require(all(re.fullmatch('[a-f0-9]{64}', pin) for pin in (NODE_SHA, CHECKPOINT_SHA, STAGING_SHA, OLD_STAGING_SHA,
        LOCK_SHA, OLD_LOCK_SHA, INSTALL_LOCK_SHA, DEPENDENCY_INVENTORY['sha256'], BUNDLE_SHA, *CODEC_FILES.values())), 'RECEIPT_PINS_REQUIRED')
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.16.0', 'PUBLICATION_PIN_REQUIRED')
    require(type(REPORTED_STARTUP_SECOND) is int and REPORTED_STARTUP_SECOND > 0
        and re.fullmatch('[a-f0-9]{64}', STARTUP_RECORD_SHA), 'STARTUP_PIN_REQUIRED')
    require(all(re.fullmatch('[a-f0-9]{64}', pin) for pin in (START_SHA, CHECK_SHA, PRECHECK_SHA)), 'HOSTED_LAUNCHER_AND_CHECK_PINS_REQUIRED')
    require(type(STORAGE_MARKER_SHAS) is dict and set(STORAGE_MARKER_SHAS) == {'media', 'video'}
        and all(re.fullmatch('[a-f0-9]{64}', pin) for pin in STORAGE_MARKER_SHAS.values()), 'STORAGE_MARKER_PINS_REQUIRED')
    private_directory(PRIVATE)
    previous, current = release('1.15.1'), release('1.16.0')
    baseline = source(previous['checkout'], OLD_SOURCE, OLD_TREE, '1.15.1')
    candidate = source(current['checkout'], SOURCE, TREE, '1.16.0')
    require(baseline[1:4] == candidate[1:4] and [name for name, _ in candidate[2]] == VIDEO_DDL
        and [name for name, _ in candidate[3]] == EXPERIENCE_DDL, 'MIGRATIONS_CHANGED')
    locked_transition(baseline[0], candidate[0])
    require(baseline[4] == candidate[4], 'PACKAGE_OTHER_CHANGED')
    require(file(PRIVATE / 'runtime-node-v24.22.1/bin/node', 0o700, limit=256 * 1024 * 1024, hash_only=True) == NODE_SHA, 'NODE_PIN')
    staged = staging('1.16.0', STAGING_SHA)
    require(staged.get('preservedActiveCheckpointSha256') == CHECKPOINT_SHA, 'STAGING_PRIOR_CHECKPOINT')
    require(staged.get('priorActiveStagingSha256') == OLD_STAGING_SHA, 'STAGING_PRIOR_RECEIPT')
    require(staged.get('baselineMetadataRelease') == '1.15.1'
        and staged.get('expectedActiveServiceVersion') == '1.15.1', 'STAGING_METADATA_BASELINE')
    require(staged.get('launcherSha256') == START_SHA and staged.get('checkLauncherSha256') == CHECK_SHA, 'CURRENT_LAUNCHER_PINS')
    prior_staged = staging('1.15.1', OLD_STAGING_SHA)
    dependencies = reused_dependencies(previous, current, staged, prior_staged)
    bundle = PRIVATE / 'runtime-video-180'; private_directory(bundle)
    require(sorted(path.name for path in bundle.iterdir()) == BUNDLE_NAMES, 'VIDEO_BUNDLE')
    aggregate = hashlib.sha256()
    for name in BUNDLE_NAMES:
        content = file(bundle / name, limit=16384)
        require(bool(content), 'VIDEO_BUNDLE')
        aggregate.update(name.encode()); aggregate.update(b'\0'); aggregate.update(str(len(content)).encode()); aggregate.update(b'\0'); aggregate.update(content)
    require(aggregate.hexdigest() == BUNDLE_SHA, 'VIDEO_BUNDLE')
    require(staged.get('checkPrerequisite') == 'verified_storage_root_bindings'
        and staged.get('storageBindingsChecked') is False and staged.get('storageBindingsWritten') is False, 'STAGING_STORAGE_SCOPE')
    markers = storage_markers(bundle)
    check = precheck(current['precheckLog'])
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
        dependencies=dependencies, storageBindings=markers, bundleFingerprintSha256=BUNDLE_SHA, launchers={key: staged[key] for key in ('launcherSha256', 'checkLauncherSha256')},
        priorMetadataRelease='1.15.1', priorHostedStaging=dict(release='1.15.1', source=OLD_SOURCE,
            tree=OLD_TREE, stagingReceiptSha256=OLD_STAGING_SHA,
            launcherSha256=prior_staged['launcherSha256'], checkLauncherSha256=prior_staged['checkLauncherSha256'],
            scope='pinned_prior_staging_with_complete_final1151_metadata_preserved'))


def prepare(document, evidence, recorded_at, original_sha):
    require(type(document) is dict and type(document.get('developmentSimplification')) is dict, 'CHECKPOINT_SHAPE')
    development = document['developmentSimplification']; existing = development.get('release1160')
    prior = copy.deepcopy(document)
    if existing is not None:
        require(type(existing) is dict and type(existing.get('priorActiveService')) is dict, 'EXISTING_SECTION')
        instant(existing.get('recordedAt')); recorded_at = existing['recordedAt']
        prior['activeService'] = copy.deepcopy(existing['priorActiveService'])
        del prior['developmentSimplification']['release1160']
        require(digest(render(prior)) == CHECKPOINT_SHA, 'EXISTING_PRIOR_DRIFT')
    else:
        require(original_sha == CHECKPOINT_SHA, 'CHECKPOINT_PIN')
    old = prior.get('activeService')
    require(type(old) is dict and old.get('release') == '1.15.1' and old.get('source') == OLD_SOURCE
        and old.get('tree') == OLD_TREE and old.get('nodeAfterDeployment') == 'v24.22.1'
        and old.get('schemaMigrations') == 38 and all(type(prior['developmentSimplification'].get(name)) is dict for name in ('release1151', 'release1150', 'release1141', 'release1140', 'release1130', 'release1112', 'release1111', 'release1110', 'release1101', 'release1100', 'release190', 'release184')), 'CURRENT_ACTIVE_DRIFT')
    pin = release('1.16.0')
    active = {key: str(pin[key]) for key in ('source', 'tree', 'checkout', 'launcher', 'checkLauncher', 'log')}
    active.update(release='1.16.0', nodeAfterDeployment='v24.22.1', nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'),
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
        historicalRelease1151Preserved=True, historicalRelease1150Preserved=True, historicalRelease1141Preserved=True, historicalRelease1140Preserved=True, historicalRelease1130Preserved=True, historicalRelease1112Preserved=True, historicalRelease1111Preserved=True, historicalRelease1110Preserved=True, historicalRelease1101Preserved=True, historicalRelease1100Preserved=True, historicalRelease190Preserved=True, historicalRelease184Preserved=True, schemaUnchanged=True, restart184Allowed=False, restart172Allowed=False,
        priorHostedStaging1151Preserved=True, priorMetadataRelease='1.15.1',
        priorRelease1151SqlCompatible=True, publicProfileDowngradeQualified=False,
        publicSnapshotDowngradeLimit='backend1111_cannot_read_new_public_snapshot_format2',
        rollbackAfterMigrationQualified=False,
        rollbackQualificationScope='historical_sql38_precheck_only_not_remount_qualified')
    updated = copy.deepcopy(prior); updated['activeService'] = active
    updated['developmentSimplification']['release1160'] = section
    if existing is not None:
        require(canonical(document) == canonical(updated), 'EXISTING_SECTION_DIVERGENT')
        return updated, True
    restored = copy.deepcopy(updated); restored['activeService'] = copy.deepcopy(old)
    del restored['developmentSimplification']['release1160']
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
            out_fd, temporary = tempfile.mkstemp(prefix='.release1160-', dir=PRIVATE)
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
        return dict(status='release1160_metadata_already_recorded' if already else 'release1160_metadata_recorded',
            version='1.16.0', source=SOURCE, tree=TREE, metadataOnly=True, noRestart=True, schemaMigrations=38,
            applicationTables=37, release=evidence['identity']['release'], publicReady=True,
            rollbackRelease=None, rollbackAfterMigrationQualified=False,
            rollbackQualificationScope='historical_sql38_precheck_only_not_remount_qualified', publicProfileDowngradeQualified=False,
            restart184Allowed=False, restart172Allowed=False, historicalRelease1151Preserved=True, historicalRelease1150Preserved=True, historicalRelease1141Preserved=True, historicalRelease1140Preserved=True, historicalRelease1130Preserved=True, historicalRelease1112Preserved=True, historicalRelease1111Preserved=True, historicalRelease1110Preserved=True, historicalRelease1101Preserved=True, historicalRelease1100Preserved=True, historicalRelease190Preserved=True, historicalRelease184Preserved=True,
            priorHostedStaging1151Preserved=True, priorMetadataRelease='1.15.1',
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
        print(json.dumps(dict(status='release1160_metadata_unconfirmed', code=code,
            metadataOnly=True, noRestart=True, noAutomaticRetry=True), separators=(',', ':')))
        raise SystemExit(1)
