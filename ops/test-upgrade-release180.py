#!/usr/bin/env python3
"""Synthetic qualification of the exact operator helper; no hosted files or SQL.

Only extracted blocks run against temporary files/modules, a PTY and loopback.
The full hosted helper is never executed with valid arguments.
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
HELPER = ROOT / 'upgrade-release180.sh'
SOURCE = HELPER.read_text()
SNAPSHOT = hashlib.sha256(HELPER.read_bytes()).hexdigest()
NODE = shutil.which('node')
assert NODE
PASSWORD = 'SyntheticPasswordOnly!42'
RESULTS = []

def passed(label):
    RESULTS.append(label)
    print('PASS ' + label)

def embedded(name):
    return SOURCE.split(name + "='\n",1)[1].split("\n'\n",1)[0]

COMMON, CODE = embedded('jm_common'), embedded('jm_code')
subprocess.run(['/bin/bash','-n',str(HELPER)],check=True)
subprocess.run([NODE,'--input-type=module','--check'],input=(COMMON+'\n'+CODE).encode(),check=True)
assert 'set +a' in SOURCE and 'unset jm_password' in SOURCE and 'export jm_password' not in SOURCE
assert SOURCE.index('stty -echo <&3') < SOURCE.index('Mot de passe SQL') < SOURCE.index('read -r -s -u 3 jm_password')
assert '3<&-' in SOURCE and 'runtime-node-v24.22.1/bin/node' in SOURCE
assert 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb' in SOURCE
assert SOURCE.index('jm_source "$jm_checkout"') < SOURCE.index('jm_common=')
assert SOURCE.index('"$jm_node" --input-type=module -e "$jm_common" -- "$jm_mode"') < SOURCE.index('exec 3<>/dev/tty')
assert 'loadPlan: async () => plan' in CODE and 'loadVideoMigrations()' in CODE and 'ordinary.length !== 33' in CODE
assert 'record.version === 1 ? "HISTORICAL_CLOSURE_PENDING"' in CODE
assert 'offline:true' in CODE and 'createConfiguredServer' not in SOURCE and 'rm ' not in SOURCE
assert 'start-local-closures' not in SOURCE and 'record-release' not in SOURCE
passed('syntax_explicit_candidate_loader_and_precredential_gates')
for args in [[],['--service-stopped'],['--service-running','a'*64,'b'*64],['--service-stopped','bad','b'*64],['--status','a'*64]]:
    result=subprocess.run(['/bin/bash',str(HELPER),*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    assert result.returncode != 0 and b'Identite SQL' not in result.stdout+result.stderr
passed('exact_mode_and_two_explicit_fingerprint_arguments_required')

# The exact stop observation block: scoped process facts, disappearance,
# permission failure, and a real ephemeral loopback listener where available.
stop=COMMON.split('// BEGIN STOP CHECK:',1)[1].split('// END STOP CHECK',1)[0]
stop=stop[stop.index('\n')+1:]
stop_test='''
import assert from "node:assert/strict";
import {createConnection,createServer} from "node:net";
const ROOT="/srv/customer/jessiemessage-private";
const refuse=code=>{throw Object.assign(Error(),{code});};
let denied=false;
const sample={pid:process.pid+100000,uid:process.getuid(),exe:ROOT+"/runtime-node-v24.22.1/bin/node",cwd:"/tmp",command:"node"};
async function readdir(){return [String(sample.pid)];}
async function readFile(path){if(denied)throw Object.assign(Error(),{code:"EACCES"});return path.endsWith("/status")?"Uid: "+sample.uid+" 0 0 0\\n":sample.command;}
async function readlink(path){return path.endsWith("/exe")?sample.exe:sample.cwd;}
'''+stop+'''
assert.throws(()=>refuseLiveService([sample]),e=>e.code==="SERVICE_NOT_STOPPED");
assert.throws(()=>refuseLiveService([{...sample,exe:"/usr/bin/node",cwd:"/srv/customer/jessiemessage-operator/production-171-c2d7b3b3"}]),e=>e.code==="SERVICE_NOT_STOPPED");
assert.doesNotThrow(()=>refuseLiveService([{...sample,pid:process.pid}]));
assert.doesNotThrow(()=>refuseLiveService([{...sample,uid:sample.uid+1}]));
assert.doesNotThrow(()=>refuseLiveService([{...sample,exe:"/usr/bin/node",cwd:"/tmp"}]));
assert.equal((await ownedProcessFacts()).length,1);denied=true;
await assert.rejects(ownedProcessFacts(),e=>e.code==="SERVICE_STOP_UNVERIFIED");
const server=createServer();
try{await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});}
catch(error){if(!process.env.CI&&!process.env.JM180_REQUIRE_NATIVE&&["EPERM","EACCES"].includes(error.code)){console.log("NATIVE_PORT_UNAVAILABLE");process.exit(0);}throw error;}
const port=server.address().port;
await assert.rejects(portClosed("127.0.0.1",port),e=>e.code==="SERVICE_NOT_STOPPED");
await new Promise(resolve=>server.close(resolve));await portClosed("127.0.0.1",port);
console.log("NATIVE_PORT_PASSED");
'''
result=subprocess.run([NODE,'--input-type=module','-e',stop_test],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
assert result.returncode==0,(result.stdout,result.stderr)
if b'NATIVE_PORT_UNAVAILABLE' in result.stdout:print('LIMIT native loopback listener unavailable locally; required in CI')
passed('actual_stop_block_process_scope_permission_refusal_and_bounded_port_probe')

with tempfile.TemporaryDirectory(prefix='release180-upgrade-fixture-') as temporary:
    root=Path(temporary)
    def write(name,text,mode=0o600):
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);p.chmod(mode);return p
    # Exercise the original source-gate function on a real disposable Git repo.
    repo=root/'source';repo.mkdir()
    def git(*args):
        return subprocess.run(['/usr/bin/git','-C',str(repo),*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.decode().strip()
    git('init');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','--allow-empty','-m','synthetic')
    sha=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}');git('tag','v1.8.0')
    source_function=re.search(r'^jm_source\(\) \{\n.*?^\}',SOURCE,re.M|re.S)[0]
    def source_gate(commit=sha,expected_tree=tree,version='1.8.0'):
        return subprocess.run(['/bin/bash','-c','set -euo pipefail\n'+source_function+'\njm_source "$1" "$2" "$3" "$4"','synthetic source',str(repo),commit,expected_tree,version],stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode
    assert source_gate()==0 and source_gate(commit='0'*40)!=0 and source_gate(expected_tree='0'*40)!=0 and source_gate(version='1.7.2')!=0
    (repo/'untracked').write_text('synthetic');assert source_gate()!=0
    passed('real_source_commit_tree_tag_and_dirty_checkout_guards')

    # File pins: actual O_NOFOLLOW reads/metadata checks, synthetic scope adapter.
    private=root/'private';private.mkdir(mode=0o700)
    bundle=private/'runtime-video-180';bundle.mkdir(mode=0o700)
    source6=private/'primary-origin-candidate-4a355851';source6.mkdir(mode=0o700)
    scope_module=write('server/files/private-directory.mjs','export async function withPrivateDirectory(directory,work){return work({path:directory,file:name=>directory+"/"+name,async assertReady(){}});}\n')
    names=sorted(['runtime-database.json','runtime-auth.json','runtime-messaging.json','runtime-media.json','runtime-notifications.json','runtime-crm.json','runtime-video.json'])
    contents={name:(json.dumps({'synthetic':name})+'\n').encode() for name in names}
    for name,content in contents.items():
        (bundle/name).write_bytes(content);(bundle/name).chmod(0o600)
        if name!='runtime-video.json':(source6/name).write_bytes(content);(source6/name).chmod(0o600)
    def bundle_hash():
        h=hashlib.sha256()
        for name in names:
            content=(bundle/name).read_bytes();h.update(name.encode()+b'\0'+str(len(content)).encode()+b'\0'+content)
        return h.hexdigest()
    releases=[]
    for version,short,sha,tree in [('1.7.2','172','6b3319a77c307ed7d6b003fe33de36807c70c266','924d500375a69ae50bc63414b15df71271e2bf8a'),('1.8.0','180','fd6e53b14b520231b0b307a2761331dd8c740a5b','324c3563fc6b1cfce669bcf58d90962c23c966b8')]:
        suffix=short+'-'+sha[:8];start=private/('start-primary-release'+suffix+'.sh');check=private/('check-primary-release'+suffix+'.sh')
        for p in [start,check]:p.write_text('#!/bin/bash\nexit 0\n');p.chmod(0o700)
        log=private/('jm'+short+'-node24221.log');prelog=private/('jm'+short+'-preflight-node24221-'+sha[:8]+'.log')
        for p in [log,prelog]:p.write_text('');p.chmod(0o600)
        releases.append(dict(version=version,source=sha,tree=tree,checkout=str(root/'operator'/('production-'+suffix)),launcher=str(start),launcherSha256=hashlib.sha256(start.read_bytes()).hexdigest(),launcherMode='0700',checkLauncher=str(check),checkLauncherSha256=hashlib.sha256(check.read_bytes()).hexdigest(),checkLauncherMode='0700',log=str(log),logMode='0600',precheckLog=str(prelog),precheckLogMode='0600',profile='photos-notify-recovery-crm-broadcast-video',videoConfigurationDirectory=str(bundle),started=False,migrated=False,precheckPassed=False,hostedQualified=False,videoConfigurationPrepared=False))
    receipt=dict(format='jessiemessage-release180-staging',version=1,status='release180_sources_staged_not_qualified',releases=releases,nodeVersion='v24.22.1',nodeBinarySha256='e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb',schemaMigrationsExpected=36,baselineMigrationFiles=33,videoConfigurationDirectory=str(bundle),operationsDirectory=str(private/'recurring-backup-052'),rollbackRelease='1.7.2',normalMigrationsPreserved=True,candidateVideoMigrationsIdentical=True,priorActivePreserved=True,rollbackPrepared=True,noRestart=True)
    for name in ['started','migrated','runtimeStarted','managerChanged','checkpointChanged','hostedQualified','sqlStatusChecked','videoConfigurationPrepared','rollbackHostedQualified']:receipt[name]=False
    rp=private/'jm180-staging.json'
    def save_receipt():
        rp.write_text(json.dumps(receipt)+'\n');rp.chmod(0o600);return hashlib.sha256(rp.read_bytes()).hexdigest()
    common=COMMON.replace('/srv/customer/jessiemessage-private',str(private)).replace('/srv/customer/jessiemessage-operator',str(root/'operator'))
    common=re.sub(r'async function verifySource\(value\) \{.*?\n\}', 'async function verifySource(value) {}',common,count=1,flags=re.S)
    def check_pins(staging=None,bundle_pin=None,valid=True):
        result=subprocess.run([NODE,'--input-type=module','-e',common,'--','--status',staging or save_receipt(),bundle_pin or bundle_hash()],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
        assert (result.returncode==0) is valid,(result.stdout,result.stderr)
        assert b'synthetic' not in result.stdout+result.stderr
    check_pins();check_pins(staging='0'*64,valid=False);check_pins(bundle_pin='0'*64,valid=False)
    receipt['started']=True;check_pins(valid=False);receipt['started']=False
    receipt['releases'][0]['tree']='0'*40;check_pins(valid=False);receipt['releases'][0]['tree']='924d500375a69ae50bc63414b15df71271e2bf8a'
    changed=bundle/'runtime-auth.json';changed.write_bytes(b'different');check_pins(valid=False);changed.write_bytes(contents[changed.name])
    changed.chmod(0o644);check_pins(valid=False);changed.chmod(0o600)
    changed.unlink();changed.symlink_to(source6/changed.name);check_pins(valid=False);changed.unlink();changed.write_bytes(contents[changed.name]);changed.chmod(0o600)
    linked=bundle/'extra-link';os.link(changed,linked);check_pins(valid=False);linked.unlink()
    launcher=Path(releases[0]['launcher']);launcher.write_text('# changed\n');check_pins(valid=False)
    passed('receipt_flags_sources_launcher_hashes_bundle_aggregate_modes_links_and_exact_six_bytes')

    api='''
import {readFileSync,appendFileSync} from "node:fs";
export const scenario=JSON.parse(readFileSync("scenario.json"));
export const trace=value=>appendFileSync("trace.jsonl",JSON.stringify(value)+"\\n");
export const VIDEO_RUNTIME_OPTIONS={originProfile:"primary",recovery:true};
export async function readRuntimeDatabaseConfiguration(){const c={user:"runtime_user",password:"private-runtime-secret",host:"sql.invalid",port:3306,database:"synthetic"};process.on("exit",()=>trace({configurationPasswordCleared:c.password===""}));return c;}
export async function loadRuntimeVideoEnvironment(){return {JESSIEMESSAGE_MEDIA_ROOT:"photos",JESSIEMESSAGE_MEDIA_KEY:Buffer.alloc(32,1).toString("base64url"),JESSIEMESSAGE_CRM_KEY:Buffer.alloc(32,2).toString("base64url")};}
export function runtimeVideoConfiguration(){return {root:"video",key:Buffer.alloc(32,3),capacity:{ownerBytes:1073741824,totalBytes:10737418240},minimumFreeBytes:536870912};}
export function privateAuthenticationProcessOptions(){return {port:"3000"};}
export function clearRuntimeMessagingSecrets(){}
export async function assertDistinctVideoRoots(){trace({rootsChecked:true});if(scenario.rootsError)throw Error("SyntheticPasswordOnly!42");}
export async function readPassword(input){let value="";for await(const c of input)value+=c;if(value!=="SyntheticPasswordOnly!42")throw Object.assign(Error(),{code:"MIGRATION_INPUT_PASSWORD"});return value;}
const base=Array.from({length:33},(_,i)=>({version:i+1,name:String(i+1),checksum:"b".repeat(64)}));
export async function loadMigrations(){return base;}
export async function loadVideoMigrations(){return [...base,...["0034_video_storage_state.sql","0035_video_assets.sql","0036_message_video.sql"].map((name,i)=>({version:i+34,name,checksum:"c".repeat(64)}))].slice(0,scenario.planLength??36);}
export async function migrationStatus(){return [];}
export async function applyMigrations(){trace({ddl:true});if(scenario.ddlError)throw Object.assign(Error("private"),{code:"MIGRATION_FAILED"});return {};}
export function databaseOptions(){return {};}
export async function createMediaStorage(){return {fingerprint:async()=>Buffer.alloc(32,4)};}
export async function createVideoStorage(){return {fingerprint:async()=>Buffer.alloc(32,5),availableSpace:async()=>({availableBytes:scenario.lowSpace?1n:999999999999n})};}
let barrier=0;
export async function captureOperationalState(){trace({barrier:++barrier});if(scenario.operationError)throw Object.assign(Error(),{code:scenario.operationError});return {jobs:scenario.receipts??(scenario.pendingVersion&&barrier>=(scenario.pendingAt??1)?[{record:{phase:"requested",version:scenario.pendingVersion}}]:[])};}
export function snapshotErasureRegistry(state){return state;}
export function authenticateRegistrySnapshot(state){return {jobs:new Map(state.jobs.map((j,i)=>[i,j]))};}
export async function createRuntimePool(){trace({pool:true});return {getConnection:async()=>({query:async()=>[{assets:scenario.assets??0,links:0,states:0}],release:async()=>trace({released:true})}),end:async()=>trace({poolClosed:true})};}
export function createChatStore(){return {};}
export function createVideoStore(){return {assertSchema:async()=>trace({videoSchema:true}),status:async()=>({ready:false,heldBytes:0,pendingBytes:0}),initialize:async value=>{trace({initialize:value.offline});if(scenario.initializeError)throw Error("SyntheticPasswordOnly!42");return {ready:true,heldBytes:0,pendingBytes:0,ownerBytes:1073741824,totalBytes:10737418240};}};}
let call=0;
export async function run(options,password,deps){trace({command:options.command,passwordCorrect:password==="SyntheticPasswordOnly!42",passwordInArgs:process.argv.some(x=>x.includes(password)),passwordInEnvironment:Object.values(process.env).includes(password),account:options.user,confirmed:options.confirmation===options.database});const plan=await deps.loadPlan();if(plan.length!==36)throw Error();const c=await deps.connect({});await deps.status(c,{});if(options.command==="upgrade")await deps.apply(c,{});const action=scenario.actions[call++];if(!action)throw Error("unexpectedcall");if(action.error)throw Object.assign(Error("SyntheticPasswordOnly!42"),{code:action.error});return action;}
export default {createConnection:async()=>{if(scenario.connectionError)throw Object.assign(Error("SyntheticPasswordOnly!42"),{code:scenario.connectionError});return {};}};
'''
    write('fixture-api.mjs',api)
    paths=re.findall(r'await import\("(\./[^\"]+)"\)',CODE)
    for path in paths:
        p=root/path;p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text('export * from '+json.dumps((root/'fixture-api.mjs').as_uri())+';\n')
    write('node_modules/mariadb/package.json','{"name":"mariadb","type":"module","exports":"./index.mjs"}')
    write('node_modules/mariadb/index.mjs','export {default} from '+json.dumps((root/'fixture-api.mjs').as_uri())+';\n')
    prelude='''
import {scenario,trace} from "./fixture-api.mjs";
const mode=process.argv[1],SOURCE6="source",BUNDLE="bundle",VIDEO_ROOT="video",OPERATIONS="operations",RELEASES=[{}, {source:"fd6e53b14b520231b0b307a2761331dd8c740a5b"}];
const refuse=code=>{throw Object.assign(Error("private synthetic"),{code});};
let pins=0,stops=0;
async function verifyPins(){trace({pins:++pins});if(scenario.badPinsAt===pins)refuse("RELEASE_PINS");}
async function assertServiceStopped(){trace({stop:++stops});if(scenario.liveAt===stops)refuse("SERVICE_NOT_STOPPED");}
async function withPrivateDirectory(directory,work){return work({path:directory});}
async function readdir(){return scenario.nonemptyRoot?["existing"]:[];}
'''
    checked33=dict(status='checked',engineVerified=True,transportVerified=True,migrations=36,applied=33,pending=3,interrupted=False)
    checked36=dict(checked33,applied=36,pending=0)
    upgraded=dict(status='upgraded',engineVerified=True,transportVerified=True,migrations=36,applied=3,unchanged=33)
    def run_code(label,actions,*,mode='--service-stopped',valid=True,user='existing_migrator',commands=None,code=None,**scenario):
        write('scenario.json',json.dumps(dict(actions=actions,**scenario)));tracefile=root/'trace.jsonl';tracefile.unlink(missing_ok=True)
        result=subprocess.run([NODE,'--input-type=module','-e',prelude+'\n'+CODE,'--',mode,'a'*64,'b'*64,user],input=PASSWORD.encode(),cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
        assert (result.returncode==0) is valid,(label,result.stdout,result.stderr)
        assert PASSWORD.encode() not in result.stdout+result.stderr and b'private-runtime-secret' not in result.stdout+result.stderr
        values=[json.loads(line) for line in result.stdout.splitlines()];assert len(values)==1,(label,values,result.stderr)
        value=values[0];events=[json.loads(line) for line in tracefile.read_text().splitlines()] if tracefile.exists() else []
        calls=[e for e in events if 'command' in e]
        if commands is not None:assert [e['command'] for e in calls]==commands,(label,calls)
        assert all(e['passwordCorrect'] and not e['passwordInArgs'] and not e['passwordInEnvironment'] and e['confirmed'] for e in calls)
        assert any(e.get('configurationPasswordCleared') is True for e in events)
        if code:assert value['code']==code,(label,value)
        assert value['runtimeStarted'] is False
        if not valid:assert value['noAutomaticRetry'] is True and value['restart171Allowed'] is False
        passed(label);return value,events
    run_code('status_reads_exact33_plus_three_candidate_ddls_without_mutation',[checked33],mode='--status',commands=['status'])
    value,events=run_code('upgrade33_to36_then_initializes_empty_video_offline',[checked33,upgraded,checked36],commands=['status','upgrade','status'])
    assert value['schema36Confirmed'] is True and value['upgradeAttempted'] is True and any(e.get('initialize') is True for e in events)
    assert next(i for i,e in enumerate(events) if e.get('ddl')) < next(i for i,e in enumerate(events) if e.get('initialize'))
    run_code('already36_rechecks_without_ddl_then_initializes_idempotently',[checked36,checked36],commands=['status','status'])
    for name,status in [('partial34_refused',dict(checked33,applied=34,pending=2)),('older32_refused',dict(checked33,applied=32,pending=4)),('interrupted_refused',dict(checked33,interrupted=True)),('tls_unverified_refused',dict(checked33,transportVerified=False))]:
        run_code(name,[status],valid=False,commands=['status'],code='SCHEMA_STATUS_UNEXPECTED')
    run_code('runtime_migration_account_refused_before_sql',[],valid=False,user='runtime_user',commands=[],code='MIGRATION_STATUS_ACCOUNT_REFUSED')
    for error,expected in [('ER_ACCESS_DENIED_ERROR','SQL_AUTHENTICATION_REFUSED'),('CERT_HAS_EXPIRED','SQL_TLS_CERTIFICATE_REFUSED'),('PRIVATE_UNKNOWN','SQL_CONNECTION_FAILED')]:
        run_code('sql_connection_failure_is_neutral_'+error,[],valid=False,connectionError=error,commands=['status'],code=expected)
    value,events=run_code('pending_v1_receipt_refused_before_upgrade',[checked33],valid=False,pendingVersion=1,commands=['status'],code='HISTORICAL_CLOSURE_PENDING')
    assert value['upgradeAttempted'] is False and not any(e.get('ddl') for e in events)
    run_code('pending_v1_appearing_at_second_guard_refused_before_upgrade',[checked33],valid=False,pendingVersion=1,pendingAt=2,commands=['status'],code='HISTORICAL_CLOSURE_PENDING')
    run_code('pending_v2_receipt_is_not_silently_replayed',[checked36],valid=False,pendingVersion=2,commands=['status'],code='ERASURE_PENDING')
    run_code('duplicate_legacy_and_video_client_receipts_refused_before_ddl',[checked33],valid=False,receipts=[dict(record=dict(clientId='a'*32,phase='completed',version=v)) for v in [1,2]],commands=['status'],code='ERASURE_CHANGED')
    run_code('restoration_marker_refused_before_upgrade',[checked33],valid=False,operationError='OPERATIONS_RECONCILIATION_REQUIRED',commands=['status'],code='OPERATIONS_RECONCILIATION_REQUIRED')
    run_code('runtime_reappearing_refused_before_upgrade',[checked33],valid=False,liveAt=1,commands=['status'],code='SERVICE_NOT_STOPPED')
    run_code('changed_pins_refused_before_upgrade',[checked33],valid=False,badPinsAt=1,commands=['status'],code='RELEASE_PINS')
    for extra in [dict(nonemptyRoot=True),dict(lowSpace=True)]:
        run_code('nonempty_or_low_space_video_root_refused_before_ddl',[checked33],valid=False,commands=['status'],code='VIDEO_INITIALIZATION',**extra)
    value,events=run_code('ddl_failure_requires_inspection_without_retry',[checked33],valid=False,ddlError=True,commands=['status','upgrade'],code='MIGRATION_FAILED')
    assert value['migrationApplied'] is None and value['schemaState']=='inspection_required' and not any(e.get('initialize') for e in events)
    run_code('post_upgrade_unconfirmed_history_blocks_initialization',[checked33,upgraded,checked33],valid=False,commands=['status','upgrade','status'],code='SCHEMA_STATUS_UNEXPECTED')
    value,events=run_code('nonempty_video_sql_catalog_refused_after36',[checked33,upgraded,checked36],valid=False,assets=1,code='VIDEO_INITIALIZATION')
    assert value['schema36Confirmed'] is True and not any(e.get('initialize') for e in events)
    value,events=run_code('initialization_ambiguity_preserves_confirmed36_without_restart',[checked33,upgraded,checked36],valid=False,initializeError=True)
    assert value['schema36Confirmed'] is True and value['videoInitializationAttempted'] is True

    # Exact credential block, immediate PTY paste, private pipe and FD3 closed.
    input_block='exec 3<>/dev/tty'+SOURCE.split('exec 3<>/dev/tty',1)[1].split("jm_code='",1)[0]
    dispatch='if printf'+SOURCE.split('if printf',1)[1].split('[[ "$jm_mode" != --status ]]',1)[0]
    fake=write('node-tty-fixture.sh','''#!/bin/bash
set -euo pipefail
[[ ! -t 0 && ! -e /proc/$$/fd/3 ]]
[[ "$4" == -- && "$8" == existing_migrator && "$*" != *SyntheticPasswordOnly* ]]
[[ "${jm_password-unset}" == unset ]]
IFS= read -r -d "" secret || true
[[ "$secret" == SyntheticPasswordOnly!42 ]]
printf "PRIVATE_PIPE_AND_FD3_OK\\n"
''',0o700)
    harness='set +x\nset +a\nset -euo pipefail\nunset jm_password\njm_tty_state=\n'+re.search(r'^jm_cleanup\(\) \{\n.*?^\}',SOURCE,re.M|re.S)[0]+'\ntrap jm_cleanup EXIT\njm_node="$1"\n'+input_block+'\njm_common=synthetic\njm_code=synthetic\njm_mode=--status\njm_staging_sha=a\njm_bundle_sha=b\n'+dispatch
    master,slave=pty.openpty();pid=os.fork()
    if pid==0:
        os.setsid();import fcntl;fcntl.ioctl(slave,termios.TIOCSCTTY,0)
        os.dup2(slave,0);os.dup2(slave,1);os.dup2(slave,2);os.close(master)
        if slave>2:os.close(slave)
        os.execv('/bin/bash',['/bin/bash','-c',harness,'synthetic tty',str(fake)])
    os.close(slave);output=b'';sent_user=sent_password=False;deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        ready,_,_=select.select([master],[],[],0.1)
        if ready:
            try:chunk=os.read(master,65536)
            except OSError:break
            if not chunk:break
            output+=chunk
            if not sent_user and b'Identite SQL' in output:os.write(master,b'existing_migrator\n');sent_user=True
            if not sent_password and b'saisie masquee' in output:
                assert termios.tcgetattr(master)[3]&termios.ECHO==0
                os.write(master,PASSWORD.encode()+b'\n');sent_password=True
    _,status=os.waitpid(pid,0)
    try:restored=bool(termios.tcgetattr(master)[3]&termios.ECHO)
    finally:os.close(master)
    assert os.waitstatus_to_exitcode(status)==0 and restored and sent_user and sent_password,(status,output)
    assert PASSWORD.encode() not in output and b'PRIVATE_PIPE_AND_FD3_OK' in output
    passed('tty_masking_before_prompt_secret_pipe_only_and_fd3_closed')

    suffix='trap - ERR'+SOURCE.split('trap - ERR',1)[1]
    assert 'bash "$jm_start' not in suffix and '>' not in suffix.replace('>/dev/null 2>&1','')
    for failed in [None,'172','180']:
        case=root/('checks-'+str(failed));case.mkdir();trace=case/'trace';trace.write_text('existing\n')
        candidate=suffix
        for number,sha in [('172','6b3319a7'),('180','fd6e53b1')]:
            path=case/('check'+number+'.sh');path.write_text('#!/bin/bash\nprintf "'+number+'\\n" >> "$CHECK_TRACE"\nexit '+('1' if failed==number else '0')+'\n')
            candidate=candidate.replace('/srv/customer/jessiemessage-private/check-primary-release'+number+'-'+sha+'.sh',str(path))
        result=subprocess.run(['/bin/bash','-c','set -euo pipefail\n'+candidate],env=dict(os.environ,CHECK_TRACE=str(trace)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
        value=json.loads(result.stdout);assert result.returncode==(0 if failed is None else 1)
        assert trace.read_text()==('existing\n172\n' if failed=='172' else 'existing\n172\n180\n')
        assert value['runtimeStarted'] is False and value['schema36Confirmed'] is True
    passed('exact_post_sql_block_runs172_then180_checks_only_and_preserves_logs')

assert hashlib.sha256(HELPER.read_bytes()).hexdigest()==SNAPSHOT
print(f'RESULT {len(RESULTS)}/{len(RESULTS)} passed; no hosted helper, SQL connection or runtime start')
