#!/usr/bin/env python3
"""Draft 1.15.0 preparation with fresh private dependencies; never CHECK or start.

Usage: python3 prepare-release1150.py SOURCE1150 TREE1150
The merged candidate pins are qualified by the separate operator workflow.
Hosted execution requires successful main CI and publication as tag v1.15.0;
the release process must confirm these before providing any hosted command.
The exact finalized1141 checkpoint remains untouched throughout staging.
No SQL, configuration, key, checkpoint, Manager or runtime action occurs.
Existing partial output is preserved and refuses an automatic retry.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import urllib.request

PRIVATE = Path('/srv/customer/jessiemessage-private')
BASE_CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1141-c803c2c9')
DEPENDENCY_ROOT = Path('/srv/customer/jessiemessage-operator/production-1140-4f3ce5de/node_modules')
BASE_SOURCE = 'c803c2c9be16c0c4ee218d8cac4a1272620d2772'
BASE_TREE = 'f391b5cebe0a8a8ffd63c818cd481b50970336f1'
QUALIFICATION_PENDING = 'QUALIFICATION_PENDING'
RELEASE_SOURCE = '6712028e08b1e04ac7628bdbb9c39fd9f90d9909'
RELEASE_TREE = 'c80ee33ebfe01838c86cc2b4166b344acf5ea745'
START_PIN = 'e53198d1ddf099eaf3ecbd60b6916a94921430a555eaed2a4a4c41ce64ff27a9'
CHECK_PIN = '6f4aa454a5d1163b9450dba8644ed50dcf034f1a916cad1891c0fa1fc2b05919'
NODE_PIN = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_VERSION = 'v24.22.1'
CHECKPOINT_PIN = '93d6ddf70db3b1b30d006bf2fb30ab7594ebc2d2b8f88cc59a230f247cbaca82'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')
EXPERIENCE_DDL = ('0037_profile_preferences.sql', '0038_reply_tracking.sql')
SHA = re.compile(r'[a-f0-9]{40}')
BASE_STAGING_SHA = 'df4b58f79ed08af15365557fd88670cd887c4cce9382200fadbd03a9c9593d72'
ARCHIVE_URL = 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz'
ARCHIVE_SHA = '6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6'
ARCHIVE_BYTES = 32026916
ARCHIVE_ROOT = 'node-v24.22.1-linux-x64'
OLD_ROOT_DEPENDENCIES = {'libheif-js': '1.23.5', 'mariadb': '3.5.4', 'nodemailer': '10.1.4',
                     'otpauth': '9.5.2', 'sharp': '0.35.5', 'web-push': '3.6.7'}
OLD_CODEC_FILES = {'libheif-wasm/libheif-bundle.mjs': '095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9',
               'libheif-wasm/LICENSE': 'fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596'}


NPM_VERSION = '11.19.1'
BASE_LOCK_SHA = 'd4b723dc88b8e0e7b0d85755d6751b31399248a1444c55e47c61c56809e76f7c'
BASE_INSTALL_LOCK_SHA = '623e3be5057fd8d348d9363d30afef93c6e26dc8cd6df3b8150116c5f17c8e5b'
DEPENDENCY_INVENTORY = dict(sha256='547c6ec03aa29027264dbb848e7830df0cb615a1eb92710498bc94d988897c37', entries=1082, files=914)
DEPENDENCY_SOURCE = '4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd'
DEPENDENCY_TREE = 'e5a239eaf7b8c3395a843c9e0d600efeb7aa569b'
CONFIGURATION_SHA = 'bcca2f3fd91ffc0dec51a7077eb9e192a53b6e653b60c7db7159e473b83aac85'
CONFIGURATION_NAMES = tuple(sorted(('runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json', 'runtime-video.json')))
# Final codec choice, all added lock records, installed resources and a real
# decoding smoke must be pinned together before this draft can touch a host.
ALLOWED_NEW_DEPENDENCIES = {'@imagemagick/magick-wasm': '0.0.45', '@phenomen/libavif-wasm': '1.4.203', 'heic-to': '1.6.7'}
ADDITIONAL_LOCK_RECORDS = {'node_modules/@imagemagick/magick-wasm': {'integrity': 'sha512-ef8FHka4xLWo5/tGTV6P45bPjTvnKZz/oHN6sCDTbY8zaCdM2MeaoQHLsy9IHuiVHQhomG3TQ6ErgTnEDyuzvw==',
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
CODEC_SMOKE_PATH = 'ops/smoke-photo-codecs1150.mjs'
CODEC_SMOKE_SHA = '57d6d1e552fb8dd9a9373d3fa0a103705e109edbffe8c9c35e1dfb6fe53d9ddb'


class StagingRefused(Exception):
    pass


def require(ok, label):
    if not ok:
        raise StagingRefused(label)


def clean_environment():
    env = dict(os.environ)
    for name in ('NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED',
                 'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF',
                 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
                 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'):
        env.pop(name, None)
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0')
    return env


def command(args, *, data=None, timeout=45):
    try:
        result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                check=False, env=clean_environment(), timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise StagingRefused('command_not_confirmed') from None
    require(result.returncode == 0, 'command_refused')
    return result.stdout


def git(checkout, *args):
    return command(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                    '-c', 'core.hooksPath=/dev/null', '-C', str(checkout), *args]).decode('utf-8').strip()


def regular(path, mode=None, *, digest_only=False):
    require(path.is_absolute(), 'absolute_file_required')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
            and before.st_nlink == 1 and not before.st_mode & 0o022
            and (mode is None or stat.S_IMODE(before.st_mode) == mode),
            'file_metadata:' + path.name)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        first = os.fstat(handle.fileno())
        require((before.st_dev, before.st_ino) == (first.st_dev, first.st_ino), 'file_identity:' + path.name)
        if digest_only:
            digest = hashlib.sha256()
            while chunk := handle.read(262144):
                digest.update(chunk)
            content = digest.hexdigest()
        else:
            content = handle.read()
        after = os.fstat(handle.fileno())
    visible = path.lstat()
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(all(getattr(first, name) == getattr(after, name) == getattr(visible, name) for name in fields),
            'file_changed:' + path.name)
    return content


def private_directory(path):
    value = path.lstat()
    require(path.is_absolute() and not path.is_symlink() and path.resolve(strict=True) == path
            and stat.S_ISDIR(value.st_mode) and value.st_uid == os.getuid()
            and stat.S_IMODE(value.st_mode) == 0o700, 'private_directory')


def normalize_created_directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path and not path.is_symlink(), 'created_directory_path')
    before = path.lstat()
    require(stat.S_ISDIR(before.st_mode) and before.st_uid == os.getuid()
            and stat.S_IMODE(before.st_mode) in (0o700, 0o2700), 'created_directory_metadata')
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_ctime_ns')
        require(all(getattr(before, key) == getattr(opened, key) == getattr(path.lstat(), key) for key in fields), 'created_directory_changed')
        if stat.S_IMODE(opened.st_mode) == 0o2700:
            os.fchmod(fd, 0o700); os.fsync(fd)
        after = os.fstat(fd)
        require(stat.S_IMODE(after.st_mode) == 0o700 and all(getattr(after, key) == getattr(opened, key) == getattr(path.lstat(), key)
            for key in ('st_dev', 'st_ino', 'st_uid', 'st_gid')), 'created_directory_not_private')
    finally:
        os.close(fd)
    private_directory(path)


def source(checkout, expected, tree):
    require(not checkout.is_symlink() and git(checkout, 'rev-parse', 'HEAD') == expected, 'source_identity')
    require(git(checkout, 'rev-parse', 'HEAD^{tree}') == tree, 'source_tree')
    require(not git(checkout, 'status', '--porcelain', '--untracked-files=normal'), 'source_dirty')


def absent(path):
    require(not path.exists() and not path.is_symlink(), 'existing_output:' + path.name)


def active_dependencies():
    link = BASE_CHECKOUT / 'node_modules'
    value = link.lstat()
    require(stat.S_ISLNK(value.st_mode) and value.st_uid == os.getuid()
            and os.readlink(link) == str(DEPENDENCY_ROOT), 'active_dependencies_link')
    private_directory(DEPENDENCY_ROOT)
    require(link.resolve(strict=True) == DEPENDENCY_ROOT, 'active_dependencies_path')
    after = link.lstat()
    require((value.st_dev, value.st_ino, value.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_ctime_ns), 'active_dependencies_changed')
    return DEPENDENCY_ROOT


def fingerprint(content):
    return hashlib.sha256(content).hexdigest()


def source_blob(sha, name):
    entry = git(BASE_CHECKOUT, 'ls-tree', sha, '--', name)
    require(entry.startswith('100644 blob ') and entry.endswith('\t' + name), 'source_file:' + name)
    return command(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                    '-c', 'core.hooksPath=/dev/null', '-C', str(BASE_CHECKOUT), 'show', sha + ':' + name])


def migration_inventory(sha, directory):
    names = git(BASE_CHECKOUT, 'ls-tree', '-r', '--name-only', sha, '--', directory).splitlines()
    require(all(Path(name).parent.as_posix() == directory and name.endswith('.sql') for name in names),
            'migration_inventory')
    return [(Path(name).name, fingerprint(source_blob(sha, name))) for name in names]


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


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
                                regular(path, digest_only=True)])
        require(identity(before) == identity(directory.lstat()), 'dependency_directory_changed')
    walk(root)
    return dict(sha256=fingerprint(canonical(entries)), entries=len(entries),
                files=sum(item[1] == 'file' for item in entries))


def safe_relative(value):
    return isinstance(value, str) and value and PurePosixPath(value).as_posix() == value \
        and not PurePosixPath(value).is_absolute() and '..' not in PurePosixPath(value).parts \
        and not any(ord(c) < 32 for c in value)


def qualification_pins():
    require(all(isinstance(pin, str) and SHA.fullmatch(pin) for pin in (RELEASE_SOURCE, RELEASE_TREE)),
            'release1150_pins_pending')
    require(isinstance(ALLOWED_NEW_DEPENDENCIES, dict) and bool(ALLOWED_NEW_DEPENDENCIES)
            and not set(ALLOWED_NEW_DEPENDENCIES) & set(OLD_ROOT_DEPENDENCIES)
            and all(safe_relative(name) and isinstance(version, str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version)
                    for name, version in ALLOWED_NEW_DEPENDENCIES.items()), 'new_dependencies_pins_pending')
    require(isinstance(ADDITIONAL_LOCK_RECORDS, dict) and bool(ADDITIONAL_LOCK_RECORDS)
            and all(safe_relative(name) and name.startswith('node_modules/') and isinstance(value, dict)
                    for name, value in ADDITIONAL_LOCK_RECORDS.items()), 'new_lock_pins_pending')
    require(isinstance(CODEC_FILES, dict) and bool(CODEC_FILES)
            and all(safe_relative(name) and isinstance(pin, str) and re.fullmatch(r'[a-f0-9]{64}', pin)
                    for name, pin in CODEC_FILES.items()), 'codec_files_pins_pending')
    require(safe_relative(CODEC_SMOKE_PATH) and CODEC_SMOKE_PATH.endswith('.mjs')
            and isinstance(CODEC_SMOKE_SHA, str) and re.fullmatch(r'[a-f0-9]{64}', CODEC_SMOKE_SHA),
            'codec_smoke_pins_pending')


def release_dependencies():
    require(isinstance(ALLOWED_NEW_DEPENDENCIES, dict), 'new_dependencies_pins_pending')
    return dict(OLD_ROOT_DEPENDENCIES, **ALLOWED_NEW_DEPENDENCIES)


def validate_lock_transition(old_package, old_lock, package, lock):
    qualification_pins()
    require(old_lock.get('lockfileVersion') == lock.get('lockfileVersion') == 3, 'dependency_lock_format')
    for manifest, graph, version, dependencies in ((old_package, old_lock, '1.14.1', OLD_ROOT_DEPENDENCIES),
            (package, lock, '1.15.0', release_dependencies())):
        require(manifest.get('version') == graph.get('version') == graph.get('packages', {}).get('', {}).get('version') == version,
                'package_versions')
        require(manifest.get('dependencies') == graph['packages'][''].get('dependencies') == dependencies,
                'package_dependencies')
    require(not set(ADDITIONAL_LOCK_RECORDS) & set(old_lock['packages']), 'existing_lock_record_replaced')
    require({key: value for key, value in lock['packages'].items() if key not in old_lock['packages']} == ADDITIONAL_LOCK_RECORDS,
            'new_lock_records')
    normalized_package, normalized_lock = copy.deepcopy(package), copy.deepcopy(lock)
    normalized_package['version'] = old_package['version']
    normalized_package['dependencies'] = copy.deepcopy(old_package['dependencies'])
    normalized_lock['version'] = old_lock['version']
    normalized_lock['packages']['']['version'] = old_lock['packages']['']['version']
    normalized_lock['packages']['']['dependencies'] = copy.deepcopy(old_lock['packages']['']['dependencies'])
    for name in ADDITIONAL_LOCK_RECORDS:
        del normalized_lock['packages'][name]
    require(normalized_package == old_package, 'package_other_change')
    require(normalized_lock == old_lock, 'locked_dependencies')


def verified_dependencies():
    root = active_dependencies()
    source(root.parent, DEPENDENCY_SOURCE, DEPENDENCY_TREE)
    require(fingerprint(source_blob(DEPENDENCY_SOURCE, 'package-lock.json')) == BASE_INSTALL_LOCK_SHA,
            'active_install_lock_hash')
    inventory = dependency_inventory(root)
    require(inventory == DEPENDENCY_INVENTORY, 'active_dependency_inventory')
    for name, version in OLD_ROOT_DEPENDENCIES.items():
        manifest = json.loads(regular(root / name / 'package.json'))
        require(manifest.get('name') == name and manifest.get('version') == version, 'active_dependency_version:' + name)
    for name, pin in OLD_CODEC_FILES.items():
        require(regular(root / 'libheif-js' / name, digest_only=True) == pin, 'active_dependency_codec:' + name)
    return dict(directory=str(root), inventory=inventory, directVersions=dict(OLD_ROOT_DEPENDENCIES),
                applicationLockSha256=BASE_LOCK_SHA, installationLockSha256=BASE_INSTALL_LOCK_SHA,
                codecSha256=dict(OLD_CODEC_FILES), installed=False, scriptsExecuted=False)


def configuration_fingerprint():
    root = PRIVATE / 'runtime-video-180'; private_directory(root)
    require(sorted(path.name for path in root.iterdir()) == list(CONFIGURATION_NAMES), 'configuration_inventory')
    digest = hashlib.sha256()
    for name in CONFIGURATION_NAMES:
        data = regular(root / name, 0o600)
        require(0 < len(data) <= 16384, 'configuration_file_size')
        digest.update(name.encode()); digest.update(b'\0'); digest.update(str(len(data)).encode()); digest.update(b'\0'); digest.update(data)
    value = digest.hexdigest()
    require(value == CONFIGURATION_SHA, 'configuration_hash')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise StagingRefused('archive_redirect')


def download_archive():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(ARCHIVE_URL, timeout=45) as response:
            require(response.status == 200 and response.url == ARCHIVE_URL, 'archive_response')
            data = response.read(ARCHIVE_BYTES + 1)
    except StagingRefused:
        raise
    except Exception:
        raise StagingRefused('archive_download_not_confirmed') from None
    require(len(data) == ARCHIVE_BYTES and fingerprint(data) == ARCHIVE_SHA, 'archive_identity')
    return data


def make_private(path):
    absent(path); path.mkdir(mode=0o700); normalize_created_directory(path)


def write_exclusive(path, content, mode=0o600):
    private_directory(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(content); output.flush(); os.fsync(output.fileno())
    require(regular(path, mode) == content, 'written_file:' + path.name)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def extract_tools(data, root, *, include_node=False):
    """Extract only regular npm files (and Node for disposable qualification)."""
    require(len(data) == ARCHIVE_BYTES and fingerprint(data) == ARCHIVE_SHA, 'archive_identity')
    private_directory(root)
    files, seen, expanded = [], set(), 0
    prefix = (ARCHIVE_ROOT, 'lib', 'node_modules', 'npm')
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:xz') as archive:
            for count, member in enumerate(archive, 1):
                require(count <= 20000, 'archive_member_limit')
                name = PurePosixPath(member.name)
                selected = name.parts[:4] == prefix or include_node and name.parts == (ARCHIVE_ROOT, 'bin', 'node')
                if not selected:
                    continue
                require(name.as_posix() == member.name.rstrip('/') and '..' not in name.parts
                        and not name.is_absolute() and not any(ord(c) < 32 for c in member.name), 'archive_path')
                require(member.isfile() or member.isdir(), 'archive_member_type')
                relative = Path('node') if name.parts == (ARCHIVE_ROOT, 'bin', 'node') else Path('npm', *name.parts[4:])
                require(relative.as_posix() not in seen, 'archive_duplicate'); seen.add(relative.as_posix())
                if member.isdir():
                    require(member.size == 0, 'archive_directory_size'); continue
                expanded += member.size
                require(0 <= member.size <= 128 * 1024 * 1024 and expanded <= 192 * 1024 * 1024, 'archive_expanded_limit')
                with archive.extractfile(member) as stream:
                    content = stream.read(member.size + 1)
                require(len(content) == member.size, 'archive_file_size')
                files.append((relative, content))
    except StagingRefused:
        raise
    except Exception:
        raise StagingRefused('archive_invalid') from None
    mapping = dict(files)
    require(Path('npm/bin/npm-cli.js') in mapping and Path('npm/package.json') in mapping, 'archive_npm_missing')
    manifest = json.loads(mapping[Path('npm/package.json')])
    require(manifest.get('name') == 'npm' and manifest.get('version') == NPM_VERSION, 'archive_npm_manifest')
    if include_node:
        require(Path('node') in mapping and fingerprint(mapping[Path('node')]) == NODE_PIN, 'archive_node_identity')
    for relative, content in files:
        destination = root / relative
        parents = list(destination.parent.relative_to(root).parts)
        parent = root
        for part in parents:
            parent = parent / part
            if not parent.exists():
                make_private(parent)
            private_directory(parent)
        write_exclusive(destination, content, 0o700 if relative == Path('node') else 0o600)
    return dict(npmVersion=manifest['version'], npmCli=str(root / 'npm/bin/npm-cli.js'),
                archiveSha256=ARCHIVE_SHA, archiveBytes=ARCHIVE_BYTES)


def npm_environment(node, cache, temporary):
    # No user/global npm configuration, inherited credentials, proxy or Node hooks.
    return dict(PATH=str(node.parent) + ':/usr/bin:/bin', LC_ALL='C', TMPDIR=str(temporary),
                NPM_CONFIG_USERCONFIG=str(cache.parent / 'user.npmrc'),
                NPM_CONFIG_GLOBALCONFIG=str(cache.parent / 'global.npmrc'),
                NPM_CONFIG_UPDATE_NOTIFIER='false')


def install_dependencies(checkout, tools, node, package_bytes, lock_bytes, *, node_pin=NODE_PIN):
    private_directory(checkout); private_directory(tools)
    require(regular(node, 0o700, digest_only=True) == node_pin, 'install_node_identity')
    require(regular(checkout / 'package.json') == package_bytes
            and regular(checkout / 'package-lock.json') == lock_bytes, 'install_manifest_identity')
    absent(checkout / 'node_modules'); absent(checkout / '.npmrc')
    for name in ('cache', 'tmp'):
        make_private(tools / name)
    for name in ('user.npmrc', 'global.npmrc'):
        write_exclusive(tools / name, b'')
    cli = tools / 'npm/bin/npm-cli.js'
    args = [str(node), str(cli), 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
            '--registry=https://registry.npmjs.org/', '--cache=' + str(tools / 'cache'),
            '--userconfig=' + str(tools / 'user.npmrc'), '--globalconfig=' + str(tools / 'global.npmrc')]
    logs = [tools / ('npm-' + name + '.log') for name in ('stdout', 'stderr')]
    for path in logs:
        write_exclusive(path, b'')
    with logs[0].open('ab') as stdout, logs[1].open('ab') as stderr:
        try:
            result = subprocess.run(args, cwd=str(checkout), env=npm_environment(node, tools / 'cache', tools / 'tmp'),
                                    stdout=stdout, stderr=stderr, timeout=300, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise StagingRefused('npm_install_not_confirmed') from None
    require(result.returncode == 0, 'npm_install_refused')
    require(regular(node, 0o700, digest_only=True) == node_pin, 'install_node_changed')
    require(regular(checkout / 'package.json') == package_bytes
            and regular(checkout / 'package-lock.json') == lock_bytes, 'install_manifest_changed')
    modules = checkout / 'node_modules'
    normalize_created_directory(modules)
    inventory = dependency_inventory(modules)
    lock = json.loads(lock_bytes)
    require(json.loads(package_bytes).get('dependencies') == lock['packages']['']['dependencies'] == release_dependencies(),
            'installed_dependency_map')
    for name, version in release_dependencies().items():
        manifest = json.loads(regular(modules / name / 'package.json'))
        require(manifest.get('name') == name and manifest.get('version') == version, 'installed_version:' + name)
    for name, expected in OLD_CODEC_FILES.items():
        require(regular(modules / 'libheif-js' / name, digest_only=True) == expected, 'installed_prior_codec:' + name)
    for name, expected in CODEC_FILES.items():
        require(regular(modules / name, digest_only=True) == expected, 'installed_codec:' + name)
    smoke = checkout / CODEC_SMOKE_PATH
    require(regular(smoke, digest_only=True) == CODEC_SMOKE_SHA, 'codec_smoke_identity')
    smoke_logs = [tools / ('codec-smoke-' + name + '.log') for name in ('stdout', 'stderr')]
    for path in smoke_logs:
        write_exclusive(path, b'')
    with smoke_logs[0].open('ab') as stdout, smoke_logs[1].open('ab') as stderr:
        try:
            checked = subprocess.run([str(node), str(smoke)], cwd=str(checkout),
                env=npm_environment(node, tools / 'cache', tools / 'tmp'), stdout=stdout, stderr=stderr,
                timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise StagingRefused('native_dependency_not_confirmed') from None
    require(checked.returncode == 0, 'native_dependency_refused')
    require(dependency_inventory(modules) == inventory, 'installed_dependencies_changed')
    return dict(strategy='private-npm-ci-ignore-scripts', directory=str(modules), lockSha256=fingerprint(lock_bytes),
        inventory=inventory, directVersions=release_dependencies(), codecSha256=dict(CODEC_FILES), codecSyntheticSmoke=True,
        codecSmokePath=CODEC_SMOKE_PATH, codecSmokeSha256=CODEC_SMOKE_SHA,
        codecSmokeStdoutSha256=regular(smoke_logs[0], 0o600, digest_only=True),
        codecSmokeStderrSha256=regular(smoke_logs[1], 0o600, digest_only=True),
        stdoutSha256=regular(logs[0], 0o600, digest_only=True), stderrSha256=regular(logs[1], 0o600, digest_only=True),
        scriptsExecuted=False)


def release_plan(sha, tree):
    short = sha[:8]
    return dict(version='1.15.0', sha=sha, tree=tree,
        checkout=BASE_CHECKOUT.parent / ('production-1150-' + short),
        tools=PRIVATE / ('install-1150-' + short),
        start=PRIVATE / ('start-primary-release1150-' + short + '.sh'),
        check=PRIVATE / ('check-primary-release1150-' + short + '.sh'),
        log=PRIVATE / 'jm1150-node24221.log', prelog=PRIVATE / ('jm1150-preflight-node24221-' + short + '.log'))


def launcher(content, plan, *, check):
    text = content.decode('utf-8')
    operation = 'check-local-closures' if check else 'start-local-closures'
    opposite = 'start-local-closures' if check else 'check-local-closures'
    require(text.count(operation) == 1 and opposite not in text, 'launcher_command')
    require(text.count('--profile') == text.count('--profile ' + PROFILE) == 1, 'launcher_profile')
    replacements = ((BASE_SOURCE, plan['sha']), (BASE_TREE, plan['tree']), (str(BASE_CHECKOUT), str(plan['checkout'])),
        (str(PRIVATE / ('jm1141-preflight-node24221-c803c2c9.log' if check else 'jm1141-node24221.log')),
         str(plan['prelog' if check else 'log'])))
    for before, after in replacements:
        count = text.count(before)
        require(count >= 1, 'launcher_replacement')
        text = text.replace(before, after)
        require(before not in text and text.count(after) == count, 'launcher_replacement_count')
    require(text.count('--experience 1') == text.count('--experience') == 1, 'launcher_experience')
    require(text.count('--private-path-mode linux-dirfd') == 1
        and str(PRIVATE / 'runtime-node-v24.22.1/bin/node') in text
        and str(PRIVATE / 'runtime-video-180') in text and str(PRIVATE / 'recurring-backup-052') in text, 'launcher_runtime_binding')
    result = text.encode(); command(['/bin/bash', '-n'], data=result)
    return result


def checkpoint_baseline(raw):
    require(fingerprint(raw) == CHECKPOINT_PIN, 'active_checkpoint_hash')
    document = json.loads(raw)
    require(document.get('activeService', {}).get('release') == '1.14.1'
            and document['activeService'].get('source') == BASE_SOURCE
            and document['activeService'].get('tree') == BASE_TREE, 'active_checkpoint_identity')
    return dict(sha256=CHECKPOINT_PIN, metadataRelease='1.14.1')


def stage(sha, tree):
    qualification_pins()
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in (sha, tree)), 'input_identity')
    require((sha, tree) == (RELEASE_SOURCE, RELEASE_TREE) and sha != BASE_SOURCE, 'release1150_pinned_identity')
    private_directory(PRIVATE)
    checkpoint = PRIVATE / 'jm0702-existing-pc-update.json'
    checkpoint_bytes = regular(checkpoint, 0o600); baseline = checkpoint_baseline(checkpoint_bytes)
    prior_staging = regular(PRIVATE / 'jm1141-staging.json', 0o600)
    require(fingerprint(prior_staging) == BASE_STAGING_SHA, 'active_staging_hash')
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    start = PRIVATE / 'start-primary-release1141-c803c2c9.sh'
    check = PRIVATE / 'check-primary-release1141-c803c2c9.sh'
    start_bytes, check_bytes = regular(start, 0o700), regular(check, 0o700)
    require(fingerprint(start_bytes) == START_PIN and fingerprint(check_bytes) == CHECK_PIN, 'active_launcher_hash')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'node_hash')
    require(command([str(node), '--version'], timeout=10).decode().strip() == NODE_VERSION, 'node_version')
    private_directory(BASE_CHECKOUT)
    deps = active_dependencies(); old_dependencies = verified_dependencies(); old_inventory = old_dependencies['inventory']
    bundle_sha = configuration_fingerprint()
    plan = release_plan(sha, tree); receipt_path = PRIVATE / 'jm1150-staging.json'
    for path in (receipt_path, *(plan[name] for name in ('checkout', 'tools', 'start', 'check', 'log', 'prelog'))):
        absent(path)
    git(BASE_CHECKOUT, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.15.0:refs/tags/v1.15.0')
    require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v1.15.0^{commit}') == sha, 'tag_identity')
    require(git(BASE_CHECKOUT, 'rev-parse', sha + '^{tree}') == tree, 'tag_tree')
    for before, after in ((BASE_SOURCE, sha), (sha, 'refs/remotes/origin/main')):
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', before, after)
    package_bytes, lock_bytes = source_blob(sha, 'package.json'), source_blob(sha, 'package-lock.json')
    old_lock_bytes = source_blob(BASE_SOURCE, 'package-lock.json')
    require(fingerprint(old_lock_bytes) == BASE_LOCK_SHA, 'active_lock_hash')
    validate_lock_transition(json.loads(source_blob(BASE_SOURCE, 'package.json')), json.loads(old_lock_bytes),
                             json.loads(package_bytes), json.loads(lock_bytes))
    for revision in (BASE_SOURCE, sha):
        require(not git(BASE_CHECKOUT, 'ls-tree', revision, '--', 'node_modules', '.npmrc'), 'tracked_dependency_configuration')
    for directory, expected, label in (('db/migrations', 33, 'normal'), ('server/video/migrations', VIDEO_DDL, 'video'),
                                        ('server/experience/migrations', EXPERIENCE_DDL, 'experience')):
        old, new = [migration_inventory(revision, directory) for revision in (BASE_SOURCE, sha)]
        require(old == new and (len(old) == expected if isinstance(expected, int) else tuple(name for name, _ in old) == expected),
                label + '_migrations_preserved')
    plan['startBytes'], plan['checkBytes'] = launcher(start_bytes, plan, check=False), launcher(check_bytes, plan, check=True)
    require(fingerprint(source_blob(sha, CODEC_SMOKE_PATH)) == CODEC_SMOKE_SHA, 'codec_smoke_source')
    archive = download_archive()
    def preserved():
        source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
        require(regular(checkpoint, 0o600) == checkpoint_bytes, 'checkpoint_changed')
        require(regular(PRIVATE / 'jm1141-staging.json', 0o600) == prior_staging, 'active_staging_changed')
        require(regular(start, 0o700) == start_bytes and regular(check, 0o700) == check_bytes, 'active_launchers_changed')
        require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'active_node_changed')
        require(active_dependencies() == deps and verified_dependencies() == old_dependencies, 'active_dependencies_changed')
        require(configuration_fingerprint() == bundle_sha, 'configuration_changed')
    preserved()
    for path in (receipt_path, *(plan[name] for name in ('checkout', 'tools', 'start', 'check', 'log', 'prelog'))):
        absent(path)
    previous_umask = os.umask(0o077)
    try:
        git(BASE_CHECKOUT, 'worktree', 'add', '--detach', str(plan['checkout']), sha)
        normalize_created_directory(plan['checkout']); source(plan['checkout'], sha, tree)
        make_private(plan['tools']); npm = extract_tools(archive, plan['tools'])
        installation = install_dependencies(plan['checkout'], plan['tools'], node, package_bytes, lock_bytes, node_pin=NODE_PIN)
        preserved(); source(plan['checkout'], sha, tree)
        for key, content, mode in (('start', plan['startBytes'], 0o700), ('check', plan['checkBytes'], 0o700),
                                    ('log', b'', 0o600), ('prelog', b'', 0o600)):
            write_exclusive(plan[key], content, mode)
        preserved(); source(plan['checkout'], sha, tree)
        require(dependency_inventory(plan['checkout'] / 'node_modules') == installation['inventory'], 'new_dependencies_changed')
        receipt = dict(format='jessiemessage-release1150-staging', version=1, status='release1150_sources_staged_not_qualified',
            release='1.15.0', source=sha, tree=tree, checkout=str(plan['checkout']), checkoutMode='0700',
            launcher=str(plan['start']), launcherSha256=fingerprint(plan['startBytes']), launcherMode='0700',
            checkLauncher=str(plan['check']), checkLauncherSha256=fingerprint(plan['checkBytes']), checkLauncherMode='0700',
            log=str(plan['log']), logMode='0600', logSha256=fingerprint(b''), precheckLog=str(plan['prelog']),
            precheckLogMode='0600', precheckLogSha256=fingerprint(b''), nodeVersion=NODE_VERSION, nodeBinarySha256=NODE_PIN,
            profile=PROFILE, expectedActiveServiceVersion='1.14.1', baselineMetadataRelease=baseline['metadataRelease'],
            preservedActiveCheckpointSha256=baseline['sha256'], priorActiveStagingSha256=BASE_STAGING_SHA,
            priorActivePreserved=True, existingConfigurationUntouched=True, baselineMigrationFiles=33,
            schemaMigrationsExpected=38, applicationTablesExpected=37, experienceEnabled=True, experienceMigrationFiles=2,
            experienceMigrationsIdentical=True, normalMigrationsPreserved=True, videoMigrationsIdentical=True,
            sqlStatusChecked=False, configurationPrepared=False, hostedQualified=False, precheckPassed=False,
            started=False, migrated=False, runtimeStarted=False, noRestart=True, managerChanged=False, checkpointChanged=False,
            dependenciesReused=False, dependencyDirectory=installation['directory'], dependencies=installation, installer=npm,
            priorDependencyInventory=old_inventory, priorDependencies=old_dependencies,
            bundleFingerprintSha256=bundle_sha, videoConfigurationDirectory=str(PRIVATE / 'runtime-video-180'),
            operationsDirectory=str(PRIVATE / 'recurring-backup-052'), nextCheckCommand='bash ' + str(plan['check']))
        content = canonical(receipt); write_exclusive(receipt_path, content)
    finally:
        os.umask(previous_umask)
    return dict(receipt, receipt=str(receipt_path), receiptSha256=fingerprint(content))


def main(args):
    require(len(args) == 2, 'usage_two_source_tree_arguments')
    print(json.dumps(stage(*args), separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        reason = str(error) if isinstance(error, StagingRefused) else type(error).__name__
        raise SystemExit('PREPARATION1150_NON_CONFIRMEE : ' + reason + '; conserver les traces, ne pas relancer.') from None



