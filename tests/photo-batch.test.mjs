import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoBatch, removePhoto, runPhotoBatch, MAX_PHOTO_BATCH } from "../public/photo-batch.js";
const id = n => n.toString(16).padStart(32,"0");
function fixture(count=5) {
  let key=0;
  const batch=createPhotoBatch(Array.from({length:count},(_,i)=>({name:`synthetic-${i}`})),()=>id(++key));
  batch.caption="One caption";
  const sent=new Map(), calls={prepared:[],uploaded:[],sent:[]};let uploadId=100;
  const hooks={prepare:async file=>{calls.prepared.push(file.name);return file;},upload:async file=>{calls.uploaded.push(file.name);return {id:id(++uploadId)};},send:async messages=>({results:messages.map(input=>{
    calls.sent.push(input);const duplicate=sent.has(input.clientMessageId);
    if(!duplicate)sent.set(input.clientMessageId,{id:id(sent.size+200),sequence:String(sent.size+1),clientMessageId:input.clientMessageId});
    return {clientMessageId:input.clientMessageId,message:sent.get(input.clientMessageId),duplicate};})})};
  return {batch,calls,hooks,sent};
}
test("five-photo selection removes and appends before send without replacing remaining identities",()=>{
  const f=fixture(), preserved=f.batch.items[2].clientMessageId;
  assert.equal(removePhoto(f.batch,f.batch.items[1].clientMessageId).file.name,"synthetic-1");
  const batch=createPhotoBatch([{name:"added"}],()=>id(30),f.batch);
  assert.equal(batch.items.length,5);assert.equal(batch.items[1].clientMessageId,preserved);
  assert.equal(batch.started,false);assert.equal(f.sent.size,0);
  assert.throws(()=>createPhotoBatch(Array(11).fill({}),()=>id(1)),/photo_selection_limit/);
  assert.equal(MAX_PHOTO_BATCH,10);
});
test("serial bounded upload sends captions once and records successes only on server confirmation",async()=>{
  const f=fixture();let active=0,peak=0;
  f.hooks.upload=async file=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;return {id:id(Number(file.name.at(-1))+100)};};
  assert.equal(await runPhotoBatch(f.batch,f.hooks),true);assert.equal(peak,1);assert.equal(f.sent.size,5);
  assert.equal(f.calls.sent.filter(input=>input.caption==="One caption").length,1);
  assert.ok(f.batch.items.every(item=>item.status==="sent"&&item.file===null&&item.prepared===null));
});
test("an upload failure preserves other photos and retries only the failed file",async()=>{
  const f=fixture();const upload=f.hooks.upload;let failed=true;
  f.hooks.upload=async file=>{if(file.name==="synthetic-2"&&failed){failed=false;throw Object.assign(new Error(),{status:507,code:"storage_limit"});}return upload(file);};
  assert.equal(await runPhotoBatch(f.batch,f.hooks),false);assert.equal(f.sent.size,2);assert.equal(f.batch.items[2].status,"failed");
  const prior=f.calls.sent.length;assert.equal(await runPhotoBatch(f.batch,f.hooks),true);assert.equal(f.sent.size,5);
  assert.equal(f.calls.sent.length,prior+3);assert.equal(f.calls.prepared.filter(name=>name==="synthetic-2").length,1);
});
test("a lost server response reuses each exact message key and never duplicates persisted photos",async()=>{
  const f=fixture(),send=f.hooks.send;let lost=true;const keys=f.batch.items.map(item=>item.clientMessageId);
  f.hooks.send=async messages=>{const result=await send(messages);if(lost){lost=false;throw new Error("lost_response");}return result;};
  assert.equal(await runPhotoBatch(f.batch,f.hooks),false);assert.equal(f.sent.size,5);assert.ok(f.batch.items.every(item=>item.status==="uncertain"));
  assert.equal(await runPhotoBatch(f.batch,f.hooks),true);assert.equal(f.sent.size,5);assert.equal(f.calls.uploaded.length,5);
  assert.deepEqual(f.calls.sent.slice(5).map(item=>item.clientMessageId),keys);
});
test("double click cannot start a second transfer while the first one awaits upload",async()=>{
  const f=fixture(2);let release;f.hooks.prepare=()=>new Promise(resolve=>{release=()=>resolve({name:"prepared"});});
  const first=runPhotoBatch(f.batch,f.hooks);assert.equal(await runPhotoBatch(f.batch,f.hooks),false);
  release();await new Promise(resolve=>setTimeout(resolve,0));release();assert.equal(await first,true);assert.equal(f.sent.size,2);
});
test("partial message failure retries only failed identities and keeps the captured reply boundary",async()=>{
  const f=fixture(3),send=f.hooks.send;f.batch.replyThrough="9007199254740993";f.batch.replyVersion="7";let first=true;
  f.hooks.send=async messages=>{const result=await send(first?messages.slice(0,1):messages);if(first){first=false;result.results.push({clientMessageId:messages[1].clientMessageId,status:503,error:"media_unavailable"},{clientMessageId:messages[2].clientMessageId,status:424,error:"photo_batch_waiting"});}return result;};
  assert.equal(await runPhotoBatch(f.batch,f.hooks),false);assert.equal(f.sent.size,1);
  assert.equal(await runPhotoBatch(f.batch,f.hooks),true);assert.equal(f.sent.size,3);
  assert.equal(f.calls.sent.length,3);assert.ok(f.calls.sent.every(input=>input.replyThrough==="9007199254740993"&&input.replyVersion==="7"));
});
test("account or conversation switch stops before publication and preserves the in-memory draft",async()=>{
  const f=fixture(2);let current=true;f.hooks.prepare=async file=>{current=false;return file;};
  await assert.rejects(runPhotoBatch(f.batch,{...f.hooks,current:()=>current}),error=>error.stale===true);
  assert.equal(f.sent.size,0);assert.equal(f.batch.busy,false);assert.ok(f.batch.items.every(item=>item.file));
});

test("failure of the first photo publishes neither later photos nor a caption until retry",async()=>{
  const f=fixture(3),upload=f.hooks.upload;let first=true;
  f.hooks.upload=async file=>{if(first){first=false;throw Object.assign(new Error(),{status:507,code:"storage_limit"});}return upload(file);};
  assert.equal(await runPhotoBatch(f.batch,f.hooks),false);assert.equal(f.sent.size,0);assert.equal(f.calls.prepared.length,1);
  assert.equal(await runPhotoBatch(f.batch,f.hooks),true);assert.equal(f.sent.size,3);
  assert.deepEqual(f.calls.sent.map(input=>input.clientMessageId),f.batch.items.map(item=>item.clientMessageId));
  assert.deepEqual(f.calls.sent.map(input=>input.caption),["One caption","",""]);
});

test("definitively missing uploaded photos can be removed, while uncertain identities remain protected",async()=>{
  const f=fixture(2);f.hooks.send=async inputs=>({results:inputs.map((input,index)=>({clientMessageId:input.clientMessageId,status:index===0?404:424,error:index===0?"not_found":"photo_batch_waiting"}))});
  assert.equal(await runPhotoBatch(f.batch,f.hooks),false);const first=f.batch.items[0];
  assert.ok(first.mediaId);assert.equal(removePhoto(f.batch,first.clientMessageId),first);
  f.batch.items[0].status="uncertain";f.batch.items[0].error={status:0};
  assert.equal(removePhoto(f.batch,f.batch.items[0].clientMessageId),null);
});
