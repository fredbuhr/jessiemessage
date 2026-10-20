#!/usr/bin/env python3
"""Local synthetic imports and a controlling TTY; no SQL or remote execution."""
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
import time

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / 'status-release120-migration-r2.sh'
text = SCRIPT.read_text()
snapshot = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
code = re.search(r"^jm_code='\n(.*?)\n'$", text, re.M | re.S)[1]
node = shutil.which('node')
assert node
subprocess.run(['bash', '-n', str(SCRIPT)], check=True)
subprocess.run([node, '--input-type=module', '--check'], input=code.encode(), check=True)
assert 'command: "status"' in code and 'command: "upgrade"' not in code
assert '3<&-' in text and '[[ -t 3 ]]' in text and '[[ -t 0 ]]' not in text
secret = 'synthetic migration $() `value` "quote" é'
runtime_secret = 'synthetic runtime password never emitted'
cases = []

with tempfile.TemporaryDirectory(dir=ROOT, prefix='status-release120-fixture-') as temporary:
    root = Path(temporary)
    (root / 'server/config').mkdir(parents=True)
    (root / 'scripts').mkdir()
    (root / 'server/db').mkdir()
    (root / 'node_modules/mariadb').mkdir(parents=True)
    (root / 'server/config/runtime-database-file.mjs').write_text('''
export async function readRuntimeDatabaseConfiguration(directory) {
  if (process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE !== "linux-dirfd") throw new Error("path mode");
  if (directory !== "/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851") throw new Error("profile");
  if (process.env.JM_SYNTHETIC_CASE === "reader-error") throw new Error(''' + json.dumps(runtime_secret) + ''');
  globalThis.fixtureConfiguration = { host:"sql.example.invalid", port:"3306", database:"fixture_database",
    user:"fixture_runtime", password:''' + json.dumps(runtime_secret) + ''' };
  return globalThis.fixtureConfiguration;
}
''')
    (root / 'scripts/migration-input.mjs').write_text('''
import { isatty } from "node:tty";
export async function readPassword(stream) {
  if (stream.isTTY || isatty(3)) throw new Error("inherited terminal descriptor");
  let result = "";
  for await (const chunk of stream) result += chunk;
  return result;
}
''')
    (root / 'scripts/migrate-stdin.mjs').write_text('''
export async function run(options, password, dependencies) {
  if (options.command !== "status" || options.host !== "sql.example.invalid" || options.port !== "3306"
      || options.database !== "fixture_database" || options.confirmation !== "fixture_database"
      || options.user !== "fixture_migrator") throw new Error("invalid migration options");
  if (globalThis.fixtureConfiguration.password !== "") throw new Error("runtime password retained");
  const secret = ''' + json.dumps(secret) + ''';
  if (JSON.stringify(process.argv).includes(secret) || JSON.stringify(process.env).includes(secret))
    throw new Error("password outside stdin");
  if (password !== secret) throw new Error("wrong password: " + password);
  if (process.env.JM_SYNTHETIC_CASE === "run-error") throw new Error("native error with " + password);
  await dependencies.loadPlan();
  const connection = await dependencies.connect({});
  await connection.query("SHOW SESSION STATUS LIKE Ssl_cipher");
  await dependencies.status(connection, {});
  const migrated = process.env.JM_SYNTHETIC_CASE === "already31";
  return {status:"checked", engineVerified:true, transportVerified:true, migrations:31,
    applied:migrated ? 31 : 30, pending:migrated ? 0 : 1, interrupted:false};
}
''')
    (root / 'server/db/connection.mjs').write_text('''export function databaseOptions() {
      return {ssl:{rejectUnauthorized:true,minVersion:"TLSv1.2"},logParam:false,trace:false};
    }''')
    (root / 'server/db/migrations.mjs').write_text('''export async function loadMigrations(){return [];}
      export async function migrationStatus(){
        if(process.env.JM_SYNTHETIC_CASE==="history-drift")
          throw Object.assign(new Error("synthetic SQL text never emitted"), {code:"CHECKSUM_DRIFT"});
        return [];
      }''')
    (root / 'node_modules/mariadb/package.json').write_text('{"type":"module","main":"index.mjs"}')
    (root / 'node_modules/mariadb/index.mjs').write_text('''export default {async createConnection(options){
      if(options.ssl.rejectUnauthorized!==true||options.ssl.minVersion!=="TLSv1.2"||options.logParam!==false||options.trace!==false)
        throw new Error("insecure transport");
      const native = {"auth-error":"ER_ACCESS_DENIED_ERROR", "tls-error":"CERT_HAS_EXPIRED",
        "host-error":"ENOTFOUND", "unknown-driver-error":"SECRET_CODE_WITH_PRIVATE_DATA"}[process.env.JM_SYNTHETIC_CASE];
      if(native) throw Object.assign(new Error("native synthetic password/configuration never emitted"),{code:native});
      return {async query(){return []},async end(){}};
    }};''')
    def git(*args):
        return subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', str(root), *args],
                              check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().strip()
    git('init', '-q')
    git('add', 'server', 'scripts', 'node_modules')
    git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic')
    sha, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')
    adapted = text.replace('jm_checkout=/srv/customer/jessiemessage-operator/production-111-cfa7dd35',
                           'jm_checkout=' + str(root))
    adapted = adapted.replace('jm_sha=cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a', 'jm_sha=' + sha)
    adapted = adapted.replace('jm_tree=94b2fec5383fd948df7605b63f65a4e23078c2a1', 'jm_tree=' + tree)
    adapted = adapted.replace('jm_node=/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node',
                              'jm_node=' + node)
    adapted = adapted.replace('67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c',
                              hashlib.sha256(Path(node).read_bytes()).hexdigest())
    adapted = adapted.replace('== v24.22.0 ]]', '== ' + subprocess.check_output([node, '--version']).decode().strip() + ' ]]')

    def tty_case(label, *, username='fixture_migrator', password=secret, scenario='pending31', success=True, expected_code=None, expected_phase=None):
        read_end, write_end = os.pipe()
        pid, terminal = pty.fork()
        if pid == 0:
            os.close(write_end)
            os.dup2(read_end, 0)
            os.close(read_end)
            environment = dict(os.environ, JM_SYNTHETIC_CASE=scenario)
            if scenario == 'inherited-export':
                environment['jm_password'] = 'prior-placeholder'
                environment['SHELLOPTS'] = 'allexport'
            # The real deployment wrapper also supplies code on non-TTY stdin.
            os.execve('/bin/bash', ['bash', '-s'], environment)
        os.close(read_end)
        os.write(write_end, adapted.encode())
        os.close(write_end)
        transcript = b''
        sent_user = sent_password = False
        deadline = time.monotonic() + 12
        try:
            while time.monotonic() < deadline:
                ready, _, _ = select.select([terminal], [], [], 0.1)
                if ready:
                    try:
                        chunk = os.read(terminal, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    transcript += chunk
                if not sent_user and b'compte de migration existant : ' in transcript:
                    os.write(terminal, username.encode() + b'\n')
                    sent_user = True
                if not sent_password and b'(saisie masquee) : ' in transcript:
                    os.write(terminal, password.encode() + b'\n')
                    sent_password = True
            else:
                os.kill(pid, 9)
                raise AssertionError('synthetic TTY timeout')
        finally:
            os.close(terminal)
            _, status = os.waitpid(pid, 0)
        output = transcript.decode(errors='replace')
        assert all(value not in output for value in [secret,runtime_secret,password,'SECRET_CODE_WITH_PRIVATE_DATA','native synthetic password/configuration','synthetic SQL text']), output
        assert sent_user
        if success:
            assert os.waitstatus_to_exitcode(status) == 0, output
            rows = [json.loads(line[line.index('{'):]) for line in output.splitlines() if line.startswith('{')]
            assert len(rows) == 1, output
            result = rows[0]
            assert result['status'] == 'checked' and result['readOnly'] is True
            assert result['migrated'] is False and result['noRestart'] is True
            assert result['source'] == 'cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a'
            assert result['applied'] == (31 if scenario == 'already31' else 30)
            assert result['pending'] == (0 if scenario == 'already31' else 1)
            assert result['interrupted'] is False
            assert 'ddlPrivilegesVerified' not in result
        else:
            assert os.waitstatus_to_exitcode(status) != 0, output
            if username != 'invalid-account':
                rows = [json.loads(line[line.index('{'):]) for line in output.splitlines() if line.startswith('{')]
                assert len(rows) == 1, output
                assert rows[0]['status'] == 'migration_status_not_confirmed', output
                if expected_code: assert rows[0]['code'] == expected_code, output
                if expected_phase: assert rows[0]['phase'] == expected_phase, output
            else: assert 'MIGRATION_STATUS_NOT_CONFIRMED:' in output
        cases.append(label)
        print('PASS ' + label)

    tty_case('non_tty_script_stdin_hidden_password_pending31')
    tty_case('preserves_already_migrated_counts', scenario='already31')
    tty_case('inherited_export_and_allexport_cannot_export_password', scenario='inherited-export')
    tty_case('runtime_account_refused', username='fixture_runtime', success=False)
    tty_case('invalid_account_refused', username='invalid-account', success=False)
    tty_case('reader_native_error_redacted', scenario='reader-error', success=False)
    tty_case('migration_native_error_redacted', scenario='run-error', success=False)
    tty_case('auth_refusal_isolated_without_native_details', scenario='auth-error', success=False,
             expected_code='SQL_AUTHENTICATION_REFUSED', expected_phase='sql_connection')
    tty_case('tls_failure_classified_without_disabling_verification', scenario='tls-error', success=False,
             expected_code='SQL_TLS_CERTIFICATE_REFUSED', expected_phase='sql_connection')
    tty_case('dns_failure_classified', scenario='host-error', success=False,
             expected_code='SQL_HOST_UNRESOLVED', expected_phase='sql_connection')
    tty_case('unknown_driver_code_and_message_redacted', scenario='unknown-driver-error', success=False,
             expected_code='SQL_CONNECTION_FAILED', expected_phase='sql_connection')
    tty_case('history_drift_isolated_without_sql', scenario='history-drift', success=False,
             expected_code='CHECKSUM_DRIFT', expected_phase='migration_history')
    without_tty = subprocess.run(['/bin/bash', '-s'], input=adapted.encode(), start_new_session=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert without_tty.returncode != 0
    assert b'Identite SQL' not in without_tty.stdout + without_tty.stderr
    cases.append('no_controlling_tty_refused')
    print('PASS ' + cases[-1])

assert hashlib.sha256(SCRIPT.read_bytes()).hexdigest() == snapshot
print(f'RESULT {len(cases)}/{len(cases)} passed; script_sha256={snapshot}; synthetic imports only, no SQL/remote execution')
