#!/usr/bin/env python3
"""Stage pinned 1.14.1 sources and launchers, reusing exact private 1.14.0 dependencies.

Usage: python3 prepare-release1141.py SOURCE1141 TREE1141
Qualification pins stay fail-closed until the exact merged release is supplied.
Hosted execution also requires successful main CI and immutable publication.
No npm/install, SQL, CHECK, configuration, checkpoint, Manager or runtime action.
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
BASE_CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1140-4f3ce5de')
DEPENDENCY_ROOT = BASE_CHECKOUT / 'node_modules'
BASE_SOURCE = '4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd'
BASE_TREE = 'e5a239eaf7b8c3395a843c9e0d600efeb7aa569b'
RELEASE_SOURCE = 'c803c2c9be16c0c4ee218d8cac4a1272620d2772'
RELEASE_TREE = 'f391b5cebe0a8a8ffd63c818cd481b50970336f1'
START_PIN = '12f9b0c634c89912eb15ca02244c76f14694a84a3e8499051e52e4988c316635'
CHECK_PIN = 'ae4999d70f15be6cd1491c30ac5ad99494e5f0d35a3fcc1b3e0daf3748424419'
NODE_PIN = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_VERSION = 'v24.22.1'
CHECKPOINT_PIN = '19ceaa7e91d32daba7da5b71d7dfe02ad964e8d9d2850ae016cfa732b8a9c6e0'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')
EXPERIENCE_DDL = ('0037_profile_preferences.sql', '0038_reply_tracking.sql')
SHA = re.compile(r'[a-f0-9]{40}')
BASE_STAGING_SHA = '2fe494a43a446c882ce509f4ecf51925bd5789a94bdbdf2ce6923d83e5ff7d72'
ROOT_DEPENDENCIES = {'libheif-js': '1.23.5', 'mariadb': '3.5.4', 'nodemailer': '10.1.4',
                     'otpauth': '9.5.2', 'sharp': '0.35.5', 'web-push': '3.6.7'}
CODEC_FILES = {'libheif-wasm/libheif-bundle.mjs': '095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9',
               'libheif-wasm/LICENSE': 'fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596'}
DEPENDENCY_INVENTORY = dict(sha256='547c6ec03aa29027264dbb848e7830df0cb615a1eb92710498bc94d988897c37', entries=1082, files=914)
BASE_LOCK_SHA = '623e3be5057fd8d348d9363d30afef93c6e26dc8cd6df3b8150116c5f17c8e5b'


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
    require(DEPENDENCY_ROOT == BASE_CHECKOUT / 'node_modules', 'active_dependencies_root')
    # Unlike older releases, 1.14.0 owns a real private directory, never a link.
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
        require(regular(root / 'libheif-js' / name, digest_only=True) == expected, 'active_dependency_codec:' + name)
    return dict(strategy='reuse-exact-private-1140', directory=str(root), inventory=inventory,
                directVersions=versions, codecSha256=dict(CODEC_FILES), scriptsExecuted=False,
                installed=False, lockSha256=BASE_LOCK_SHA)


def validate_lock_transition(old_package, old_lock, package, lock):
    require(old_lock.get('lockfileVersion') == lock.get('lockfileVersion') == 3, 'dependency_lock_format')
    for manifest, graph, version in ((old_package, old_lock, '1.14.0'), (package, lock, '1.14.1')):
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
    return dict(version='1.14.1', sha=sha, tree=tree,
                checkout=BASE_CHECKOUT.parent / ('production-1141-' + short),
                start=PRIVATE / ('start-primary-release1141-' + short + '.sh'),
                check=PRIVATE / ('check-primary-release1141-' + short + '.sh'),
                log=PRIVATE / 'jm1141-node24221.log',
                prelog=PRIVATE / ('jm1141-preflight-node24221-' + short + '.log'))


def launcher(content, plan, *, check):
    text = content.decode('utf-8')
    operation = 'check-local-closures' if check else 'start-local-closures'
    opposite = 'start-local-closures' if check else 'check-local-closures'
    require(text.count(operation) == 1 and opposite not in text, 'launcher_command')
    require(text.count('--profile') == 1 and text.count('--profile ' + PROFILE) == 1,
            'launcher_profile')
    replacements = ((BASE_SOURCE, plan['sha']), (BASE_TREE, plan['tree']),
                    (str(BASE_CHECKOUT), str(plan['checkout'])),
                    (str(PRIVATE / ('jm1140-preflight-node24221-4f3ce5de.log' if check else 'jm1140-node24221.log')),
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
    require(document.get('activeService', {}).get('release') == '1.14.0'
            and document['activeService'].get('source') == BASE_SOURCE
            and document['activeService'].get('tree') == BASE_TREE, 'active_checkpoint_identity')
    return dict(sha256=observed, metadataRelease='1.14.0')


def stage(sha1141, tree1141):
    require(SHA.fullmatch(RELEASE_SOURCE) and SHA.fullmatch(RELEASE_TREE), 'release1141_pins_pending')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in (sha1141, tree1141)), 'input_identity')
    require((sha1141, tree1141) == (RELEASE_SOURCE, RELEASE_TREE), 'release1141_pinned_identity')
    require(sha1141 != BASE_SOURCE, 'distinct_sources')
    private_directory(PRIVATE)
    old_staging = regular(PRIVATE / 'jm1140-staging.json', 0o600)
    require(fingerprint(old_staging) == BASE_STAGING_SHA, 'active_staging_hash')
    checkpoint_path = PRIVATE / 'jm0702-existing-pc-update.json'
    checkpoint_bytes = regular(checkpoint_path, 0o600)
    baseline = checkpoint_baseline(checkpoint_bytes)
    receipt_path = PRIVATE / 'jm1141-staging.json'
    absent(receipt_path)
    private_directory(BASE_CHECKOUT)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    old_start = PRIVATE / 'start-primary-release1140-4f3ce5de.sh'
    old_check = PRIVATE / 'check-primary-release1140-4f3ce5de.sh'
    start_bytes, check_bytes = regular(old_start, 0o700), regular(old_check, 0o700)
    require(fingerprint(start_bytes) == START_PIN and fingerprint(check_bytes) == CHECK_PIN, 'active_launcher_hash')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'node_hash')
    require(command([str(node), '--version'], timeout=10).decode().strip() == NODE_VERSION, 'node_version')
    plan = release_plan(sha1141, tree1141)
    for name in ('checkout', 'start', 'check', 'log', 'prelog'):
        absent(plan[name])
    git(BASE_CHECKOUT, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.14.1:refs/tags/v1.14.1')
    require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v1.14.1^{commit}') == sha1141, 'tag_identity')
    require(git(BASE_CHECKOUT, 'rev-parse', sha1141 + '^{tree}') == tree1141, 'tag_tree')
    for before, after in ((BASE_SOURCE, sha1141), (sha1141, 'refs/remotes/origin/main')):
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', before, after)
    manifests = []
    for revision in (BASE_SOURCE, sha1141):
        package_bytes, lock_bytes = source_blob(revision, 'package.json'), source_blob(revision, 'package-lock.json')
        manifests.append((json.loads(package_bytes), json.loads(lock_bytes)))
        if revision == BASE_SOURCE:
            require(fingerprint(lock_bytes) == BASE_LOCK_SHA, 'active_lock_hash')
        require(not git(BASE_CHECKOUT, 'ls-tree', revision, '--', 'node_modules'), 'tracked_dependencies')
    validate_lock_transition(*manifests[0], *manifests[1])
    normal = [migration_inventory(sha, 'db/migrations') for sha in (BASE_SOURCE, sha1141)]
    require(len(normal[0]) == 33 and normal[0] == normal[1], 'normal_migrations_preserved')
    video = [migration_inventory(sha, 'server/video/migrations') for sha in (BASE_SOURCE, sha1141)]
    require(tuple(name for name, _ in video[0]) == VIDEO_DDL and video[0] == video[1], 'video_migrations_identical')
    experience = [migration_inventory(sha, 'server/experience/migrations') for sha in (BASE_SOURCE, sha1141)]
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
    require(regular(PRIVATE / 'jm1140-staging.json', 0o600) == old_staging, 'prewrite_active_staging_changed')
    absent(receipt_path)
    for name in ('checkout', 'start', 'check', 'log', 'prelog'):
        absent(plan[name])
    prior_umask = os.umask(0o077)
    try:
        git(BASE_CHECKOUT, 'worktree', 'add', '--detach', str(plan['checkout']), sha1141)
        normalize_created_directory(plan['checkout'])
        source(plan['checkout'], sha1141, tree1141)
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
    source(plan['checkout'], sha1141, tree1141)
    private_directory(plan['checkout']); private_directory(deps)
    require(regular(PRIVATE / 'jm1140-staging.json', 0o600) == old_staging, 'active_staging_preserved')
    require(active_dependencies() == deps and verified_dependencies() == dependency_report, 'active_dependencies_preserved')
    link_info = link.lstat()
    require(stat.S_ISLNK(link_info.st_mode) and link_info.st_uid == os.getuid()
            and os.readlink(link) == str(deps) and link.resolve(strict=True) == deps, 'final_dependencies_link')
    require(regular(plan['start'], 0o700) == plan['startBytes']
            and regular(plan['check'], 0o700) == plan['checkBytes'], 'final_launchers')
    require(regular(plan['log'], 0o600) == regular(plan['prelog'], 0o600) == b'', 'logs_not_empty')
    receipt = dict(format='jessiemessage-release1141-staging', version=1,
        status='release1141_sources_staged_not_qualified', release='1.14.1', source=sha1141, tree=tree1141,
        checkout=str(plan['checkout']), launcher=str(plan['start']), launcherSha256=fingerprint(plan['startBytes']),
        launcherMode='0700', checkLauncher=str(plan['check']), checkLauncherSha256=fingerprint(plan['checkBytes']),
        checkLauncherMode='0700', log=str(plan['log']), logMode='0600', logSha256=fingerprint(b''),
        precheckLog=str(plan['prelog']), precheckLogMode='0600', precheckLogSha256=fingerprint(b''),
        nodeVersion=NODE_VERSION, nodeBinarySha256=NODE_PIN, profile=PROFILE,
        expectedActiveServiceVersion='1.14.0', priorActivePreserved=True,
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
        nextCheckCommand='bash ' + str(plan['check']))
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
        print(json.dumps(dict(status='release1141_staging_not_confirmed', code=code,
                             runtimeStarted=False, noAutomaticRetry=True), separators=(',', ':')), file=sys.stderr)
        sys.exit(1)
