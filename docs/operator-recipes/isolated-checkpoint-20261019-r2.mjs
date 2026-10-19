// Temporary operator glue; no secret value is embedded in this file.
import { constants } from 'node:fs';
import { lstat, open, mkdir, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = '/srv/customer/jessiemessage-operator/witness-recovery-control-072-94fb7882';
const HEAD = '94fb7882cf74eb5f2ec165e67833ac2e7cdf13f3';
const TREE = 'c6d304e49209a1194d91c0992096e59ff3685b6e';
const ROOT = '/srv/customer/jessiemessage-private';
const ORIGINAL = `${ROOT}/primary-origin-candidate-4a355851`;
const OPS = `${ROOT}/recurring-backup-052`;
const CAPTURE = `${OPS}/capture-1792386945745-204e0e8e073b6131`;
const COPY = `${ROOT}/restore-d19-checkpoint`;
const QUARANTINE = `${ROOT}/restore-d19-quarantine`;
const OPERATOR = `${ROOT}/restore-d19-operator`;
const AUTHORITY = `${ROOT}/witness-origin-069-6b84f6e1`;
const CONTRACT = '4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10';
const DATABASE = 'fb4hmr_jm_restore_20261019', USER = 'fb4hmr_jm_d19';
const HOST = 'fb4hmr.myd.infomaniak.com';
const PROFILE = 'photos-notify-recovery-crm-broadcast';
const STAGES = new Set(['prepare', 'access', 'precheck', 'quarantine', 'quarantine-resume', 'import', 'verify', 'final']);
const stage = process.argv[2];
let phase = 'arguments';
const fail = code => { const error = new Error(); error.code = `D19_${code}`; throw error; };
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const moduleAt = relative => import(pathToFileURL(`${REPO}/${relative}`).href);
const ENV = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', JESSIEMESSAGE_PRIVATE_PATH_MODE: 'linux-dirfd' };
const stateNames = ['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'];
const same = (a,b) => stateNames.every(name => a[name] === b[name]);
function regular(s) {
  if (!s.isFile() || s.uid !== BigInt(process.getuid()) || (s.mode & 0o7777n) !== 0o600n || s.nlink !== 1n) fail('PRIVATE_FILE');
}
async function readPrivate(scope, name, maximum = 4*1024*1024) {
  await scope.assertReady();
  let handle, bytes;
  try {
    handle = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({bigint:true}); regular(before);
    if (before.size < 1n || before.size > BigInt(maximum)) fail('FILE_LIMIT');
    bytes = Buffer.alloc(Number(before.size)); let at = 0;
    while (at < bytes.length) { const { bytesRead } = await handle.read(bytes, at, bytes.length-at, at); if (!bytesRead) fail('FILE_CHANGED'); at += bytesRead; }
    const after = await handle.stat({bigint:true}), visible = await lstat(scope.file(name), {bigint:true});
    regular(after); regular(visible); if (!same(before,after) || !same(after,visible)) fail('FILE_CHANGED');
    await scope.assertReady(); return bytes;
  } catch(error) { bytes?.fill(0); throw error; }
  finally { await handle?.close(); }
}
async function writePrivate(scope, name, bytes) {
  let handle;
  await scope.assertReady();
  try {
    handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    await handle.chmod(0o600); await handle.writeFile(bytes); await handle.sync();
    const written = await handle.stat({bigint:true}); regular(written);
    if (written.size !== BigInt(bytes.length)) fail('WRITE');
  } finally { await handle?.close(); }
  await scope.sync();
  const back = await readPrivate(scope,name,Math.max(bytes.length,1));
  try { if (!back.equals(bytes)) fail('WRITE'); } finally { back.fill(0); }
}
const resultName = name => `d19-${name}.json`;
let withPrivateDirectory;
async function readResult(name, optional = false) {
  return withPrivateDirectory(OPERATOR, async scope => {
    if (optional) { try { await lstat(scope.file(resultName(name))); } catch(error) { if (error.code === 'ENOENT') return null; throw error; } }
    const bytes = await readPrivate(scope,resultName(name));
    try { return JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
  });
}
async function save(name, value) {
  await withPrivateDirectory(OPERATOR, async scope => {
    const bytes=Buffer.from(`${JSON.stringify(value)}\n`); try { await writePrivate(scope,resultName(name),bytes); } finally { bytes.fill(0); }
  });
  return value;
}
async function git(...args) {
  return new Promise((yes,no) => execFile('/usr/bin/git',['-C',REPO,...args], {env:ENV,encoding:'utf8',maxBuffer:1024*1024,timeout:10000}, (error,stdout) => error ? no(Object.assign(new Error(),{code:'D19_SOURCE'})) : yes(stdout.trim())));
}
async function pins() {
  if (await git('rev-parse','HEAD') !== HEAD || await git('rev-parse','HEAD^{tree}') !== TREE || await git('status','--porcelain')) fail('SOURCE');
}
async function hashes() {
  const value = {};
  for (const name of ['runtime-database.json','runtime-auth.json','runtime-messaging.json','runtime-media.json','runtime-notifications.json','runtime-crm.json']) {
    value[name] = await withPrivateDirectory(ORIGINAL, async scope => {const b=await readPrivate(scope,name); try{return hash(b);}finally{b.fill(0);}});
  }
  for (const [dir,name] of [['contract','witness-genesis.json'],['enrollment','witness-enrollment-origin.json'],['enrollment','witness-enrollment.json']]) {
    value[`${dir}/${name}`]=await withPrivateDirectory(`${AUTHORITY}/${dir}`,async scope=>{const b=await readPrivate(scope,name);try{return hash(b);}finally{b.fill(0);}});
  }
  if (value['contract/witness-genesis.json']!==CONTRACT
    || value['enrollment/witness-enrollment-origin.json']!=='817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1'
    || value['enrollment/witness-enrollment.json']!=='445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a') fail('AUTHORITY_CHANGED');
  return value;
}
async function unchanged() {
  await pins(); const before=await readResult('baseline'); if (!equal(before.hashes,await hashes())) fail('SOURCE_CHANGED');
}
async function credentials(source) {
  return withPrivateDirectory(OPERATOR, async scope=>{
    const bytes=await readPrivate(scope,'import-operator.json',16384);
    try {
      const v=JSON.parse(bytes.toString('utf8'));
      if (!v || Object.getPrototypeOf(v)!==Object.prototype || !equal(Object.keys(v).sort(),['database','format','host','password','user','version'])
        || v.format!=='jessiemessage-isolated-restore-operator' || v.version!==1 || v.host!==HOST || v.host!==source.JESSIEMESSAGE_DB_HOST
        || v.database!==DATABASE || v.user!==USER || DATABASE.toLowerCase()===source.JESSIEMESSAGE_DB_NAME.toLowerCase() || USER===source.JESSIEMESSAGE_RUNTIME_DB_USER
        || typeof v.password!=='string' || !v.password || !v.password.isWellFormed() || /[\x00-\x1f\x7f]/.test(v.password) || Buffer.byteLength(v.password)>4096) fail('OPERATOR');
      return v;
    } finally {bytes.fill(0);}
  });
}
async function cli(script, args, password, timeoutMs = 180000) {
  return new Promise((yes,no)=>{
    const began=process.hrtime.bigint();
    const child=spawn(process.execPath,[`${REPO}/scripts/${script}`,...args],{cwd:REPO,env:ENV,stdio:['pipe','pipe','pipe'],detached:true});
    let out=Buffer.alloc(0),err=Buffer.alloc(0),bad=false,done=false,timedOut=false,wasCancelled=false;
    const diagnostics=(exitCode=null,signal=null)=>({childElapsedMilliseconds:Number((process.hrtime.bigint()-began)/1000000n),
      childExitCode:Number.isInteger(exitCode)?exitCode:null,childSignal:typeof signal==='string'&&/^SIG[A-Z0-9]+$/.test(signal)?signal:null,
      childTimedOut:timedOut,childCancelled:wasCancelled});
    const groupSignal=signal=>{if(!child.pid)return;try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}};
    const kill=()=>{bad=true;groupSignal('SIGTERM');};
    const timer=setTimeout(()=>{timedOut=true;kill();},Math.max(1000,timeoutMs-10000));
    const hardTimer=setTimeout(()=>{timedOut=true;bad=true;groupSignal('SIGKILL');},timeoutMs);
    const cancelled=()=>{wasCancelled=true;kill();};process.once('SIGINT',cancelled);process.once('SIGTERM',cancelled);
    const clean=()=>{clearTimeout(timer);clearTimeout(hardTimer);groupSignal('SIGKILL');process.removeListener('SIGINT',cancelled);process.removeListener('SIGTERM',cancelled);out.fill(0);err.fill(0);};
    const consume=(which,chunk)=>{const old=which==='out'?out:err;const next=Buffer.concat([old,chunk]);old.fill(0);chunk.fill(0);if(which==='out')out=next;else err=next;if(next.length>262144)kill();};
    child.stdout.on('data',c=>consume('out',c));child.stderr.on('data',c=>consume('err',c));
    child.stdin.on('error',kill);child.stdout.on('error',kill);child.stderr.on('error',kill);
    child.once('error',()=>{if(!done){done=true;const diagnostic=diagnostics();clean();no(Object.assign(new Error(),{code:'D19_CHILD',...diagnostic}));}});
    child.once('close',(code,signal)=>{
      if(done)return;done=true;
      try{
        if(bad||code!==0||signal){
          let detail,childPhase,childStatus;
          const stderr=err.toString('utf8');
          const operational=/^(OPERATIONS_[A-Z_]+): Private operational recovery was not confirmed\.\s*$/.exec(stderr);
          if(operational)detail=operational[1];
          else try{
            const value=JSON.parse(stderr.trim());
            if(/^(?:APPLICATION_CHECKPOINT_RESUME|APPLICATION_CHECKPOINT_IMPORT|PRIVATE_CHECKPOINT_VERIFY)_[A-Z_]+$/.test(value?.code??''))detail=value.code;
            if(['arguments','precheck','configuration','password','connection','inspection','import','verification','cleanup'].includes(value?.phase))childPhase=value.phase;
            if(['application_checkpoint_resume_failed','application_checkpoint_import_failed','private_checkpoint_verification_failed'].includes(value?.status))childStatus=value.status;
          }catch{}
          throw Object.assign(new Error(),{code:'D19_CHILD',...(detail?{detailCode:detail}:{}),...(childPhase?{childPhase}:{}),...(childStatus?{childStatus}:{})});
        }
        const lines=out.toString('utf8').trim().split('\n');if(lines.length!==1)fail('CHILD_RESULT');
        const value=JSON.parse(lines[0]);clean();yes(value);
      }catch(error){const diagnostic=diagnostics(code,signal);clean();no(Object.assign(error,diagnostic));}
    });
    if(password!==undefined)child.stdin.write(password);child.stdin.end();
  });
}
async function receipt() { const {readCheckpointReceipt}=await moduleAt('server/backup/checkpoint-receipt.mjs');return withPrivateDirectory(COPY,s=>readCheckpointReceipt(s)); }
function resumeArgs(command, sqlSha256) {
  return [command,'--private-directory',ORIGINAL,'--private-path-mode','linux-dirfd','--checkpoint-directory',COPY,'--database',DATABASE,'--confirm-database',DATABASE,'--user',USER,'--profile',PROFILE,'--sql-sha256',sqlSha256];
}
function operationsArgs(command) {
  return [command,'--private-directory',ORIGINAL,'--operations-directory',OPS,'--checkpoint-directory',COPY,'--destination-private-directory',QUARANTINE,'--database',DATABASE,'--media-root',`${COPY}/media`,'--witness-operator-directory',AUTHORITY,'--witness-contract-sha256',CONTRACT];
}
function restored(v, imported) {
  if (!v || v.status!==(imported?'application_checkpoint_restored_verified':'application_checkpoint_existing_clone_verified')
    || v.action!==(imported?'imported_empty_clone':'verified_existing_clone') || v.importedThisRun!==imported
    || v.imported!==imported || v.checkpointFilesMatched!==true || v.applicationSnapshotMatched!==true || v.databaseConnected!==true
    || v.capacityRebound!==false || v.httpStarted!==false || v.smtpStarted!==false || v.workersStarted!==false || v.tables!==30 || v.migrations!==30
    || v.sourceMutated!==false || v.version!==10 || v.profile!=='messaging-photos-notify-recovery-crm-broadcast-application' || v.operationsCovered!==true || v.operationalRestorationPending!==true || v.externalRegistryContinuityVerified!==false) fail('RESULT');
}
async function access(source, expected) {
  const {connectOperatorDatabase,inspectResumeClone}=await moduleAt('scripts/resume-application-checkpoint.mjs');
  const {diagnoseBackupInspection}=await moduleAt('server/backup/inspection-diagnostics.mjs');
  const secret=await credentials(source);let connection;
  try {
    connection=await connectOperatorDatabase({JESSIEMESSAGE_DB_HOST:secret.host,JESSIEMESSAGE_DB_PORT:source.JESSIEMESSAGE_DB_PORT,JESSIEMESSAGE_DB_NAME:DATABASE,JESSIEMESSAGE_MIGRATION_DATABASE:DATABASE,JESSIEMESSAGE_DB_USER:USER,JESSIEMESSAGE_DB_PASSWORD:secret.password});
    const state=await inspectResumeClone(connection,DATABASE);
    if (state!==expected)fail('TARGET_STATE');
    const rows=await connection.query('SHOW DATABASES');
    if(!Array.isArray(rows)||!rows.length||rows.length>10)fail('TARGET_SCOPE');
    const names=rows.map(row=>Object.values(row)[0]);
    const allowed=new Set([DATABASE,'information_schema','performance_schema','mysql','sys']);
    if(!names.includes(DATABASE)||names.some(name=>typeof name!=='string'||!allowed.has(name))||names.includes(source.JESSIEMESSAGE_DB_NAME))fail('TARGET_SCOPE');
    const diagnosis=await diagnoseBackupInspection(connection,DATABASE);
    return {targetState:state,tlsVerified:true,sourceDatabaseVisible:false,otherCustomerDatabasesVisible:false,diagnosis};
  } finally {secret.password='';await connection?.end();}
}
async function assertPriorRecoveryStopped() {
  // r1 ran in this same SSH process namespace. Refuse any surviving recovery
  // CLI for this exact source/copy/target, without printing process arguments.
  const entries=await readdir('/proc',{withFileTypes:true});
  for(const entry of entries){
    if(!entry.isDirectory()||!/^[1-9][0-9]*$/.test(entry.name))continue;
    let bytes;
    try{
      const info=await lstat(`/proc/${entry.name}`);
      if(info.uid!==process.getuid())continue;
      bytes=await readFile(`/proc/${entry.name}/cmdline`);
      if(bytes.length>65536)fail('PROCESS_STATE');
      const args=bytes.toString('utf8').split('\0');
      if(args.includes(`${REPO}/scripts/restore-private-operations.mjs`)
        &&args.includes(COPY)&&args.includes(QUARANTINE))fail('RECOVERY_STILL_RUNNING');
    }catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
    finally{bytes?.fill(0);}
  }
}
async function assertRecoveryDestinationAbsent() {
  await withPrivateDirectory(ROOT,async parent=>{
    try{await lstat(parent.file('restore-d19-quarantine'));fail('QUARANTINE_EXISTS');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  });
}
async function assertPreparedCheckpoint() {
  const prepared=await readResult('prepare');
  const {hashCheckpointFile}=await moduleAt('server/backup/checkpoint-receipt.mjs');
  await withPrivateDirectory(COPY,async scope=>{
    for(const name of ['receipt.json','manifest.json','database.sql.gz','operations.enc.json','checkpoint.tar.gz']){
      if(!equal(await hashCheckpointFile(scope,name),prepared.files[name]))fail('CHECKPOINT_CHANGED');
    }
  });
}
async function main() {
  if(!STAGES.has(stage)||process.argv.length!==3)fail('USAGE');
  ({withPrivateDirectory}=await moduleAt('server/files/private-directory.mjs'));
  phase='source';
  const {privateAuthenticationProcessOptions}=await moduleAt('server/config/private-auth-environment.mjs');
  privateAuthenticationProcessOptions(process.env,process.execArgv);
  await pins();
  const already=await readResult(stage,true);
  if(already){process.stdout.write(`${JSON.stringify({stage,status:'recorded_result',completed:already.completed===true})}\n`);return;}
  const {loadRuntimeBroadcastEnvironment}=await moduleAt('server/config/runtime-broadcast.mjs');
  const {clearRuntimeMessagingSecrets}=await moduleAt('server/config/runtime-messaging.mjs');
  let source;
  try {
    if(stage==='prepare'){
      phase='baseline';
      if(await readResult('baseline',true))fail('PREPARATION_INCOMPLETE');
      await save('baseline',{version:1,source:HEAD,tree:TREE,at:new Date().toISOString(),hashes:await hashes()});
      phase='copy';
      const {readCheckpointReceipt,hashCheckpointFile}=await moduleAt('server/backup/checkpoint-receipt.mjs');
      const {copyCheckpointMedia,verifyCheckpointMedia}=await moduleAt('server/backup/checkpoint-files.mjs');
      await withPrivateDirectory(ROOT,async parent=>{await mkdir(parent.file('restore-d19-checkpoint'),{mode:0o700});await parent.sync();});
      const copied={};let sourceReceipt;
      await withPrivateDirectory(CAPTURE,async from=>withPrivateDirectory(COPY,async to=>{
        sourceReceipt=await readCheckpointReceipt(from);
        if(sourceReceipt.version!==10||sourceReceipt.schema.tables!==30||sourceReceipt.schema.migrations!==30)fail('CHECKPOINT');
        for(const name of ['receipt.json','manifest.json','database.sql.gz','operations.enc.json','checkpoint.tar.gz','checkpoint.tar.gz.gpg']){
          const bytes=await readPrivate(from,name,64*1024*1024);
          try {await writePrivate(to,name,bytes);copied[name]={bytes:bytes.length,sha256:hash(bytes)};}finally{bytes.fill(0);}
        }
        await mkdir(to.file('media'),{mode:0o700});await to.sync();
        const inventory=await withPrivateDirectory(`${CAPTURE}/media`,s=>withPrivateDirectory(`${COPY}/media`,t=>copyCheckpointMedia(s,t)));
        if(!equal(inventory,sourceReceipt.media))fail('MEDIA');
        await withPrivateDirectory(`${COPY}/media`,s=>verifyCheckpointMedia(s,sourceReceipt.media));
        if(!equal(await readCheckpointReceipt(to),sourceReceipt))fail('CHECKPOINT');
        if(copied['database.sql.gz'].sha256!==sourceReceipt.sql.sha256||copied['operations.enc.json'].sha256!==sourceReceipt.operations.sha256)fail('CHECKPOINT');
        const after=await hashCheckpointFile(from,'checkpoint.tar.gz');
        if(!equal(after,copied['checkpoint.tar.gz']))fail('CHECKPOINT_CHANGED');
      }));
      await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),files:copied,mediaFiles:sourceReceipt.media.files.length,sqlSha256:sourceReceipt.sql.uncompressedSha256,capacityRebound:false,started:false});
    } else {
      await unchanged();await readResult('prepare');
      source=await loadRuntimeBroadcastEnvironment(ORIGINAL,{port:'3000',originProfile:'primary',recovery:true});
      await assertPreparedCheckpoint();
      const r=await receipt();phase=stage;
      if(stage==='access'){
        const report=await access(source,'empty');await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),...report,imported:false,started:false});
      } else if(stage==='precheck'){
        await readResult('access');
        const report=await cli('resume-application-checkpoint.mjs',resumeArgs('check',r.sql.uncompressedSha256));
        if(report.status!=='application_restore_precheck_passed'||report.databaseConnected!==false||report.imported!==false||report.operationsCovered!==true||report.version!==10||report.sqlSha256!==r.sql.uncompressedSha256)fail('RESULT');
        await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),report});
      } else if(stage==='quarantine'){
        await readResult('precheck');
        if(await readResult('quarantine-started',true))fail('QUARANTINE_UNCERTAIN');
        const check=await cli('restore-private-operations.mjs',operationsArgs('check'));
        if(check.status!=='operational_restore_precheck_passed'||check.externalRegistryContinuityVerified!==true||check.reconciliationRequired!==true||check.sqlRestored!==false||check.started!==false||!/^[a-f0-9]{64}$/.test(check.planSha256))fail('RESULT');
        await save('quarantine-check',{version:1,completed:true,at:new Date().toISOString(),report:check});
        await save('quarantine-started',{version:1,completed:false,at:new Date().toISOString(),planSha256:check.planSha256});
        const report=await cli('restore-private-operations.mjs',[...operationsArgs('restore'),'--confirm-plan-sha256',check.planSha256]);
        await save('quarantine-response',{version:1,completed:false,at:new Date().toISOString(),report});
        if(report.status!=='operational_quarantine_restored'||report.restored!==true||report.externalRegistryContinuityVerified!==true||report.reconciliationRequired!==true||report.sqlRestored!==false||report.started!==false)fail('RESULT');
        await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),report});
      } else if(stage==='quarantine-resume'){
        await readResult('precheck');
        const priorCheck=await readResult('quarantine-check'), priorStarted=await readResult('quarantine-started');
        if(priorCheck.completed!==true||priorCheck.report?.status!=='operational_restore_precheck_passed'
          ||priorCheck.report.externalRegistryContinuityVerified!==true||priorCheck.report.started!==false
          ||priorStarted.completed!==false||priorStarted.planSha256!==priorCheck.report.planSha256
          ||await readResult('quarantine-response',true)||await readResult('quarantine',true)
          ||await readResult('quarantine-resume-started',true)||await readResult('quarantine-resume-response',true))fail('RESUME_PRECONDITION');
        await assertPriorRecoveryStopped();await assertRecoveryDestinationAbsent();
        await save('quarantine-resume-started',{version:2,completed:false,at:new Date().toISOString(),priorAttemptPreserved:true,
          priorCheckAt:priorCheck.at,priorStartedAt:priorStarted.at,destinationAbsent:true,priorRecoveryProcessAbsent:true,deadlineMilliseconds:720000});
        const check=await cli('restore-private-operations.mjs',operationsArgs('check'),undefined,720000);
        if(check.status!=='operational_restore_precheck_passed'||check.externalRegistryContinuityVerified!==true||check.reconciliationRequired!==true
          ||check.sqlRestored!==false||check.started!==false||!/^[a-f0-9]{64}$/.test(check.planSha256))fail('RESULT');
        await save('quarantine-resume-check',{version:2,completed:true,at:new Date().toISOString(),report:check});
        await assertRecoveryDestinationAbsent();
        const report=await cli('restore-private-operations.mjs',[...operationsArgs('restore'),'--confirm-plan-sha256',check.planSha256],undefined,720000);
        await save('quarantine-resume-response',{version:2,completed:false,at:new Date().toISOString(),report});
        if(report.status!=='operational_quarantine_restored'||report.restored!==true||report.externalRegistryContinuityVerified!==true
          ||report.reconciliationRequired!==true||report.sqlRestored!==false||report.started!==false)fail('RESULT');
        await unchanged();await assertPreparedCheckpoint();
        await save('quarantine',{version:2,completed:true,at:new Date().toISOString(),resumedKnownAbsentAttempt:true,report});
        await save(stage,{version:2,completed:true,at:new Date().toISOString(),priorAttemptPreserved:true,report});
      } else if(stage==='import'){
        await readResult('quarantine');
        if(await readResult('import-started',true))fail('IMPORT_UNCERTAIN');
        await access(source,'empty');
        const secret=await credentials(source);
        try {
          await save('import-started',{version:1,completed:false,at:new Date().toISOString(),sqlSha256:r.sql.uncompressedSha256});
          const report=await cli('resume-application-checkpoint.mjs',resumeArgs('resume',r.sql.uncompressedSha256),secret.password);
          await save('import-response',{version:1,completed:false,at:new Date().toISOString(),report});
          restored(report,true);await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),report});
        } finally {secret.password='';}
      } else if(stage==='verify'){
        await readResult('quarantine');
        await access(source,'application-schema');
        const secret=await credentials(source);
        try {
          const report=await cli('resume-application-checkpoint.mjs',resumeArgs('resume',r.sql.uncompressedSha256),secret.password);
          await save('verify-response',{version:1,completed:false,at:new Date().toISOString(),report});
          restored(report,false);await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),report});
        } finally {secret.password='';}
      } else if(stage==='final'){
        await readResult('verify');
        const {assertNoOperationalRestore}=await moduleAt('server/backup/operational-checkpoint.mjs');
        let blocked=false;
        try{await withPrivateDirectory(QUARANTINE,s=>assertNoOperationalRestore(s));}
        catch(error){if(error.code==='OPERATIONS_RECONCILIATION_REQUIRED')blocked=true;else throw error;}
        if(!blocked)fail('QUARANTINE_GUARD');
        await unchanged();await save(stage,{version:1,completed:true,at:new Date().toISOString(),quarantineGuardRefused:true,sourcePinsUnchanged:true,configurationAndAuthorityHashesUnchanged:true,capacityRebound:false,started:false,closuresEnabled:false,reconciliationRequired:true,completeDatabase:false});
      }
    }
    process.stdout.write(`${JSON.stringify({stage,status:'completed',completed:true})}\n`);
  } finally {clearRuntimeMessagingSecrets(source);}
}
function failureDto(error) {
  const code=/^D19_[A-Z_]+$/.test(error?.code??'')?error.code:'D19_OPERATION';
  const detailCode=/^(?:APPLICATION_CHECKPOINT_RESUME|APPLICATION_CHECKPOINT_IMPORT|PRIVATE_CHECKPOINT_VERIFY|PRIVATE_AUTH|BACKUP_INSPECTION|BACKUP_APPLICATION|CHECKPOINT_FILES|CHECKPOINT_RECEIPT|OPERATIONS|RUNTIME_BROADCAST)_[A-Z_]+$/.test(error?.detailCode??error?.code??'')?(error.detailCode??error.code):undefined;
  return {stage:STAGES.has(stage)?stage:'unknown',status:'failed',code,phase,...(detailCode?{detailCode}:{}),
    ...(['arguments','precheck','configuration','password','connection','inspection','import','verification','cleanup'].includes(error?.childPhase)?{childPhase:error.childPhase}:{}),
    ...(['application_checkpoint_resume_failed','application_checkpoint_import_failed','private_checkpoint_verification_failed'].includes(error?.childStatus)?{childStatus:error.childStatus}:{}),
    ...(Number.isSafeInteger(error?.childElapsedMilliseconds)&&error.childElapsedMilliseconds>=0?{childElapsedMilliseconds:error.childElapsedMilliseconds}:{}),
    ...(Object.hasOwn(error??{},'childExitCode')&&(error.childExitCode===null||Number.isInteger(error.childExitCode))?{childExitCode:error.childExitCode}:{}),
    ...(Object.hasOwn(error??{},'childSignal')&&(error.childSignal===null||/^SIG[A-Z0-9]+$/.test(error.childSignal))?{childSignal:error.childSignal}:{}),
    ...(typeof error?.childTimedOut==='boolean'?{childTimedOut:error.childTimedOut}:{}),
    ...(typeof error?.childCancelled==='boolean'?{childCancelled:error.childCancelled}:{})};
}
try{await main();}
catch(error){
  const result=failureDto(error);let failureRecorded=false;
  if(STAGES.has(stage)&&typeof withPrivateDirectory==='function'){
    try{
      if(!await readResult(`${stage}-failure`,true))await save(`${stage}-failure`,{version:2,completed:false,at:new Date().toISOString(),...result});
      failureRecorded=true;
    }catch{}
  }
  process.stderr.write(`${JSON.stringify({...result,failureRecorded})}\n`);process.exitCode=1;
}
