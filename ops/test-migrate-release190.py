"""Synthetic migration policy and local durable-marker tests; no SQL/hosting."""
import importlib.util
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import sys
import tempfile
import termios
import time
import unittest
import warnings
from unittest import mock

HERE = Path(__file__).resolve().parent


def helper():
    spec = importlib.util.spec_from_file_location('migrate190_synthetic', HERE / 'migrate-release190.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class MigrationPolicy(unittest.TestCase):
    def test_exact_plan_and_upgrade_paths_use_the_existing_service_only(self):
        module = helper()
        assertions = r'''
const assert = (await import('node:assert/strict')).default;
const plan=Array.from({length:38},(_,index)=>({version:index+1,name:index===36?'0037_profile_preferences.sql':index===37?'0038_reply_tracking.sql':`synthetic_${index}.sql`}));
const checked=(applied,pending)=>({status:'checked',engineVerified:true,transportVerified:true,migrations:38,applied,pending,interrupted:false});
const configuration=()=>({host:'sql.example.invalid',port:'3306',database:'synthetic',user:'runtime_only',password:'runtime-secret'});
const password='synthetic-only $() quoted password';
for(const initial of [36,38]){
 const calls=[]; let count=0;
 const run=async(options,secret,deps)=>{calls.push(options.command);assert.equal(secret,password);assert.equal(options.user,'migration_only');assert.equal(options.database,options.confirmation);assert.equal((await deps.loadPlan()).length,38);
   if(options.command==='upgrade')return {status:'upgraded',engineVerified:true,transportVerified:true,migrations:38,applied:2,unchanged:36};
   return count++===0?checked(initial,38-initial):checked(38,0);};
 const config=configuration();
 const result=await migrate190('upgrade','migration_only',password,{configuration:config,run,loadPlan:async()=>plan});
 assert.deepEqual(calls,initial===36?['status','upgrade','status']:['status','status']);
 assert.equal(config.password,'');assert.equal(result.schemaMigrations,38);assert.equal(result.applicationTables,37);
 assert.equal(result.applied,initial===36?2:0);assert.equal(result.restart184Allowed,false);assert.equal(result.restart172Allowed,false);assert.equal(result.runtimeStarted,false);
 assert.equal(JSON.stringify(result).includes(password),false);
}
for(const initial of [36,38]){
 const result=await migrate190('status','migration_only',password,{configuration:configuration(),loadPlan:async()=>plan,run:async options=>{assert.equal(options.command,'status');return checked(initial,38-initial);}});
 assert.equal(result.migrated,false);assert.equal(result.applied,initial);assert.equal(result.restart184Allowed,initial===36);
}
'''
        completed = subprocess.run([shutil.which('node'), '--input-type=module', '-e', module.NODE_LIBRARY + assertions],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_partial_interrupted_or_unexpected_history_never_reaches_upgrade(self):
        module = helper()
        assertions = r'''
const assert=(await import('node:assert/strict')).default;
const plan=Array.from({length:38},(_,i)=>({version:i+1,name:i===36?'0037_profile_preferences.sql':i===37?'0038_reply_tracking.sql':`fixture_${i}`}));
for(const before of [{applied:37,pending:1},{applied:0,pending:38},{applied:35,pending:3},{applied:36,pending:2,interrupted:true},{applied:38,pending:0,transportVerified:false}]){
 let calls=0;
 await assert.rejects(migrate190('upgrade','migration_only','synthetic-password',{configuration:{user:'runtime_only'},loadPlan:async()=>plan,run:async options=>{calls++;assert.equal(options.command,'status');return {status:'checked',engineVerified:true,transportVerified:true,migrations:38,interrupted:false,...before};}}),{code:'RELEASE190_SCHEMA_NOT_CONFIRMED'});
 assert.equal(calls,1);
}
for(const badPlan of [plan.slice(0,36),[...plan,{version:39}],plan.map((row,i)=>i===37?{...row,name:'unreviewed.sql'}:row)]){
 let called=false;
 await assert.rejects(migrate190('upgrade','migration_only','synthetic-password',{configuration:{user:'runtime_only'},loadPlan:async()=>badPlan,run:async()=>{called=true;}}));assert.equal(called,false);
}
let called=false;await assert.rejects(migrate190('upgrade','runtime_only','synthetic-password',{configuration:{user:'runtime_only'},loadPlan:async()=>{called=true;}}));assert.equal(called,false);
'''
        completed = subprocess.run([shutil.which('node'), '--input-type=module', '-e', module.NODE_LIBRARY + assertions],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_unqualified_or_unstaged_scripts_refuse_before_any_file_or_process(self):
        module = helper()
        with mock.patch.object(module.Path, 'lstat', side_effect=AssertionError('no private access')), \
                mock.patch.object(module.subprocess, 'run', side_effect=AssertionError('no process')):
            with mock.patch.multiple(module, SOURCE='QUALIFICATION_PENDING', TREE='QUALIFICATION_PENDING'):
                with self.assertRaisesRegex(module.MigrationRefused, 'QUALIFICATION_PENDING'):
                    module.identity()
            with mock.patch.multiple(module, SOURCE='a' * 40, TREE='b' * 40, STAGING_SHA='STAGING_PENDING'):
                with self.assertRaisesRegex(module.MigrationRefused, 'STAGING_PENDING'):
                    module.identity()


class Wrapper(unittest.TestCase):
    def setUp(self):
        self.module = helper()
        self.temp = tempfile.TemporaryDirectory(prefix='migrate190-synthetic-', dir=HERE.parent)
        self.addCleanup(self.temp.cleanup)
        self.module.PRIVATE = Path(self.temp.name); self.module.PRIVATE.chmod(0o700)
        self.module.SOURCE, self.module.TREE, self.module.STAGING_SHA = 'a' * 40, 'b' * 40, 'c' * 64
        self.password = 'Synthetic-only secret $() with spaces'
        self.result = dict(status='release190_schema38_confirmed', schemaMigrations=38, applicationTables=37,
            applied=2, unchanged=36, migrated=True, runtimeStarted=False, serviceStopOperatorAttested=True,
            restart184Allowed=False, restart172Allowed=False, rollbackAfterMigrationQualified=False)

    def call(self, args, *, result=None, returncode=0):
        terminal = mock.MagicMock(); terminal.__enter__.return_value = terminal; terminal.readline.return_value = 'migration_only\n'
        process = mock.Mock(returncode=returncode, stdout=json.dumps(self.result if result is None else result).encode(), stderr=b'')
        def execute(command, **settings):
            self.assertNotIn(self.password, command)
            self.assertEqual(settings['input'], self.password.encode())
            self.assertNotIn(self.password, json.dumps(settings['env']))
            self.assertEqual(command[-2:], ['migration_only', args[0]])
            if args[0] == 'upgrade':
                self.assertTrue((self.module.PRIVATE / 'jm190-upgrade-attempt.json').is_file())
            return process
        with mock.patch.object(self.module, 'identity', return_value=(Path('/synthetic-checkout'), Path('/synthetic-node'))), \
                mock.patch.object(self.module, '_open_terminal', return_value=terminal), mock.patch.object(self.module.getpass, 'getpass', return_value=self.password), \
                mock.patch.object(self.module.subprocess, 'run', side_effect=execute), mock.patch('sys.stdout', new_callable=io.StringIO) as output:
            self.module.main(args)
            return json.loads(output.getvalue())

    def test_upgrade_persists_attempt_and_success_receipts_without_password_and_refuses_retry(self):
        result = self.call(['upgrade', '--service-stopped'])
        attempt = self.module.PRIVATE / 'jm190-upgrade-attempt.json'; receipt = self.module.PRIVATE / 'jm190-schema38.json'
        self.assertEqual(attempt.stat().st_mode & 0o777, 0o600); self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
        self.assertEqual(result['receiptSha256'], self.module.digest(receipt.read_bytes()))
        self.assertNotIn(self.password, attempt.read_text() + receipt.read_text())
        with mock.patch.object(self.module, 'identity', return_value=(Path('/unused'), Path('/unused'))), \
                mock.patch.object(self.module, '_open_terminal', side_effect=AssertionError('no second credential prompt')):
            with self.assertRaisesRegex(self.module.MigrationRefused, 'EXISTING_ATTEMPT_INSPECT_STATUS_NO_RETRY'):
                self.module.main(['upgrade', '--service-stopped'])

    def test_failure_leaves_durable_attempt_and_no_success_receipt(self):
        with self.assertRaisesRegex(self.module.MigrationRefused, 'SQL_NOT_CONFIRMED'):
            self.call(['upgrade', '--service-stopped'], returncode=1)
        self.assertTrue((self.module.PRIVATE / 'jm190-upgrade-attempt.json').is_file())
        self.assertFalse((self.module.PRIVATE / 'jm190-schema38.json').exists())

    def test_status_remains_available_after_uncertain_attempt_and_writes_nothing(self):
        self.module.exclusive(self.module.PRIVATE / 'jm190-upgrade-attempt.json', {'status':'attempted'})
        before = {path.name:path.read_bytes() for path in self.module.PRIVATE.iterdir()}
        status = dict(self.result, status='release190_schema_status', applied=38, pending=0, migrated=False)
        self.assertEqual(self.call(['status'], result=status)['applied'], 38)
        self.assertEqual({path.name:path.read_bytes() for path in self.module.PRIVATE.iterdir()}, before)

    def test_stop_attestation_is_required_before_identity_or_credentials(self):
        with mock.patch.object(self.module, 'identity', side_effect=AssertionError('must refuse first')):
            for args in [[], ['upgrade'], ['upgrade','--service-stopped','extra'], ['status','--password','secret']]:
                with self.assertRaisesRegex(self.module.MigrationRefused, 'USAGE'):
                    self.module.main(args)

    def test_password_echo_fallback_refuses_before_attempt_marker_or_node(self):
        terminal = mock.MagicMock(); terminal.__enter__.return_value = terminal
        terminal.isatty.return_value = True; terminal.readline.return_value = 'migration_only\n'
        def unprotected_prompt(*_args, **_kwargs):
            warnings.warn('echo cannot be disabled', self.module.getpass.GetPassWarning)
            raise AssertionError('getpass fallback must stop before reading a password')
        with mock.patch.object(self.module, 'identity', return_value=(Path('/unused'), Path('/unused'))), \
                mock.patch.object(self.module, '_open_terminal', return_value=terminal), \
                mock.patch.object(self.module.getpass, 'getpass', side_effect=unprotected_prompt), \
                mock.patch.object(self.module.subprocess, 'run', side_effect=AssertionError('no Node')):
            with self.assertRaises(self.module.getpass.GetPassWarning):
                self.module.main(['upgrade','--service-stopped'])
        self.assertEqual(list(self.module.PRIVATE.iterdir()), [])


class ControllingTerminal(unittest.TestCase):
    def test_real_tty_prompts_hide_password_and_send_it_only_to_node_stdin_without_writes(self):
        user = 'migration_pty'
        password = 'Synthetic-only PTY $() password with spaces'
        expected_hash = hashlib.sha256(password.encode()).hexdigest()
        with tempfile.TemporaryDirectory(prefix='migrate190-pty-', dir=HERE.parent) as temporary:
            directory = Path(temporary); private = directory / 'private'; private.mkdir(mode=0o700)
            # Exercise the real Python main, terminal/getpass and real Node
            # subprocess. Only identity and the SQL program are replaced.
            node_program = """
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
let password='';for await(const chunk of process.stdin)password+=chunk.toString('utf8');
assert.equal(createHash('sha256').update(password).digest('hex'),EXPECTED_HASH);
assert.equal(JSON.stringify(process.argv).includes(password),false);
assert.equal(JSON.stringify(process.env).includes(password),false);
assert.deepEqual(process.argv.slice(1),['migration_pty','status']);
process.stdout.write(JSON.stringify({status:'release190_schema_status',schemaMigrations:38,
applicationTables:37,applied:36,pending:2,migrated:false,runtimeStarted:false,
restart184Allowed:true,restart172Allowed:true,rollbackAfterMigrationQualified:false})+'\\n');
""".replace('EXPECTED_HASH', json.dumps(expected_hash))
            program = f"""
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('migrate190_real_pty',{str(HERE / 'migrate-release190.py')!r})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.PRIVATE=Path({str(private)!r})
module.identity=lambda:(Path({str(directory)!r}),Path({shutil.which('node')!r}))
module.NODE_LIBRARY='';module.NODE_MAIN={node_program!r}
module.main(['status'])
assert list(module.PRIVATE.iterdir())==[], 'status must not create any receipt or marker'
"""
            master, slave = pty.openpty(); transcript = bytearray(); process = None
            initial_echo = termios.tcgetattr(slave)[3] & termios.ECHO
            def controlling_terminal():
                os.setsid(); fcntl.ioctl(0, termios.TIOCSCTTY, 0)
            try:
                process = subprocess.Popen([sys.executable, '-c', program], stdin=slave, stdout=slave, stderr=slave,
                    preexec_fn=controlling_terminal, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
                def read_until(expected, timeout=8):
                    deadline = time.monotonic() + timeout
                    while expected not in transcript:
                        remaining = deadline - time.monotonic()
                        self.assertGreater(remaining, 0, 'missing terminal prompt: ' + transcript.decode('utf-8', errors='replace'))
                        readable, _, _ = select.select([master], [], [], min(remaining, 0.2))
                        if readable:
                            chunk = os.read(master, 4096)
                            if chunk: transcript.extend(chunk)
                        elif process.poll() is not None:
                            self.fail('process exited before terminal prompt: ' + transcript.decode('utf-8', errors='replace'))
                read_until('Identité SQL du compte de migration existant : '.encode())
                os.write(master, (user + '\n').encode())
                read_until('Mot de passe SQL de ce compte (saisie masquée) : '.encode())
                self.assertEqual(termios.tcgetattr(slave)[3] & termios.ECHO, 0, 'secret prompt must disable terminal echo')
                os.write(master, (password + '\n').encode())
                read_until(b'"hostedPrecheckPassed":false')
                self.assertEqual(process.wait(timeout=8), 0, transcript.decode('utf-8', errors='replace'))
                self.assertEqual(termios.tcgetattr(slave)[3] & termios.ECHO, initial_echo, 'getpass must restore terminal echo')
                self.assertNotIn(password.encode(), transcript)
                receipts = [json.loads(line) for line in transcript.decode().splitlines() if line.startswith('{')]
                self.assertEqual(len(receipts), 1)
                self.assertEqual(receipts[0]['status'], 'release190_schema_status')
                self.assertFalse(receipts[0]['migrated']); self.assertFalse(receipts[0]['runtimeStarted'])
                self.assertEqual(list(private.iterdir()), [])
            finally:
                if process is not None and process.poll() is None:
                    process.kill(); process.wait(timeout=3)
                os.close(master); os.close(slave)


if __name__ == '__main__':
    unittest.main(verbosity=2)
