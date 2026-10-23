#!/usr/bin/env python3
"""Bounded SQL36-to38 operator. No listener, Manager action or downgrade.

status reads the existing ledger. upgrade requires --service-stopped, takes a
durable attempt marker before SQL and refuses an automatic second attempt.
Credentials are entered locally on /dev/tty and sent only through Node stdin.
No command is usable until qualified source/tree and hosted staging are pinned.
"""
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import warnings

PRIVATE = Path('/srv/customer/jessiemessage-private')
OPERATOR = Path('/srv/customer/jessiemessage-operator')
SOURCE = '5dda0dd4453d34a0be839d2a1402301dea835381'
TREE = 'f06a140e738f20994425c714a278b0646f651c1b'
STAGING_SHA = '3a4788b4a31cac3d55f09950e3b98f99a700e0f0dd8af21f83a6135bd01d8cd0'
NODE_SHA = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb'
CHECKPOINT_SHA = '3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212'

# This library is executed unchanged in synthetic Node tests. The real main
# supplies only the existing migrate-stdin service and the reviewed plan38.
NODE_LIBRARY = r'''
async function migrate190(command, user, password, {configuration, run, loadPlan}) {
  const fail = () => {throw Object.assign(new Error('RELEASE190_SCHEMA_NOT_CONFIRMED'), {code:'RELEASE190_SCHEMA_NOT_CONFIRMED'});};
  if (!['status','upgrade'].includes(command) || !/^[a-zA-Z0-9_]{1,80}$/.test(user ?? '') || user === configuration.user) fail();
  const plan = await loadPlan();
  if (!Array.isArray(plan) || plan.length !== 38 || plan.some((row,index) => row.version !== index + 1)
    || plan[36].name !== '0037_profile_preferences.sql' || plan[37].name !== '0038_reply_tracking.sql') fail();
  const options = {command:'status', host:configuration.host, port:configuration.port,
    database:configuration.database, confirmation:configuration.database, user};
  configuration.password = '';
  const dependencies = {loadPlan: async () => plan};
  const valid = value => value?.status === 'checked' && value.engineVerified === true && value.transportVerified === true
    && value.migrations === 38 && value.interrupted === false
    && ((value.applied === 36 && value.pending === 2) || (value.applied === 38 && value.pending === 0));
  const before = await run(options, password, dependencies);
  if (!valid(before)) fail();
  if (command === 'status') return {status:'release190_schema_status', schemaMigrations:38, applicationTables:37,
    applied:before.applied, pending:before.pending, migrated:false, runtimeStarted:false,
    restart184Allowed:before.applied === 36, restart172Allowed:before.applied === 36,
    rollbackAfterMigrationQualified:false};
  let applied = 0;
  if (before.applied === 36) {
    const result = await run({...options,command:'upgrade'},password,dependencies);
    if (result?.status !== 'upgraded' || result.engineVerified !== true || result.transportVerified !== true
      || result.migrations !== 38 || result.applied !== 2 || result.unchanged !== 36) fail();
    applied = 2;
  }
  const after = await run(options,password,dependencies);
  if (!valid(after) || after.applied !== 38 || after.pending !== 0) fail();
  return {status:'release190_schema38_confirmed', schemaMigrations:38, applicationTables:37,
    applied, unchanged:38-applied, migrated:applied === 2, runtimeStarted:false,
    serviceStopOperatorAttested:true, restart184Allowed:false, restart172Allowed:false,
    rollbackAfterMigrationQualified:false};
}
'''
NODE_MAIN = r'''
let configuration, password;
try {
  const [{readRuntimeDatabaseConfiguration},{readPassword},{run},{loadExperienceMigrations}] = await Promise.all([
    import('./server/config/runtime-database-file.mjs'),import('./scripts/migration-input.mjs'),
    import('./scripts/migrate-stdin.mjs'),import('./server/experience/migrations.mjs')]);
  configuration = await readRuntimeDatabaseConfiguration('/srv/customer/jessiemessage-private/runtime-video-180');
  password = await readPassword(process.stdin);
  const result = await migrate190(process.argv[2],process.argv[1],password,{configuration,run,loadPlan:loadExperienceMigrations});
  process.stdout.write(JSON.stringify(result)+'\n');
} catch {
  process.stdout.write(JSON.stringify({status:'release190_schema_not_confirmed',runtimeStarted:false,
    restart184Allowed:false,restart172Allowed:false,noAutomaticRetry:true})+'\n');
  process.exitCode=1;
} finally { if(configuration) configuration.password=''; password=''; }
'''


