import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createResetStore } from "../server/reset/store.mjs";
import { createPasswordService } from "../server/account-password/service.mjs";
import { hashPassword, makeTotpSecret, newToken, createRecoveryCodes, recoveryCodeDigest, sealTotpSecret, tokenDigest, totpCode, verifyPassword } from "../server/auth/crypto.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const date = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

test("real database own-password rotation is atomic, preserves encrypted history and revokes old devices/reset links", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database,/^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations=await loadMigrations(), allowed=[...createdMigrationTables(migrations).reverse(),"migration_probe","schema_migrations"];
  const connection=await connectDatabase();let pool;
  const cleanup=async()=>{const tables=await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",[options.database]);assert.ok(tables.every(x=>allowed.includes(x.name)));for(const name of allowed)await connection.query(`DROP TABLE IF EXISTS ${name}`);};
  try {
    await cleanup();await applyMigrations(connection,{database:options.database,migrations});pool=await createRuntimePool(process.env);
    let now=Date.now();const clock=()=>now, key=randomBytes(32), mailKey=randomBytes(32), chatKey=randomBytes(32);
    const authStore=createAuthStore(pool,{clock}), accessStore=createAccessStore(pool,{clock}), chatStore=createChatStore(pool,{clock}), resetStore=createResetStore(pool,{clock});
    const oldPassword="Original synthetic password", newPassword=" Testé8 ", originalHash=await hashPassword(oldPassword);
    const admin={id:randomBytes(16),email:"password-admin@example.invalid",secret:makeTotpSecret()};
    const backupDigests=createRecoveryCodes().map(recoveryCodeDigest);
    await authStore.initializeAdmin({id:admin.id,email:admin.email,pseudonym:"Synthetic admin",passwordHash:originalHash,secretEncrypted:sealTotpSecret(admin.secret,key,admin.id),recoveryDigests:backupDigests,now});
    const client={id:randomBytes(16),email:"password-client@example.invalid",conversationId:randomBytes(16)};
    await connection.query(`INSERT INTO users (id,role,status,pseudonym,email,password_hash,email_verified_at,access_approved_at,created_at,updated_at)
      VALUES (?,'client','active','Synthetic client',?,?,?,?,?,?)`,[client.id,client.email,originalHash,date(now-1000),date(now-1000),date(now-1000),date(now-1000)]);
    await connection.query("INSERT INTO client_auth_state (user_id,age_declared_at) VALUES (?,?)",[client.id,date(now-1000)]);
    await consumeSyntheticInvitation(connection,client.id,now-1000);
    await connection.query("INSERT INTO conversations (id,client_id,admin_id,created_at) VALUES (?,?,?,?)",[client.conversationId,client.id,admin.id,date(now)]);
    const authService=await createAuthService({store:authStore,totpKey:key,clock});
    const accessService=await createAccessService({store:accessStore,authStore,authService,totpKey:key,mailKey,origin:"https://example.invalid",clock});
    const chatService=await createChatService({store:chatStore,authStore,authService,accessService,key:chatKey,clock});
    const service=createPasswordService({authService,accessService,authStore,accessStore,key,clock});
    let adminOne=await authService.login({email:admin.email,password:oldPassword,factor:totpCode(admin.secret,{now}),peerAddress:"127.0.0.1"});
    now+=30000;
    const adminTwo=await authService.login({email:admin.email,password:oldPassword,factor:totpCode(admin.secret,{now}),peerAddress:"127.0.0.1"});
    let clientOne=await accessService.login({email:client.email,password:oldPassword,peerAddress:"127.0.0.1"});
    const clientTwo=await accessService.login({email:client.email,password:oldPassword,peerAddress:"127.0.0.1"});
    const conversation=client.conversationId.toString("hex");
    await chatService.send("client",clientOne.token,conversation,{clientMessageId:randomBytes(16).toString("hex"),body:"Encrypted history survives password change"});
    const before=await chatService.messages("client",clientOne.token,conversation,{});
    const fields=await connection.query("SELECT id,role,status,pseudonym,email,email_verified_at,access_approved_at,created_at FROM users ORDER BY id");
    const resetToken=newToken();
    await resetStore.requestReset({email:client.email,now,reset:{id:randomBytes(16),tokenHash:tokenDigest(resetToken),expiresAt:now+1800000},mail:{id:randomBytes(16),payloadEncrypted:"synthetic-encrypted-reset-fixture"}});
    await t.test("incorrect current password and mismatched confirmation change nothing",async()=>{
      await assert.rejects(service.change("client",clientOne.token,{currentPassword:"Wrong synthetic password",newPassword,confirmation:newPassword}),{code:"PASSWORD_CURRENT_INVALID"});
      await assert.rejects(service.change("client",clientOne.token,{currentPassword:oldPassword,newPassword,confirmation:"mismatch"}),{code:"PASSWORD_MISMATCH"});
      assert.ok(await accessService.session(clientTwo.token));assert.ok(await resetStore.inspectReset({tokenHash:tokenDigest(resetToken),now}));
    });
    await t.test("replacement session insertion failure rolls back password, devices and recovery changes",async()=>{
      const record=await accessStore.getPasswordChangeRecord(tokenDigest(clientOne.token),{now});
      const current=await accessStore.getClientSession(tokenDigest(clientOne.token),{now,idleSeconds:0});
      await assert.rejects(accessStore.changePassword({tokenHash:tokenDigest(clientOne.token),expectedPasswordHash:record.passwordHash,expectedGeneration:record.generation,passwordHash:await hashPassword(newPassword),session:{id:current.id,tokenHash:tokenDigest(newToken())},now}),{code:"ACCESS_DATABASE_OPERATION"});
      assert.equal((await accessStore.getClientLoginRecord(client.email)).passwordHash,originalHash);
      assert.ok(await accessService.session(clientOne.token));assert.ok(await accessService.session(clientTwo.token));
      assert.ok(await resetStore.inspectReset({tokenHash:tokenDigest(resetToken),now}));
    });
    await t.test("client rotates current session, revokes other devices and resets, while decrypting identical history",async()=>{
      const changed=await service.change("client",clientOne.token,{currentPassword:oldPassword,newPassword,confirmation:newPassword});
      assert.notEqual(changed.token,clientOne.token);assert.equal(await accessService.session(clientOne.token),null);assert.equal(await accessService.session(clientTwo.token),null);
      assert.ok(await accessService.session(changed.token));assert.equal(await resetStore.inspectReset({tokenHash:tokenDigest(resetToken),now}),null);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE recipient_user_id=?",[client.id]))[0].status,"cancelled");
      assert.equal(await verifyPassword(oldPassword,(await accessStore.getClientLoginRecord(client.email)).passwordHash),false);
      assert.equal(await verifyPassword(newPassword,(await accessStore.getClientLoginRecord(client.email)).passwordHash),true);
      assert.deepEqual(await chatService.messages("client",changed.token,conversation,{}),before);
      clientOne=changed;
    });
    await t.test("admin rotates current session and preserves MFA enrollment/backup codes and chat data",async()=>{
      const recoveryBefore=await connection.query("SELECT code_hash,mfa_version,consumed_at FROM admin_recovery_codes WHERE user_id=? ORDER BY code_hash",[admin.id]);
      const mfaBefore=await connection.query("SELECT secret_encrypted,version,last_totp_step,enabled_at FROM admin_mfa WHERE user_id=?",[admin.id]);
      const changed=await service.change("admin",adminOne.token,{currentPassword:oldPassword,newPassword,confirmation:newPassword});
      assert.equal(await authService.session(adminOne.token),null);assert.equal(await authService.session(adminTwo.token),null);assert.ok(await authService.session(changed.token));
      assert.deepEqual(await connection.query("SELECT code_hash,mfa_version,consumed_at FROM admin_recovery_codes WHERE user_id=? ORDER BY code_hash",[admin.id]),recoveryBefore);
      assert.deepEqual(await connection.query("SELECT secret_encrypted,version,last_totp_step,enabled_at FROM admin_mfa WHERE user_id=?",[admin.id]),mfaBefore);
      assert.ok((await chatService.messages("admin",changed.token,conversation,{})).messages.length);
      adminOne=changed;
    });
    await t.test("concurrent stale token changes have one winner and cannot overwrite it",async()=>{
      const result=await Promise.allSettled([service.change("client",clientOne.token,{currentPassword:newPassword,newPassword:"Alternate one password",confirmation:"Alternate one password"}),service.change("client",clientOne.token,{currentPassword:newPassword,newPassword:"Alternate two password",confirmation:"Alternate two password"})]);
      assert.equal(result.filter(x=>x.status==="fulfilled").length,1);assert.equal(result.find(x=>x.status==="rejected").reason.code,"PASSWORD_AUTH_INVALID");
    });
    assert.deepEqual(await connection.query("SELECT id,role,status,pseudonym,email,email_verified_at,access_approved_at,created_at FROM users ORDER BY id"),fields);
  } finally {if(pool)await pool.end();await cleanup();await connection.end();}
});
