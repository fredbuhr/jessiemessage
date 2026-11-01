#!/usr/bin/env python3
"""Record1150 metadata after exact startup, public HTTP and CHECK receipts.

Same SQL38; three pinned codec packages use a fresh private dependency directory.
The complete finalized1141 state and its legacy1140 dependency chain are preserved.
No SQL, startup, installation or Manager operation.
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
DEPENDENCY_ROOT = OPERATOR / 'production-1150-6712028e/node_modules'
OLD_DEPENDENCY_ROOT = OPERATOR / 'production-1140-4f3ce5de/node_modules'
SOURCE = '6712028e08b1e04ac7628bdbb9c39fd9f90d9909'
TREE = 'c80ee33ebfe01838c86cc2b4166b344acf5ea745'
OLD_SOURCE = 'c803c2c9be16c0c4ee218d8cac4a1272620d2772'
OLD_TREE = 'f391b5cebe0a8a8ffd63c818cd481b50970336f1'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
CHECKPOINT_SHA = '93d6ddf70db3b1b30d006bf2fb30ab7594ebc2d2b8f88cc59a230f247cbaca82'
STAGING_SHA = '6384c78bf94ce688ec33060d672019d8ae534466d7de57c701046e75c6c46a4b'
OLD_STAGING_SHA = 'df4b58f79ed08af15365557fd88670cd887c4cce9382200fadbd03a9c9593d72'
START_SHA = 'da4c86b73649a0939d8ff37f1bd35175b5d2d2b31aa0f15bcd8e1f9fcb191b56'
CHECK_SHA = 'c165522014d83d09d5fcb0032b41d91fa13e2f5e146f5aaffde61062620459ba'
LOCK_SHA = '1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1'
OLD_LOCK_SHA = 'd4b723dc88b8e0e7b0d85755d6751b31399248a1444c55e47c61c56809e76f7c'
DEPENDENCY_INVENTORY = {'entries': 1180,
 'files': 988,
 'sha256': '4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152'}
OLD_DEPENDENCY_INVENTORY = {'entries': 1082,
 'files': 914,
 'sha256': '547c6ec03aa29027264dbb848e7830df0cb615a1eb92710498bc94d988897c37'}
ROOT_DEPENDENCIES = {'@imagemagick/magick-wasm': '0.0.45',
 '@phenomen/libavif-wasm': '1.4.203',
 'heic-to': '1.6.7',
 'libheif-js': '1.23.5',
 'mariadb': '3.5.4',
 'nodemailer': '10.1.4',
 'otpauth': '9.5.2',
 'sharp': '0.35.5',
 'web-push': '3.6.7'}
CODEC_FILES = {'@imagemagick/magick-wasm/LICENSE': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
 '@imagemagick/magick-wasm/NOTICE': '7cb6cf162ba965ed068dbc9e638c9b792b8a1a9f4dae51031e7a21ff1ebefc8d',
 '@imagemagick/magick-wasm/dist/index.js': '696370daea26ec9ccb1d53316e49eca464cd841678be0fdd550652cbcc73208e',
 '@imagemagick/magick-wasm/dist/x86/magick.wasm': '54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c',
 '@phenomen/libavif-wasm/LICENSE': '9c49270079649e9ca5017850706c7c7b6d3e55c87351f50db343c9cf8a3947ac',
 '@phenomen/libavif-wasm/THIRD_PARTY_NOTICES.md': '6f002f45208da417ea75f12759a151419e6472dc3c5a7718b422c652f65209f6',
 '@phenomen/libavif-wasm/dist/codec/decode.mjs': '9a005bb8209388479101680344c7ef2123625d08af699ff32bbcd85c198f0d07',
 '@phenomen/libavif-wasm/dist/decode.wasm': '10cd87f2c5cd865a3c4fcfde30cc9611387bebe91e4eae7d62b62ef17c27279e',
 '@phenomen/libavif-wasm/dist/versions.json': '48e014a6fe8aa1f6638c3a146f106b78a7c6c7bc98ec7df47af5b7bcdbbac477',
 'heic-to/LICENSE': 'dbd7222d8026e5d6ca6991d1e6a205de927f300840433c2e90a60644a9980c75',
 'heic-to/src/lib/libheif-without-unsafe-eval.js': '75aaf03816c22f8cf40dbcaeb22bee83f2e1c5da4b7417577a7883b296348734'}
LEGACY_SOURCE = '4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd'
LEGACY_TREE = 'e5a239eaf7b8c3395a843c9e0d600efeb7aa569b'
LEGACY_STAGING_SHA = '2fe494a43a446c882ce509f4ecf51925bd5789a94bdbdf2ce6923d83e5ff7d72'
LEGACY_LOCK_SHA = '623e3be5057fd8d348d9363d30afef93c6e26dc8cd6df3b8150116c5f17c8e5b'
OLD_START_SHA = 'e53198d1ddf099eaf3ecbd60b6916a94921430a555eaed2a4a4c41ce64ff27a9'
OLD_CHECK_SHA = '6f4aa454a5d1163b9450dba8644ed50dcf034f1a916cad1891c0fa1fc2b05919'
OLD_ROOT_DEPENDENCIES = {'libheif-js': '1.23.5',
 'mariadb': '3.5.4',
 'nodemailer': '10.1.4',
 'otpauth': '9.5.2',
 'sharp': '0.35.5',
 'web-push': '3.6.7'}
OLD_CODEC_FILES = {'libheif-wasm/LICENSE': 'fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596',
 'libheif-wasm/libheif-bundle.mjs': '095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9'}
ADDED_LOCK_RECORDS = {'node_modules/@imagemagick/magick-wasm': {'integrity': 'sha512-ef8FHka4xLWo5/tGTV6P45bPjTvnKZz/oHN6sCDTbY8zaCdM2MeaoQHLsy9IHuiVHQhomG3TQ6ErgTnEDyuzvw==',
                                           'license': 'Apache-2.0',
                                           'resolved': 'https://registry.npmjs.org/@imagemagick/magick-wasm/-/magick-wasm-0.0.45.tgz',
                                           'version': '0.0.45'},
 'node_modules/@phenomen/libavif-wasm': {'engines': {'node': '>=22'},
                                         'integrity': 'sha512-gGYPkUddbjsnyRRWV75oXeq0Wog5SSAR7d9QHo5c68cWwvN64s+ikfFGYgQ1SeKuDqGWhE33qtv/xibTIBfW7Q==',
                                         'license': 'MIT',
                                         'resolved': 'https://registry.npmjs.org/@phenomen/libavif-wasm/-/libavif-wasm-1.4.203.tgz',
                                         'version': '1.4.203'},
 'node_modules/heic-to': {'integrity': 'sha512-GCPYNl86u6eZ7mr2aa+uQB+PrQOVKSBYfH8esovr8kh2c6EYQSDYIJ6uhXSmM2hPC8PdBVJ/Trn0jnfM9H9gvg==',
                          'license': 'LGPL-3.0',
                          'resolved': 'https://registry.npmjs.org/heic-to/-/heic-to-1.6.7.tgz',
                          'version': '1.6.7'}}
SMOKE_PATH = 'ops/smoke-photo-codecs1150.mjs'
SMOKE_SHA = '57d6d1e552fb8dd9a9373d3fa0a103705e109edbffe8c9c35e1dfb6fe53d9ddb'
SMOKE_STDOUT_SHA = 'e543359fa86dde7b69979c467dff601a69e481fdb47907762949ccfb9687ec8e'
SMOKE_STDERR_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
NPM_STDOUT_SHA = 'a93cec561d30b0e48414b8a526dfc163a51e9ca00ac0b52c2fd769a7c13b251f'
NPM_STDERR_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
ARCHIVE_SHA = '6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6'
ARCHIVE_BYTES = 32026916
NPM_VERSION = '11.19.1'
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
RELEASE_ID = 430794626
RELEASE_TAG = 'v1.15.0'
# User UI: 01/11/2026 20:27:30 Europe/Paris (UTC+01); milliseconds come only from the unique startup log.
REPORTED_STARTUP_SECOND = 1793561250

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
    require(version in ('1.15.0', '1.14.1', '1.14.0', '1.8.5'), 'RELEASE_VERSION')
    sha, tree = {'1.15.0': (SOURCE, TREE), '1.14.1': (OLD_SOURCE, OLD_TREE),
        '1.14.0': (LEGACY_SOURCE, LEGACY_TREE), '1.8.5': (ROLLBACK185_SOURCE, ROLLBACK185_TREE)}[version]
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
        and observed.get('version') == '1.15.0' and observed.get('commit') == SOURCE
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
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.15.0'
        and all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE)), 'PUBLICATION_PIN_REQUIRED')
    root = 'https://api.github.com/repos/fredbuhr/jessiemessage'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    values = []
    for suffix in ('/releases/' + str(RELEASE_ID), '/git/ref/tags/' + RELEASE_TAG, '/releases/latest'):
        url = root + suffix
        request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JessieMessage-release1150-metadata-check'}, method='GET')
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


def locked_transition(baseline, candidate):
    require(baseline.get('packages', {}).get('', {}).get('dependencies') == OLD_ROOT_DEPENDENCIES
        and candidate.get('packages', {}).get('', {}).get('dependencies') == ROOT_DEPENDENCIES, 'DEPENDENCY_ROOT_VERSIONS')
    require(type(ADDED_LOCK_RECORDS) is dict and bool(ADDED_LOCK_RECORDS), 'DEPENDENCY_ADDED_PINS')
    previous, updated = baseline['packages'], candidate['packages']
    require(set(updated) - set(previous) == set(ADDED_LOCK_RECORDS)
        and all(updated[name] == value for name, value in ADDED_LOCK_RECORDS.items()), 'DEPENDENCY_ADDED_LOCK_CHANGED')
    normalized = copy.deepcopy(candidate)
    normalized['packages']['']['dependencies'] = copy.deepcopy(OLD_ROOT_DEPENDENCIES)
    for name in ADDED_LOCK_RECORDS:
        del normalized['packages'][name]
    require(normalized == baseline, 'DEPENDENCY_OTHER_LOCK_CHANGED')


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
    target = OLD_DEPENDENCY_ROOT
    require(target == previous['checkout'] / 'node_modules', 'PRIOR_DEPENDENCY_PATH')
    private_directory(target); private_directory(previous['checkout']); private_directory(current['checkout'])
    link = current['checkout'] / 'node_modules'; before = link.lstat()
    require(stat.S_ISLNK(before.st_mode) and before.st_uid == os.getuid()
        and os.readlink(link) == str(target) and link.resolve(strict=True) == target
        and fingerprint(before) == fingerprint(link.lstat()), 'REUSED_DEPENDENCY_LINK')
    require(staged.get('dependenciesReused') is True and staged.get('dependencyDirectory') == str(target)
        and staged.get('checkoutMode') == '0700', 'REUSED_DEPENDENCIES')
    inventory = dependency_inventory(target)
    require(inventory == OLD_DEPENDENCY_INVENTORY, 'DEPENDENCY_INVENTORY_PIN')
    require(file(previous['checkout'] / 'package-lock.json', mode=None, hash_only=True) == LEGACY_LOCK_SHA
        and file(current['checkout'] / 'package-lock.json', mode=None, hash_only=True) == OLD_LOCK_SHA, 'DEPENDENCY_LOCK_PIN')
    for name, expected in OLD_ROOT_DEPENDENCIES.items():
        manifest = parse(file(target / name / 'package.json', mode=None))
        require(manifest.get('name') == name and manifest.get('version') == expected, 'INSTALLED_VERSION')
    for name, expected in OLD_CODEC_FILES.items():
        require(file(target / 'libheif-js' / name, mode=None, hash_only=True) == expected, 'INSTALLED_CODEC')
    recorded = staged.get('dependencies')
    require(type(recorded) is dict and recorded.get('strategy') == 'reuse-exact-private-1140'
        and recorded.get('directory') == str(target) and recorded.get('lockSha256') == LEGACY_LOCK_SHA
        and recorded.get('inventory') == inventory and recorded.get('directVersions') == OLD_ROOT_DEPENDENCIES
        and recorded.get('codecSha256') == OLD_CODEC_FILES and recorded.get('scriptsExecuted') is False
        and recorded.get('installed') is False, 'DEPENDENCY_STAGING_BINDING')
    prior = prior_staged.get('dependencies')
    require(prior_staged.get('dependenciesReused') is False and prior_staged.get('dependencyDirectory') == str(target)
        and type(prior) is dict and prior.get('strategy') == 'private-npm-ci-ignore-scripts'
        and prior.get('directory') == str(target) and prior.get('lockSha256') == LEGACY_LOCK_SHA
        and prior.get('inventory') == inventory and prior.get('directVersions') == OLD_ROOT_DEPENDENCIES
        and prior.get('codecSha256') == OLD_CODEC_FILES and prior.get('scriptsExecuted') is False
        and prior.get('sharpSyntheticSmoke') is True, 'PRIOR_DEPENDENCY_STAGING_BINDING')
    require(dependency_inventory(target) == inventory and fingerprint(before) == fingerprint(link.lstat()), 'DEPENDENCIES_CHANGED')
    return dict(strategy='reuse-exact-private-1140', directory=str(target), lockSha256=OLD_LOCK_SHA,
        baseLockSha256=LEGACY_LOCK_SHA, inventory=inventory, directVersions=OLD_ROOT_DEPENDENCIES,
        codecSha256=OLD_CODEC_FILES, installedFilesVerified=True, scriptsExecuted=False, installed=False,
        sharpQualificationScope='pinned_1140_staging_receipt_only_no_code_execution')


def fresh_dependencies(previous, current, staged, prior_staged, legacy_staged):
    legacy = release('1.14.0')
    prior_verified = reused_dependencies(legacy, previous, prior_staged, legacy_staged)
    target = DEPENDENCY_ROOT
    require(target == current['checkout'] / 'node_modules' and target != OLD_DEPENDENCY_ROOT, 'FRESH_DEPENDENCY_PATH')
    private_directory(current['checkout']); private_directory(target)
    require(staged.get('checkoutMode') == '0700' and staged.get('dependenciesReused') is False
        and staged.get('dependencyDirectory') == str(target), 'FRESH_DEPENDENCIES')
    inventory = dependency_inventory(target)
    require(inventory == DEPENDENCY_INVENTORY, 'DEPENDENCY_INVENTORY_PIN')
    require(file(current['checkout'] / 'package-lock.json', mode=None, hash_only=True) == LOCK_SHA, 'DEPENDENCY_LOCK_PIN')
    for name, expected in ROOT_DEPENDENCIES.items():
        manifest = parse(file(target / name / 'package.json', mode=None))
        require(manifest.get('name') == name and manifest.get('version') == expected, 'INSTALLED_VERSION')
    for name, expected in CODEC_FILES.items():
        require(file(target / name, mode=None, limit=128 * 1024 * 1024, hash_only=True) == expected, 'INSTALLED_CODEC')
    for name, expected in OLD_CODEC_FILES.items():
        require(file(target / 'libheif-js' / name, mode=None, hash_only=True) == expected, 'INSTALLED_PRIOR_CODEC')
    require(file(current['checkout'] / SMOKE_PATH, mode=None, hash_only=True) == SMOKE_SHA, 'CODEC_SMOKE_SOURCE')
    recorded = staged.get('dependencies')
    tools = PRIVATE / ('install-1150-' + SOURCE[:8]); private_directory(tools)
    installer = dict(npmVersion=NPM_VERSION, npmCli=str(tools / 'npm/bin/npm-cli.js'),
        archiveSha256=ARCHIVE_SHA, archiveBytes=ARCHIVE_BYTES)
    require(staged.get('installer') == installer, 'INSTALLER_STAGING_BINDING')
    expected = dict(strategy='private-npm-ci-ignore-scripts', directory=str(target), lockSha256=LOCK_SHA,
        inventory=inventory, directVersions=ROOT_DEPENDENCIES, codecSha256=CODEC_FILES,
        codecSyntheticSmoke=True, codecSmokePath=SMOKE_PATH, codecSmokeSha256=SMOKE_SHA,
        codecSmokeStdoutSha256=SMOKE_STDOUT_SHA, codecSmokeStderrSha256=SMOKE_STDERR_SHA,
        stdoutSha256=NPM_STDOUT_SHA, stderrSha256=NPM_STDERR_SHA, scriptsExecuted=False)
    require(recorded == expected, 'DEPENDENCY_STAGING_BINDING')
    for name, expected_sha in (('npm-stdout.log', NPM_STDOUT_SHA), ('npm-stderr.log', NPM_STDERR_SHA),
            ('codec-smoke-stdout.log', SMOKE_STDOUT_SHA), ('codec-smoke-stderr.log', SMOKE_STDERR_SHA)):
        require(file(tools / name, hash_only=True) == expected_sha, 'INSTALL_LOG_PIN')
    prior = dict(directory=str(OLD_DEPENDENCY_ROOT), inventory=OLD_DEPENDENCY_INVENTORY,
        directVersions=OLD_ROOT_DEPENDENCIES, applicationLockSha256=OLD_LOCK_SHA,
        installationLockSha256=LEGACY_LOCK_SHA, codecSha256=OLD_CODEC_FILES, installed=False, scriptsExecuted=False)
    require(staged.get('priorDependencyInventory') == OLD_DEPENDENCY_INVENTORY
        and staged.get('priorDependencies') == prior and staged.get('bundleFingerprintSha256') == BUNDLE_SHA,
        'PRIOR_DEPENDENCY_STAGING_BINDING')
    require(dependency_inventory(target) == inventory
        and dependency_inventory(OLD_DEPENDENCY_ROOT) == prior_verified['inventory'], 'DEPENDENCIES_CHANGED')
    return dict(expected, baseLockSha256=OLD_LOCK_SHA, priorInstallationLockSha256=LEGACY_LOCK_SHA,
        installedFilesVerified=True, installed=False, freshDirectoryVerified=True,
        priorDependencies=prior, installationQualificationScope='pinned_1150_staging_receipt_only_no_code_execution')


def verify_evidence():
    require(all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE, OLD_SOURCE, OLD_TREE, LEGACY_SOURCE, LEGACY_TREE)), 'QUALIFICATION_REQUIRED')
    require(all(re.fullmatch('[a-f0-9]{64}', pin) for pin in (NODE_SHA, CHECKPOINT_SHA, STAGING_SHA, OLD_STAGING_SHA,
        START_SHA, CHECK_SHA, OLD_START_SHA, OLD_CHECK_SHA, LOCK_SHA, OLD_LOCK_SHA, LEGACY_LOCK_SHA,
        LEGACY_STAGING_SHA, DEPENDENCY_INVENTORY['sha256'], OLD_DEPENDENCY_INVENTORY['sha256'], BUNDLE_SHA,
        SMOKE_SHA, SMOKE_STDOUT_SHA, SMOKE_STDERR_SHA, NPM_STDOUT_SHA, NPM_STDERR_SHA, ARCHIVE_SHA,
        *CODEC_FILES.values(), *OLD_CODEC_FILES.values())), 'RECEIPT_PINS_REQUIRED')
    require(type(RELEASE_ID) is int and RELEASE_ID > 0 and RELEASE_TAG == 'v1.15.0', 'PUBLICATION_PIN_REQUIRED')
    require(type(REPORTED_STARTUP_SECOND) is int and REPORTED_STARTUP_SECOND > 0, 'STARTUP_PIN_REQUIRED')
    private_directory(PRIVATE)
    previous, current = release('1.14.1'), release('1.15.0')
    baseline = source(previous['checkout'], OLD_SOURCE, OLD_TREE, '1.14.1')
    candidate = source(current['checkout'], SOURCE, TREE, '1.15.0')
    require(baseline[1:4] == candidate[1:4] and [name for name, _ in candidate[2]] == VIDEO_DDL
        and [name for name, _ in candidate[3]] == EXPERIENCE_DDL, 'MIGRATIONS_CHANGED')
    locked_transition(baseline[0], candidate[0])
    package = copy.deepcopy(candidate[4]); package['dependencies'] = copy.deepcopy(OLD_ROOT_DEPENDENCIES)
    require(baseline[4] == package, 'PACKAGE_OTHER_CHANGED')
    require(file(PRIVATE / 'runtime-node-v24.22.1/bin/node', 0o700, limit=256 * 1024 * 1024, hash_only=True) == NODE_SHA, 'NODE_PIN')
    staged = staging('1.15.0', STAGING_SHA)
    require(staged.get('preservedActiveCheckpointSha256') == CHECKPOINT_SHA, 'STAGING_PRIOR_CHECKPOINT')
    require(staged.get('priorActiveStagingSha256') == OLD_STAGING_SHA, 'STAGING_PRIOR_RECEIPT')
    require(staged.get('baselineMetadataRelease') == '1.14.1'
        and staged.get('expectedActiveServiceVersion') == '1.14.1', 'STAGING_METADATA_BASELINE')
    require(staged.get('launcherSha256') == START_SHA and staged.get('checkLauncherSha256') == CHECK_SHA, 'CURRENT_LAUNCHER_PINS')
    prior_staged = staging('1.14.1', OLD_STAGING_SHA)
    legacy = release('1.14.0')
    legacy_source = source(legacy['checkout'], LEGACY_SOURCE, LEGACY_TREE, '1.14.0')
    require(legacy_source[1:4] == baseline[1:4], 'PRIOR_MIGRATIONS_CHANGED')
    legacy_staged = staging('1.14.0', LEGACY_STAGING_SHA)
    require(prior_staged.get('launcherSha256') == OLD_START_SHA
        and prior_staged.get('checkLauncherSha256') == OLD_CHECK_SHA, 'PRIOR_LAUNCHER_PINS')
    dependencies = fresh_dependencies(previous, current, staged, prior_staged, legacy_staged)
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
        require(inventory[1:4] == candidate[1:4], 'ROLLBACK_MIGRATIONS')
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
        priorMetadataRelease='1.14.1', priorHostedStaging=dict(release='1.14.1', source=OLD_SOURCE,
            tree=OLD_TREE, stagingReceiptSha256=OLD_STAGING_SHA,
            launcherSha256=prior_staged['launcherSha256'], checkLauncherSha256=prior_staged['checkLauncherSha256'],
            scope='pinned_prior_staging_with_complete_final1141_metadata_preserved'), rollback185=rollback)


def prepare(document, evidence, recorded_at, original_sha):
    require(type(document) is dict and type(document.get('developmentSimplification')) is dict, 'CHECKPOINT_SHAPE')
    development = document['developmentSimplification']; existing = development.get('release1150')
    prior = copy.deepcopy(document)
    if existing is not None:
        require(type(existing) is dict and type(existing.get('priorActiveService')) is dict, 'EXISTING_SECTION')
        instant(existing.get('recordedAt')); recorded_at = existing['recordedAt']
        prior['activeService'] = copy.deepcopy(existing['priorActiveService'])
        del prior['developmentSimplification']['release1150']
        require(digest(render(prior)) == CHECKPOINT_SHA, 'EXISTING_PRIOR_DRIFT')
    else:
        require(original_sha == CHECKPOINT_SHA, 'CHECKPOINT_PIN')
    old = prior.get('activeService')
    require(type(old) is dict and old.get('release') == '1.14.1' and old.get('source') == OLD_SOURCE
        and old.get('tree') == OLD_TREE and old.get('nodeAfterDeployment') == 'v24.22.1'
        and old.get('schemaMigrations') == 38 and all(type(prior['developmentSimplification'].get(name)) is dict for name in ('release1141', 'release1140', 'release1130', 'release1112', 'release1111', 'release1110', 'release1101', 'release1100', 'release190', 'release184')), 'CURRENT_ACTIVE_DRIFT')
    pin = release('1.15.0')
    active = {key: str(pin[key]) for key in ('source', 'tree', 'checkout', 'launcher', 'checkLauncher', 'log')}
    active.update(release='1.15.0', nodeAfterDeployment='v24.22.1', nodeBinary=str(PRIVATE / 'runtime-node-v24.22.1/bin/node'),
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
        historicalRelease1141Preserved=True, historicalRelease1140Preserved=True, historicalRelease1130Preserved=True, historicalRelease1112Preserved=True, historicalRelease1111Preserved=True, historicalRelease1110Preserved=True, historicalRelease1101Preserved=True, historicalRelease1100Preserved=True, historicalRelease190Preserved=True, historicalRelease184Preserved=True, schemaUnchanged=True, restart184Allowed=False, restart172Allowed=False,
        priorHostedStaging1141Preserved=True, priorHostedStaging1140Preserved=True, priorMetadataRelease='1.14.1',
        priorRelease1141SqlCompatible=True, publicProfileDowngradeQualified=False,
        publicSnapshotDowngradeLimit='backend1111_cannot_read_new_public_snapshot_format2',
        rollbackAfterMigrationQualified=evidence['rollback185'] is not None,
        rollbackQualificationScope='sql38_precheck_only', rollback=copy.deepcopy(evidence['rollback185']))
    updated = copy.deepcopy(prior); updated['activeService'] = active
    updated['developmentSimplification']['release1150'] = section
    if existing is not None:
        require(canonical(document) == canonical(updated), 'EXISTING_SECTION_DIVERGENT')
        return updated, True
    restored = copy.deepcopy(updated); restored['activeService'] = copy.deepcopy(old)
    del restored['developmentSimplification']['release1150']
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
            out_fd, temporary = tempfile.mkstemp(prefix='.release1150-', dir=PRIVATE)
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
        return dict(status='release1150_metadata_already_recorded' if already else 'release1150_metadata_recorded',
            version='1.15.0', source=SOURCE, tree=TREE, metadataOnly=True, noRestart=True, schemaMigrations=38,
            applicationTables=37, release=evidence['identity']['release'], publicReady=True,
            rollbackRelease='1.8.5' if evidence['rollback185'] is not None else None,
            rollbackAfterMigrationQualified=evidence['rollback185'] is not None,
            rollbackQualificationScope='sql38_precheck_only', publicProfileDowngradeQualified=False,
            restart184Allowed=False, restart172Allowed=False, historicalRelease1141Preserved=True, historicalRelease1140Preserved=True, historicalRelease1130Preserved=True, historicalRelease1112Preserved=True, historicalRelease1111Preserved=True, historicalRelease1110Preserved=True, historicalRelease1101Preserved=True, historicalRelease1100Preserved=True, historicalRelease190Preserved=True, historicalRelease184Preserved=True,
            priorHostedStaging1141Preserved=True, priorHostedStaging1140Preserved=True, priorMetadataRelease='1.14.1',
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
        print(json.dumps(dict(status='release1150_metadata_unconfirmed', code=code,
            metadataOnly=True, noRestart=True, noAutomaticRetry=True), separators=(',', ':')))
        raise SystemExit(1)
