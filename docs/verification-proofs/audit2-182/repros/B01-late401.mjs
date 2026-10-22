import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createChatHandler } from '../../../../server/chat/http.mjs';
import { createMediaHandler } from '../../../../server/media/http.mjs';
import { createVideoHandler } from '../../../../server/video/http.mjs';
import { createProfileHandler } from '../../../../server/profile/http.mjs';
import { createPrivacyHandler } from '../../../../server/privacy/http.mjs';
const origin='https://jessiemessage.example';
const oldToken=Buffer.alloc(32,1).toString('base64url'),newToken=Buffer.alloc(32,2).toString('base64url'),csrf=Buffer.alloc(32,3).toString('base64url');
const cid='c'.repeat(32);
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function one(kind,role){
 const arrived=deferred(),release=deferred();let revoked=false;
 const cookie=role==='admin'?'__Host-jessie_session':'__Host-jessie_client';
 const actor=async()=>({user:{id:'a'.repeat(32),role,pseudonym:'Synthetic'},csrf,expiresAt:Date.now()+3600000,access:{state:'active',admissionPolicy:'manual_invitation',emailVerified:true,invitationConsumed:true,approved:true}});
 const delayed=async()=>{arrived.resolve();await release.promise;throw Object.assign(new Error('Synthetic revoked old session'),{code:'CHAT_UNAUTHORIZED'});};
 let handler,path;
 if(kind==='chat'){
  const service={actor,listConversations:async()=>{},clientConversation:async()=>{},messages:delayed,events:async()=>{},send:async()=>{},markRead:async()=>{},delete:async()=>{}};
  handler=createChatHandler(service,{origin});path=`/api/chat/${role}/conversations/${cid}/messages`;
 }else if(kind==='media'){
  const service={actor,admitUpload:async()=>{},releaseUpload:()=>{},upload:async()=>{},listAssets:delayed,asset:async()=>{},messageAsset:async()=>{},gallery:async()=>{},removeAsset:async()=>{},send:async()=>{}};
  handler=createMediaHandler(service,{origin});path=`/api/media/${role}/assets`;
 }else if(kind==='video'){
  const service={actor,admitUpload:async()=>{},releaseUpload:async()=>{},upload:async()=>{},open:async()=>{},listOwned:delayed,remove:async()=>{}};
  handler=createVideoHandler(service,{origin});path=`/api/video/${role}/assets`;
 }else if(kind==='profile'){
  handler=createProfileHandler({actor,profile:delayed,save:async()=>{},avatar:async()=>{},peerAvatar:async()=>{}},{origin});path=`/api/profile/${role}`;
 }else{
  const service={read:async()=>{arrived.resolve();await release.promise;return {publication:'draft_only'};},save:async()=>{},close:()=>{}};
  const privateActor=async()=>revoked?null:{user:{id:'a'.repeat(32),role:'admin',pseudonym:'Synthetic'},csrf,expiresAt:Date.now()+3600000};
  handler=createPrivacyHandler(service,{origin:'https://jessiemessage.com',actor:privateActor});path='/api/admin/privacy';
 }
 const server=createServer(async(req,res)=>{
  if(req.url==='/synthetic-login-B'){revoked=true;res.writeHead(200,{'Set-Cookie':`${cookie}=${newToken}; Path=/; Secure; HttpOnly; SameSite=Strict`});res.end('synthetic');return;}
  if(!await handler(req,res)){res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  let jar=`${cookie}=${oldToken}`;
  const pending=fetch(base+path,{headers:{Cookie:jar}});await arrived.promise;
  const newer=await fetch(base+'/synthetic-login-B');jar=newer.headers.get('set-cookie').split(';',1)[0];
  assert.equal(jar,`${cookie}=${newToken}`);
  release.resolve();const stale=await pending;assert.equal(stale.status,401);
  const deletion=stale.headers.get('set-cookie');if(deletion)jar=deletion.split(';',1)[0];
  const erased=jar===`${cookie}=`;
  assert.equal(erased,kind!=='privacy-control');
  return {handler:kind,role,order:['old request A starts','handler reaches delayed operation','new session B cookie is received','old A returns 401'],status:stale.status,lateSetCookie:deletion?deletion.replace(/=.*/, '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict'):null,replacementCookieErasedByResponse:erased};
 }finally{handler.close?.();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
const results=[];for(const kind of ['chat','media','video','profile'])for(const role of ['admin','client'])results.push(await one(kind,role));results.push(await one('privacy-control','admin'));
console.log(JSON.stringify({type:'synthetic_late401_cookie_replacement_reproduction',runtime:process.version,scope:'Actual HTTP handlers on a synthetic loopback server; browser cookie replacement is modeled from received Set-Cookie headers; no browser or real account used.',results,positiveCases:8,negativeControlCases:1},null,2));
