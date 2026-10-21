import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
const names=["announcements.html","announcements.js","announcements-model.js","i18n.js","i18n-tools.js","session-clock.js"];
const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL(`../public/${name}`,import.meta.url),"utf8")])));
const now=1792584000000,id=n=>n.toString(16).padStart(32,"0");
const session=(owner=1)=>({user:{id:id(owner),role:"admin",pseudonym:"Synthetic"},csrf:"A".repeat(43),expiresAt:now+3600000});
const item=(revision="1",body="Je commence bientôt")=>({id:id(7),revision,body,startsAt:now,expiresAt:now+3600000,status:"visible",sendPrivateMessage:false,campaignId:null});
const ok=(data,status=200)=>({status,ok:status>=200&&status<300,json:async()=>data});
const flush=async()=>{for(let i=0;i<24;i++)await new Promise(resolve=>setImmediate(resolve));};
class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attributes = new Map(); this.events = new Map(); this.value = ""; this.hidden = false; this.disabled = false; this.checked = false; this.className = ""; this._text = ""; this.classList = { toggle() {} }; }
  get isConnected() { return this.root === true || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ""; this.append(...children); }
  after(...children) { const parent = this.parentElement, index = parent.children.indexOf(this); for (const child of children) child.parentElement = parent; parent.children.splice(index + 1, 0, ...children); }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  removeEventListener(name, callback) { this.events.set(name, (this.events.get(name) ?? []).filter((value) => value !== callback)); }
  matches(selector) { if (selector === "a[data-help-link]") return this.tagName === "A" && this.getAttribute("data-help-link") !== null;
    if (selector.startsWith("[")) return this.getAttribute(selector.slice(1, -1)) !== null;
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    if (selector === "input:checked") return this.tagName === "INPUT" && this.checked;
    return this.tagName.toLowerCase() === selector.toLowerCase(); }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(selector.split(",").some((part) => child.matches(part.trim())) ? [child] : []), ...child.querySelectorAll(selector)]); }
  reset() { for (const field of this.querySelectorAll("input,textarea,select")) { field.value = ""; field.checked = false; } }
  showModal() { this.open = true; } close() { this.open = false; } focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; } checkValidity() { return true; }
}
function parse(html) {
  const root = new Element("root"); root.root = true; const stack = [root], ids = new Map(), voids = new Set(["meta", "link", "input", "img", "br"]);
  const decode = (value) => value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const value = match[0]; if (value.startsWith("<!")) continue;
    if (value.startsWith("</")) { stack.pop(); continue; }
    if (!value.startsWith("<")) { stack.at(-1)._text += decode(value); continue; }
    const tag = /^<([a-z0-9-]+)/i.exec(value)?.[1]; if (!tag) continue;
    const node = new Element(tag);
    for (const attribute of value.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)(?:="([^"]*)")?/g)) if (attribute[1] !== tag) node.setAttribute(attribute[1], decode(attribute[2] ?? ""));
    if (node.getAttribute("id")) ids.set(node.getAttribute("id"), node);
    stack.at(-1).append(node); if (!voids.has(tag)) stack.push(node);
  }
  return { root, ids };
}

function harness(respond) {
  const {root,ids}=parse(files["announcements.html"]), events=new Map(),windowEvents=new Map(),timers=new Map(),calls=[];let next=0;
  const document={visibilityState:"visible",documentElement:root.querySelectorAll("html")[0],body:root.querySelectorAll("body")[0],activeElement:null,
    querySelectorAll:selector=>root.querySelectorAll(selector),getElementById:id=>ids.get(id),createElement:tag=>new Element(tag),
    addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn);},removeEventListener(){}};
  for(const node of ids.values())node.ownerDocument=document;
  class Clock extends Date { static now(){return now;} }
  const context=vm.createContext({document,window:{addEventListener:(name,fn)=>{if(!windowEvents.has(name))windowEvents.set(name,[]);windowEvents.get(name).push(fn);}},
    navigator:{language:"fr-FR"},sessionStorage:{getItem(){return null;},setItem(){}},location:{replace(value){context.destination=value;}},Date:Clock,BigInt,crypto:webcrypto,
    AbortController,URL,URLSearchParams,TextEncoder,console,setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id),
    fetch:async(path,options={})=>{calls.push({path,options});return respond(path,options,calls);}});
  const run=code=>vm.runInContext(code,context);
  run(files["i18n.js"]);run(files["i18n-tools.js"]);run(files["session-clock.js"]);
  const model=files["announcements-model.js"],exports=[...model.matchAll(/export (?:function|const) (\w+)/g)].map(match=>match[1]);
  run(`globalThis.model=(()=>{${model.replaceAll("export function ","function ").replaceAll("export const ","const ")}return {${exports.join(",")}};})();`);
  const code=files["announcements.js"].replace(/^import \{([^\n]+)\} from "\/announcements-model.js";/,"const {$1}=model;");
  run(`(()=>{${code}\nglobalThis.feature={state,bootstrap,mutate,loadCurrent};})();`);
  return {ids,calls,context,document,run,timers,async event(id,name){for(const fn of ids.get(id).events.get(name)??[])fn({preventDefault(){}});await flush();},
    async visibility(value){document.visibilityState=value;for(const fn of events.get("visibilitychange")??[])fn();await flush();}};
}

