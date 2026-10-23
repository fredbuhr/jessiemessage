// Production follow-up component in native Chrome; only loopback synthetic API.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const initial = () => ({ needed: true, through: "1", handledThrough: "0", version: "1", oldestAt: 1750000000000 });
const markup = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/i18n.js" defer></script><script src="/i18n-tools.js" defer></script><script type="module" src="/fixture.js"></script></head><body><main id="host"></main></body></html>`;
const module = `import {createFollowupUI} from '/followup.js';
window.__errors=[];window.addEventListener('error',()=>__errors.push('error'));window.addEventListener('unhandledrejection',()=>__errors.push('unhandled'));
window.__changes=[];window.__responses=0;window.__conversation={id:'a'.repeat(32),lastReadSequence:'1',reply:${JSON.stringify(initial())}};
window.__ui=createFollowupUI({host:document.getElementById('host'),getConversation:()=>__conversation,getReplyThrough:()=>__conversation.lastReadSequence,
request:async(path,options)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)});const value=await response.json();window.__responses++;if(!response.ok)throw Object.assign(new Error('request'),{status:response.status});return value;},
onChanged:(id,reply)=>{__changes.push(id);__conversation.reply=reply;},onError:()=>__errors.push('request')});window.__ui.update();`;
async function fixture() {
  const resources = new Map(await Promise.all(["followup.js","i18n.js","i18n-tools.js"].map(async name=>[`/${name}`,await readFile(new URL(`../../public/${name}`,import.meta.url))]))), calls=[];
  let reply=initial(), hold=null, fail=false;
  const server=createServer((request,response)=>{void(async()=>{
    const path=new URL(request.url,"http://localhost").pathname;response.setHeader("Cache-Control","no-store");
    if(path==="/"){response.setHeader("Content-Type","text/html");response.end(markup);return;}
    if(path==="/fixture.js"){response.setHeader("Content-Type","text/javascript");response.end(module);return;}
    if(resources.has(path)){response.setHeader("Content-Type","text/javascript");response.end(resources.get(path));return;}
    if(path===`/api/chat/admin/conversations/${"a".repeat(32)}/reply`){
      let raw="";for await(const chunk of request)raw+=chunk;const input=JSON.parse(raw);calls.push(input);if(hold)await hold;
      response.setHeader("Content-Type","application/json");
      if(fail){response.writeHead(409);response.end(JSON.stringify({error:"message_conflict"}));return;}
      reply={...reply,needed:input.action==="needed",handledThrough:input.action==="handled"?input.through:reply.handledThrough,version:String(Number(reply.version)+1),oldestAt:input.action==="needed"?1750000000000:null};
      response.end(JSON.stringify({reply}));return;
    }
    if(path==="/favicon.ico"){response.writeHead(204);response.end();return;}
    response.writeHead(404);response.end();
  })().catch(()=>response.destroy());});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,calls,conflict(value=true){fail=value;},hold(value){hold=value;},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test("native Chrome follow-up actions preserve read state, prevent double clicks, show conflicts and clear on owner handoff",{timeout:120000},async t=>{
  const driver=await startWebDriver();
  try{
    for(const width of [320,1280])await t.test(`${width}px`,async()=>{
      const source=await fixture(),page=await driver.browser({origin:source.origin,width});let release;
      try{
        await page.navigate("/");await waitUntil(()=>page.execute("return !!window.__ui && !document.querySelector('.reply-followup').hidden"),"reply component mounted");
        source.hold(new Promise(resolve=>{release=resolve;}));
        await page.execute("document.querySelectorAll('.reply-followup button')[1].click();document.querySelectorAll('.reply-followup button')[1].click()");
        await waitUntil(()=>source.calls.length===1,"one explicit action");
        assert.deepEqual(source.calls[0],{action:"handled",through:"1",expectedVersion:"1"});
        release();source.hold(null);
        await waitUntil(()=>page.execute("return window.__conversation.reply.needed===false"),"handled acknowledged");
        assert.equal(await page.execute("return window.__conversation.lastReadSequence"),"1","reply task never forges read receipt");
        assert.equal(await page.execute("return document.querySelectorAll('.reply-followup button')[0].type"),"button");
        source.conflict();await page.execute("document.querySelector('.reply-followup button').focus()");await page.key("\uE007");
        await waitUntil(()=>page.execute("return document.querySelector('.reply-followup').textContent.includes('Le suivi a changé.')"),"conflict remains visible");
        await page.execute("JessieI18n.setLanguage('en')");
        assert.equal(await page.execute("return document.querySelector('.reply-followup button').textContent"),"Needs a reply");
        assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"),true);
        source.conflict(false); source.hold(new Promise(resolve=>{release=resolve;}));
        await page.click(".reply-followup button"); await waitUntil(()=>source.calls.length===3,"held old-owner action");
        const changes=await page.execute("return window.__changes.length");
        await page.execute("window.__ui.clear();window.__conversation={id:'b'.repeat(32),lastReadSequence:'0',reply:{needed:true,through:'5',handledThrough:'0',version:'1',oldestAt:1750000000000}};window.__ui.update()");
        release();source.hold(null);
        await waitUntil(()=>page.execute("return window.__responses===3 && !document.querySelector('.reply-followup button').disabled"),"old-owner response settled without overwriting new owner");
        assert.equal(await page.execute("return window.__changes.length"),changes);
        assert.equal(await page.execute("return window.__conversation.reply.through"),"5");
        await page.execute("window.__ui.clear()");assert.equal(await page.execute("return document.querySelector('.reply-followup').hidden"),true);
        assert.deepEqual(await page.execute("return window.__errors"),[]);
      }finally{release?.();await page.close();await source.close();}
    });
  }finally{await driver.close();}
});
