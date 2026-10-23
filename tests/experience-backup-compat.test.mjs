import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EXPERIENCE_APPLICATION_COVERAGE, VIDEO_APPLICATION_COVERAGE, validateExperienceApplicationCoverage,
  validateVideoApplicationCoverage, validateVideoSnapshotCoverage, assertExperienceApplicationTableInspection } from "../server/backup/application-scope.mjs";
import { createdMigrationTables } from "../server/db/migrations.mjs";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { createBackupSnapshotStore, captureBackupSnapshot, assertBackupSnapshot } from "../server/backup/snapshot.mjs";
import { createBackupManifest, verifyBackupManifest } from "../server/backup/manifest.mjs";
import { createBackupCryptoStore } from "../server/backup/crypto-store.mjs";
import { verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData } from "../server/backup/verify.mjs";
import { sealPreferences } from "../server/preferences/crypto.mjs";
import { parseArguments, main as backupMain } from "../scripts/backup.mjs";
const database="jessiemessage_test_experience_backup",date="2026-10-23 12:00:00.000000";
const neutral=error=>error.code==="BACKUP_APPLICATION_SCOPE"&&!String(error).includes("private-password");
const keys=()=>Object.fromEntries(["totpKey","mailKey","messageKey","mediaKey","crmKey","notificationKey","videoKey"].map(name=>[name,randomBytes(32)]));
const identity=()=>({databaseTag:"1".repeat(64),rootPathTag:"2".repeat(64),rootPhysicalTag:"3".repeat(64),rootFingerprint:"4".repeat(64),rootAncestors:["a".repeat(64)],video:{databaseTag:"1".repeat(64),rootPathTag:"5".repeat(64),rootPhysicalTag:"6".repeat(64),rootFingerprint:"7".repeat(64),rootAncestors:["a".repeat(64)]}});
test("SQL38 coverage authenticates exactly37 physical tables without broadening historical SQL36",()=>{
  assert.equal(EXPERIENCE_APPLICATION_COVERAGE.tables,37);assert.equal(Object.isFrozen(EXPERIENCE_APPLICATION_COVERAGE),true);
  assert.deepEqual(validateVideoSnapshotCoverage(EXPERIENCE_APPLICATION_COVERAGE),EXPERIENCE_APPLICATION_COVERAGE);
  assert.deepEqual(validateVideoSnapshotCoverage(VIDEO_APPLICATION_COVERAGE),VIDEO_APPLICATION_COVERAGE);
  assert.throws(()=>validateVideoApplicationCoverage(EXPERIENCE_APPLICATION_COVERAGE),neutral);
  assert.throws(()=>validateExperienceApplicationCoverage(VIDEO_APPLICATION_COVERAGE),neutral);
  for(const change of [{tables:38},{tables:35},{completeDatabase:true},{extra:true}])assert.throws(()=>validateVideoSnapshotCoverage({...EXPERIENCE_APPLICATION_COVERAGE,...change}),neutral);
  const accessor={...EXPERIENCE_APPLICATION_COVERAGE};Object.defineProperty(accessor,"tables",{enumerable:true,get(){assert.fail("coverage getter executed");}});assert.throws(()=>validateVideoSnapshotCoverage(accessor),neutral);
});
test("SQL38 table inspection refuses a missing, duplicate, unrelated or non-table object",async()=>{
  const plan=await loadExperienceMigrations(), names=[...createdMigrationTables(plan),"schema_migrations"];
  assert.equal(plan.length,38);assert.equal(names.length,37);
  const rows=names.map(name=>({name,kind:"BASE TABLE",engine:"InnoDB"}));
  const connection=(values)=>({async query(sql){return sql.startsWith("SELECT DATABASE")?[{name:database}]:values;}});
  assert.equal(await assertExperienceApplicationTableInspection(connection(rows),database),true);
  for(const values of [rows.slice(1),[...rows,rows[0]],rows.map((r,i)=>i?r:{...r,name:"unknown"}),rows.map((r,i)=>i?r:{...r,kind:"VIEW"})])await assert.rejects(assertExperienceApplicationTableInspection(connection(values),database),neutral);
});
async function captureFixture(){
  const plan=await loadExperienceMigrations(),definitions=plan.filter(m=>/^CREATE\s+TABLE\s/i.test(m.sql.trim())).map(({sql})=>({name:/^CREATE\s+TABLE\s+([a-z_]+)/i.exec(sql.trim())[1],primary:/PRIMARY KEY\s*\(([a-z_, ]+)\)/i.exec(sql)[1].split(",").map(x=>x.trim())})).concat({name:"schema_migrations",primary:["version"]});
  const inventory=definitions.map(x=>({name:x.name,kind:"BASE TABLE",engine:"InnoDB",collation:"utf8mb4_unicode_ci"}));
  const columns=definitions.flatMap(({name,primary})=>primary.map((column,i)=>({table_name:name,name:column,type:"varbinary(16)",nullable:"NO",default_value:null,extra:"",collation:null,position:i+1})));
  const add=(table,name,type)=>columns.push({table_name:table,name,type,nullable:"NO",default_value:null,extra:"",collation:null,position:columns.filter(c=>c.table_name===table).length+1});
  for(const table of ["media_storage_state","video_storage_state"])for(const [name,type]of[["owner_bytes","bigint unsigned"],["total_bytes","bigint unsigned"],["held_bytes","bigint unsigned"],["root_fingerprint","varbinary(32)"],["initialized_at","datetime(6)"]])add(table,name,type);
  add("profile_preferences","version","int unsigned");add("profile_preferences","selection_encrypted","mediumtext");
  add("crm_tasks","reply_kind","varchar(8)");add("crm_tasks","reply_through","bigint unsigned");add("crm_tasks","reply_reopened","tinyint unsigned");
  const state={selection:"synthetic-encrypted-selection-A",through:1n,queries:[]};
  const connection={async query(sql){state.queries.push(sql);if(sql==="SELECT DATABASE() AS name")return[{name:database}];if(sql.includes(" FROM media_storage_state ")||sql.includes(" FROM video_storage_state "))return[{id:1,owner_bytes:1000,total_bytes:10000,held_bytes:0,root_fingerprint:Buffer.alloc(32,sql.includes("video_storage")?7:4),initialized_at:date}];
    if(sql.includes(" FROM profile_preferences "))return[{user_id:Buffer.alloc(16,1),version:1,selection_encrypted:state.selection}];
    if(sql.includes(" FROM crm_tasks "))return[{id:Buffer.alloc(16,2),reply_kind:"reply",reply_through:state.through,reply_reopened:0}];
    if(sql.includes(" FROM schema_migrations "))return plan.map(m=>({version:m.version}));return[];},async beginTransaction(){},async commit(){},async rollback(){},release(){}};
  const inspection={async query(sql){if(sql==="SELECT DATABASE() AS name")return[{name:database}];if(sql.includes("information_schema.TABLES"))return inventory;if(sql.includes("information_schema.COLUMNS"))return columns;return[];},release(){}};
  const store=createBackupSnapshotStore({pool:{getConnection:async()=>connection},inspectionPool:{getConnection:async()=>inspection},coverage:"application-tables",video:true,experience:true});
  return{state,store};
}
test("capture includes preference ciphertext and reply cursors in the authenticated core digest",async()=>{
  const f=await captureFixture(), first=await captureBackupSnapshot({store:f.store});assert.equal(first.version,3);assert.equal(first.counts.tables,37);assert.deepEqual(first.coverage,EXPERIENCE_APPLICATION_COVERAGE);
  f.state.selection="synthetic-encrypted-selection-B";const changedPrefs=await captureBackupSnapshot({store:f.store});assert.notEqual(changedPrefs.coreDigest,first.coreDigest);
  f.state.through=2n;const changedReply=await captureBackupSnapshot({store:f.store});assert.notEqual(changedReply.coreDigest,changedPrefs.coreDigest);
  assert.equal(assertBackupSnapshot({expected:first,actual:structuredClone(first),mode:"recovery"}).heldBytes,0);
  assert.throws(()=>assertBackupSnapshot({expected:first,actual:{...first,coverage:VIDEO_APPLICATION_COVERAGE,counts:{...first.counts,tables:36}},mode:"recovery"}),error=>error.code==="BACKUP_SNAPSHOT_DRIFT");
  assert.throws(()=>createBackupSnapshotStore({pool:{getConnection(){}},experience:true}),error=>error.code==="BACKUP_SNAPSHOT_INPUT");
});
test("existing v3 video manifests retain exact old/new coverage and reject contradictory counts",async()=>{
  const f=await captureFixture(),snapshot=await captureBackupSnapshot({store:f.store}),keyset=keys();
  for(const count of[36,37]){
    const value={...snapshot,coverage:count===37?EXPERIENCE_APPLICATION_COVERAGE:VIDEO_APPLICATION_COVERAGE,counts:{...snapshot.counts,tables:count}};
    const manifest=createBackupManifest({snapshot:value,identity:identity(),keys:keyset,now:Date.now(),profile:"messaging-photos-notify-recovery-crm-broadcast-video-application"});
    assert.equal(manifest.version,11);assert.equal(verifyBackupManifest({manifest,keys:keyset}).snapshot.coverage.tables,count);
  }
  assert.throws(()=>createBackupManifest({snapshot:{...snapshot,counts:{...snapshot.counts,tables:38}},identity:identity(),keys:keyset,now:Date.now(),profile:"messaging-photos-notify-recovery-crm-broadcast-video-application"}),error=>error.code==="BACKUP_MANIFEST_INVALID");
});
test("experience backup crypto authenticates private selections by owner/version without exposing plaintext",async()=>{
  const keyset=keys(),owner=Buffer.alloc(16,3),value={catalogueVersion:"2026-10-23-recherche-1",selectedIds:["pref_c99_private-synthetic"]};
  let row={id:owner,version:1,encrypted:sealPreferences(value,keyset.crmKey,owner.toString("hex"),"1"),owner_role:"client"};
  const pool={async getConnection(){return{async query(sql){return sql.includes("FROM profile_preferences")?[row]:[];},release(){}};}};
  const options={pool,storage:{get(){}},videoStorage:{open(){}},keys:keyset,experience:true};
  const good=await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(options);assert.equal(good.healthy,true);assert.equal(good.counts.preferences,1);assert.equal(JSON.stringify(good).includes(value.selectedIds[0]),false);
  row={...row,version:2};const wrong=await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(options);assert.equal(wrong.healthy,false);assert.deepEqual(wrong.issues,[{purpose:"preferences",code:"verification_failed"}]);
  await assert.rejects(createBackupCryptoStore({pool,video:true}).page({purpose:"preferences"}),error=>error.code==="BACKUP_DATABASE");
});
test("backup CLI requires an explicit paired experience option with the application video profile",()=>{
  const base=["prepare","--offline","--manifest","/tmp/synthetic.manifest.json"],video=[...base,"--profile","photos-notify-recovery-crm-broadcast-video-application"];
  assert.equal(parseArguments([...video,"--experience","1"]).experience,true);assert.equal(parseArguments(video).experience,undefined);
  for(const args of[[...base,"--experience","1"],[...video,"--experience"],[...video,"--experience","0"],[...video,"--experience","1","--experience","1"]])assert.throws(()=>parseArguments(args),error=>error.code==="BACKUP_USAGE");
});