test("admin announcement page bootstraps and a lost confirmation retries the same stable mutation",async()=>{
  let current=null,revision="0",postCount=0;const payloads=[];
  const h=harness(async(path,options)=>{
    if(path.endsWith("/session"))return ok(session());
    if(path==="/api/announcements/admin/current"&&options.method==="POST"){
      payloads.push(JSON.parse(options.body));postCount++;current=item("1",payloads[0].body);revision="1";
      if(postCount===1)return {status:201,ok:true,json:async()=>{throw new Error("incomplete JSON after commit");}};
      return ok({serverTime:now,revision,announcement:current,duplicate:true});
    }
    if(path==="/api/announcements/admin/current")return ok({serverTime:now,revision,announcement:current});
    throw new Error("Unexpected fixture path "+path);
  });await flush();assert.equal(h.ids.get("announcements-content").hidden,false);
  h.ids.get("body").value="Je commence bientôt";await h.event("body","input");await h.event("announcement-form","submit");
  assert.equal(h.ids.get("uncertain").hidden,false);assert.equal(h.ids.get("announcement-fields").disabled,true);
  await h.event("retry","click");assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);
  assert.equal(h.ids.get("uncertain").hidden,true);assert.equal(h.ids.get("current-body").textContent,"Je commence bientôt");
});

test("a conflicting announcement preserves the unsaved text until the operator explicitly uses the new revision",async()=>{
  const h=harness(async(path,options)=>{
    if(path.endsWith("/session"))return ok(session());
    if(path==="/api/announcements/admin/current"&&options.method==="POST")return ok({error:"conflict"},409);
    if(path==="/api/announcements/admin/current")return ok({serverTime:now,revision:"2",announcement:item("2","Other device")});
    throw new Error("Unexpected fixture path "+path);
  });await flush();h.ids.get("body").value="My unsaved draft";await h.event("body","input");await h.event("announcement-form","submit");
  assert.equal(h.ids.get("body").value,"My unsaved draft");assert.match(h.ids.get("save-status").textContent,/brouillon est conservé/);
  await h.event("use-current","click");assert.equal(h.ids.get("body").value,"Other device");assert.equal(h.run("feature.state.baseRevision"),"2");
});

test("private message preview requires the current acknowledgement and language changes preserve raw text",async()=>{
  const h=harness(async(path)=>{
    if(path.endsWith("/session"))return ok(session());
    if(path.endsWith("/preview"))return ok({totalCount:2500,eligibleCount:2499,excludedCount:1,previewToken:"preview"});
    if(path.endsWith("/current"))return ok({serverTime:now,revision:"0",announcement:null});
    throw new Error("Unexpected fixture path "+path);
  });await flush();h.ids.get("body").value="Fermer";await h.event("body","input");h.ids.get("send-message").checked=true;await h.event("send-message","change");
  assert.equal(h.ids.get("save").disabled,true);await h.event("preview","click");assert.equal(h.ids.get("save").disabled,true);
  h.ids.get("acknowledge").checked=true;await h.event("acknowledge","change");assert.equal(h.ids.get("save").disabled,false);
  const before=h.calls.length;h.run('JessieI18n.setLanguage("en")');assert.equal(h.ids.get("body").value,"Fermer");assert.equal(h.ids.get("draft-preview").textContent,"Fermer");
  assert.match(h.ids.get("acknowledge-label").textContent,/2,499 clients/);assert.equal(h.calls.length,before);
});

