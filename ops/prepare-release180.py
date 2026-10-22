#!/usr/bin/env python3
"""Stage exact JessieMessage 1.7.2/1.8.0 sources and launchers; never run them.

Usage: python3 prepare-release180.py SHA172 TREE172 SHA180 TREE180
The future runtime-video-180 configuration is intentionally neither read nor
created. Its separate preparation and hosted qualification precede any use of
the launchers produced here. This draft must be reviewed before publication.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

PRIVATE = Path('/srv/customer/jessiemessage-private')
BASE_CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-171-c2d7b3b3')
BASE_SOURCE = 'c2d7b3b31c6d0955892829f808dc4135d7d8debf'
BASE_TREE = 'd4945207f25375abb5d89c3a23ae91b6e34ea115'
START_PIN = '4692b9035aa4d24a3da1a8a71d5476a6db5892d8b5a9f8776631dfa58c1362a3'
CHECK_PIN = '1cd75896ba54496d8d7824a1108935975e3528ec2c6eb68adc9a7c9b26c8737d'
NODE_PIN = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_VERSION = 'v24.22.1'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')
SHA = re.compile(r'[a-f0-9]{40}')


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


def regular(path, mode, *, digest_only=False):
    require(path.is_absolute(), 'absolute_file_required')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
            and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == mode,
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


def source(checkout, expected, tree):
    require(not checkout.is_symlink() and git(checkout, 'rev-parse', 'HEAD') == expected, 'source_identity')
    require(git(checkout, 'rev-parse', 'HEAD^{tree}') == tree, 'source_tree')
    require(not git(checkout, 'status', '--porcelain', '--untracked-files=normal'), 'source_dirty')


def absent(path):
    require(not path.exists() and not path.is_symlink(), 'existing_output:' + path.name)


def fingerprint(content):
    return hashlib.sha256(content).hexdigest()


def source_blob(sha, name):
    entry = git(BASE_CHECKOUT, 'ls-tree', sha, '--', name)
    require(entry.startswith('100644 blob ') and entry.endswith('\t' + name), 'source_file:' + name)
    return command(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                    '-c', 'core.hooksPath=/dev/null', '-C', str(BASE_CHECKOUT), 'show', sha + ':' + name])


def migration_inventory(sha, directory):
    names = git(BASE_CHECKOUT, 'ls-tree', '-r', '--name-only', sha, '--', directory).splitlines()
    require(all(Path(name).parent.as_posix() == directory and name.endswith('.sql') for name in names), 'migration_inventory')
    return [(Path(name).name, fingerprint(source_blob(sha, name))) for name in names]


def release_plan(version, sha, tree):
    short = sha[:8]
    number = version.replace('.', '')
    return dict(version=version, sha=sha, tree=tree,
                checkout=BASE_CHECKOUT.parent / ('production-' + number + '-' + short),
                start=PRIVATE / ('start-primary-release' + number + '-' + short + '.sh'),
                check=PRIVATE / ('check-primary-release' + number + '-' + short + '.sh'),
                log=PRIVATE / ('jm' + number + '-node24221.log'),
                prelog=PRIVATE / ('jm' + number + '-preflight-node24221-' + short + '.log'))


def launcher(content, plan, *, check):
    text = content.decode('utf-8')
    operation = 'check-local-closures' if check else 'start-local-closures'
    opposite = 'start-local-closures' if check else 'check-local-closures'
    require(text.count(operation) == 1 and opposite not in text and '--profile' not in text, 'launcher_command')
    replacements = ((BASE_SOURCE, plan['sha']), (BASE_TREE, plan['tree']),
                    (str(BASE_CHECKOUT), str(plan['checkout'])),
                    (str(PRIVATE / 'primary-origin-candidate-4a355851'), str(PRIVATE / 'runtime-video-180')),
                    (str(PRIVATE / ('jm171-preflight-node24221-c2d7b3b3.log' if check else 'jm171-node24221.log')),
                     str(plan['prelog' if check else 'log'])))
    for before, after in replacements:
        count = text.count(before)
        require(count >= 1, 'launcher_replacement')
        text = text.replace(before, after)
        require(before not in text and text.count(after) == count, 'launcher_replacement_count')
    flag = '--private-path-mode linux-dirfd'
    require(text.count(flag) == 1, 'launcher_path_mode')
    text = text.replace(flag, flag + ' --profile ' + PROFILE)
    require(text.count('--profile ' + PROFILE) == 1
            and str(PRIVATE / 'runtime-node-v24.22.1/bin/node') in text
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


def stage(sha172, tree172, sha180, tree180):
    values = (sha172, tree172, sha180, tree180)
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in values), 'input_identity')
    require(sha172 != sha180 and sha172 != BASE_SOURCE and sha180 != BASE_SOURCE, 'distinct_sources')
    private_directory(PRIVATE)
    receipt_path = PRIVATE / 'jm180-staging.json'
    absent(receipt_path)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    old_start = PRIVATE / 'start-primary-release171-c2d7b3b3.sh'
    old_check = PRIVATE / 'check-primary-release171-c2d7b3b3.sh'
    start_bytes, check_bytes = regular(old_start, 0o700), regular(old_check, 0o700)
    require(fingerprint(start_bytes) == START_PIN and fingerprint(check_bytes) == CHECK_PIN, 'active_launcher_hash')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'node_hash')
    require(command([str(node), '--version'], timeout=10).decode().strip() == NODE_VERSION, 'node_version')
    plans = [release_plan('1.7.2', sha172, tree172), release_plan('1.8.0', sha180, tree180)]
    for plan in plans:
        for name in ('checkout', 'start', 'check', 'log', 'prelog'):
            absent(plan[name])
    git(BASE_CHECKOUT, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.7.2:refs/tags/v1.7.2',
        'refs/tags/v1.8.0:refs/tags/v1.8.0')
    for plan in plans:
        require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v' + plan['version'] + '^{commit}') == plan['sha'], 'tag_identity')
        require(git(BASE_CHECKOUT, 'rev-parse', plan['sha'] + '^{tree}') == plan['tree'], 'tag_tree')
    for before, after in ((BASE_SOURCE, sha172), (sha172, sha180), (sha180, 'refs/remotes/origin/main')):
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', before, after)
    locks = []
    for sha, version in ((BASE_SOURCE, '1.7.1'), (sha172, '1.7.2'), (sha180, '1.8.0')):
        package = json.loads(source_blob(sha, 'package.json'))
        lock = json.loads(source_blob(sha, 'package-lock.json'))
        require(package['version'] == lock['version'] == lock['packages']['']['version'] == version, 'package_versions')
        require(package.get('dependencies') == lock['packages'][''].get('dependencies'), 'package_dependencies')
        del lock['version']; del lock['packages']['']['version']; locks.append(lock)
        require(not git(BASE_CHECKOUT, 'ls-tree', sha, '--', 'node_modules'), 'tracked_dependencies')
    require(locks[0] == locks[1] == locks[2], 'locked_dependencies')
    migrations = [migration_inventory(sha, 'db/migrations') for sha in (BASE_SOURCE, sha172, sha180)]
    require(len(migrations[0]) == 33 and migrations[0] == migrations[1] == migrations[2], 'normal_migrations_preserved')
    video = [migration_inventory(sha, 'server/video/migrations') for sha in (sha172, sha180)]
    require(tuple(name for name, _ in video[0]) == VIDEO_DDL and video[0] == video[1], 'video_migrations_identical')
    deps = (BASE_CHECKOUT / 'node_modules').resolve(strict=True)
    require(deps.is_dir() and deps.stat().st_uid == os.getuid(), 'active_dependencies_directory')
    # Validate BOTH complete launcher plans before creating either worktree.
    for plan in plans:
        plan['startBytes'] = launcher(start_bytes, plan, check=False)
        plan['checkBytes'] = launcher(check_bytes, plan, check=True)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    absent(receipt_path)
    for plan in plans:
        for name in ('checkout', 'start', 'check', 'log', 'prelog'):
            absent(plan[name])
    prior_umask = os.umask(0o077)
    try:
        for plan in plans:
            git(BASE_CHECKOUT, 'worktree', 'add', '--detach', str(plan['checkout']), plan['sha'])
            source(plan['checkout'], plan['sha'], plan['tree'])
            link = plan['checkout'] / 'node_modules'; absent(link)
            link.symlink_to(deps, target_is_directory=True)
        for plan in plans:
            for name, content, mode in (('start', plan['startBytes'], 0o700), ('check', plan['checkBytes'], 0o700),
                                        ('log', b'', 0o600), ('prelog', b'', 0o600)):
                write_exclusive(plan[name], content, mode)
    finally:
        os.umask(prior_umask)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    require(fingerprint(regular(old_start, 0o700)) == START_PIN
            and fingerprint(regular(old_check, 0o700)) == CHECK_PIN, 'active_launchers_preserved')
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'final_node_hash')
    releases = []
    for plan in plans:
        source(plan['checkout'], plan['sha'], plan['tree'])
        require((plan['checkout'] / 'node_modules').resolve(strict=True) == deps, 'final_dependencies_link')
        require(regular(plan['start'], 0o700) == plan['startBytes']
                and regular(plan['check'], 0o700) == plan['checkBytes'], 'final_launchers')
        require(regular(plan['log'], 0o600) == regular(plan['prelog'], 0o600) == b'', 'logs_not_empty')
        releases.append(dict(version=plan['version'], source=plan['sha'], tree=plan['tree'], checkout=str(plan['checkout']),
            launcher=str(plan['start']), launcherSha256=fingerprint(plan['startBytes']), launcherMode='0700',
            checkLauncher=str(plan['check']), checkLauncherSha256=fingerprint(plan['checkBytes']), checkLauncherMode='0700',
            log=str(plan['log']), logMode='0600', logSha256=fingerprint(b''),
            precheckLog=str(plan['prelog']), precheckLogMode='0600', precheckLogSha256=fingerprint(b''),
            profile=PROFILE, videoConfigurationDirectory=str(PRIVATE / 'runtime-video-180'),
            videoConfigurationPrepared=False, hostedQualified=False, started=False, migrated=False, precheckPassed=False))
    receipt = dict(format='jessiemessage-release180-staging', version=1,
        status='release180_sources_staged_not_qualified', releases=releases, nodeVersion=NODE_VERSION,
        nodeBinarySha256=NODE_PIN, expectedActiveServiceVersion='1.7.1', priorActivePreserved=True,
        rollbackRelease='1.7.2', rollbackPrepared=True, rollbackHostedQualified=False,
        videoConfigurationDirectory=str(PRIVATE / 'runtime-video-180'),
        operationsDirectory=str(PRIVATE / 'recurring-backup-052'),
        baselineMigrationFiles=33, schemaMigrationsExpected=36, normalMigrationsPreserved=True,
        candidateVideoMigrationsIdentical=True, sqlStatusChecked=False, videoConfigurationPrepared=False,
        hostedQualified=False, started=False, migrated=False, runtimeStarted=False, noRestart=True,
        managerChanged=False, checkpointChanged=False)
    receipt_bytes = (json.dumps(receipt, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
    prior_umask = os.umask(0o077)
    try:
        write_exclusive(receipt_path, receipt_bytes, 0o600)
    finally:
        os.umask(prior_umask)
    return dict(receipt, receipt=str(receipt_path), receiptSha256=fingerprint(receipt_bytes))


def main(args):
    require(len(args) == 4, 'usage_four_source_tree_arguments')
    print(json.dumps(stage(*args), separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        code = str(error) if isinstance(error, StagingRefused) else 'staging_not_confirmed'
        print(json.dumps(dict(status='release180_staging_not_confirmed', code=code,
                             runtimeStarted=False, noAutomaticRetry=True), separators=(',', ':')), file=sys.stderr)
        sys.exit(1)