class MigrationRefused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise MigrationRefused(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file(path, mode=0o600, limit=2 * 1024 * 1024):
    require(path.is_absolute() and path.resolve(strict=True) == path, 'FILE_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and stat.S_IMODE(before.st_mode) == mode and before.st_size <= limit, 'FILE_METADATA')
        result = handle.read(limit + 1)
        after, visible = os.fstat(handle.fileno()), path.lstat()
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(len(result) == before.st_size and all(getattr(before, key) == getattr(after, key) == getattr(visible, key)
            for key in fields), 'FILE_CHANGED')
    return result


def exclusive(path, value):
    data = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(data); handle.flush(); os.fsync(handle.fileno())
    directory = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    require(file(path) == data, 'WRITE_CHANGED')


def environment():
    return dict(PATH='/usr/bin:/bin', LANG='C', LC_ALL='C', GIT_CONFIG_NOSYSTEM='1',
                GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0', JESSIEMESSAGE_PRIVATE_PATH_MODE='linux-dirfd')


def identity():
    require(all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (SOURCE, TREE)), 'QUALIFICATION_PENDING')
    require(re.fullmatch('[a-f0-9]{64}', STAGING_SHA), 'STAGING_PENDING')
    metadata = PRIVATE.lstat()
    require(PRIVATE.resolve(strict=True) == PRIVATE and stat.S_ISDIR(metadata.st_mode)
        and metadata.st_uid == os.getuid() and stat.S_IMODE(metadata.st_mode) == 0o700, 'PRIVATE_DIRECTORY')
    checkout = OPERATOR / ('production-190-' + SOURCE[:8])
    require(checkout.resolve(strict=True) == checkout, 'SOURCE_DIRECTORY')
    def git(*args):
        result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
            '-c', 'core.hooksPath=/dev/null', '-C', str(checkout), *args], env=environment(),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        require(result.returncode == 0 and len(result.stdout) <= 1024 * 1024, 'SOURCE_UNAVAILABLE')
        return result.stdout.decode().strip()
    require(git('rev-parse','HEAD') == SOURCE and git('rev-parse','HEAD^{tree}') == TREE
        and git('rev-parse','refs/tags/v1.9.0^{commit}') == SOURCE and git('status','--porcelain','--untracked-files=normal') == '', 'SOURCE_IDENTITY')
    staged_bytes = file(PRIVATE / 'jm190-staging.json'); require(digest(staged_bytes) == STAGING_SHA, 'STAGING_PIN')
    staged = json.loads(staged_bytes)
    require(staged.get('format') == 'jessiemessage-release190-staging' and staged.get('source') == SOURCE
        and staged.get('tree') == TREE and staged.get('schemaMigrationsExpected') == 38
        and staged.get('applicationTablesExpected') == 37 and staged.get('experienceEnabled') is True, 'STAGING_SCOPE')
    for field, suffix in (('launcher', 'start'), ('checkLauncher', 'check')):
        expected = PRIVATE / (suffix + '-primary-release190-' + SOURCE[:8] + '.sh')
        require(staged.get(field) == str(expected) and digest(file(expected, 0o700)) == staged.get(field + 'Sha256'), 'LAUNCHER_PIN')
    require(digest(file(PRIVATE / 'jm0702-existing-pc-update.json')) == CHECKPOINT_SHA, 'CHECKPOINT_PIN')
    node = PRIVATE / 'runtime-node-v24.22.1/bin/node'
    require(digest(file(node, 0o700, 256 * 1024 * 1024)) == NODE_SHA, 'NODE_PIN')
    version = subprocess.run([str(node), '--version'], env=environment(), stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    require(version.returncode == 0 and version.stdout.strip() == b'v24.22.1', 'NODE_VERSION')
    return checkout, node


def main(args):
    require(args == ['status'] or args == ['upgrade','--service-stopped'], 'USAGE')
    mode = args[0]; checkout, node = identity()
    attempt, receipt = PRIVATE / 'jm190-upgrade-attempt.json', PRIVATE / 'jm190-schema38.json'
    if mode == 'upgrade':
        require(not attempt.exists() and not attempt.is_symlink() and not receipt.exists() and not receipt.is_symlink(), 'EXISTING_ATTEMPT_INSPECT_STATUS_NO_RETRY')
    with open('/dev/tty', 'r+', encoding='utf-8') as terminal:
        require(terminal.isatty(), 'TTY_REQUIRED')
        terminal.write('Identité SQL du compte de migration existant : '); terminal.flush()
        user = terminal.readline(100).rstrip('\n')
        require(re.fullmatch('[a-zA-Z0-9_]{1,80}', user), 'MIGRATOR_USER')
        with warnings.catch_warnings():
            # Refuse getpass's echoing fallback before it consumes a secret.
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('Mot de passe SQL de ce compte (saisie masquée) : ', stream=terminal)
    require(password and len(password.encode()) <= 4096 and not any(value in password for value in ('\0','\r','\n')), 'PASSWORD_INPUT')
    if mode == 'upgrade':
        exclusive(attempt, dict(status='release190_upgrade_attempted', source=SOURCE, tree=TREE,
            schemaMigrationsExpected=38, applicationTablesExpected=37, serviceStopOperatorAttested=True,
            runtimeStarted=False, noAutomaticRetry=True))
    try:
        result = subprocess.run([str(node), '--input-type=module', '-e', NODE_LIBRARY + NODE_MAIN, user, mode],
            cwd=checkout, env=environment(), input=password.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    finally:
        password = ''
    require(result.returncode == 0 and len(result.stdout) <= 16384, 'SQL_NOT_CONFIRMED_INSPECT_STATUS_NO_RETRY')
    value = json.loads(result.stdout)
    require(value.get('runtimeStarted') is False and value.get('schemaMigrations') == 38
        and value.get('applicationTables') == 37 and value.get('status') == ('release190_schema_status' if mode == 'status' else 'release190_schema38_confirmed'), 'SQL_RECEIPT')
    value.update(source=SOURCE, tree=TREE, nodeVersion='v24.22.1', metadataOnly=False, managerChanged=False,
        checkpointChanged=False, hostedPrecheckPassed=False, noRestart=True)
    if mode == 'upgrade':
        value.update(attemptSha256=digest(file(attempt)), stagingReceiptSha256=STAGING_SHA)
        exclusive(receipt, value)
        value['receiptSha256'] = digest(file(receipt))
    print(json.dumps(value, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        code = str(error) if isinstance(error, MigrationRefused) else 'MIGRATION_UNAVAILABLE'
        print(json.dumps(dict(status='release190_schema_not_confirmed',code=code,runtimeStarted=False,
            restart184Allowed=False,restart172Allowed=False,noAutomaticRetry=True),separators=(',', ':')))
        raise SystemExit(1)