test("same-owner hide preserves an uncertain request, whereas a replacement account purges its draft and retry id",async()=>{
  let owner=1,postCount=0;const h=harness(async(path,options)=>{
    if(path.endsWith("/session"))return ok(session(owner));
    if(path.endsWith("/current")&&options.method==="POST"){postCount++;throw new Error("offline after possible commit");}
    if(path.endsWith("/current"))return ok({serverTime:now,revision:"0",announcement:null});
    throw new Error("Unexpected fixture path "+path);
  });await flush();h.ids.get("body").value="Private old owner";await h.event("body","input");await h.event("announcement-form","submit");
  const prior=h.run("JSON.stringify(feature.state.pending.body)");await h.visibility("hidden");assert.equal(h.ids.get("body").value,"");
  await h.visibility("visible");assert.equal(h.run("JSON.stringify(feature.state.pending.body)"),prior);
  owner=2;await h.visibility("hidden");await h.visibility("visible");assert.equal(h.run("feature.state.pending"),null);assert.equal(h.ids.get("body").value,"");assert.equal(postCount,1);
});

test("a current GET delayed across a save cannot restore its older announcement or form fields",async()=>{
  let block=false,resolveOld;
  const h=harness(async(path,options)=>{
    if(path.endsWith("/session"))return ok(session());
    if(path.endsWith("/current")&&options.method==="POST")return ok({serverTime:now,revision:"2",announcement:item("2","Committed new text"),duplicate:false});
    if(path.endsWith("/current")){
      if(block)return new Promise(resolve=>{resolveOld=resolve;});
      return ok({serverTime:now,revision:"1",announcement:item("1","Previous text")});
    }
    throw new Error("Unexpected fixture path "+path);
  });await flush();block=true;const delayed=h.run("feature.loadCurrent(true)");await flush();assert.equal(typeof resolveOld,"function");
  h.ids.get("body").value="Committed new text";await h.event("body","input");await h.event("announcement-form","submit");
  assert.equal(h.ids.get("current-body").textContent,"Committed new text");
  resolveOld(ok({serverTime:now,revision:"1",announcement:item("1","Previous text")}));await delayed;await flush();
  assert.equal(h.ids.get("current-body").textContent,"Committed new text");assert.equal(h.ids.get("body").value,"Committed new text");assert.equal(h.run("feature.state.currentRevision"),"2");
});

test("an in-flight logout cannot bootstrap again on visibility resume and only confirmed logout redirects",async()=>{
  let resolveLogout;const h=harness(async(path)=>{
    if(path==="/api/auth/logout")return new Promise(resolve=>{resolveLogout=resolve;});
    if(path.endsWith("/session"))return ok(session());
    if(path.endsWith("/current"))return ok({serverTime:now,revision:"0",announcement:null});
    throw new Error("Unexpected fixture path "+path);
  });await flush();await h.event("logout","click");assert.equal(h.ids.get("announcements-content").hidden,true);
  const calls=h.calls.length;await h.visibility("hidden");await h.visibility("visible");assert.equal(h.calls.length,calls);
  resolveLogout(ok({}));await flush();assert.match(h.context.destination,/admin\/login/);
  const failure=harness(async(path)=>{
    if(path==="/api/auth/logout")return ok({error:"unavailable"},503);
    if(path.endsWith("/session"))return ok(session());
    return ok({serverTime:now,revision:"0",announcement:null});
  });await flush();await failure.event("logout","click");assert.equal(failure.context.destination,undefined);assert.match(failure.ids.get("session-status").textContent,/déconnexion n’a pas été confirmée/);
});

test("a removal on another device permits an explicit rebase while preserving the local draft",async()=>{
  let removed=false;
  const h=harness(async(path,options)=>{
    if(path.endsWith("/session"))return ok(session());
    if(path.endsWith("/current")&&options.method==="POST")return ok({error:"conflict"},409);
    if(path.endsWith("/current"))return ok({serverTime:now,revision:removed?"2":"1",announcement:removed?null:item("1","Previous text")});
    throw new Error("Unexpected fixture path "+path);
  });await flush();h.ids.get("body").value="Preserve this local draft";await h.event("body","input");removed=true;await h.event("announcement-form","submit");
  assert.equal(h.ids.get("use-current").hidden,false);assert.equal(h.ids.get("use-current").textContent,"Actualiser mon brouillon");
  assert.equal(h.run("feature.state.baseRevision"),"1");await h.event("use-current","click");
  assert.equal(h.ids.get("body").value,"Preserve this local draft");assert.equal(h.run("feature.state.baseRevision"),"2");
  assert.equal(h.run("feature.state.preview"),null);assert.equal(h.run("feature.state.acknowledged"),false);
});