test("backup verification derives SQL38 from authenticated archive coverage before creating schema readers",async()=>{
  const f=await captureFixture(),snapshot=await captureBackupSnapshot({store:f.store}),keyset=keys(),bound=identity(),seen=[];
  bound.rootFingerprint=snapshot.capacity.rootFingerprint;bound.video.rootFingerprint=snapshot.video.capacity.rootFingerprint;
  const profile="photos-notify-recovery-crm-broadcast-video-application";
  const manifest=createBackupManifest({snapshot,identity:bound,keys:keyset,now:Date.now(),profile:"messaging-"+profile});
  const pool={end:async()=>{}},inspection={end:async()=>{}},store={databaseName:async()=>database};
  const dependencies={configure:()=>({databaseName:database,keys:keyset,media:{enabled:true,root:"/synthetic/media",key:keyset.mediaKey,capacity:{ownerBytes:1000,totalBytes:10000}},video:{root:"/synthetic/video",capacity:{ownerBytes:1000,totalBytes:10000}}}),
    createPool:async()=>pool,createInspectionPool:async()=>inspection,
    makeStorage:async()=>({fingerprint:async()=>Buffer.from(bound.rootFingerprint,"hex")}),makeVideoStorage:async()=>({fingerprint:async()=>Buffer.from(bound.video.rootFingerprint,"hex")}),
    makeVideoStore:options=>{seen.push(["video",options]);return{assertSchema:async()=>{}};},makeSchemaStore:()=>({assertSchema:async options=>seen.push(["schema",options])}),
    makeSnapshotStore:options=>{seen.push(["snapshot",options]);return store;},
    snapshots:{captureBackupSnapshot:async()=>snapshot,assertBackupSnapshot:()=>({heldBytes:0,videoHeldBytes:0,candidates:[],videoCandidates:[]}),verifyBackupStorage:async()=>({complete:true,healthy:true})},
    verifyBackupData:async options=>{seen.push(["crypto",options]);return{complete:true,healthy:true};},
    manifests:{readManifest:async()=>manifest,verifyBackupManifest:input=>verifyBackupManifest(input),backupIdentity:async()=>bound,assertCloneIdentity(){},manifestHash:()=>"a".repeat(64)},outputStream:{write(){}}};
  const result=await backupMain(["verify","--offline","--manifest","/synthetic/manifest.json","--profile",profile],{},dependencies);
  assert.equal(result.verified,true);for(const kind of["video","schema","snapshot","crypto"])assert.equal(seen.find(x=>x[0]===kind)[1].experience,true,kind);
  let opened=false;
  await assert.rejects(backupMain(["verify","--offline","--manifest","/synthetic/manifest.json","--profile",profile],{},{...dependencies,createPool:async()=>{opened=true;return pool;},manifests:{...dependencies.manifests,verifyBackupManifest(){throw new Error("bad authentication");}}}));
  assert.equal(opened,false);
});
