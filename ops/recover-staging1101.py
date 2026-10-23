#!/usr/bin/env python3
"""Complete only a fully verified1101 candidate refused for inherited setgid."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import types
import urllib.request

OPERATOR = 'e5dbfc124a8169a551285d4feb15b827edf07e58'
PINS = {'prepare-release1101.py': '6682282bb938aa91578410d4dd317c631172b6ee71c6cadf31063995e1169608',
        'release1101-dependencies.py': '293f06004d79d9b32a891473c7514b74eda58e5798f083561540a0108c58806b'}
PHASE = 'pinned_tools'


class RecoveryRefused(Exception):
    pass


def require(ok, label):
    if not ok:
        raise RecoveryRefused(label)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RecoveryRefused('pinned_tool_redirect')


def load_tools():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    contents = {}
    for filename, pin in PINS.items():
        url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/' + OPERATOR + '/ops/' + filename
        with opener.open(url, timeout=20) as response:
            value = response.read(262145)
            require(response.status == 200 and response.url == url and len(value) <= 262144, 'pinned_tool_download')
        require(digest(value) == pin, 'pinned_tool_hash')
        contents[filename] = value
    result = []
    for name, value in contents.items():
        module = types.ModuleType('pinned_recovery_' + name)
        exec(compile(value, '<pinned-1101>', 'exec'), module.__dict__)
        result.append(module)
    return result


def validate_dependencies(oldroot, newroot, old_lock, new_lock, old_lock_bytes, new_lock_bytes, archive, dependencies):
    before = dependencies.dependency_inventory(oldroot)
    current = dependencies.dependency_inventory(newroot)
    dependencies.verify_installed(oldroot, old_lock); dependencies.verify_installed(newroot, new_lock)
    outside = lambda rows: [row for row in rows if row['path'] != '.package-lock.json' and row['path'] != 'nodemailer' and not row['path'].startswith('nodemailer/')]
    require(outside(before['entries']) == outside(current['entries']), 'outside_dependency_difference')
    expected = {'nodemailer': ('directory', None)}
    for relative, value in dependencies.archive_files(archive):
        path = Path('nodemailer') / relative
        for parent in path.parents:
            if parent.as_posix() != '.': expected[parent.as_posix()] = ('directory', None)
        expected[path.as_posix()] = ('directory', None) if value is None else ('file', digest(value))
    leaf = {row['path']: row for row in current['entries'] if row['path'] == 'nodemailer' or row['path'].startswith('nodemailer/')}
    require(set(leaf) == set(expected), 'nodemailer_paths_difference')
    for path, (kind, fingerprint) in expected.items():
        row = leaf[path]
        require(row['type'] == kind, 'nodemailer_entry_type')
        require(row['mode'] in (0o700, 0o2700) if kind == 'directory' else row['mode'] == 0o600, 'nodemailer_entry_mode')
        if kind == 'file': require(row['sha256'] == fingerprint, 'nodemailer_bytes_difference')
    old_hidden, new_hidden = oldroot / '.package-lock.json', newroot / '.package-lock.json'
    require(old_hidden.exists() == new_hidden.exists(), 'hidden_lock_presence')
    if old_hidden.exists():
        expected_hidden = dependencies.normalized_hidden_lock(dependencies.read_stable(old_hidden), old_lock, new_lock)
        require(dependencies.read_stable(new_hidden) == expected_hidden, 'hidden_lock_difference')
    require((oldroot.stat().st_dev, oldroot.stat().st_ino) != (newroot.stat().st_dev, newroot.stat().st_ino), 'dependency_root_alias')
    for row in current['entries']:
        if row['type'] != 'file': continue
        info = (newroot / row['path']).lstat()
        require(info.st_nlink == 1 and info.st_uid == os.getuid() and stat.S_ISREG(info.st_mode), 'candidate_file_metadata')
        oldpath = oldroot / row['path']
        if oldpath.exists() and not oldpath.is_symlink():
            prior = oldpath.stat()
            require((info.st_dev, info.st_ino) != (prior.st_dev, prior.st_ino), 'candidate_hardlink_to_active')
    require(dependencies.dependency_inventory(oldroot) == before, 'active_dependencies_changed')
    return dict(strategy=dependencies.STRATEGY, oldLockSha256=digest(old_lock_bytes), newLockSha256=digest(new_lock_bytes),
        tarballIntegrity=dependencies.INTEGRITY, oldTreeSha256=before['sha256'], newTreeSha256=current['sha256'])


def normalize_root(newroot, expected):
    require(newroot.resolve(strict=True) == newroot and not newroot.is_symlink(), 'candidate_root_path')
    fd = os.open(newroot, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd); visible = newroot.lstat()
        fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        require(all(getattr(before, field) == getattr(expected, field) == getattr(visible, field) for field in fields), 'candidate_root_changed')
        require(before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o2700, 'candidate_root_not_sgid2700')
        os.fchmod(fd, 0o700); os.fsync(fd)
        after = os.fstat(fd); visible = newroot.lstat()
        require(stat.S_IMODE(after.st_mode) == stat.S_IMODE(visible.st_mode) == 0o700
            and all(getattr(after, field) == getattr(before, field) == getattr(visible, field) for field in ('st_dev', 'st_ino', 'st_uid', 'st_gid')), 'candidate_root_normalization_unconfirmed')
    finally:
        os.close(fd)


def checkout_paths(prepare, plan):
    tracked = set(prepare.git(plan['checkout'], 'ls-files', '-z').split('\0')) - {''}
    expected = tracked | {'.git'}
    actual = set()
    for parent, directories, files in os.walk(plan['checkout'], followlinks=False):
        relative = Path(parent).relative_to(plan['checkout'])
        if relative == Path('.') and 'node_modules' in directories: directories.remove('node_modules')
        require(not any((Path(parent) / name).is_symlink() for name in directories), 'candidate_directory_symlink')
        for name in files: actual.add((relative / name).as_posix())
    require(actual == expected, 'candidate_untracked_or_ignored_files')


def make_receipt(prepare, plan, dependency_receipt):
    return dict(format='jessiemessage-release1101-staging', version=1, status='release1101_sources_staged_not_qualified',
        release='1.10.1', source=prepare.RELEASE_SOURCE, tree=prepare.RELEASE_TREE, checkout=str(plan['checkout']),
        launcher=str(plan['start']), launcherSha256=digest(plan['startBytes']), launcherMode='0700',
        checkLauncher=str(plan['check']), checkLauncherSha256=digest(plan['checkBytes']), checkLauncherMode='0700',
        log=str(plan['log']), logMode='0600', logSha256=digest(b''), precheckLog=str(plan['prelog']), precheckLogMode='0600', precheckLogSha256=digest(b''),
        nodeVersion=prepare.NODE_VERSION, nodeBinarySha256=prepare.NODE_PIN, profile=prepare.PROFILE,
        expectedActiveServiceVersion='1.10.0', priorActivePreserved=True, videoConfigurationDirectory=str(prepare.PRIVATE / 'runtime-video-180'),
        operationsDirectory=str(prepare.PRIVATE / 'recurring-backup-052'), existingConfigurationUntouched=True,
        baselineMigrationFiles=33, schemaMigrationsExpected=38, applicationTablesExpected=37, experienceEnabled=True,
        experienceMigrationFiles=2, experienceMigrationsIdentical=True, normalMigrationsPreserved=True, videoMigrationsIdentical=True,
        sqlStatusChecked=False, configurationPrepared=False, hostedQualified=False, precheckPassed=False, started=False,
        migrated=False, runtimeStarted=False, noRestart=True, managerChanged=False, checkpointChanged=False,
        preservedActiveCheckpointSha256=prepare.CHECKPOINT_PIN, priorActiveStagingSha256=prepare.BASE_STAGING_SHA,
        dependencies=dependency_receipt, nextCheckCommand='bash ' + str(plan['check']))


def recover(tools=None, archive=None):
    global PHASE
    prepare, dependencies = load_tools() if tools is None else tools
    plan = prepare.release_plan(prepare.RELEASE_SOURCE, prepare.RELEASE_TREE)
    receipt_path = prepare.PRIVATE / 'jm1101-staging.json'
    node = prepare.PRIVATE / 'runtime-node-v24.22.1/bin/node'
    old_start = prepare.PRIVATE / 'start-primary-release1100-51b0cf22.sh'; old_check = prepare.PRIVATE / 'check-primary-release1100-51b0cf22.sh'
    pins = [(prepare.PRIVATE / 'jm0702-existing-pc-update.json', 0o600, prepare.CHECKPOINT_PIN),
        (prepare.PRIVATE / 'jm1100-staging.json', 0o600, prepare.BASE_STAGING_SHA),
        (old_start, 0o700, prepare.START_PIN), (old_check, 0o700, prepare.CHECK_PIN), (node, 0o700, prepare.NODE_PIN)]
    def recheck(expected_dependencies=None):
        prepare.private_directory(prepare.PRIVATE); prepare.absent(receipt_path)
        for path, mode, pin in pins: require(prepare.regular(path, mode, digest_only=True) == pin, 'active_pin_changed')
        prepare.source(prepare.BASE_CHECKOUT, prepare.BASE_SOURCE, prepare.BASE_TREE)
        if expected_dependencies is not None:
            require((prepare.BASE_CHECKOUT / 'node_modules').resolve(strict=True) == expected_dependencies, 'active_dependency_link_changed')
        prepare.source(plan['checkout'], prepare.RELEASE_SOURCE, prepare.RELEASE_TREE); checkout_paths(prepare, plan)
        for name in ('log', 'prelog'): require(prepare.regular(plan[name], 0o600) == b'', 'candidate_log_not_empty')
    PHASE = 'existing_candidate_pins'; recheck()
    oldroot = (prepare.BASE_CHECKOUT / 'node_modules').resolve(strict=True); newroot = plan['checkout'] / 'node_modules'
    initial = newroot.lstat()
    require(newroot.resolve(strict=True) == newroot and stat.S_ISDIR(initial.st_mode) and initial.st_uid == os.getuid()
        and stat.S_IMODE(initial.st_mode) == 0o2700, 'candidate_root_not_sgid2700')
    plan['startBytes'] = prepare.launcher(prepare.regular(old_start, 0o700), plan, check=False)
    plan['checkBytes'] = prepare.launcher(prepare.regular(old_check, 0o700), plan, check=True)
    for name in ('start', 'check'): require(prepare.regular(plan[name], 0o700) == plan[name + 'Bytes'], 'candidate_launcher_difference')
    PHASE = 'source_lock_and_migrations'
    old_bytes = prepare.source_blob(prepare.BASE_SOURCE, 'package-lock.json'); new_bytes = prepare.source_blob(prepare.RELEASE_SOURCE, 'package-lock.json')
    old_lock, new_lock = json.loads(old_bytes), json.loads(new_bytes)
    dependencies.validate_lock_transition(json.loads(prepare.source_blob(prepare.BASE_SOURCE, 'package.json')), old_lock,
        json.loads(prepare.source_blob(prepare.RELEASE_SOURCE, 'package.json')), new_lock)
    for directory, count in [('db/migrations', 33), ('server/video/migrations', 3), ('server/experience/migrations', 2)]:
        before, after = (prepare.migration_inventory(sha, directory) for sha in (prepare.BASE_SOURCE, prepare.RELEASE_SOURCE))
        require(len(before) == count and before == after, 'migration_inventory_difference')
    PHASE = 'existing_dependencies_exact'
    archive = dependencies.download_archive() if archive is None else archive
    dependency_receipt = validate_dependencies(oldroot, newroot, old_lock, new_lock, old_bytes, new_bytes, archive, dependencies)
    require(prepare.command([str(node), '--version'], timeout=10).decode().strip() == prepare.NODE_VERSION, 'node_version_difference')
    module_check = "const {createRequire}=require('node:module');const path=require('node:path');const r=createRequire(path.join(process.argv[1],'package.json'));const p=r.resolve('nodemailer/package.json');if(!p.startsWith(process.argv[1]+'/node_modules/nodemailer/')||r('nodemailer/package.json').version!=='10.1.4')process.exit(1);"
    prepare.command([str(node), '-e', module_check, str(plan['checkout'])], timeout=10)
    PHASE = 'last_prewrite_validation'; recheck(oldroot)
    for name in ('start', 'check'): require(prepare.regular(plan[name], 0o700) == plan[name + 'Bytes'], 'candidate_launcher_changed')
    require(dependencies.dependency_inventory(oldroot)['sha256'] == dependency_receipt['oldTreeSha256']
        and dependencies.dependency_inventory(newroot)['sha256'] == dependency_receipt['newTreeSha256'], 'dependencies_changed')
    PHASE = 'normalize_only_new_dependency_root'; normalize_root(newroot, initial)
    prepare.private_directory(newroot)
    PHASE = 'post_normalization_validation'; recheck(oldroot)
    for name in ('start', 'check'): require(prepare.regular(plan[name], 0o700) == plan[name + 'Bytes'], 'candidate_launcher_changed')
    require(dependencies.dependency_inventory(oldroot)['sha256'] == dependency_receipt['oldTreeSha256']
        and dependencies.dependency_inventory(newroot)['sha256'] == dependency_receipt['newTreeSha256'], 'dependencies_changed')
    PHASE = 'write_only_staging_receipt'
    receipt = make_receipt(prepare, plan, dependency_receipt)
    content = (json.dumps(receipt, sort_keys=True, separators=(',', ':')) + '\n').encode()
    prepare.write_exclusive(receipt_path, content, 0o600)
    return dict(receipt, receipt=str(receipt_path), receiptSha256=digest(content))


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'usage')
        print(json.dumps(recover(), separators=(',', ':')))
    except Exception as error:
        value = str(error)
        safe = value if re.fullmatch(r'[a-z][a-z0-9_]{0,80}(?::[a-zA-Z0-9_.-]{1,80})?', value) else 'operation_not_confirmed'
        kind = type(error).__name__
        if kind not in ('RecoveryRefused', 'StagingRefused', 'DependencyRefused', 'FileNotFoundError', 'PermissionError', 'OSError', 'HTTPError', 'URLError', 'TimeoutError'):
            kind = 'UnexpectedError'
        print(json.dumps(dict(status='release1101_recovery_not_confirmed', phase=PHASE, code=safe, errorType=kind, noCheck=True,
            noRestart=True, noAutomaticRetry=True), separators=(',', ':')))
        raise SystemExit(1)
