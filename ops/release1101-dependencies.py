"""Narrow dependency transition1100 ->1101; no npm or install scripts.

Only the locked Nodemailer leaf changes. The previous installed tree is read,
copied without hardlinks, and rechecked; it is never modified.
"""
import base64
import copy
import hashlib
import hmac
import io
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import ssl
import stat
import tarfile
import urllib.request

VERSION = '10.1.4'
URL = 'https://registry.npmjs.org/nodemailer/-/nodemailer-10.1.4.tgz'
INTEGRITY = 'sha512-EsMnOR2oRv4LGnWvHgcVYkkQ4O2j8KO4WTw6l+PHR4sOXo8SAgIraxtEnGDmotjbhv0hDsu3IuDIFZm8iXwO4A=='
LEAF = 'node_modules/nodemailer'
STRATEGY = 'private-copy-replace-locked-leaf'
MAX_ARCHIVE = 2 * 1024 * 1024
MAX_EXPANDED = 8 * 1024 * 1024
MAX_MEMBERS = 512
DISK_MARGIN = 128 * 1024 * 1024


class DependencyRefused(Exception):
    pass


def require(value, code):
    if not value:
        raise DependencyRefused(code)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def validate_lock_transition(old_package, old_lock, new_package, new_lock):
    require(old_lock.get('lockfileVersion') == new_lock.get('lockfileVersion') == 3, 'dependency_lock_format')
    for package, lock, version in ((old_package, old_lock, '1.10.0'), (new_package, new_lock, '1.10.1')):
        require(package.get('name') == lock.get('name') == 'jessiemessage', 'dependency_package_name')
        require(package.get('version') == lock.get('version') == lock.get('packages', {}).get('', {}).get('version') == version,
                'dependency_package_version')
        require(package.get('dependencies') == lock['packages'][''].get('dependencies'), 'dependency_package_map')
    old_leaf, new_leaf = old_lock['packages'].get(LEAF), new_lock['packages'].get(LEAF)
    require(isinstance(old_leaf, dict) and old_leaf.get('version') == '10.1.1', 'dependency_old_leaf')
    require(isinstance(new_leaf, dict) and new_leaf == dict(version=VERSION, resolved=URL, integrity=INTEGRITY,
            license='MIT-0', engines={'node': '>=20.0.0'}), 'dependency_new_leaf')
    require(old_package['dependencies'].get('nodemailer') == '10.1.1'
            and new_package['dependencies'].get('nodemailer') == VERSION, 'dependency_root_leaf')
    normalized = copy.deepcopy(new_lock)
    normalized['version'] = old_lock['version']
    normalized['packages']['']['version'] = old_lock['packages']['']['version']
    normalized['packages']['']['dependencies']['nodemailer'] = '10.1.1'
    normalized['packages'][LEAF] = old_leaf
    require(normalized == old_lock, 'dependency_other_lock_changed')


def fingerprint(value):
    return tuple(getattr(value, name) for name in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def read_stable(path):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and not before.st_mode & 0o022,
            'dependency_file_metadata')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        first = os.fstat(stream.fileno())
        require(fingerprint(before) == fingerprint(first), 'dependency_file_changed')
        content = stream.read()
        require(fingerprint(first) == fingerprint(os.fstat(stream.fileno())) == fingerprint(path.lstat()),
                'dependency_file_changed')
    return content


