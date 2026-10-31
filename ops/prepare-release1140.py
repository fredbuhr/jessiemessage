#!/usr/bin/env python3
"""Stage 1.14.0 and fresh private dependencies; run neither CHECK nor service.

Usage: python3 prepare-release1140.py SOURCE1140 TREE1140
The merged candidate pins are qualified by the separate operator workflow.
Hosted execution requires successful main CI and publication as tagv1.14.0;
the release process must confirm these before providing any hosted command.
The exact finalized1130 checkpoint remains untouched throughout staging.
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
BASE_CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1130-b9e2ad78')
DEPENDENCY_ROOT = Path('/srv/customer/jessiemessage-operator/production-1101-9eb99f1f/node_modules')
BASE_SOURCE = 'b9e2ad78b47dccb72b8e793cdc448e6b70424430'
BASE_TREE = 'dc8933723a54c0307a3fd52719bdd4fd3ac3f96a'
RELEASE_SOURCE = '4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd'
RELEASE_TREE = 'e5a239eaf7b8c3395a843c9e0d600efeb7aa569b'
START_PIN = 'fb40a652f2400dfc4cc14d53fb8f3d9348dd95d703784e0b9a85c63f87666526'
CHECK_PIN = '97f15d145bb84f3e3a340d2a29fd43e5f0b64c9e6c0ea0e24a06d676b0ac2321'
NODE_PIN = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_VERSION = 'v24.22.1'
CHECKPOINT_PIN = 'cdcb3f8b35208ddfaff19009235f86d4dd23a10ac13b00c9c692daad2bbe496d'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')
EXPERIENCE_DDL = ('0037_profile_preferences.sql', '0038_reply_tracking.sql')
SHA = re.compile(r'[a-f0-9]{40}')
BASE_STAGING_SHA = '08eb630927a84cc63c0b552fa9f729ab7ee2433f6c3fc8aca1466c007f021ecd'
ARCHIVE_URL = 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz'
ARCHIVE_SHA = '6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6'
ARCHIVE_BYTES = 32026916
ARCHIVE_ROOT = 'node-v24.22.1-linux-x64'
HEIF_RECORD = dict(version='1.23.5', resolved='https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz',
    integrity='sha512-umXZPthnWZtF3iG/5mQG+AZ2V6i0UeYpo3z2CkggTEgL8dKmIIwJT6TDuAMuabXa1yTW8uJ1ZAgR+CxNTklYYw==',
    license='LGPL-3.0', engines={'node': '>=8.0.0'})
ROOT_DEPENDENCIES = {'libheif-js': '1.23.5', 'mariadb': '3.5.4', 'nodemailer': '10.1.4',
                     'otpauth': '9.5.2', 'sharp': '0.35.5', 'web-push': '3.6.7'}
CODEC_FILES = {'libheif-wasm/libheif-bundle.mjs': '095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9',
               'libheif-wasm/LICENSE': 'fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596'}


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


def validate_lock_transition(old_package, old_lock, package, lock):
    require(old_lock.get('lockfileVersion') == lock.get('lockfileVersion') == 3, 'dependency_lock_format')
    for manifest, graph, version in ((old_package, old_lock, '1.13.0'), (package, lock, '1.14.0')):
        require(manifest.get('version') == graph.get('version') == graph.get('packages', {}).get('', {}).get('version') == version,
                'package_versions')
        require(manifest.get('dependencies') == graph['packages'][''].get('dependencies'), 'package_dependencies')
    require(package['dependencies'] == ROOT_DEPENDENCIES
            and old_package['dependencies'] == {k: v for k, v in ROOT_DEPENDENCIES.items() if k != 'libheif-js'},
            'dependency_root_versions')
    require(lock['packages'].get('node_modules/libheif-js') == HEIF_RECORD, 'dependency_heif_record')
    normalized = copy.deepcopy(lock)
    normalized['version'] = old_lock['version']
    normalized['packages']['']['version'] = old_lock['packages']['']['version']
    del normalized['packages']['']['dependencies']['libheif-js']
    del normalized['packages']['node_modules/libheif-js']
    require(normalized == old_lock, 'dependency_other_lock_changed')


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
    require(manifest.get('name') == 'npm' and re.fullmatch(r'\d+\.\d+\.\d+', manifest.get('version', '')), 'archive_npm_manifest')
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
                NPM_CONFIG_USERCONFIG='/dev/null', NPM_CONFIG_GLOBALCONFIG='/dev/null',
                NPM_CONFIG_UPDATE_NOTIFIER='false')


def install_dependencies(checkout, tools, node, package_bytes, lock_bytes, *, node_pin=NODE_PIN):
    private_directory(checkout); private_directory(tools)
    require(regular(node, 0o700, digest_only=True) == node_pin, 'install_node_identity')
    require(regular(checkout / 'package.json') == package_bytes
            and regular(checkout / 'package-lock.json') == lock_bytes, 'install_manifest_identity')
    absent(checkout / 'node_modules'); absent(checkout / '.npmrc')
    for name in ('cache', 'tmp'):
        make_private(tools / name)
    cli = tools / 'npm/bin/npm-cli.js'
    args = [str(node), str(cli), 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
            '--registry=https://registry.npmjs.org/', '--cache=' + str(tools / 'cache'),
            '--userconfig=/dev/null', '--globalconfig=/dev/null']
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
    require(json.loads(package_bytes).get('dependencies') == lock['packages']['']['dependencies'] == ROOT_DEPENDENCIES,
            'installed_dependency_map')
    for name, version in ROOT_DEPENDENCIES.items():
        manifest = json.loads(regular(modules / name / 'package.json'))
        require(manifest.get('name') == name and manifest.get('version') == version, 'installed_version:' + name)
    for name, expected in CODEC_FILES.items():
        require(regular(modules / 'libheif-js' / name, digest_only=True) == expected, 'installed_codec:' + name)
    smoke = b"const sharp=require('sharp'); sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().then(b=>{if(!b.length)process.exit(1)}).catch(()=>process.exit(1));"
    try:
        checked = subprocess.run([str(node), '-e', smoke.decode()], cwd=str(checkout),
            env=npm_environment(node, tools / 'cache', tools / 'tmp'), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise StagingRefused('native_dependency_not_confirmed') from None
    require(checked.returncode == 0, 'native_dependency_refused')
    require(dependency_inventory(modules) == inventory, 'installed_dependencies_changed')
    return dict(strategy='private-npm-ci-ignore-scripts', directory=str(modules), lockSha256=fingerprint(lock_bytes),
        inventory=inventory, directVersions=ROOT_DEPENDENCIES, codecSha256=CODEC_FILES, sharpSyntheticSmoke=True,
        stdoutSha256=regular(logs[0], 0o600, digest_only=True), stderrSha256=regular(logs[1], 0o600, digest_only=True),
        scriptsExecuted=False)


def release_plan(sha, tree):
    short = sha[:8]
    return dict(version='1.14.0', sha=sha, tree=tree,
        checkout=BASE_CHECKOUT.parent / ('production-1140-' + short),
        tools=PRIVATE / ('install-1140-' + short),
        start=PRIVATE / ('start-primary-release1140-' + short + '.sh'),
        check=PRIVATE / ('check-primary-release1140-' + short + '.sh'),
        log=PRIVATE / 'jm1140-node24221.log', prelog=PRIVATE / ('jm1140-preflight-node24221-' + short + '.log'))


def launcher(content, plan, *, check):
    text = content.decode('utf-8')
    operation = 'check-local-closures' if check else 'start-local-closures'
    opposite = 'start-local-closures' if check else 'check-local-closures'
    require(text.count(operation) == 1 and opposite not in text, 'launcher_command')
    require(text.count('--profile') == text.count('--profile ' + PROFILE) == 1, 'launcher_profile')
    replacements = ((BASE_SOURCE, plan['sha']), (BASE_TREE, plan['tree']), (str(BASE_CHECKOUT), str(plan['checkout'])),
        (str(PRIVATE / ('jm1130-preflight-node24221-b9e2ad78.log' if check else 'jm1130-node24221.log')),
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
    require(document.get('activeService', {}).get('release') == '1.13.0'
            and document['activeService'].get('source') == BASE_SOURCE
            and document['activeService'].get('tree') == BASE_TREE, 'active_checkpoint_identity')
    return dict(sha256=CHECKPOINT_PIN, metadataRelease='1.13.0')


def stage(sha, tree):
    require(SHA.fullmatch(RELEASE_SOURCE) and SHA.fullmatch(RELEASE_TREE), 'release1140_pins_pending')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in (sha, tree)), 'input_identity')
    require((sha, tree) == (RELEASE_SOURCE, RELEASE_TREE) and sha != BASE_SOURCE, 'release1140_pinned_identity')
    private_directory(PRIVATE)
    checkpoint = PRIVATE / 'jm0702-existing-pc-update.json'
    checkpoint_bytes = regular(checkpoint, 0o600); baseline = checkpoint_baseline(checkpoint_bytes)
    prior_staging = regular(PRIVATE / 'jm1130-staging.json', 0o600)
    require(fingerprint(prior_staging) == BASE_STAGING_SHA, 'active_staging_hash')
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    start = PRIVATE / 'start-primary-release1130-b9e2ad78.sh'
    check = PRIVATE / 'check-primary-release1130-b9e2ad78.sh'
    start_bytes, check_bytes = regular(start, 0o700), regular(check, 0o700)
    require(fingerprint(start_bytes) == START_PIN and fingerprint(check_bytes) == CHECK_PIN, 'active_launcher_hash')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'node_hash')
    require(command([str(node), '--version'], timeout=10).decode().strip() == NODE_VERSION, 'node_version')
    deps = active_dependencies(); old_inventory = dependency_inventory(deps)
    plan = release_plan(sha, tree); receipt_path = PRIVATE / 'jm1140-staging.json'
    for path in (receipt_path, *(plan[name] for name in ('checkout', 'tools', 'start', 'check', 'log', 'prelog'))):
        absent(path)
    git(BASE_CHECKOUT, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.14.0:refs/tags/v1.14.0')
    require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v1.14.0^{commit}') == sha, 'tag_identity')
    require(git(BASE_CHECKOUT, 'rev-parse', sha + '^{tree}') == tree, 'tag_tree')
    for before, after in ((BASE_SOURCE, sha), (sha, 'refs/remotes/origin/main')):
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', before, after)
    package_bytes, lock_bytes = source_blob(sha, 'package.json'), source_blob(sha, 'package-lock.json')
    validate_lock_transition(json.loads(source_blob(BASE_SOURCE, 'package.json')), json.loads(source_blob(BASE_SOURCE, 'package-lock.json')),
                             json.loads(package_bytes), json.loads(lock_bytes))
    for revision in (BASE_SOURCE, sha):
        require(not git(BASE_CHECKOUT, 'ls-tree', revision, '--', 'node_modules', '.npmrc'), 'tracked_dependency_configuration')
    for directory, expected, label in (('db/migrations', 33, 'normal'), ('server/video/migrations', VIDEO_DDL, 'video'),
                                        ('server/experience/migrations', EXPERIENCE_DDL, 'experience')):
        old, new = [migration_inventory(revision, directory) for revision in (BASE_SOURCE, sha)]
        require(old == new and (len(old) == expected if isinstance(expected, int) else tuple(name for name, _ in old) == expected),
                label + '_migrations_preserved')
    plan['startBytes'], plan['checkBytes'] = launcher(start_bytes, plan, check=False), launcher(check_bytes, plan, check=True)
    archive = download_archive()
    def preserved():
        source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
        require(regular(checkpoint, 0o600) == checkpoint_bytes, 'checkpoint_changed')
        require(regular(PRIVATE / 'jm1130-staging.json', 0o600) == prior_staging, 'active_staging_changed')
        require(regular(start, 0o700) == start_bytes and regular(check, 0o700) == check_bytes, 'active_launchers_changed')
        require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'active_node_changed')
        require(active_dependencies() == deps and dependency_inventory(deps) == old_inventory, 'active_dependencies_changed')
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
        receipt = dict(format='jessiemessage-release1140-staging', version=1, status='release1140_sources_staged_not_qualified',
            release='1.14.0', source=sha, tree=tree, checkout=str(plan['checkout']), checkoutMode='0700',
            launcher=str(plan['start']), launcherSha256=fingerprint(plan['startBytes']), launcherMode='0700',
            checkLauncher=str(plan['check']), checkLauncherSha256=fingerprint(plan['checkBytes']), checkLauncherMode='0700',
            log=str(plan['log']), logMode='0600', logSha256=fingerprint(b''), precheckLog=str(plan['prelog']),
            precheckLogMode='0600', precheckLogSha256=fingerprint(b''), nodeVersion=NODE_VERSION, nodeBinarySha256=NODE_PIN,
            profile=PROFILE, expectedActiveServiceVersion='1.13.0', baselineMetadataRelease=baseline['metadataRelease'],
            preservedActiveCheckpointSha256=baseline['sha256'], priorActiveStagingSha256=BASE_STAGING_SHA,
            priorActivePreserved=True, existingConfigurationUntouched=True, baselineMigrationFiles=33,
            schemaMigrationsExpected=38, applicationTablesExpected=37, experienceEnabled=True, experienceMigrationFiles=2,
            experienceMigrationsIdentical=True, normalMigrationsPreserved=True, videoMigrationsIdentical=True,
            sqlStatusChecked=False, configurationPrepared=False, hostedQualified=False, precheckPassed=False,
            started=False, migrated=False, runtimeStarted=False, noRestart=True, managerChanged=False, checkpointChanged=False,
            dependenciesReused=False, dependencyDirectory=installation['directory'], dependencies=installation, installer=npm,
            priorDependencyInventory=old_inventory, videoConfigurationDirectory=str(PRIVATE / 'runtime-video-180'),
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
        raise SystemExit('PREPARATION1140_NON_CONFIRMEE : ' + reason + '; conserver les traces, ne pas relancer.') from None


