#!/usr/bin/env python3
"""Prepare Node 24.22.1 and separate 1.6.0 launchers; never start the service.

Usage: python3 prepare-node24221.py /absolute/node-v24.22.1-linux-x64.tar.xz
Download the archive from ARCHIVE_URL first. The official HTTPS checksum is
pinned here; this helper does not claim to verify a GPG signature. Existing
Node, launchers, logs, Manager settings and checkpoint are never modified.
On failure inspect any partial preparation before retrying; nothing is replaced.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import tarfile
import tempfile

VERSION = 'v24.22.1'
ARCHIVE_URL = 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz'
RELEASE_URL = 'https://nodejs.org/en/blog/release/v24.22.1/'
ARCHIVE_SHA256 = '6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6'
ARCHIVE_BYTES = 32026916
MEMBER = 'node-v24.22.1-linux-x64/bin/node'
NODE_SHA256 = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_BYTES = 126879696
OLD_NODE_SHA256 = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
PRIVATE = Path('/srv/customer/jessiemessage-private')
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-160-9590741e')
SOURCE = '9590741e7065067aee9d1ad5d1206739cc27eb6b'
TREE = '38e72545ab4fd6feb4a04e934b2eb8685f82b970'
OLD_RUNTIME = 'runtime-node-v24.22.0'
RUNTIME = 'runtime-node-v24.22.1'
LAUNCHERS = (
    ('start-primary-release160-9590741e.sh', '39015e53147112981203b5172f11f52563311be7e92a92f2b78bf4dca744f1b4',
     'start-primary-release160-node24221-9590741e.sh', 'jm160-node2422.log', 'jm160-node24221.log', 'start-local-closures'),
    ('check-primary-release160-9590741e.sh', '13362ac14caa4795a4fbf3ee3fc50e94188938179c1cde119d6d968427a50971',
     'check-primary-release160-node24221-9590741e.sh', 'jm160-preflight-9590741e.log', 'jm160-preflight-node24221-9590741e.log', 'check-local-closures'),
)


def require(ok, label):
    if not ok:
        raise RuntimeError(label)


def digest_file(file):
    value = hashlib.sha256()
    while chunk := file.read(262144):
        value.update(chunk)
    return value.hexdigest()


def regular(path, mode=None):
    require(path.is_absolute() and path.resolve(strict=True) == path, 'file_path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid()
                and value.st_nlink == 1 and not value.st_mode & 0o022
                and (mode is None or stat.S_IMODE(value.st_mode) == mode), 'file_metadata:' + path.name)
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise


def source_check(checkout):
    require(checkout.resolve(strict=True) == checkout, 'checkout_path')
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0')
    def git(*args):
        return subprocess.check_output(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
            '-c', 'core.hooksPath=/dev/null', '-C', str(checkout), *args], env=env, text=True).strip()
    require(git('rev-parse', 'HEAD') == SOURCE and git('rev-parse', 'HEAD^{tree}') == TREE
            and not git('status', '--porcelain', '--untracked-files=normal'), 'checkout_identity')
    require(json.loads((checkout / 'package.json').read_text())['version'] == '1.6.0', 'application_version')


def launcher_plans(private):
    plans = []
    old_node = str(private / OLD_RUNTIME / 'bin/node')
    new_node = str(private / RUNTIME / 'bin/node')
    for old_name, pin, new_name, old_log, new_log, command in LAUNCHERS:
        with regular(private / old_name, 0o700) as file:
            content = file.read()
        require(hashlib.sha256(content).hexdigest() == pin, 'launcher_hash:' + old_name)
        text = content.decode('utf-8')
        require(text.count(old_node) == 3 and text.count(old_log) == 1
                and text.count(command) == 1 and SOURCE in text and TREE in text
                and str(CHECKOUT) in text, 'launcher_shape:' + old_name)
        text = text.replace(old_node, new_node).replace(old_log, new_log)
        # The observed 1.6.0 launchers bind both the version and binary digest.
        for before, after in ((OLD_NODE_SHA256, NODE_SHA256), ('v24.22.0', VERSION)):
            require(text.count(before) == 1, 'launcher_pin_count:' + old_name)
            text = text.replace(before, after)
        require('v24.22.0' not in text and OLD_NODE_SHA256 not in text, 'old_node_pin')
        subprocess.run(['/bin/bash', '-n'], input=text.encode(), check=True, stdout=subprocess.DEVNULL)
        plans.append((new_name, text.encode(), 0o700))
        plans.append((new_log, b'', 0o600))
    return plans


def write_exclusive(path, content, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())


def publish_directory(root_fd, stage_name, target_name):
    # Linux-only preparation: RENAME_NOREPLACE also refuses a raced empty directory.
    rename = ctypes.CDLL(None, use_errno=True).renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(root_fd, os.fsencode(stage_name), root_fd, os.fsencode(target_name), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def prepare(archive, private=PRIVATE, checkout=CHECKOUT):
    require(platform.system() == 'Linux' and platform.machine() in ('x86_64', 'amd64'), 'linux_x64_required')
    require(private.is_absolute() and private.resolve(strict=True) == private, 'private_path')
    helper_repository = Path(__file__).resolve().parents[1]
    require(not private.is_relative_to(checkout)
            and not ((helper_repository / '.git').exists() and private.is_relative_to(helper_repository))
            and not (private / '.git').exists(), 'private_outside_checkout')
    root_fd = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root_stat = os.fstat(root_fd)
        require(root_stat.st_uid == os.getuid() and stat.S_IMODE(root_stat.st_mode) == 0o700, 'private_metadata')
        def unchanged_root():
            current = private.lstat()
            require(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino)
                    == (root_stat.st_dev, root_stat.st_ino), 'private_replaced')
        source_check(checkout)
        with regular(private / OLD_RUNTIME / 'bin/node', 0o700) as file:
            require(digest_file(file) == OLD_NODE_SHA256, 'old_node_hash')
        plans = launcher_plans(private)
        for name in [RUNTIME, *(value[0] for value in plans)]:
            require(not os.path.lexists(private / name), 'existing_output:' + name)
        with regular(archive) as file:
            require(os.fstat(file.fileno()).st_size == ARCHIVE_BYTES and digest_file(file) == ARCHIVE_SHA256,
                    'archive_checksum')
            file.seek(0)
            with tempfile.TemporaryDirectory(prefix='.node24221-', dir=private) as temporary:
                stage = Path(temporary)
                (stage / 'bin').mkdir(mode=0o700)
                node = stage / 'bin/node'
                with tarfile.open(fileobj=file, mode='r:xz') as distribution:
                    members = [value for value in distribution if value.name == MEMBER]
                    require(len(members) == 1 and members[0].isreg() and members[0].size == NODE_BYTES,
                            'archive_node_member')
                    with distribution.extractfile(members[0]) as source:
                        fd = os.open(node, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o700)
                        with os.fdopen(fd, 'wb') as output:
                            while chunk := source.read(262144):
                                output.write(chunk)
                            output.flush()
                            os.fsync(output.fileno())
                with regular(node, 0o700) as binary:
                    require(digest_file(binary) == NODE_SHA256, 'node_checksum')
                env = {key: value for key, value in os.environ.items() if key not in ('NODE_OPTIONS', 'NODE_PATH')}
                require(subprocess.check_output([str(node), '--version'], env=env, cwd='/',
                        stdin=subprocess.DEVNULL, timeout=15, text=True).strip() == VERSION, 'node_version')
                for directory in (stage / 'bin', stage):
                    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                unchanged_root()
                publish_directory(root_fd, stage.name, RUNTIME)
                os.fsync(root_fd)
        for name, content, mode in plans:
            unchanged_root()
            write_exclusive(private / name, content, mode)
        os.fsync(root_fd)
        unchanged_root()
        source_check(checkout)
        # Recheck originals after all writes; no operation runs their contents.
        launcher_plans(private)
        with regular(private / OLD_RUNTIME / 'bin/node', 0o700) as file:
            require(digest_file(file) == OLD_NODE_SHA256, 'final_old_node_hash')
        with regular(private / RUNTIME / 'bin/node', 0o700) as file:
            require(digest_file(file) == NODE_SHA256, 'final_node_hash')
        for name, content, mode in plans:
            with regular(private / name, mode) as file:
                require(file.read() == content, 'final_output:' + name)
        return dict(status='node24221_prepared_not_started', source=SOURCE, tree=TREE, applicationVersion='1.6.0',
            nodeVersion=VERSION, nodeBinary=str(private / RUNTIME / 'bin/node'), nodeBinarySha256=NODE_SHA256,
            archiveSha256=ARCHIVE_SHA256, archiveBytes=ARCHIVE_BYTES, signatureVerified=False,
            files=[dict(path=str(private / name), sha256=hashlib.sha256(content).hexdigest(), mode=f'{mode:04o}')
                   for name, content, mode in plans], precheckPassed=False, runtimeStarted=False,
            managerChanged=False, checkpointChanged=False, migrated=False, noRestart=True,
            preservedNode=str(private / OLD_RUNTIME / 'bin/node'),
            preservedLaunchers=[str(private / value[0]) for value in LAUNCHERS])
    finally:
        os.close(root_fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.archive), separators=(',', ':')))
    except Exception as error:
        raise SystemExit('NODE_PREPARATION_REFUSED: ' + str(error))
