#!/usr/bin/env python3
"""Stage the pinned 1.9.0 checkout and launchers from active 1.8.4; run neither.

Usage: python3 prepare-release190.py SOURCE190 TREE190
The release pins below identify the exact main source qualified by CI.
Schema38 CHECK must follow a separately guarded SQL36-to38 upgrade.
Old184/172 launchers are not a rollback after migration.
No SQL, configuration, key, checkpoint, Manager or runtime action occurs.
Existing partial output is preserved and refuses an automatic retry.
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
BASE_CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-184-1a41e08a')
BASE_SOURCE = '1a41e08abc87c3a29d9163fbf8cd2342eb04693c'
BASE_TREE = 'e0964b50c03d3881d851f01f86f58777d22b2c10'
RELEASE_SOURCE = '5dda0dd4453d34a0be839d2a1402301dea835381'
RELEASE_TREE = 'f06a140e738f20994425c714a278b0646f651c1b'
ROLLBACK185_SOURCE = '7a40de9742bdbedc5c0829d820882ca08bf23a91'
ROLLBACK185_TREE = '7ec449cb3a63a091c5233993923ceb69f8314366'
START_PIN = '3e564f1a61d102c53644b9e3449488c183b7321f164321ed915accdce9074473'
CHECK_PIN = 'db74a9fb9d608c46cae09c89da69c0c335ba9679bfc9ad111b212b59c0a45daf'
NODE_PIN = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
NODE_VERSION = 'v24.22.1'
CHECKPOINT_PIN = '3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212'
PROFILE = 'photos-notify-recovery-crm-broadcast-video'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')
EXPERIENCE_DDL = ('0037_profile_preferences.sql', '0038_reply_tracking.sql')
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
    require(all(Path(name).parent.as_posix() == directory and name.endswith('.sql') for name in names),
            'migration_inventory')
    return [(Path(name).name, fingerprint(source_blob(sha, name))) for name in names]


def release_plan(sha, tree, version='1.9.0'):
    require(version in ('1.8.5', '1.9.0'), 'release_plan_version')
    short, number = sha[:8], version.replace('.', '')
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
    require(text.count(operation) == 1 and opposite not in text, 'launcher_command')
    require(text.count('--profile') == 1 and text.count('--profile ' + PROFILE) == 1,
            'launcher_profile')
    require('--experience' not in text, 'launcher_experience_already_present')
    text = text.replace('--profile ' + PROFILE, '--profile ' + PROFILE + ' --experience 1')
    replacements = ((BASE_SOURCE, plan['sha']), (BASE_TREE, plan['tree']),
                    (str(BASE_CHECKOUT), str(plan['checkout'])),
                    (str(PRIVATE / ('jm184-preflight-node24221-1a41e08a.log' if check else 'jm184-node24221.log')),
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


def stage(sha190, tree190):
    require(SHA.fullmatch(RELEASE_SOURCE) and SHA.fullmatch(RELEASE_TREE), 'release190_pins_pending')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in (sha190, tree190)), 'input_identity')
    require((sha190, tree190) == (RELEASE_SOURCE, RELEASE_TREE), 'release190_pinned_identity')
    require(sha190 != BASE_SOURCE, 'distinct_sources')
    rollback = (ROLLBACK185_SOURCE, ROLLBACK185_TREE) != ('QUALIFICATION_PENDING', 'QUALIFICATION_PENDING')
    if rollback:
        require(all(SHA.fullmatch(value) for value in (ROLLBACK185_SOURCE, ROLLBACK185_TREE)), 'rollback185_pins_pending')
        require(ROLLBACK185_SOURCE not in (BASE_SOURCE, sha190), 'distinct_rollback_source')
    private_directory(PRIVATE)
    checkpoint_path = PRIVATE / 'jm0702-existing-pc-update.json'
    checkpoint_bytes = regular(checkpoint_path, 0o600)
    require(fingerprint(checkpoint_bytes) == CHECKPOINT_PIN, 'active_checkpoint_hash')
    receipt_path = PRIVATE / 'jm190-staging.json'
    absent(receipt_path)
    if rollback: absent(PRIVATE / 'jm185-staging.json')
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    old_start = PRIVATE / 'start-primary-release184-1a41e08a.sh'
    old_check = PRIVATE / 'check-primary-release184-1a41e08a.sh'
    start_bytes, check_bytes = regular(old_start, 0o700), regular(old_check, 0o700)
    require(fingerprint(start_bytes) == START_PIN and fingerprint(check_bytes) == CHECK_PIN, 'active_launcher_hash')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'node_hash')
    require(command([str(node), '--version'], timeout=10).decode().strip() == NODE_VERSION, 'node_version')
    plan = release_plan(sha190, tree190)
    plans = ([release_plan(ROLLBACK185_SOURCE, ROLLBACK185_TREE, '1.8.5')] if rollback else []) + [plan]
    for selected in plans:
        for name in ('checkout', 'start', 'check', 'log', 'prelog'): absent(selected[name])
    git(BASE_CHECKOUT, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
        'refs/heads/main:refs/remotes/origin/main', 'refs/tags/v1.9.0:refs/tags/v1.9.0',
        *(['refs/tags/v1.8.5:refs/tags/v1.8.5'] if rollback else []))
    require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v1.9.0^{commit}') == sha190, 'tag_identity')
    require(git(BASE_CHECKOUT, 'rev-parse', sha190 + '^{tree}') == tree190, 'tag_tree')
    for before, after in ((BASE_SOURCE, sha190), (sha190, 'refs/remotes/origin/main')):
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', before, after)
    if rollback:
        require(git(BASE_CHECKOUT, 'rev-parse', 'refs/tags/v1.8.5^{commit}') == ROLLBACK185_SOURCE, 'rollback_tag_identity')
        require(git(BASE_CHECKOUT, 'rev-parse', ROLLBACK185_SOURCE + '^{tree}') == ROLLBACK185_TREE, 'rollback_tree')
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', BASE_SOURCE, ROLLBACK185_SOURCE)
        git(BASE_CHECKOUT, 'merge-base', '--is-ancestor', ROLLBACK185_SOURCE, sha190)
    identities = [(BASE_SOURCE, '1.8.4')] + ([(ROLLBACK185_SOURCE, '1.8.5')] if rollback else []) + [(sha190, '1.9.0')]
    locks = []
    for sha, version in identities:
        package = json.loads(source_blob(sha, 'package.json'))
        lock = json.loads(source_blob(sha, 'package-lock.json'))
        require(package['version'] == lock['version'] == lock['packages']['']['version'] == version, 'package_versions')
        require(package.get('dependencies') == lock['packages'][''].get('dependencies'), 'package_dependencies')
        del lock['version']; del lock['packages']['']['version']; locks.append(lock)
        require(not git(BASE_CHECKOUT, 'ls-tree', sha, '--', 'node_modules'), 'tracked_dependencies')
    require(all(value == locks[0] for value in locks), 'locked_dependencies')
    normal = [migration_inventory(sha, 'db/migrations') for sha, _ in identities]
    require(len(normal[0]) == 33 and all(value == normal[0] for value in normal), 'normal_migrations_preserved')
    video = [migration_inventory(sha, 'server/video/migrations') for sha, _ in identities]
    require(tuple(name for name, _ in video[0]) == VIDEO_DDL and all(value == video[0] for value in video), 'video_migrations_identical')
    experience = migration_inventory(sha190, 'server/experience/migrations')
    require(tuple(name for name, _ in experience) == EXPERIENCE_DDL, 'experience_migration_inventory')
    if rollback: require(migration_inventory(ROLLBACK185_SOURCE, 'server/experience/migrations') == experience, 'rollback_experience_migrations_identical')
    deps = (BASE_CHECKOUT / 'node_modules').resolve(strict=True)
    require(deps.is_dir() and deps.stat().st_uid == os.getuid(), 'active_dependencies_directory')
    # Validate BOTH complete launcher plans, then recheck all pins before the first worktree.
    for selected in plans:
        selected['startBytes'] = launcher(start_bytes, selected, check=False)
        selected['checkBytes'] = launcher(check_bytes, selected, check=True)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    require(regular(old_start, 0o700) == start_bytes and regular(old_check, 0o700) == check_bytes,
            'active_launchers_changed')
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'prewrite_node_hash')
    require((BASE_CHECKOUT / 'node_modules').resolve(strict=True) == deps, 'prewrite_dependencies')
    require(regular(checkpoint_path, 0o600) == checkpoint_bytes, 'prewrite_checkpoint_changed')
    absent(receipt_path)
    if rollback: absent(PRIVATE / 'jm185-staging.json')
    for selected in plans:
        for name in ('checkout', 'start', 'check', 'log', 'prelog'): absent(selected[name])
    prior_umask = os.umask(0o077)
    try:
        for selected in plans:
            git(BASE_CHECKOUT, 'worktree', 'add', '--detach', str(selected['checkout']), selected['sha'])
            source(selected['checkout'], selected['sha'], selected['tree'])
            link = selected['checkout'] / 'node_modules'; absent(link)
            link.symlink_to(deps, target_is_directory=True)
            for name, content, mode in (('start', selected['startBytes'], 0o700), ('check', selected['checkBytes'], 0o700),
                                        ('log', b'', 0o600), ('prelog', b'', 0o600)):
                write_exclusive(selected[name], content, mode)
    finally:
        os.umask(prior_umask)
    source(BASE_CHECKOUT, BASE_SOURCE, BASE_TREE)
    require(fingerprint(regular(old_start, 0o700)) == START_PIN
            and fingerprint(regular(old_check, 0o700)) == CHECK_PIN, 'active_launchers_preserved')
    require(regular(node, 0o700, digest_only=True) == NODE_PIN, 'final_node_hash')
    require(regular(checkpoint_path, 0o600) == checkpoint_bytes, 'final_checkpoint_changed')
    for selected in plans:
        source(selected['checkout'], selected['sha'], selected['tree'])
        link = selected['checkout'] / 'node_modules'
        require(link.is_symlink() and link.resolve(strict=True) == deps, 'final_dependencies_link')
        require(regular(selected['start'], 0o700) == selected['startBytes']
                and regular(selected['check'], 0o700) == selected['checkBytes'], 'final_launchers')
        require(regular(selected['log'], 0o600) == regular(selected['prelog'], 0o600) == b'', 'logs_not_empty')
    receipt = dict(format='jessiemessage-release190-staging', version=1,
        status='release190_sources_staged_not_qualified', release='1.9.0', source=sha190, tree=tree190,
        checkout=str(plan['checkout']), launcher=str(plan['start']), launcherSha256=fingerprint(plan['startBytes']),
        launcherMode='0700', checkLauncher=str(plan['check']), checkLauncherSha256=fingerprint(plan['checkBytes']),
        checkLauncherMode='0700', log=str(plan['log']), logMode='0600', logSha256=fingerprint(b''),
        precheckLog=str(plan['prelog']), precheckLogMode='0600', precheckLogSha256=fingerprint(b''),
        nodeVersion=NODE_VERSION, nodeBinarySha256=NODE_PIN, profile=PROFILE,
        expectedActiveServiceVersion='1.8.4', priorActivePreserved=True,
        videoConfigurationDirectory=str(PRIVATE / 'runtime-video-180'),
        operationsDirectory=str(PRIVATE / 'recurring-backup-052'), existingConfigurationUntouched=True,
        baselineMigrationFiles=33, schemaMigrationsExpected=38, applicationTablesExpected=37,
        experienceEnabled=True, experienceMigrationFiles=2, normalMigrationsPreserved=True,
        videoMigrationsIdentical=True, sqlStatusChecked=False, configurationPrepared=False,
        hostedQualified=False, precheckPassed=False, started=False, migrated=False, runtimeStarted=False,
        noRestart=True, managerChanged=False, checkpointChanged=False,
        preservedActiveCheckpointSha256=CHECKPOINT_PIN,
        schemaUpgradeRequired=True, rollbackBeforeMigrationRelease='1.8.4', rollbackAfterMigrationQualified=False,
        restart184AfterMigrationAllowed=False, restart172AfterMigrationAllowed=False,
        nextAction='inspect_schema38_status_then_stop_service_before_upgrade',
        rollback185Prepared=rollback, rollback185HostedQualified=False,
        nextCheckCommand='bash ' + str(plan['check']))
    if rollback:
        selected = plans[0]; prepared = dict(receipt)
        prepared.update(format='jessiemessage-release185-staging', status='release185_sources_staged_not_qualified',
            release='1.8.5', source=selected['sha'], tree=selected['tree'], checkout=str(selected['checkout']),
            launcher=str(selected['start']), launcherSha256=fingerprint(selected['startBytes']),
            checkLauncher=str(selected['check']), checkLauncherSha256=fingerprint(selected['checkBytes']),
            log=str(selected['log']), precheckLog=str(selected['prelog']),
            preferencesEnabled=False, replyTrackingEnabled=False, nextCheckCommand='bash ' + str(selected['check']))
        rollback_bytes = (json.dumps(prepared, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
        write_exclusive(PRIVATE / 'jm185-staging.json', rollback_bytes, 0o600)
        receipt.update(rollback185Source=selected['sha'], rollback185Tree=selected['tree'],
            rollback185StagingReceiptSha256=fingerprint(rollback_bytes), rollback185CheckCommand='bash ' + str(selected['check']))
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
        print(json.dumps(dict(status='release190_staging_not_confirmed', code=code,
                             runtimeStarted=False, noAutomaticRetry=True), separators=(',', ':')), file=sys.stderr)
        sys.exit(1)
