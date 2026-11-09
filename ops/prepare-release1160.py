#!/usr/bin/env python3
"""Stage pinned 1.16.0 sources and launchers, reusing the exact active installation.

Usage: python3 prepare-release1160.py SOURCE1160 TREE1160
Qualification pins stay fail-closed until the exact merged release is supplied.
Hosted execution also requires successful main CI and immutable publication.
No npm/install, SQL, CHECK, storage binding, configuration, checkpoint, Manager or runtime action.
Only the newly created checkout may drop inherited setgid, through its open fd.
Existing parents, active checkout/dependencies and partial output are preserved.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

PRIVATE = Path('/srv/customer/jessiemessage-private')
BASE_CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1151-a4a07f9f')
DEPENDENCY_ROOT = Path('/srv/customer/jessiemessage-operator/production-1150-6712028e/node_modules')
BASE_SOURCE = 'a4a07f9f31c47a7185b57d11b8277be1d87fd2c1'
BASE_TREE = '568530e702fa4d0a8a6b1743988c5e20b8656c40'
# Exact PR150 merge. Hosted execution still requires green main CI and immutable publication.
RELEASE_SOURCE = 'd2b57fb88d58aacf64dd51c5d1952c65f5c327ae'
RELEASE_TREE = '632ec530d812fa75cf2aa4b603c91c81dcaf7e8e'
START_PIN = '6ec4d5e5e38752ceecf01dbd68c007e3052fa4e8c395cfc8a32f67e3459359df'
CHECK_PIN = '89db31ab008fbe3af3d8dacd053e740c28f47ef906b496cfc981d01e6aaff8b9'
NODE_PIN = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_VERSION = 'v24.22.1'
CHECKPOINT_PIN = '0a2f64c3f77082f374289883b3607a27e3447bdcb37e4ca43faea2971e6267c3'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')
EXPERIENCE_DDL = ('0037_profile_preferences.sql', '0038_reply_tracking.sql')
SHA = re.compile(r'[a-f0-9]{40}')
BASE_STAGING_SHA = '0323f8631bc6c0f4c6f1fee22e68a2bc1c5b8d730a6d2c93545f929518cb7216'
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
DEPENDENCY_INVENTORY = dict(sha256='4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152', entries=1180, files=988)
INSTALL_LOCK_SHA = '1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1'
BASE_LOCK_SHA = 'eb6203bd91ad9a740766e55a517f29bc7c2acd6a48ddc725dfb0f4ee092ff7ca'


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
    if not digest_only:
        require(before.st_size <= 2097152, 'file_size:' + path.name)
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
            content = handle.read(2097153)
            require(len(content) == first.st_size and len(content) <= 2097152, 'file_size:' + path.name)
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
    info = link.lstat()
    require(stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid()
            and os.readlink(link) == str(DEPENDENCY_ROOT) and link.resolve(strict=True) == DEPENDENCY_ROOT,
            'active_dependencies_link')
    private_directory(DEPENDENCY_ROOT.parent)
    private_directory(DEPENDENCY_ROOT)
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



def verified_dependencies():
    root = active_dependencies()
    inventory = dependency_inventory(root)
    require(inventory == DEPENDENCY_INVENTORY, 'active_dependency_inventory')
    versions = {}
    for name, expected in ROOT_DEPENDENCIES.items():
        manifest = json.loads(regular(root / name / 'package.json'))
        require(manifest.get('name') == name and manifest.get('version') == expected, 'active_dependency_version:' + name)
        versions[name] = manifest['version']
    for name, expected in CODEC_FILES.items():
        require(regular(root / name, digest_only=True) == expected, 'active_dependency_codec:' + name)
    return dict(strategy='reuse-exact-private-1150', directory=str(root), inventory=inventory,
                directVersions=versions, codecSha256=dict(CODEC_FILES), scriptsExecuted=False,
                installed=False, lockSha256=INSTALL_LOCK_SHA, activeApplicationLockSha256=BASE_LOCK_SHA)


def validate_lock_transition(old_package, old_lock, package, lock):
    require(old_lock.get('lockfileVersion') == lock.get('lockfileVersion') == 3, 'dependency_lock_format')
    for manifest, graph, version in ((old_package, old_lock, '1.15.1'), (package, lock, '1.16.0')):
        require(manifest.get('version') == graph.get('version') == graph.get('packages', {}).get('', {}).get('version') == version,
                'package_versions')
        require(manifest.get('dependencies') == graph['packages'][''].get('dependencies') == ROOT_DEPENDENCIES,
                'package_dependencies')
    normalized_package, normalized_lock = copy.deepcopy(package), copy.deepcopy(lock)
    normalized_package['version'] = old_package['version']
    normalized_lock['version'] = old_lock['version']
    normalized_lock['packages']['']['version'] = old_lock['packages']['']['version']
    require(normalized_package == old_package, 'package_other_change')
    require(normalized_lock == old_lock, 'locked_dependencies')


def release_plan(sha, tree):
    short = sha[:8]
    return dict(version='1.16.0', sha=sha, tree=tree,
                checkout=BASE_CHECKOUT.parent / ('production-1160-' + short),
                start=PRIVATE / ('start-primary-release1160-' + short + '.sh'),
                check=PRIVATE / ('check-primary-release1160-' + short + '.sh'),
                log=PRIVATE / 'jm1160-node24221.log',
                prelog=PRIVATE / ('jm1160-preflight-node24221-' + short + '.log'))


def launcher(content, plan, *, check):
    text = content.decode('utf-8')
    operation = 'check-local-closures' if check else 'start-local-closures'
    opposite = 'start-local-closures' if check else 'check-local-closures'
    require(text.count(operation) == 1 and opposite not in text, 'launcher_command')
    require(text.count('--profile') == 1 and text.count('--profile ' + PROFILE) == 1,
            'launcher_profile')
    replacements = ((BASE_SOURCE, plan['sha']), (BASE_TREE, plan['tree']),
                    (str(BASE_CHECKOUT), str(plan['checkout'])),
                    (str(PRIVATE / (f'jm1151-preflight-node24221-{BASE_SOURCE[:8]}.log' if check else 'jm1151-node24221.log')),
                     str(plan['prelog' if check else 'log'])))
    for before, after in replacements:
        count = text.count(before)
        require(count >= 1, 'launcher_replacement')
        text = text.replace(before, after)
        require(before not in text and text.count(after) == count, 'launcher_replacement_count')
    require(text.count('--experience 1') == text.count('--experience') == 1, 'launcher_experience')
    require(text.count('--private-path-mode linux-dirfd') == 1
            and str(PRIVATE / 'runtime-node-v24.22.1/bin/node') in text
            and str(PRIVATE / 'runtime-video-180') in text
            and str(PRIVATE / 'recurring-backup-052') in text, 'launcher_runtime_binding')
    result = text.encode('utf-8')
    command(['/bin/bash', '-n'], data=result)
    return result


def write_exclusive(path, content, mode):
    private_directory(PRIVATE)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK, mode)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content); handle.flush(); os.fsync(handle.fileno())
    require(regular(path, mode) == content, 'written_file:' + path.name)
    directory = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)



def checkpoint_baseline(raw):
    observed = fingerprint(raw)
    require(observed == CHECKPOINT_PIN, 'active_checkpoint_hash')
    document = json.loads(raw)
    require(document.get('activeService', {}).get('release') == '1.15.1'
            and document['activeService'].get('source') == BASE_SOURCE
            and document['activeService'].get('tree') == BASE_TREE, 'active_checkpoint_identity')
    return dict(sha256=observed, metadataRelease='1.15.1')


def stage(sha1160, tree1160):
    require(SHA.fullmatch(RELEASE_SOURCE) and SHA.fullmatch(RELEASE_TREE), 'release1160_pins_pending')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in (sha1160, tree1160)), 'input_identity')
    require((sha1160, tree1160) == (RELEASE_SOURCE, RELEASE_TREE), 'release1160_pinned_identity')
    require(sha1160 != BASE_SOURCE, 'distinct_sources')
    private_directory(PRIVATE)
    old_staging = regular(PRIVATE / 'jm1151-staging.json', 0o600)
    require(fingerprint(old_staging) == BASE_STAGING_SHA, 'active_staging_hash')
    checkpoint_path = PRIVATE / 'jm0702-existing-pc-update.json'
    checkpoint_bytes = regular(checkpoint_path, 0o600)
    baseline = checkpoint_baseline(checkpoint_bytes)
    receipt_path = PRIVATE / 'jm1160-staging.json'
    absent(receipt_path)
    private_directory(BASE_CHECKOUT)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    old_start = PRIVATE / f'start-primary-release1151-{BASE_SOURCE[:8]}.sh'
    old_check = PRIVATE / f'check-primary-release1151-{BASE_SOURCE[:8]}.sh'
    start_bytes, check_bytes = regular(old_start, 0o700), regular(old_check, 0o700)
    require(fingerprint(start_bytes) == START_PIN and fingerprint(check_bytes) == CHECK_PIN, 'active_launcher_hash')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'node_hash')
    require(command([str(node), '--version'], timeout=10).decode().strip() == NODE_VERSION, 'node_version')
    plan = release_plan(sha1160, tree1160)
    for name in ('checkout', 'start', 'check', 'log', 'prelog'):
        absent(plan[name])
    git(BASE_CHECKOUT, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.16.0:refs/tags/v1.16.0')
    require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v1.16.0^{commit}') == sha1160, 'tag_identity')
    require(git(BASE_CHECKOUT, 'rev-parse', sha1160 + '^{tree}') == tree1160, 'tag_tree')
    for before, after in ((BASE_SOURCE, sha1160), (sha1160, 'refs/remotes/origin/main')):
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', before, after)
    manifests = []
    for revision in (BASE_SOURCE, sha1160):
        package_bytes, lock_bytes = source_blob(revision, 'package.json'), source_blob(revision, 'package-lock.json')
        manifests.append((json.loads(package_bytes), json.loads(lock_bytes)))
        if revision == BASE_SOURCE:
            require(fingerprint(lock_bytes) == BASE_LOCK_SHA, 'active_lock_hash')
        require(not git(BASE_CHECKOUT, 'ls-tree', revision, '--', 'node_modules'), 'tracked_dependencies')
    validate_lock_transition(*manifests[0], *manifests[1])
    normal = [migration_inventory(sha, 'db/migrations') for sha in (BASE_SOURCE, sha1160)]
    require(len(normal[0]) == 33 and normal[0] == normal[1], 'normal_migrations_preserved')
    video = [migration_inventory(sha, 'server/video/migrations') for sha in (BASE_SOURCE, sha1160)]
    require(tuple(name for name, _ in video[0]) == VIDEO_DDL and video[0] == video[1], 'video_migrations_identical')
    experience = [migration_inventory(sha, 'server/experience/migrations') for sha in (BASE_SOURCE, sha1160)]
    require(tuple(name for name, _ in experience[0]) == EXPERIENCE_DDL and experience[0] == experience[1], 'experience_migrations_identical')
    deps = active_dependencies()
    dependency_report = verified_dependencies()
    # Validate both launch commands, then recheck all pins before the new worktree.
    plan['startBytes'] = launcher(start_bytes, plan, check=False)
    plan['checkBytes'] = launcher(check_bytes, plan, check=True)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    require(regular(old_start, 0o700) == start_bytes and regular(old_check, 0o700) == check_bytes,
            'active_launchers_changed')
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'prewrite_node_hash')
    require(active_dependencies() == deps and verified_dependencies() == dependency_report, 'prewrite_dependencies')
    require(regular(checkpoint_path, 0o600) == checkpoint_bytes, 'prewrite_checkpoint_changed')
    require(regular(PRIVATE / 'jm1151-staging.json', 0o600) == old_staging, 'prewrite_active_staging_changed')
    absent(receipt_path)
    for name in ('checkout', 'start', 'check', 'log', 'prelog'):
        absent(plan[name])
    prior_umask = os.umask(0o077)
    try:
        git(BASE_CHECKOUT, 'worktree', 'add', '--detach', str(plan['checkout']), sha1160)
        normalize_created_directory(plan['checkout'])
        source(plan['checkout'], sha1160, tree1160)
        link = plan['checkout'] / 'node_modules'; absent(link)
        link.symlink_to(deps, target_is_directory=True)
        for name, content, mode in (('start', plan['startBytes'], 0o700), ('check', plan['checkBytes'], 0o700),
                                    ('log', b'', 0o600), ('prelog', b'', 0o600)):
            write_exclusive(plan[name], content, mode)
    finally:
        os.umask(prior_umask)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    require(fingerprint(regular(old_start, 0o700)) == START_PIN
            and fingerprint(regular(old_check, 0o700)) == CHECK_PIN, 'active_launchers_preserved')
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'final_node_hash')
    require(regular(checkpoint_path, 0o600) == checkpoint_bytes, 'final_checkpoint_changed')
    source(plan['checkout'], sha1160, tree1160)
    private_directory(plan['checkout']); private_directory(deps)
    require(regular(PRIVATE / 'jm1151-staging.json', 0o600) == old_staging, 'active_staging_preserved')
    require(active_dependencies() == deps and verified_dependencies() == dependency_report, 'active_dependencies_preserved')
    link_info = link.lstat()
    require(stat.S_ISLNK(link_info.st_mode) and link_info.st_uid == os.getuid()
            and os.readlink(link) == str(deps) and link.resolve(strict=True) == deps, 'final_dependencies_link')
    require(regular(plan['start'], 0o700) == plan['startBytes']
            and regular(plan['check'], 0o700) == plan['checkBytes'], 'final_launchers')
    require(regular(plan['log'], 0o600) == regular(plan['prelog'], 0o600) == b'', 'logs_not_empty')
    receipt = dict(format='jessiemessage-release1160-staging', version=1,
        status='release1160_sources_staged_not_qualified', release='1.16.0', source=sha1160, tree=tree1160,
        checkout=str(plan['checkout']), launcher=str(plan['start']), launcherSha256=fingerprint(plan['startBytes']),
        launcherMode='0700', checkLauncher=str(plan['check']), checkLauncherSha256=fingerprint(plan['checkBytes']),
        checkLauncherMode='0700', log=str(plan['log']), logMode='0600', logSha256=fingerprint(b''),
        precheckLog=str(plan['prelog']), precheckLogMode='0600', precheckLogSha256=fingerprint(b''),
        nodeVersion=NODE_VERSION, nodeBinarySha256=NODE_PIN, profile=PROFILE,
        expectedActiveServiceVersion='1.15.1', priorActivePreserved=True,
        videoConfigurationDirectory=str(PRIVATE / 'runtime-video-180'),
        operationsDirectory=str(PRIVATE / 'recurring-backup-052'), existingConfigurationUntouched=True,
        baselineMigrationFiles=33, schemaMigrationsExpected=38, applicationTablesExpected=37, experienceEnabled=True,
        experienceMigrationFiles=2, experienceMigrationsIdentical=True, normalMigrationsPreserved=True,
        videoMigrationsIdentical=True, sqlStatusChecked=False, configurationPrepared=False,
        hostedQualified=False, precheckPassed=False, started=False, migrated=False, runtimeStarted=False,
        noRestart=True, managerChanged=False, checkpointChanged=False,
        preservedActiveCheckpointSha256=baseline['sha256'], priorActiveStagingSha256=BASE_STAGING_SHA,
        baselineMetadataRelease=baseline['metadataRelease'],
        dependenciesReused=True, dependencies=dependency_report, dependencyDirectory=str(deps), checkoutMode='0700',
        storageBindingsChecked=False, storageBindingsWritten=False,
        checkPrerequisite='verified_storage_root_bindings', checkCommand='bash ' + str(plan['check']))
    receipt_bytes = (json.dumps(receipt, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
    prior_umask = os.umask(0o077)
    try:
        write_exclusive(receipt_path, receipt_bytes, 0o600)
    finally:
        os.umask(prior_umask)
    return dict(receipt, receipt=str(receipt_path), receiptSha256=fingerprint(receipt_bytes))


def main(args):
    require(len(args) == 2, 'usage_two_source_tree_arguments')
    print(json.dumps(stage(*args), separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        code = str(error) if isinstance(error, StagingRefused) else 'staging_not_confirmed'
        print(json.dumps(dict(status='release1160_staging_not_confirmed', code=code,
                             runtimeStarted=False, noAutomaticRetry=True), separators=(',', ':')), file=sys.stderr)
        sys.exit(1)
