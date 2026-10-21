#!/usr/bin/env python3
"""Standalone status/upgrade qualification: synthetic modules, TTY and CHECK only.

Never opens production files, connects to SQL, or executes a full hosted helper.
"""
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parent
FILES = [ROOT / 'status-release150-migration.sh', ROOT / 'upgrade-release150.sh']
SOURCES = [path.read_text() for path in FILES]
SNAPSHOTS = [hashlib.sha256(path.read_bytes()).hexdigest() for path in FILES]
NODE = shutil.which('node')
assert NODE
RESULTS = []
PASSWORD = 'SyntheticPasswordOnly!42'

def passed(label):
    RESULTS.append(label)
    print('PASS ' + label)

def embedded(text):
    return text.split("jm_code='\n", 1)[1].split("\n'\n", 1)[0]

for path, text in zip(FILES, SOURCES):
    subprocess.run(['/bin/bash', '-n', str(path)], check=True)
    assert 'exec 3<>/dev/tty' in text and '3<&-' in text
    assert text.index('stty -echo <&3') < text.index('Mot de passe SQL') < text.index('read -r -s -u 3 jm_password')
    assert 'set +a' in text and 'unset jm_password' in text
    assert 'export jm_password' not in text and '--password' not in text
    assert "printf '%s' \"$jm_password\" | \"$jm_node\" --input-type=module -e \"$jm_code\" \"$jm_migrator\" 3<&-" in text
    assert 'configuration.password = ""' in text and 'password = ""' in text
    assert 'runtime-node-v24.22.0/bin/node' in text
    assert '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c' in text
    assert '700:1:$(id -u)' in text and 'JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd' in text
    assert 'rm ' not in text and 'record-release' not in text
    code = embedded(text)
    subprocess.run([NODE, '--input-type=module', '--check'], input=code.encode(), check=True)
    args = [] if path == FILES[0] else ['--service-stopped']
    prefix = text.split('jm_checkout=',1)[0]
    result = subprocess.run(['/bin/bash', '-c', prefix, 'synthetic source gate', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert (result.returncode != 0) is ('QUALIFICATION_REQUIRED' in prefix)
    assert b'Identite SQL' not in result.stdout + result.stderr
    passed(path.stem + '_source_gates_checked_without_tty_or_sql')

assert '[[ $# == 1 && "$1" == --service-stopped ]]' in SOURCES[1]
for arguments in [[], ['--service-running'], ['--service-stopped', 'extra']]:
    result = subprocess.run(['/bin/bash', str(FILES[1]), *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert result.returncode != 0 and b'Identite SQL' not in result.stdout + result.stderr
passed('upgrade_requires_exact_service_stopped_attestation')

with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='release150-migration-fixture-') as temporary:
    root = Path(temporary)
    def write(name, text):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    # Every placeholder independently blocks before git, Node, TTY, SQL or files.
    for index, source in enumerate(SOURCES):
        prefix = source.split('jm_checkout=',1)[0]
        assignments = ['jm_sha','jm_tree'] + ([] if index == 0 else
            ['jm_sha150','jm_tree150','jm_start141_sha','jm_check141_sha','jm_start150_sha','jm_check150_sha'])
        pins = {name:re.search(r'^'+name+r'=([a-f0-9]{40}|[a-f0-9]{64}|QUALIFICATION_REQUIRED_[A-Z0-9_]+)$',prefix,re.M)
            for name in assignments}
        assert all(pins.values())
        def prefix_result(remaining=None):
            candidate = prefix
            for name, match in sorted(pins.items(),key=lambda item:item[1].start(1),reverse=True):
                value = ('a'*64 if name.endswith('_sha') and name != 'jm_sha' else ('c'*40 if name == 'jm_sha150' else 'b'*40))
                if name == remaining: value = 'QUALIFICATION_REQUIRED_SYNTHETIC'
                candidate = candidate[:match.start(1)] + value + candidate[match.end(1):]
            arguments = [] if index == 0 else ['--service-stopped']
            return subprocess.run(['/bin/bash','-c',candidate,'synthetic qualification gates',*arguments],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        assert prefix_result().returncode == 0
        for pin in pins:
            result = prefix_result(pin)
            assert result.returncode != 0 and b'Identite SQL' not in result.stdout + result.stderr, pin
        passed(('status' if index == 0 else 'upgrade')+'_every_unqualified_source_tree_or_launcher_pin_refused')
    file_function = re.search(r'^jm_file\(\) \{\n.*?^\}',SOURCES[1],re.M|re.S)[0]
    pinned_file = root / 'pinned-launcher.sh'
    pinned_file.write_text('#!/bin/bash\nexit 0\n');pinned_file.chmod(0o700)
    pinned_hash = hashlib.sha256(pinned_file.read_bytes()).hexdigest()
    def file_result(path, expected=pinned_hash):
        return subprocess.run(['/bin/bash','-c','set -euo pipefail\n'+file_function+'\njm_file "$1" "$2"','synthetic file pin',str(path),expected],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    assert file_result(pinned_file).returncode == 0
    assert file_result(pinned_file,'0'*64).returncode != 0
    pinned_file.chmod(0o755)
    assert file_result(pinned_file).returncode != 0
    pinned_file.chmod(0o700)
    linked = root / 'linked-launcher.sh';linked.symlink_to(pinned_file)
    assert file_result(linked).returncode != 0
    linked.unlink();os.link(pinned_file,linked)
    assert file_result(pinned_file).returncode != 0
    linked.unlink()
    passed('upgrade_launcher_hash_mode_symlink_hardlink_guards_are_enforced')
    write('server/config/runtime-database-file.mjs', '''
import { readFileSync, appendFileSync } from "node:fs";
export async function readRuntimeDatabaseConfiguration(directory) {
  if (directory !== "/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851") throw Error("wrong private directory");
  const scenario = JSON.parse(readFileSync("scenario.json"));
  if (scenario.configurationError) throw Object.assign(new Error("private config must not leak"), { code: scenario.configurationError });
  const configuration = { user: "runtime_user", password: "private-runtime-secret", host: "sql.invalid", port: 3306, database: "synthetic" };
  process.on("exit", () => appendFileSync("trace.jsonl", JSON.stringify({ configurationPasswordCleared: configuration.password === "" }) + "\\n"));
  return configuration;
}
''')
    write('scripts/migration-input.mjs', '''
export async function readPassword(input) {
  let value = "";
  for await (const chunk of input) value += chunk;
  if (value !== "SyntheticPasswordOnly!42") throw Object.assign(new Error("password input must not leak"), { code: "MIGRATION_INPUT_PASSWORD" });
  return value;
}
''')
    write('server/db/connection.mjs', 'export function databaseOptions(env) { return { synthetic: true }; }\n')
    write('server/db/migrations.mjs', '''
export async function loadMigrations() { return Array.from({length:32}, (_, index) => ({ version:index+1 })); }
export async function migrationStatus() { return { synthetic: true }; }
''')
    write('node_modules/mariadb/package.json', '{"name":"mariadb","type":"module","exports":"./index.mjs"}')
    write('node_modules/mariadb/index.mjs', '''
import { readFileSync } from "node:fs";
export default { async createConnection(options) {
  const scenario = JSON.parse(readFileSync("scenario.json"));
  if (scenario.connectionError) throw Object.assign(new Error("SyntheticPasswordOnly!42 host and private config"), { code:scenario.connectionError });
  return { synthetic: options.synthetic };
} };
''')
    write('scripts/migrate-stdin.mjs', '''
import { readFileSync, appendFileSync } from "node:fs";
let call = 0;
export async function run(options, password, dependencies) {
  const scenario = JSON.parse(readFileSync("scenario.json"));
  appendFileSync("trace.jsonl", JSON.stringify({ command:options.command, passwordCorrect:password === "SyntheticPasswordOnly!42",
    account:options.user, confirmationCorrect:options.confirmation === options.database,
    passwordInArgs:process.argv.some(value => value.includes(password)), passwordInEnvironment:Object.values(process.env).includes(password) }) + "\\n");
  const plan = await dependencies.loadPlan();
  if (plan.length !== 32) throw Error("wrong plan");
  const connection = await dependencies.connect({});
  await dependencies.status(connection, {});
  const action = scenario.actions[call++];
  if (!action) throw Error("unexpected additional migration call");
  if (action.error) throw Object.assign(new Error("SyntheticPasswordOnly!42 private context"), { code:action.error });
  return action;
}
''')
    checked31 = dict(status='checked', engineVerified=True, transportVerified=True, migrations=32, applied=31, pending=1, interrupted=False)
    checked32 = dict(checked31, applied=32, pending=0)
    upgraded = dict(status='upgraded', engineVerified=True, transportVerified=True, migrations=32, applied=1, unchanged=31)
    def run_code(label, index, actions, *, valid=True, expected_commands=None, user='existing_migrator', password=PASSWORD,
                 error_code=None, expected_phase=None, **scenario):
        write('scenario.json', json.dumps(dict(actions=actions, **scenario)))
        trace = root / 'trace.jsonl'
        trace.unlink(missing_ok=True)
        result = subprocess.run([NODE, '--input-type=module', '-e', embedded(SOURCES[index]), user], input=password.encode(),
            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        assert PASSWORD.encode() not in result.stdout + result.stderr, label
        assert b'private-runtime-secret' not in result.stdout + result.stderr, label
        assert (result.returncode == 0) is valid, (label,result.stdout,result.stderr)
        values = [json.loads(line) for line in result.stdout.splitlines()]
        assert len(values) == 1, (label,values,result.stderr)
        value = values[0]
        events = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
        calls = [event for event in events if 'command' in event]
        if expected_commands is not None: assert [event['command'] for event in calls] == expected_commands, (label,calls)
        assert all(event['passwordCorrect'] and event['confirmationCorrect'] and not event['passwordInArgs'] and not event['passwordInEnvironment'] for event in calls), (label,calls)
        if events and not scenario.get('configurationError'): assert events[-1] == {'configurationPasswordCleared':True}, (label,events)
        if error_code is not None:
            assert value['code'] == error_code, (label,value)
        if expected_phase is not None: assert value['phase'] == expected_phase, (label,value)
        if index == 0:
            assert value['readOnly'] is True and value['migrated'] is False and value['noRestart'] is True
            assert not any(event['command'] == 'upgrade' for event in calls)
        elif valid:
            assert value['status'] == 'schema32_confirmed_before_prechecks'
            assert value['schemaMigrations'] == 32 and value['schema32Confirmed'] is True
            assert value['serviceStopOperatorAttested'] is True and value['runtimeStarted'] is False
        else:
            assert value['status'] == 'release150_upgrade_not_confirmed' and value['schema32Confirmed'] is False
            assert value['runtimeStarted'] is False and value['restart140Allowed'] is False and value['noAutomaticRetry'] is True
        passed(label)
        return value

    run_code('status_reports_clean31_plus_pending32_read_only',0,[checked31],expected_commands=['status'])
    run_code('status_reports_already32_without_upgrade',0,[checked32],expected_commands=['status'])
    run_code('status_exposes_interrupted_ledger_without_retry',0,[dict(checked31,interrupted=True)],expected_commands=['status'])
    run_code('runtime_sql_identity_refused_before_password_or_sql',0,[],valid=False,user='runtime_user',expected_commands=[],error_code='MIGRATION_STATUS_ACCOUNT_REFUSED',expected_phase='migration_account')
    run_code('malformed_sql_identity_refused',0,[],valid=False,user='bad user',expected_commands=[],error_code='MIGRATION_STATUS_ACCOUNT_REFUSED')
    run_code('empty_password_refused',0,[],valid=False,password='',expected_commands=[],error_code='MIGRATION_INPUT_PASSWORD',expected_phase='password_input')
    run_code('auth_failure_is_neutral_and_contains_no_secret',0,[],valid=False,connectionError='ER_ACCESS_DENIED_ERROR',expected_commands=['status'],error_code='SQL_AUTHENTICATION_REFUSED',expected_phase='sql_connection')
    run_code('unknown_connection_failure_is_neutral',0,[],valid=False,connectionError='SECRET_UNKNOWN_SQL_ERROR',expected_commands=['status'],error_code='SQL_CONNECTION_FAILED')
    run_code('tls_failure_is_neutral',0,[],valid=False,connectionError='CERT_HAS_EXPIRED',expected_commands=['status'],error_code='SQL_TLS_CERTIFICATE_REFUSED')
    run_code('history_drift_is_not_hidden',0,[dict(error='CHECKSUM_DRIFT')],valid=False,expected_commands=['status'],error_code='CHECKSUM_DRIFT')
    run_code('unclassified_private_error_is_neutral',0,[dict(error='PRIVATE_UNEXPECTED')],valid=False,expected_commands=['status'],error_code='UNCLASSIFIED_FAILURE')

    value = run_code('upgrade_clean31_to32_then_rechecks32',1,[checked31,upgraded,checked32],expected_commands=['status','upgrade','status'])
    assert value['upgradeAttempted'] is True
    value = run_code('already32_rechecks_without_second_ddl',1,[checked32,checked32],expected_commands=['status','status'])
    assert value['upgradeAttempted'] is False and value['migration']['status'] == 'already_applied'
    for label, status in [
        ('older30_schema_refused',dict(checked31,applied=30,pending=2)),
        ('future33_plan_refused',dict(checked31,migrations=33)),
        ('interrupted_migration_refused_without_upgrade',dict(checked31,interrupted=True)),
        ('inconsistent_pending_refused',dict(checked31,pending=0)),
        ('unconfirmed_status_refused',dict(checked31,status='unknown')),
    ]:
        value = run_code(label,1,[status],valid=False,expected_commands=['status'],error_code='SCHEMA_STATUS_UNEXPECTED')
        assert value['upgradeAttempted'] is False and value['migrationApplied'] is False
    value = run_code('failed_ddl_requires_inspection_no_retry',1,[checked31,dict(error='MIGRATION_FAILED')],valid=False,expected_commands=['status','upgrade'],error_code='MIGRATION_FAILED')
    assert value['upgradeAttempted'] is True and value['migrationApplied'] is None and value['schemaState'] == 'inspection_required'
    value = run_code('unexpected_upgrade_result_requires_inspection',1,[checked31,dict(upgraded,applied=0)],valid=False,expected_commands=['status','upgrade'],error_code='SCHEMA_STATUS_UNEXPECTED')
    assert value['schemaState'] == 'inspection_required'
    run_code('post_upgrade_unconfirmed_history_blocks_prechecks',1,[checked31,upgraded,checked31],valid=False,expected_commands=['status','upgrade','status'],error_code='SCHEMA_STATUS_UNEXPECTED')
    run_code('upgrade_auth_failure_never_attempts_ddl',1,[],valid=False,connectionError='ER_ACCESS_DENIED_ERROR',expected_commands=['status'],error_code='SQL_AUTHENTICATION_REFUSED')

    # Exercise the exact credential block on a real synthetic PTY. Input arrives
    # immediately after its prompt. Node is replaced only in this isolated block.
    input_block = 'exec 3<>/dev/tty' + SOURCES[0].split('exec 3<>/dev/tty',1)[1].split("jm_code='",1)[0]
    dispatch = 'if printf' + SOURCES[0].split('if printf',1)[1]
    fake_node = root / 'node-tty-fixture.sh'
    fake_node.write_text('''#!/bin/bash
set -euo pipefail
[[ ! -t 0 && ! -e /proc/$$/fd/3 ]]
[[ "$4" == existing_migrator ]]
[[ "$*" != *SyntheticPasswordOnly* ]]
[[ "${jm_password-unset}" == unset ]]
IFS= read -r -d "" secret || true
[[ "$secret" == SyntheticPasswordOnly!42 ]]
printf "PRIVATE_PIPE_AND_FD3_OK\\n"
''')
    fake_node.chmod(0o700)
    harness = ('set +x\nset +a\nset -euo pipefail\nunset jm_password\njm_tty_state=\n'
        + re.search(r'^jm_cleanup\(\) \{\n.*?^\}',SOURCES[0],re.M|re.S)[0]
        + '\ntrap jm_cleanup EXIT\njm_node="$1"\n' + input_block + '\njm_code=synthetic\n' + dispatch)
    master, slave = pty.openpty()
    child_pid = os.fork()
    if child_pid == 0:
        os.setsid()
        import fcntl
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        os.dup2(slave,0);os.dup2(slave,1);os.dup2(slave,2)
        os.close(master)
        if slave > 2: os.close(slave)
        os.execv('/bin/bash',['/bin/bash','-c',harness,'synthetic TTY',str(fake_node)])
    os.close(slave)
    output = b''
    sent_user = sent_password = False
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        ready,_,_ = select.select([master],[],[],0.1)
        if ready:
            try: chunk = os.read(master,65536)
            except OSError: break
            if not chunk: break
            output += chunk
            if not sent_user and b'Identite SQL' in output:
                os.write(master,b'existing_migrator\n');sent_user=True
            if not sent_password and b'saisie masquee' in output:
                assert termios.tcgetattr(master)[3] & termios.ECHO == 0
                os.write(master,PASSWORD.encode()+b'\n');sent_password=True
    _, status = os.waitpid(child_pid,0)
    try: echo_restored = bool(termios.tcgetattr(master)[3] & termios.ECHO)
    finally: os.close(master)
    assert os.waitstatus_to_exitcode(status) == 0, output
    assert sent_user and sent_password and echo_restored
    assert PASSWORD.encode() not in output and b'PRIVATE_PIPE_AND_FD3_OK' in output, output
    passed('tty_echo_disabled_before_prompt_and_secret_only_private_pipe_fd3_closed')

    # The exact post-SQL block runs only CHECKs and preserves existing logs.
    suffix = 'trap - ERR' + SOURCES[1].split('trap - ERR',1)[1]
    assert 'bash "$jm_start' not in suffix and '>' not in suffix.replace('>/dev/null 2>&1','')
    for label, failed_release in [('both_prechecks_qualify_141_and150',None),('failed141_does_not_check150','141'),('failed150_preserves_141_qualification','150')]:
        case = root / label;case.mkdir()
        log = case / 'checks.log';log.write_text('existing\n')
        for release in ['141','150']:
            write(str(case.relative_to(root) / ('check'+release+'.sh')),
                '#!/bin/bash\nprintf "'+release+'\\n" >> "$CHECK_TRACE"\nexit '+('1' if release == failed_release else '0')+'\n')
        env = dict(os.environ,CHECK_TRACE=str(log))
        command = 'set -euo pipefail\njm_check141="$1"\njm_check150="$2"\n'+suffix
        result = subprocess.run(['/bin/bash','-c',command,'synthetic CHECK',str(case/'check141.sh'),str(case/'check150.sh')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
        value = json.loads(result.stdout)
        assert result.returncode == (0 if failed_release is None else 1),(label,result.stdout,result.stderr)
        assert log.read_text() == ('existing\n141\n' if failed_release == '141' else 'existing\n141\n150\n')
        assert value['schema32Confirmed'] is True and value['runtimeStarted'] is False and value['restart140Allowed'] is False
        if failed_release is None:
            assert value['status']=='schema32_prechecks_passed' and value['schemaMigrations']==32
            assert value['rollback141HostedQualified'] is True and value['release150PrecheckPassed'] is True
            assert value['targetVersion']=='1.5.0' and value['managerChanged'] is False and value['checkpointChanged'] is False
        elif failed_release == '141': assert 'rollback141HostedQualified' not in value
        else: assert value['rollback141HostedQualified'] is True
        passed(label)

assert [hashlib.sha256(path.read_bytes()).hexdigest() for path in FILES] == SNAPSHOTS
print(f'RESULT {len(RESULTS)}/{len(RESULTS)} passed; no hosted helper, SQL connection or runtime start')
