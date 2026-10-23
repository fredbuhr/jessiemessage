// Only disposable loopback SQL and synthetic accounts; no hosting transport.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables } from "../server/db/migrations.mjs";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createTasksStore } from "../server/tasks/store.mjs";
import { createCrmStore } from "../server/crm/store.mjs";
import { createReplyTracking } from "../server/tasks/reply.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), hex = value => value.toString("hex");
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
test("real SQL reply task tracks incoming, concurrent replies, broadcasts, historical requests and two sessions", { skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with a disposable loopback database.", timeout: 120000 }, async t => {
  const options = databaseOptions(); assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host)); assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadExperienceMigrations(), allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(table => allowedTables.includes(table.name)), "refuse unrelated schema cleanup");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations }); pool = await createRuntimePool(process.env);
    const now = Date.now(), clock = () => now, created = sql(now - 1000), key = randomBytes(32);
    async function user(role) {
      const value = { id: id(), sessionId: id(), token: newToken(), role, pseudonym: `Reply ${role}` };
      await connection.query("INSERT INTO users (id,role,status,pseudonym,email,password_hash,email_verified_at,age_assured_at,access_approved_at,created_at,updated_at) VALUES (?,?,'active',?,?,'synthetic',?,?,?,?,?)", [value.id,role,value.pseudonym,`${hex(value.id)}@example.invalid`,created,created,created,created,created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id,secret_encrypted,version,last_totp_step,enabled_at) VALUES (?,'synthetic',1,1,?)",[value.id,created]);
      else { await connection.query("INSERT INTO client_auth_state (user_id,credential_version,age_declared_at) VALUES (?,1,?)",[value.id,created]); await consumeSyntheticInvitation(connection,value.id,now-1000); }
      await connection.query("INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)",[value.sessionId,value.id,tokenDigest(value.token),created,sql(now+8*3600000)]);
      await connection.query(role === "admin" ? "INSERT INTO auth_session_state (session_id,last_seen_at,mfa_verified_at,mfa_version) VALUES (?,?,?,1)" : "INSERT INTO client_session_state (session_id,last_seen_at,credential_version) VALUES (?,?,1)",role === "admin" ? [value.sessionId,created,created] : [value.sessionId,created]);
      return value;
    }
    const admin=await user("admin"), client=await user("client"), foreign=await user("client"), conversationId=id(), foreignId=id();
    await connection.query("INSERT INTO conversations (id,admin_id,client_id,created_at) VALUES (?,?,?,?),(?,?,?,?)",[conversationId,admin.id,client.id,created,foreignId,admin.id,foreign.id,created]);
    const makeStore=()=>createChatStore(pool,{clock,replyTracking:createReplyTracking({key})}), store=makeStore(), second=makeStore();
    const request=(actor=admin,conv=conversationId)=>({role:actor.role,tokenHash:tokenDigest(actor.token),conversationId:conv,now});
    const message=(changes={})=>({id:id(),clientMessageId:id(),bodyEncrypted:"synthetic-ciphertext",bodyFingerprint:randomBytes(32),...changes});
    const send=(actor,changes={},conv=conversationId)=>store.sendMessage({...request(actor,conv),message:message(changes)});
    const read=()=>store.readMessages({...request(),limit:50});
    const tasks=createTasksStore({pool,chatStore:store,key,clock});
    const crm=createCrmStore({pool,chatStore:store,replyTracking:true});
    await t.test("schema and client incoming produce one reserved encrypted task; reading does not handle it", async()=>{
      assert.equal(await tasks.assertSchema({video:true,experience:true}),true);
      const first=await send(client); assert.equal(first.message.sequence,"1");
      const page=await read(); assert.equal(page.conversation.reply.needed,true);
      await store.markRead({...request(),through:"1"}); assert.equal((await read()).conversation.reply.needed,true);
      assert.equal((await store.readMessages({...request(client),limit:50})).conversation.reply,undefined);
      const rows=await connection.query("SELECT reply_kind,title_encrypted FROM crm_tasks WHERE conversation_id=?",[conversationId]); assert.equal(rows.length,1); assert.equal(rows[0].reply_kind,"reply");assert.ok(!rows[0].title_encrypted.includes("À répondre"));
      assert.equal((await tasks.list({tokenHash:tokenDigest(admin.token),now})).tasks[0].reply,true);
    });
    await t.test("response captures seen client sequence; a newer incoming and lost response retry stay correct", async()=>{
      const observed=(await read()).conversation.reply;
      await send(client); const outgoing=message({replyThrough:observed.through,replyVersion:observed.version});
      await store.sendMessage({...request(),message:outgoing});
      assert.equal((await read()).conversation.reply.needed,true);
      assert.equal((await store.sendMessage({...request(),message:outgoing})).duplicate,true);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM crm_tasks WHERE conversation_id=?",[conversationId]))[0].n),1);
      const after=(await read()).conversation.reply;
      await send(admin,{replyThrough:after.through,replyVersion:after.version}); assert.equal((await read()).conversation.reply.needed,false);
      assert.equal((await second.readMessages({...request(),limit:50})).conversation.reply.needed,false);
    });
    await t.test("manual reopen, version conflict and unread filters are independent of reads", async()=>{
      const previous=(await read()).conversation.reply;
      await store.markReply({...request(),input:{action:"needed",through:previous.through,expectedVersion:previous.version}});
      assert.equal((await second.readMessages({...request(),limit:50})).conversation.reply.needed,true);
      await assert.rejects(store.markReply({...request(),input:{action:"handled",through:previous.through,expectedVersion:previous.version}}),e=>e.code==="CHAT_CONFLICT");
      assert.equal((await crm.listContacts({tokenHash:tokenDigest(admin.token),now,reply:true})).contacts.length,1);
      const task=(await tasks.list({tokenHash:tokenDigest(admin.token),now})).tasks[0];
      await assert.rejects(tasks.save({tokenHash:tokenDigest(admin.token),now,taskId:Buffer.from(task.id,"hex"),input:{conversationId:hex(conversationId),expectedVersion:task.version,title:"Bypass",dueAt:null,done:true}}),e=>e.code==="TASKS_CONFLICT");
      await assert.rejects(store.markReply({...request(client),input:{action:"handled",through:"2",expectedVersion:previous.version}}),e=>e.code==="CHAT_FORBIDDEN");
      await assert.rejects(store.markReply({...request(client,foreignId),input:{action:"needed",through:"0",expectedVersion:"0"}}));
    });
    await t.test("broadcast does not handle; a legacy historic incoming is backfilled by the filter",async()=>{
      const before=(await read()).conversation.reply;
      await store.withBroadcastDelivery({adminId:admin.id,mfaVersion:1,conversationId,now},async(_connection,_context,append)=>append(message()));
      assert.deepEqual((await read()).conversation.reply,before);
      const legacy=createChatStore(pool,{clock});
      await legacy.sendMessage({...request(foreign,foreignId),message:message()});
      const contacts=await crm.listContacts({tokenHash:tokenDigest(admin.token),now,reply:true}); assert.equal(contacts.contacts.length,2);
      const historical=await store.readMessages({...request(admin,foreignId),limit:50}); assert.equal(historical.conversation.reply.needed,true);
    });
  } finally { await pool?.end();try{await reset();}finally{await connection.end();} }
});
