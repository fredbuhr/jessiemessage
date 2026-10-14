import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';
const html=readFileSync(new URL('../design/preview.html',import.meta.url),'utf8');
const adminSource=readFileSync(new URL('../design/admin-tools.js',import.meta.url),'utf8');
const uiSource=readFileSync(new URL('../design/admin-tools-ui.js',import.meta.url),'utf8');
const sandbox=createContext({});
new Script(html.match(/<script id="demo-model">([\s\S]*?)<\/script>/)[1]).runInContext(sandbox);
new Script(adminSource).runInContext(sandbox);
const A=sandbox.JessieAdmin;
const D=sandbox.JessieDemo;
const fresh=()=>A.initialize(D.initialState());
const plain=x=>JSON.parse(JSON.stringify(x));
const NOW=1700000000000;
const DAY=86400000;

test('management model and UI parse, no networking or persistence',()=>{
  new Script(uiSource);
  assert.doesNotMatch(adminSource+uiSource,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  assert.match(uiSource,/example\.invalid/);
});
test('invitation lifetime is independent from access lifetime',()=>{
  const s=fresh();const i=A.createInvitation(s,{name:'Robin',accessDays:30,validHours:48},NOW);
  assert.equal(i.expiresAt,NOW+2*DAY);assert.equal(i.accessDays,30);
  assert.equal(A.invitationStatus(i,NOW),'pending');
  assert.equal(A.invitationStatus(i,NOW+2*DAY),'expired');
});
test('invalid invitation input does not create partial records',()=>{
  const s=fresh();
  for(const value of [{name:''},{name:'  '},{name:'Sam',accessDays:0},{name:'Sam',accessDays:366},{name:'Sam',validHours:169},{name:'Sam',validHours:0},{name:'Sam',groupId:'missing'}])assert.throws(()=>A.createInvitation(s,value,NOW));
  assert.equal(s.invitations.length,0);assert.equal(s.managementSequence,0);
});
test('declaring age is not verifying it; activation is single use',()=>{
  const s=fresh();const i=A.createInvitation(s,{name:'Robin',groupId:'regulars'},NOW);
  assert.throws(()=>A.simulateActivation(s,i.id,{},NOW),/Declaration/);
  assert.equal(s.clients.length,4);
  const c=A.simulateActivation(s,i.id,{ageDeclared:true},NOW);
  assert.equal(c.ageDeclared,true);assert.equal(c.ageVerified,false);assert.equal(c.marketing,false);
  assert.equal(c.accessUntil,NOW+30*DAY);assert.equal(A.invitationStatus(i,NOW),'used');
  assert.ok(s.groups[0].memberIds.includes(c.id));assert.deepEqual(plain(s.messages[c.id]),[]);
  assert.throws(()=>A.simulateActivation(s,i.id,{ageDeclared:true},NOW),/unavailable/);
  assert.equal(s.clients.length,5);
});
test('revoked and expired invitations cannot create even a demo client',()=>{
  const s=fresh();const revoked=A.createInvitation(s,{name:'A'},NOW);
  A.revokeInvitation(s,revoked.id,NOW+1);
  const expired=A.createInvitation(s,{name:'B',validHours:1},NOW);
  assert.equal(A.invitationStatus(revoked,NOW),'revoked');
  assert.throws(()=>A.simulateActivation(s,revoked.id,{ageDeclared:true},NOW),/unavailable/);
  assert.throws(()=>A.simulateActivation(s,expired.id,{ageDeclared:true},NOW+3600000),/unavailable/);
  assert.equal(s.clients.length,4);
});
test('an unlimited invitation does not accidentally expire access',()=>{
  const s=fresh();const i=A.createInvitation(s,{name:'A',accessDays:null},NOW);
  const c=A.simulateActivation(s,i.id,{ageDeclared:true},NOW);
  assert.equal(c.accessUntil,null);assert.equal(A.hasAccess(c,NOW+9999*DAY),true);
  assert.throws(()=>A.renewAccess(s,c.id,30,NOW),/Unlimited/);
});
test('group membership is validated and isolated from caller arrays',()=>{
  const s=fresh(), ids=['alex','alex','liam'];const g=A.createGroup(s,'Friends',ids);
  ids.push('hugo');assert.deepEqual(plain(g.memberIds),['alex','liam']);
  assert.throws(()=>A.createGroup(s,'friends',[]),/Duplicate/);
  assert.throws(()=>A.createGroup(s,'Other',['unknown']),/Unknown client/);
  A.setMembers(s,g.id,['hugo','hugo']);assert.deepEqual(plain(g.memberIds),['hugo']);
  assert.throws(()=>A.setMembers(s,g.id,['unknown']),/Unknown/);
  assert.deepEqual(plain(g.memberIds),['hugo']);
});
test('deleted groups are removed from pending invitation settings',()=>{
  const s=fresh();const i=A.createInvitation(s,{name:'A',groupId:'regulars'},NOW);
  A.deleteGroup(s,'regulars');assert.equal(i.groupId,'');
  assert.throws(()=>A.scopedDelivery(s,{group:'group:regulars'},NOW),/Unknown group/);
});
test('suspended and expired members are excluded even in a manual group',()=>{
  const s=fresh();s.clients.find(c=>c.id==='liam').accessUntil=NOW;
  A.setMembers(s,'regulars',['alex','liam','max']);
  const result=A.scopedDelivery(s,{group:'group:regulars',text:'hello'},NOW);
  assert.deepEqual(plain(result.state.clients.map(c=>c.id)),['alex']);
  assert.equal(result.options.group,'all');assert.equal(s.clients.length,4);
});
test('manual groups retain duplicate protection and marketing preferences',()=>{
  const s=fresh();A.setMembers(s,'regulars',['alex','hugo','max']);
  let scope=A.scopedDelivery(s,{group:'group:regulars',purpose:'marketing',text:'hello'},NOW);
  assert.deepEqual(plain(D.plan(scope.state,scope.options).map(c=>c.clientId)),['alex']);
  scope=A.scopedDelivery(s,{group:'group:regulars',mediaIds:['m1','m2'],purpose:'service'},NOW);
  const plan=D.plan(scope.state,scope.options);
  assert.deepEqual(plain(plan.map(r=>r.mediaIds)),[['m2'],['m1']]);
  assert.equal(D.dispatch(scope.state,scope.options,'group-delivery'),2);
  assert.equal(D.dispatch(scope.state,scope.options,'group-delivery'),0);
  assert.equal(s.messages.max.length,0);assert.equal(s.campaigns.length,1);
});
test('an explicit empty selection cannot fall back to all members',()=>{
  const s=fresh();assert.equal(A.scopedDelivery(s,{clientIds:[],text:'hi'},NOW).state.clients.length,0);
  assert.throws(()=>A.scopedDelivery(s,{clientIds:['unknown']},NOW),/Unknown client/);
});
test('extending a timed access adds time and reactivates; expiry cannot be bypassed',()=>{
  const s=fresh();const c=s.clients[0];c.accessUntil=NOW+10*DAY;
  A.setAccess(s,c.id,false,NOW);assert.equal(A.hasAccess(c,NOW),false);
  A.renewAccess(s,c.id,30,NOW);assert.equal(c.accessUntil,NOW+40*DAY);assert.equal(c.active,true);
  c.accessUntil=NOW-1;
  assert.throws(()=>A.setAccess(s,c.id,true,NOW),/Renew/);
  A.renewAccess(s,c.id,30,NOW);assert.equal(c.accessUntil,NOW+30*DAY);
  assert.throws(()=>A.setAccess(s,c.id,'yes',NOW),/Invalid/);
});
test('public templates stay separate from private local branding',()=>{
  const build=readFileSync(new URL('../scripts/build-workbench.mjs',import.meta.url),'utf8');
  assert.match(build,/Embedded personal image/);
  assert.match(html,/<script id="local-branding" type="application\/json">\{\}<\/script>/);
});
