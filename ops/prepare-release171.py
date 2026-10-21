#!/usr/bin/env python3
"""Stage one qualified 1.7.1 checkout on already-prepared Node 24.22.1.

Pin SOURCE and TREE only after merge, successful exact main CI and publication.
This helper never starts/checks the application, migrates SQL, changes Manager
or writes the checkpoint. Partial preparation is preserved and blocks a retry.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

SOURCE = 'c2d7b3b31c6d0955892829f808dc4135d7d8debf'
TREE = 'd4945207f25375abb5d89c3a23ae91b6e34ea115'
PRIVATE = Path('/srv/customer/jessiemessage-private')
OLD = Path('/srv/customer/jessiemessage-operator/production-160-9590741e')
OLD_SHA = '9590741e7065067aee9d1ad5d1206739cc27eb6b'
OLD_TREE = '38e72545ab4fd6feb4a04e934b2eb8685f82b970'
REMOTE = 'https://github.com/fredbuhr/jessiemessage.git'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
OLD_NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
START_PIN = '39015e53147112981203b5172f11f52563311be7e92a92f2b78bf4dca744f1b4'
CHECK_PIN = '13362ac14caa4795a4fbf3ee3fc50e94188938179c1cde119d6d968427a50971'


def require(ok, label):
    if not ok:
        raise RuntimeError(label)


def regular(path, mode=None, as_digest=False):
    require(path.is_absolute() and path.resolve(strict=True) == path, 'file_path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid()
                and value.st_nlink == 1 and not value.st_mode & 0o022
                and (mode is None or stat.S_IMODE(value.st_mode) == mode), 'file_metadata')
        with os.fdopen(fd, 'rb') as file:
            fd = None
            if as_digest:
                value = hashlib.sha256()
                while chunk := file.read(262144):
                    value.update(chunk)
                return value.hexdigest()
            content = file.read(2 * 1024 * 1024 + 1)
            require(len(content) <= 2 * 1024 * 1024, 'file_size')
            return content
    finally:
        if fd is not None:
            os.close(fd)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def git(root, *args, timeout=20):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0')
    result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-C', str(root), *args], env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    require(result.returncode == 0, 'git_command_refused')
    return result.stdout.decode().strip()


def source(root, sha, tree):
    require(root.resolve(strict=True) == root and root.is_dir(), 'checkout_path')
    require(git(root, 'rev-parse', '--show-toplevel') == str(root)
            and git(root, 'rev-parse', 'HEAD') == sha
            and git(root, 'rev-parse', 'HEAD^{tree}') == tree
            and not git(root, 'status', '--porcelain', '--untracked-files=normal'), 'checkout_identity')


def contents(root, version):
    require(json.loads(regular(root / 'package.json'))['version'] == version, 'application_version')
    lock = json.loads(regular(root / 'package-lock.json'))
    require(lock['version'] == version and lock['packages']['']['version'] == version, 'lock_versions')
    del lock['version']; del lock['packages']['']['version']
    directory = root / 'db/migrations'
    require(directory.resolve(strict=True) == directory and directory.is_dir(), 'migrations_directory')
    files = sorted(directory.iterdir())
    require(len(files) == 33 and all(path.name.endswith('.sql') for path in files), 'schema33_inventory')
    return lock, [(path.name, digest(regular(path))) for path in files]


def launchers(private, old, target):
    plans = []
    old_node = str(private / 'runtime-node-v24.22.0/bin/node')
    node = str(private / 'runtime-node-v24.22.1/bin/node')
    definitions = (
        ('start', START_PIN, 'jm160-node2422.log', 'jm171-node24221.log', 'start-local-closures'),
        ('check', CHECK_PIN, 'jm160-preflight-9590741e.log', f'jm171-preflight-node24221-{SOURCE[:8]}.log', 'check-local-closures'),
    )
    for kind, pin, old_log, log, command in definitions:
        original = private / f'{kind}-primary-release160-9590741e.sh'
        before = regular(original, 0o700)
        require(digest(before) == pin, 'original_launcher_hash')
        text = before.decode()
        require(text.count(command) == 1, 'launcher_command')
        for label, previous, replacement, count in (
            ('source', OLD_SHA, SOURCE, 2), ('tree', OLD_TREE, TREE, 2),
            ('checkout', str(old), str(target), 2), ('log', old_log, log, 1),
            ('node_path', old_node, node, 3), ('node_digest', OLD_NODE_SHA, NODE_SHA, 1),
            ('node_version', 'v24.22.0', 'v24.22.1', 1),
        ):
            require(text.count(previous) == count, 'launcher_count:' + label)
            text = text.replace(previous, replacement)
            require(previous not in text, 'launcher_old_pin:' + label)
        subprocess.run(['/bin/bash', '-n'], input=text.encode(), check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        plans.extend(((private / f'{kind}-primary-release171-{SOURCE[:8]}.sh', text.encode(), 0o700),
                      (private / log, b'', 0o600)))
    return plans


def prepare():
    # Deliberately refuse this unpinned draft before reading hosting paths.
    require(re.fullmatch('[a-f0-9]{40}', SOURCE) and re.fullmatch('[a-f0-9]{40}', TREE), 'qualification_required')
    private, old = PRIVATE, OLD
    target = old.parent / f'production-171-{SOURCE[:8]}'
    require(private.resolve(strict=True) == private and private.is_dir()
            and private.stat().st_uid == os.getuid() and stat.S_IMODE(private.stat().st_mode) == 0o700,
            'private_directory')
    source(old, OLD_SHA, OLD_TREE)
    require(git(old, 'remote', 'get-url', 'origin') == REMOTE, 'repository_origin')
    node = private / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, as_digest=True) == NODE_SHA, 'prepared_node_hash')
    require(regular(private / 'runtime-node-v24.22.0/bin/node', 0o700, as_digest=True) == OLD_NODE_SHA, 'old_node_hash')
    env = {key: value for key, value in os.environ.items() if key not in ('NODE_OPTIONS', 'NODE_PATH')}
    require(subprocess.check_output([str(node), '--version'], env=env, cwd='/',
            stdin=subprocess.DEVNULL, timeout=15, text=True).strip() == 'v24.22.1', 'prepared_node_version')
    plans = launchers(private, old, target)
    require(all(not os.path.lexists(path) for path in [target, *(value[0] for value in plans)]), 'existing_output_inspect_before_retry')
    git(old, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.7.1:refs/tags/v1.7.1', timeout=120)
    require(git(old, 'rev-parse', 'refs/tags/v1.7.1^{commit}') == SOURCE
            and git(old, 'rev-parse', SOURCE + '^{tree}') == TREE, 'published_source_identity')
    git(old, 'merge-base', '--is-ancestor', OLD_SHA, SOURCE)
    git(old, 'merge-base', '--is-ancestor', SOURCE, 'refs/remotes/origin/main')
    git(old, 'worktree', 'add', '--detach', str(target), SOURCE)
    source(target, SOURCE, TREE)
    require(contents(old, '1.6.0') == contents(target, '1.7.1'), 'dependencies_or_migrations_changed')
    deps = (old / 'node_modules').resolve(strict=True)
    require(deps.is_dir() and deps.stat().st_uid == os.getuid()
            and not os.path.lexists(target / 'node_modules'), 'dependencies_directory')
    (target / 'node_modules').symlink_to(deps, target_is_directory=True)
    for path, content, mode in plans:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as output:
            output.write(content); output.flush(); os.fsync(output.fileno())
        require(regular(path, mode) == content, 'written_file_readback')
    fd = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    source(old, OLD_SHA, OLD_TREE); source(target, SOURCE, TREE)
    require(launchers(private, old, target) == plans, 'original_launchers_changed')
    require(regular(node, 0o700, as_digest=True) == NODE_SHA, 'final_node_hash')
    require(regular(private / 'runtime-node-v24.22.0/bin/node', 0o700, as_digest=True) == OLD_NODE_SHA, 'final_old_node_hash')
    return dict(status='release171_staged_not_checked', version='1.7.1', source=SOURCE, tree=TREE,
        checkout=str(target), nodeVersion='v24.22.1', nodeBinary=str(node), nodeBinarySha256=NODE_SHA,
        files=[dict(path=str(path), sha256=digest(content), mode=f'{mode:04o}') for path, content, mode in plans],
        schemaMigrationsExpected=33, migrationsUnchanged=True, dependenciesUnchanged=True,
        precheckPassed=False, runtimeStarted=False, migrated=False, noRestart=True,
        managerChanged=False, checkpointChanged=False, preservedSource160=OLD_SHA,
        rollback160Node24221PrecheckRequired=True, rollback151AndOriginal160Preserved=True)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'usage_no_arguments')
        print(json.dumps(prepare(), separators=(',', ':')))
    except Exception as error:
        raise SystemExit('STAGING_REFUSED: ' + str(error))
