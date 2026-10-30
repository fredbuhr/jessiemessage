import test from "node:test";
import assert from "node:assert/strict";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { ADMIN_SESSION_SECONDS } from "../server/auth/session-policy.mjs";
const NOW=Date.UTC(2026,9,23),userId=Buffer.alloc(16,1),sessionId=Buffer.alloc(16,2),tokenHash=Buffer.alloc(32,3);
function fixture(role) {
  const state={at:NOW,queries:[],writes:[],commits:0,rollbacks:0,onRead:null,poolWait:null,failInsert:false};
  const user={id:userId,role,status:"active",pseudonym:"Synthetic",password_hash:"original-synthetic-hash",email_verified_at:new Date(NOW-10000),access_approved_at:new Date(NOW-10000),age_assured_at:null,access_expires_at:null,invitation_consumed_at:new Date(NOW-10000)};
  const row={id:sessionId,user_id:userId,created_at:new Date(NOW-1000),expires_at:new Date(NOW+ADMIN_SESSION_SECONDS*1000),revoked_at:null,last_seen_at:new Date(NOW),mfa_verified_at:new Date(NOW-1000),mfa_version:1,credential_version:1};
  const connection={async beginTransaction(){},async commit(){state.commits++;},async rollback(){state.rollbacks++;},release(){},async query(sql,values=[]){
    state.queries.push({sql,values});
    if(/^(?:INSERT|UPDATE)/.test(sql)){state.writes.push({sql,values});if(state.failInsert&&sql.startsWith("INSERT INTO sessions"))throw new Error("synthetic insertion failure");return {affectedRows:1};}
    let value;
    if(sql.startsWith("SELECT user_id FROM sessions"))value=[{user_id:userId}];
    else if(sql.startsWith("SELECT i.created_by_id FROM invitations i JOIN users"))value=[];
    else if(sql.includes("FROM users")&&sql.includes("FOR UPDATE"))value=[user];
    else if(sql.includes("FROM admin_mfa"))value=[{version:1,enabled_at:new Date(NOW-1000)}];
    else if(sql.includes("FROM client_auth_state"))value=[{credential_version:1}];
    else if(sql.includes("JOIN auth_session_state")||sql.includes("JOIN client_session_state"))value=[row];
    else throw new Error("Unexpected test SQL");
    await state.onRead?.(sql);return value;
  }};
  const pool={async getConnection(){await state.poolWait?.();return connection;}};
  const store=role==="admin"?createAuthStore(pool,{clock:()=>state.at}):createAccessStore(pool,{clock:()=>state.at});
  const input={tokenHash,expectedPasswordHash:user.password_hash,expectedGeneration:1,passwordHash:"new-synthetic-hash",session:{id:Buffer.alloc(16,4),tokenHash:Buffer.alloc(32,5)},now:NOW};
  return {store,state,user,row,input};
}
for(const role of ["admin","client"]){
  test(`${role}: password record is authenticated and no credential write precedes the CAS`,async()=>{
    const f=fixture(role);assert.deepEqual(await f.store.getPasswordChangeRecord(tokenHash,{now:NOW}),{userId,passwordHash:"original-synthetic-hash",generation:1});
    assert.equal(f.state.writes.length,0);
    const result=await f.store.changePassword(f.input);assert.equal(result.userId,userId);assert.equal(result.role,role);
    assert.equal(result.expiresAt,NOW+180*86400000);
    const revocation=f.state.writes.findIndex(x=>x.sql.startsWith("UPDATE sessions SET revoked_at"));
    const replacement=f.state.writes.findIndex(x=>x.sql.startsWith("INSERT INTO sessions"));assert.ok(revocation>=0&&replacement>revocation);
    assert.equal(f.state.writes.some(x=>x.sql.includes("admin_mfa")||x.sql.includes("admin_recovery_codes")),false);
    assert.equal(f.state.writes.some(x=>x.sql.startsWith("UPDATE client_password_resets")),role==="client");
  });
  test(`${role}: stale credentials, revoked session and wrong-role tokens cannot rotate any credential`,async()=>{
    const f=fixture(role);assert.equal(await f.store.changePassword({...f.input,expectedPasswordHash:"stale hash"}),null);assert.equal(f.state.writes.length,0);
    f.row.revoked_at=new Date(NOW);assert.equal(await f.store.changePassword(f.input),null);assert.equal(f.state.writes.length,0);
    f.row.revoked_at=null;f.user.role=role==="admin"?"client":"admin";assert.equal(await f.store.changePassword(f.input),null);assert.equal(f.state.writes.length,0);
  });
  test(`${role}: expiry crossed during connection wait or final credential read refuses writes`,async()=>{
    const f=fixture(role);f.state.poolWait=()=>{f.state.at=NOW+ADMIN_SESSION_SECONDS*1000;};
    assert.equal(await f.store.changePassword(f.input),null);assert.equal(f.state.writes.length,0);
    const g=fixture(role);g.state.onRead=sql=>{if(sql.startsWith("SELECT password_hash"))g.state.at=NOW+ADMIN_SESSION_SECONDS*1000;};
    assert.equal(await g.store.changePassword(g.input),null);assert.equal(g.state.writes.length,0);
  });
  test(`${role}: a failed replacement session rolls back the encompassing credential transaction`,async()=>{
    const f=fixture(role);f.state.failInsert=true;
    await assert.rejects(f.store.changePassword(f.input),{code:role==="admin"?"AUTH_DATABASE_OPERATION":"ACCESS_DATABASE_OPERATION"});
    assert.equal(f.state.commits,0);assert.equal(f.state.rollbacks,1);
  });
}
