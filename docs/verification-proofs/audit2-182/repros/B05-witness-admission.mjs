import assert from 'node:assert/strict';
import { createWitnessTransport } from '../../../../server/backup/witness-transport.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const authGate=deferred(),authEntered=deferred(),bodyGate=deferred(),fourBodies=deferred();
const destinationId='1'.repeat(32),registryId='a'.repeat(64),pairedAt=1792350000000,pairingFingerprint='d'.repeat(64);
let authorizations=0,bodiesEntered=0,bodiesInFlight=0,peakBodies=0;
const transport=createWitnessTransport({destinationId,registryId,pairedAt,pairingFingerprint,async authorize(){
 authorizations++;if(authorizations===4)authEntered.resolve();await authGate.promise;return {destinationId,pairedAt,pairingFingerprint};
}});
const packet={version:1,registryId,challenge:'b'.repeat(64),snapshot:null};
const exchange=transport.exchange(packet).then(()=>({resolved:true}),()=>({rejected:true}));
function request(){return {url:'/api/backup-copy/witness/response',method:'POST',headers:{host:'jessiemessage.com','x-forwarded-proto':'https','x-jessie-backup':'1',authorization:`Bearer ${'A'.repeat(43)}`,'content-type':'application/json','content-length':'2'},rawHeaders:['Host','jessiemessage.com'],complete:false,resume(){},async *[Symbol.asyncIterator](){
 bodiesEntered++;bodiesInFlight++;peakBodies=Math.max(peakBodies,bodiesInFlight);if(bodiesEntered===4)fourBodies.resolve();
 try{await bodyGate.promise;yield Buffer.from('{}');}finally{bodiesInFlight--;this.complete=true;}
}};}
function response(){return {headersSent:false,destroyed:false,status:null,writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},end(value){this.body=value?.toString();}};}
const responses=Array.from({length:4},response);
const running=responses.map(r=>transport.handler(request(),r));
await authEntered.promise;assert.equal(bodiesEntered,0);authGate.resolve();await fourBodies.promise;
assert.equal(peakBodies,4);assert.equal(bodiesInFlight,4);
const later=response();await transport.handler(request(),later);assert.equal(later.status,429);
bodyGate.resolve();await Promise.all(running);transport.close();await exchange;
assert.deepEqual(responses.map(r=>r.status),[503,503,503,503]);
console.log(JSON.stringify({type:'synthetic_witness_admission_race',runtime:process.version,scope:'Pure calls to the actual handler with synthetic async iterables and deferred authorization. No socket, network, database, filesystem backup or real account.',documentedTransferCeiling:2,simultaneousRequestsBeforeAuthorizationRelease:4,observedConcurrentBodyReaders:peakBodies,laterRequestStatus:later.status,bytesPerSyntheticBody:2,largeBodiesAllocated:false,conclusion:'The four initial requests pass the pre-await transfers.size check and all enter body collection; a later request sees the populated set and is correctly refused.'},null,2));
