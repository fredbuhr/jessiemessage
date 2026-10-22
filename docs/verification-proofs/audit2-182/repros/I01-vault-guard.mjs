// Pure synthetic evaluation of exact source selection/guard functions only.
// No module import, GPG, encryption, runtime-file mutation, credentials or network.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const repo=new URL('../../../../', import.meta.url);
const source=await readFile(new URL('scripts/private-secrets-backup.mjs',repo),'utf8');
const constants=source.slice(source.indexOf('const FILES = '),source.indexOf('const PRIMARY = '));
const selectors=source.slice(source.indexOf('const sourceNames = '),source.indexOf('// Refuse a new AUTH-only receipt'));
const guards=source.slice(source.indexOf('async function assertNotificationsProfile'),source.indexOf('function passwordBytes'));
const available=new Set(['runtime-auth.json','runtime-database.json','runtime-messaging.json','runtime-media.json','runtime-notifications.json','runtime-crm.json','runtime-video.json']);
const calls=[];
const context=vm.createContext({
 lstat:async name=>{calls.push(name);if(!available.has(name))throw Object.assign(new Error('synthetic missing'),{code:'ENOENT'});return {};},
 fail:code=>{throw Object.assign(new Error(code),{code});},
});
vm.runInContext(`${constants}\n${selectors}\n${guards}\nglobalThis.select=sourceNames;globalThis.guard=assertProfile;`,context);
const scope={file:name=>name,assertReady:async()=>{calls.push('assertReady');}};
const selected={profile:'primary-crm',privateDirectory:'/synthetic/runtime-video182',output:'synthetic.json.gpg'};
await context.guard(scope,selected);
const result={
 source:'scripts/private-secrets-backup.mjs',
 execution:'pure_source_selection_and_preflight_guard_only',
 syntheticDirectoryFiles:[...available],
 guardPassed:true,
 guardFilesystemCalls:calls,
 selectedSourceFiles:Array.from(context.select(selected)),
 omittedPresentFiles:[...available].filter(name=>!context.select(selected).includes(name)),
 videoConfigurationSelected:context.select(selected).includes('runtime-video.json'),
 actualCoffreRun:false,encrypted:false,backupExecuted:false,productionTouched:false,
};
if(result.videoConfigurationSelected||result.omittedPresentFiles.length!==1||result.omittedPresentFiles[0]!=='runtime-video.json')throw Error('candidate did not reproduce');
process.stdout.write(JSON.stringify(result)+'\n');