def dependency_inventory(directory):
    directory = Path(directory)
    root = directory.lstat()
    require(directory.is_absolute() and directory.resolve(strict=True) == directory
            and stat.S_ISDIR(root.st_mode) and root.st_uid == os.getuid() and not root.st_mode & 0o022,
            'dependency_directory')
    entries, size, files = [], 0, 0

    def walk(parent):
        nonlocal size, files
        before = parent.lstat()
        require(stat.S_ISDIR(before.st_mode) and before.st_uid == os.getuid() and not before.st_mode & 0o022,
                'dependency_directory_metadata')
        for path in sorted(parent.iterdir()):
            relative = path.relative_to(directory).as_posix()
            require(not any(ord(char) < 32 for char in relative), 'dependency_entry_name')
            info = path.lstat()
            require(info.st_uid == os.getuid() and (stat.S_ISLNK(info.st_mode) or not info.st_mode & 0o022), 'dependency_entry_metadata')
            mode = stat.S_IMODE(info.st_mode)
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                require(target and not os.path.isabs(target), 'dependency_external_symlink')
                resolved = path.resolve(strict=True)
                require(resolved.is_relative_to(directory) and fingerprint(info) == fingerprint(path.lstat()),
                        'dependency_external_symlink')
                entries.append(dict(path=relative, type='symlink', mode=mode, target=target))
            elif stat.S_ISDIR(info.st_mode):
                entries.append(dict(path=relative, type='directory', mode=mode))
                walk(path)
            elif stat.S_ISREG(info.st_mode):
                content = read_stable(path)
                entries.append(dict(path=relative, type='file', mode=mode, size=len(content), sha256=sha256(content)))
                size += len(content); files += 1
            else:
                require(False, 'dependency_special_file')
        require(fingerprint(before) == fingerprint(parent.lstat()), 'dependency_directory_changed')

    walk(directory)
    return dict(entries=entries, sha256=sha256(canonical(entries)), bytes=size, files=files)


def verify_installed(directory, lock):
    directory = Path(directory)
    for name, expected in lock['packages']['']['dependencies'].items():
        path = directory / name / 'package.json'
        require(path.resolve(strict=True).is_relative_to(directory), 'dependency_manifest_path')
        manifest = json.loads(read_stable(path))
        require(manifest.get('name') == name and manifest.get('version') == expected, 'dependency_installed_version')


def archive_files(content):
    require(isinstance(content, bytes) and 0 < len(content) <= MAX_ARCHIVE, 'dependency_archive_size')
    require(hmac.compare_digest(hashlib.sha512(content).digest(), base64.b64decode(INTEGRITY.removeprefix('sha512-'), validate=True)),
            'dependency_archive_integrity')
    result, seen, expanded = [], set(), 0
    try:
        with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
            count = 0
            for member in archive:
                count += 1
                require(count <= MAX_MEMBERS, 'dependency_archive_members')
                path = PurePosixPath(member.name)
                require(member.name and not path.is_absolute() and '..' not in path.parts and '.' not in path.parts
                        and path.parts[0] == 'package' and path.as_posix() == member.name.rstrip('/')
                        and not any(ord(char) < 32 for char in member.name), 'dependency_archive_path')
                relative = Path(*path.parts[1:])
                name = relative.as_posix()
                require(name not in seen, 'dependency_archive_duplicate'); seen.add(name)
                require(member.isdir() or member.isfile(), 'dependency_archive_type')
                require(not member.isdir() or member.size == 0, 'dependency_archive_directory_size')
                if not path.parts[1:]:
                    require(member.isdir(), 'dependency_archive_root'); continue
                if member.isdir():
                    result.append((relative, None)); continue
                expanded += member.size
                require(0 <= member.size <= MAX_EXPANDED and expanded <= MAX_EXPANDED, 'dependency_archive_expanded')
                stream = archive.extractfile(member)
                value = stream.read(member.size + 1)
                require(len(value) == member.size, 'dependency_archive_content')
                result.append((relative, value))
            require(count > 0, 'dependency_archive_members')
    except DependencyRefused:
        raise
    except Exception:
        raise DependencyRefused('dependency_archive_invalid') from None
    manifests = [value for path, value in result if path.as_posix() == 'package.json']
    require(len(manifests) == 1 and manifests[0] is not None, 'dependency_archive_manifest')
    manifest = json.loads(manifests[0])
    require(manifest.get('name') == 'nodemailer' and manifest.get('version') == VERSION
            and manifest.get('engines') == {'node': '>=20.0.0'}, 'dependency_archive_manifest')
    require(not any(manifest.get(key) for key in ('dependencies', 'optionalDependencies', 'peerDependencies', 'bin', 'bundledDependencies', 'bundleDependencies')),
            'dependency_archive_not_leaf')
    require(not any(name in manifest.get('scripts', {}) for name in ('preinstall', 'install', 'postinstall')),
            'dependency_archive_install_script')
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise DependencyRefused('dependency_archive_redirect')


def download_archive():
    context = ssl.create_default_context(); context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
    with opener.open(urllib.request.Request(URL, headers={'User-Agent': 'JessieMessage-qualified-1101'}), timeout=20) as response:
        require(response.status == 200 and response.url == URL, 'dependency_archive_response')
        length = response.headers.get('Content-Length')
        require(length is None or length.isdigit() and int(length) <= MAX_ARCHIVE, 'dependency_archive_size')
        content = response.read(MAX_ARCHIVE + 1)
    archive_files(content)
    return content


