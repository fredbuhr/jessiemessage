#!/usr/bin/env python3
"""Synthetic TTY and actual 1.1.1 migrator; no network or deployed data."""
import hashlib, json, os, pty, re, select, shlex, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SCRIPT=ROOT/'upgrade-release120.sh'
source=SCRIPT.read_text()
node=shutil.which('node')
assert node
secret='synthetic $() `command` "quote" é'
runtime_secret='synthetic runtime credential'
subprocess.run(['bash','-n',str(SCRIPT)],check=True)
js=re.search(r"^jm_code='\n(.*?)\n'$",source,re.M|re.S)[1]
subprocess.run([node,'--input-type=module','--check'],input=js.encode(),check=True)
assert 'command: "upgrade"' in js
assert 'start-local-closures' not in source
assert '--service-stopped' in source
candidate=ROOT/'jessiemessage-compat111'
real=Path(os.environ.get('JESSIEMESSAGE_SYNTHETIC_SOURCE',candidate if candidate.is_dir() else ROOT.parent)).resolve()
realrun=(real/'scripts/migrate-stdin.mjs').as_uri()
realinput=(real/'scripts/migration-input.mjs').as_uri()
realmigrations=(real/'server/db/migrations.mjs').as_uri()
realconnection=(real/'server/db/connection.mjs').as_uri()
cases=[]
with tempfile.TemporaryDirectory(dir=ROOT,prefix='upgrade120-fixture-') as temporary:
    base=Path(temporary); root=base/'checkout'; private=base/'private'; root.mkdir();private.mkdir()
    for d in ['server/config','server/db','scripts','node_modules/mariadb']:(root/d).mkdir(parents=True,exist_ok=True)
    (root/'server/config/runtime-database-file.mjs').write_text('''export async function readRuntimeDatabaseConfiguration(){
      if(process.env.JM_SYNTHETIC_CASE==="reader-error")throw Object.assign(new Error("private runtime credential"),{code:"RUNTIME_DATABASE_CONFIGURATION"});
      globalThis.fixtureConfiguration={host:"sql.example.invalid",port:"3306",database:"synthetic_db",user:"fixture_runtime",password:"synthetic runtime credential"};
      return globalThis.fixtureConfiguration;
    }''')
    (root/'scripts/migration-input.mjs').write_text('export {readPassword} from '+json.dumps(realinput)+';')
    (root/'server/db/connection.mjs').write_text('export {databaseOptions} from '+json.dumps(realconnection)+';')
    (root/'scripts/migrate-stdin.mjs').write_text('''import assert from "node:assert/strict";
      import {run as actualRun} from '''+json.dumps(realrun)+''';
      export async function run(options,password,dependencies){
        assert.equal(password,'''+json.dumps(secret)+''');
        assert.equal(globalThis.fixtureConfiguration.password,"");
        assert.equal(JSON.stringify(process.argv).includes(password),false);
        assert.equal(JSON.stringify(process.env).includes(password),false);
        if(options.command==="upgrade")globalThis.fixtureCommands.push("upgrade");
        return actualRun(options,password,{...dependencies,apply:async(connection,context)=>{
          if(process.env.JM_SYNTHETIC_CASE==="upgrade-error")throw Object.assign(new Error("native private SQL "+password),{code:"MIGRATION_FAILED"});
          globalThis.fixtureApplied=31;return {applied:[31]};
        }});
      }''')
    (root/'server/db/migrations.mjs').write_text('''import {loadMigrations as actualLoad} from '''+json.dumps(realmigrations)+''';
      globalThis.fixtureApplied=process.env.JM_SYNTHETIC_CASE==="already31"?31:30;
      globalThis.fixtureCommands=[];
      export async function loadMigrations(){
        const plan=await actualLoad();return process.env.JM_SYNTHETIC_CASE==="unexpected-schema"?plan.slice(0,30):plan;
      }
      export async function migrationStatus(connection,{migrations}){
        return migrations.map((m,i)=>({...m,state:process.env.JM_SYNTHETIC_CASE==="interrupted"&&i===30?"running":i<globalThis.fixtureApplied?"applied":"pending"}));
      }''')
    (root/'node_modules/mariadb/package.json').write_text('{"type":"module","main":"index.mjs"}')
    (root/'node_modules/mariadb/index.mjs').write_text('''export default {async createConnection(options){
      if(!options.ssl.rejectUnauthorized||options.ssl.minVersion!=="TLSv1.2"||options.multipleStatements!==false)throw new Error("insecure connection");
      if(process.env.JM_SYNTHETIC_CASE==="auth-error")throw Object.assign(new Error("native private SQL"),{code:"ER_ACCESS_DENIED_ERROR"});
      return {async query(sql){if(sql!=="SHOW SESSION STATUS LIKE \'Ssl_cipher\'")throw new Error("unexpected SQL");return [{Variable_name:"Ssl_cipher",Value:"SYNTHETIC"}];},
        async end(){}};
    }};''')
    def git(*args):
        return subprocess.check_output(['/usr/bin/git','-c','core.hooksPath=/dev/null','-C',str(root),*args],stderr=subprocess.PIPE).decode().strip()
    git('init','-q');git('add','.');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','fixture')
    sha=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}')
    events=private/'events'
    normal111=private/'start111.sh';normal120=private/'start120.sh';check111=private/'check111.sh';check120=private/'check120.sh'
    for p in [normal111,normal120]:p.write_text('#!/bin/bash\nexit 99\n');p.chmod(0o700)
    for p,label in [(check111,'111'),(check120,'120')]:
        p.write_text('#!/bin/bash\nprintf '+shlex.quote(label+'\n')+' >> '+shlex.quote(str(events))+'\n[[ "${JM_SYNTHETIC_CASE:-}" != '+shlex.quote('precheck'+label+'-error')+' ]]\n')
        p.chmod(0o700)
    logs=[]
    for name in ['jm111-node2422.log','jm120-node2422.log','jm111-preflight-cfa7dd35.log','jm120-preflight-763b6321.log']:
        p=private/name;p.write_text('synthetic preserved log\n');p.chmod(0o600);logs.append(p)
    adapted=source.replace('jm_checkout=/srv/customer/jessiemessage-operator/production-111-cfa7dd35','jm_checkout='+str(root))
    adapted=adapted.replace('jm_sha=cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a','jm_sha='+sha).replace('jm_tree=94b2fec5383fd948df7605b63f65a4e23078c2a1','jm_tree='+tree)
    adapted=adapted.replace('jm_target120=/srv/customer/jessiemessage-operator/production-120-763b6321','jm_target120='+str(root))
    adapted=adapted.replace('jm_source "$jm_target120" 763b632185ce13eb875110c9107687b2d278ff67 c7dce7bcdb99b298ffc43c9e31dd22ee87453926','jm_source "$jm_target120" '+sha+' '+tree)
    adapted=adapted.replace('jm_node=/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node','jm_node='+node)
    adapted=adapted.replace('67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c',hashlib.sha256(Path(node).read_bytes()).hexdigest())
    adapted=adapted.replace('== v24.22.0 ]]','== '+subprocess.check_output([node,'--version']).decode().strip()+' ]]')
    for path,oldpath,oldhash in [
      (normal111,'start-primary-release111-cfa7dd35.sh','8b73e7aeb2aae4da7d3e6d0a4f1257664b594fb9f914c34835cad9387842723c'),
      (normal120,'start-primary-release120-763b6321.sh','f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f'),
      (check111,'check-primary-release111-cfa7dd35.sh','2c5132241e1d6ee852ae7ff72cf7c2d62e5cb564aad3670de726d1f2a749d1e1'),
      (check120,'check-primary-release120-763b6321.sh','b5e7a6ef89c3fca613944757699ecb26b80a53838234fb84302ef1466fff3810')]:
        adapted=adapted.replace('/srv/customer/jessiemessage-private/'+oldpath,str(path)).replace(oldhash,hashlib.sha256(path.read_bytes()).hexdigest())
    for p in logs:adapted=adapted.replace('/srv/customer/jessiemessage-private/'+p.name,str(p))
    def case(label,scenario='ok',username='fixture_migrator',expect_success=True,expect_checks=('111','120'),expect_code=None,prompt=True,args=('--service-stopped',),mutation=None):
        events.unlink(missing_ok=True)
        if mutation:mutation(True)
        r,w=os.pipe();pid,terminal=pty.fork()
        if pid==0:
            os.close(w);os.dup2(r,0);os.close(r)
            env=dict(os.environ,JM_SYNTHETIC_CASE=scenario)
            if scenario=='inherited-export':env.update(jm_password='prior-value',SHELLOPTS='allexport')
            os.execve('/bin/bash',['bash','-s','--',*args],env)
        os.close(r);os.write(w,adapted.encode());os.close(w)
        transcript=b'';sent_user=sent_password=False;deadline=time.monotonic()+12
        try:
            while time.monotonic()<deadline:
                ready,_,_=select.select([terminal],[],[],0.05)
                if ready:
                    try:chunk=os.read(terminal,65536)
                    except OSError:break
                    if not chunk:break
                    transcript+=chunk
                if not sent_user and b'compte de migration existant : ' in transcript:
                    os.write(terminal,username.encode()+b'\n');sent_user=True
                if not sent_password and b'(saisie masquee) : ' in transcript:
                    os.write(terminal,secret.encode()+b'\n');sent_password=True
            else:os.kill(pid,9);raise AssertionError('timeout')
        finally:
            os.close(terminal);_,status=os.waitpid(pid,0)
            if mutation:mutation(False)
        output=transcript.decode(errors='replace')
        assert secret not in output and runtime_secret not in output and 'native private SQL' not in output,output
        assert sent_user==prompt,output
        assert (os.waitstatus_to_exitcode(status)==0)==expect_success,output
        rows=[json.loads(line) for line in output.splitlines() if line.startswith('{')]
        assert rows,output
        checked=tuple(events.read_text().splitlines()) if events.exists() else ()
        assert checked==expect_checks,(checked,output)
        assert all(p.read_text()=='synthetic preserved log\n' for p in logs)
        if expect_success:
            assert rows[-1]['status']=='schema31_prechecks_passed',output
            assert rows[0]['migration']['applied']==(0 if scenario=='already31' else 1)
            assert rows[0]['upgradeAttempted']==(scenario!='already31')
        if expect_code:assert rows[-1].get('code')==expect_code,output
        if scenario=='upgrade-error':assert rows[-1]['migrationApplied'] is None and rows[-1]['schemaState']=='inspection_required',output
        if scenario=='precheck120-error':assert rows[-1]['rollback111HostedQualified'] is True,output
        cases.append(label);print('PASS '+label)
    case('actual_migrator_upgrade_one_then_prechecks')
    case('already_applied_skips_upgrade',scenario='already31')
    case('password_not_exported',scenario='inherited-export')
    case('interrupted_history_blocks_upgrade_and_prechecks',scenario='interrupted',expect_success=False,expect_checks=(),expect_code='SCHEMA_STATUS_UNEXPECTED')
    case('unexpected_plan_blocks_upgrade',scenario='unexpected-schema',expect_success=False,expect_checks=(),expect_code='SCHEMA_STATUS_UNEXPECTED')
    case('failed_upgrade_requires_inspection',scenario='upgrade-error',expect_success=False,expect_checks=(),expect_code='MIGRATION_FAILED')
    case('precheck111_failure_blocks120',scenario='precheck111-error',expect_success=False,expect_checks=('111',))
    case('precheck120_failure_keeps111_evidence',scenario='precheck120-error',expect_success=False,expect_checks=('111','120'))
    case('auth_refusal_blocks_upgrade',scenario='auth-error',expect_success=False,expect_checks=(),expect_code='SQL_AUTHENTICATION_REFUSED')
    case('runtime_account_refused',username='fixture_runtime',expect_success=False,expect_checks=(),expect_code='MIGRATION_STATUS_ACCOUNT_REFUSED')
    case('reader_failure_blocks_upgrade',scenario='reader-error',expect_success=False,expect_checks=(),expect_code='RUNTIME_DATABASE_CONFIGURATION')
    case('service_stop_attestation_required',args=(),expect_success=False,expect_checks=(),prompt=False)
    original=check120.read_text()
    case('modified_launcher_refused_before_credentials',expect_success=False,expect_checks=(),prompt=False,
         mutation=lambda yes:check120.write_text(original+('# modified\n' if yes else '')))
    case('unsafe_log_mode_refused_before_credentials',expect_success=False,expect_checks=(),prompt=False,
         mutation=lambda yes:logs[0].chmod(0o644 if yes else 0o600))
print('RESULT '+str(len(cases))+'/'+str(len(cases))+' passed; script_sha256='+hashlib.sha256(SCRIPT.read_bytes()).hexdigest()+'; syntheticSQL only, no network/deployed data')