def normalized_hidden_lock(content, old_lock, new_lock):
    value = json.loads(content)
    require(value.get('name') == 'jessiemessage' and isinstance(value.get('version'), str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', value['version'])
            and value.get('lockfileVersion') == 3 and isinstance(value.get('packages'), dict), 'dependency_hidden_lock')
    require(value['packages'].get(LEAF) == old_lock['packages'][LEAF], 'dependency_hidden_leaf')
    for name, record in value['packages'].items():
        require(name in old_lock['packages'] and record == old_lock['packages'][name], 'dependency_hidden_record')
    value['version'] = '1.10.1'; value['packages'][LEAF] = new_lock['packages'][LEAF]
    return canonical(value)


def copy_dependencies(source, target, old_lock, new_lock, content, *, old_lock_bytes, new_lock_bytes, disk_usage=shutil.disk_usage):
    source, target = Path(source), Path(target)
    require(json.loads(old_lock_bytes) == old_lock and json.loads(new_lock_bytes) == new_lock, 'dependency_lock_bytes')
    require(not target.exists() and not target.is_symlink() and target.parent.resolve(strict=True) == target.parent,
            'dependency_target_exists')
    before = dependency_inventory(source); verify_installed(source, old_lock)
    files = archive_files(content)
    require(disk_usage(target.parent).free >= before['bytes'] + MAX_EXPANDED + DISK_MARGIN, 'dependency_disk_space')
    hidden = source / '.package-lock.json'
    hidden_content = normalized_hidden_lock(read_stable(hidden), old_lock, new_lock) if hidden.exists() else None
    target.mkdir(mode=0o700)
    # Each source file is opened without following a replacement symlink. No
    # hardlink can cause a later leaf replacement to affect the live tree.
    for record in before['entries']:
        relative = Path(record['path']); destination = target / relative
        if record['type'] == 'directory':
            destination.mkdir(mode=record['mode']); destination.chmod(record['mode'])
        elif record['type'] == 'symlink':
            destination.symlink_to(record['target'])
        else:
            value = read_stable(source / relative)
            require(sha256(value) == record['sha256'], 'dependency_copy_changed')
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, record['mode'])
            with os.fdopen(descriptor, 'wb') as stream:
                os.fchmod(stream.fileno(), record['mode'])
                stream.write(value); stream.flush(); os.fsync(stream.fileno())
            require((source / relative).stat().st_ino != destination.stat().st_ino
                    or (source / relative).stat().st_dev != destination.stat().st_dev, 'dependency_copy_hardlink')
    require(dependency_inventory(target) == before, 'dependency_copy_mismatch')
    leaf = target / 'nodemailer'
    require(leaf.is_dir() and not leaf.is_symlink() and leaf.resolve(strict=True).is_relative_to(target), 'dependency_leaf_path')
    shutil.rmtree(leaf)
    leaf.mkdir(mode=0o755)
    for relative, value in sorted(files, key=lambda item: (len(item[0].parts), item[0].as_posix())):
        destination = leaf / relative
        destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        if value is None:
            destination.mkdir(mode=0o755, exist_ok=True)
        else:
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(value); stream.flush(); os.fsync(stream.fileno())
    if hidden_content is not None:
        hidden_target = target / '.package-lock.json'
        descriptor = os.open(hidden_target, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(hidden_content); stream.flush(); os.fsync(stream.fileno())
    after = dependency_inventory(target); verify_installed(target, new_lock)
    outside = lambda inventory: [record for record in inventory['entries'] if record['path'] != '.package-lock.json'
                                 and record['path'] != 'nodemailer' and not record['path'].startswith('nodemailer/')]
    require(outside(before) == outside(after), 'dependency_other_copy_changed')
    require(dependency_inventory(source) == before, 'dependency_active_changed')
    return dict(strategy=STRATEGY, oldLockSha256=sha256(old_lock_bytes), newLockSha256=sha256(new_lock_bytes),
                tarballIntegrity=INTEGRITY, oldTreeSha256=before['sha256'], newTreeSha256=after['sha256'])
