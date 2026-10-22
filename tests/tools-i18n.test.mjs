import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";

const files = Object.fromEntries(await Promise.all(["i18n.js", "help-link.js", "i18n-tools.js", "i18n-broadcast.js", "session-clock.js", "broadcast.html", "broadcast.js", "broadcast-model.js", "crm.js", "crm-model.js"].map(async (name) => [name, await readFile(new URL(`../public/${name}`, import.meta.url), "utf8")])));
const flush = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const id = (value) => value.toString(16).padStart(32, "0");
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
  showModal() { this.open = true; } close() { this.open = false; } focus() {} checkValidity() { return true; }
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
function harness({ respond, now } = {}) {
  const { root, ids } = parse(files["broadcast.html"]), documentEvents = new Map(), windowEvents = new Map(), calls = [], timers = new Map(); let timer = 0;
  const add = (events, name, callback) => { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); };
  const document = { visibilityState: "hidden", documentElement: root.querySelectorAll("html")[0], body: root.querySelectorAll("body")[0],
    querySelectorAll: (selector) => root.querySelectorAll(selector), getElementById: (name) => ids.get(name), createElement: (tag) => new Element(tag),
    addEventListener: (name, callback) => add(documentEvents, name, callback), removeEventListener: (name, callback) => documentEvents.set(name, (documentEvents.get(name) ?? []).filter((value) => value !== callback)) };
  const context = vm.createContext({ document, window: { addEventListener: (name, callback) => add(windowEvents, name, callback), removeEventListener() {} }, navigator: { language: "fr-FR" },
    sessionStorage: { getItem() { return null; }, setItem() {} }, AbortController, URL, URLSearchParams, TextEncoder, console, location: { replace() {} },
    ...(now === undefined ? {} : { Date: class extends Date { static now() { return now(); } } }),
    setTimeout(callback, delay) { timers.set(++timer, { callback, delay }); return timer; }, clearTimeout(value) { timers.delete(value); },
    fetch: async (path, options = {}) => { calls.push({ path, options }); if (respond) return respond(path, options); throw new Error("Unexpected network request in the UI-only harness"); } });
  const run = (code) => vm.runInContext(code, context);
  run(files["i18n.js"]); run(files["help-link.js"]); run(files["i18n-tools.js"]); run(files["i18n-broadcast.js"]); run(files["session-clock.js"]);
  const model = (name) => {
    const source = files[name], exports = [...source.matchAll(/export (?:function|const) ([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]);
    run(`globalThis.model = (() => {${source.replaceAll("export function ", "function ").replaceAll("export const ", "const ")}\nreturn {${exports.join(",")}};})();`);
  };
  return { root, ids, document, context, calls, run, model, timers, visible() { document.visibilityState = "visible"; },
    async tick(delay) { const next = [...timers].find(([, value]) => value.delay === delay); assert.ok(next, `Expected ${delay}ms timer`); timers.delete(next[0]); next[1].callback(); await flush(); },
    async online() { for (const callback of windowEvents.get("online") ?? []) callback(); await flush(); },
    switch(language) { run(`JessieI18n.setLanguage(${JSON.stringify(language)})`); }, dispatchDocument(name) { for (const callback of documentEvents.get(name) ?? []) callback(); } };
}

test("broadcast HTML marks interface leaves and loads the shared runtime/catalog before its controller", () => {
  const html = files["broadcast.html"];
  assert.ok(html.indexOf('src="/i18n.js"') < html.indexOf('src="/i18n-tools.js"'));
  assert.ok(html.indexOf('src="/i18n-tools.js"') < html.indexOf('src="/broadcast.js"'));
  assert.ok(html.indexOf('src="/session-clock.js"') < html.indexOf('src="/broadcast.js"'));
  assert.match(html, /data-jm-language/); assert.match(html, /data-jm-i18n-placeholder="Écris ton message…"/);
  const h = harness(), serviceLink = h.root.querySelectorAll("a").find(node => node.getAttribute("href") === "/admin/readiness");
  assert.equal(serviceLink.textContent, "État du service");
  h.visible(); h.switch("en");
  assert.equal(serviceLink.textContent, "Service status"); assert.equal(serviceLink.getAttribute("href"), "/admin/readiness");
  assert.equal(h.ids.get("campaign-body").getAttribute("placeholder"), "Write your message…");
  assert.equal(h.ids.get("audience-title").textContent, "Recipients"); h.switch("fr");
  assert.equal(serviceLink.textContent, "État du service");
  assert.equal(h.ids.get("audience-title").textContent, "Les destinataires"); assert.equal(h.calls.length, 0);
});

test("broadcast language switches translate live counts/status/date but preserve raw collisions, draft, audience and acknowledgement without HTTP", () => {
  const h = harness(); h.model("broadcast-model.js");
  const executable = files["broadcast.js"].replace(/^import \{([^\n]+)\} from "\/broadcast-model\.js";/, "const {$1} = model;");
  h.run(`(() => {${executable}\nglobalThis.tools = {state,renderControls,renderSelection,renderPreview,renderDetail,renderHistory,campaigns,clearPrivate};})();`); h.visible();
  h.run(`document.getElementById("broadcast-content").hidden=false;tools.state.visible=true;tools.state.session={id:"${id(1)}",csrf:"${"a".repeat(43)}",expiresAt:Date.now()+3600000,mediaEnabled:true};
    tools.state.contacts.set("${id(3)}",{id:"${id(3)}",client:{id:"${id(4)}",pseudonym:"En attente"},nickname:"Supprimer",canSend:true});
    model.selectRecipient(tools.state,"${id(3)}",true);model.updateComposition(tools.state,{title:"En attente",body:"Supprimer"});
    tools.state.preview={eligibleCount:1,repeatCount:1,recipients:[{client:{pseudonym:"En attente"},eligible:false,reason:"access_inactive",repeatMedia:true}]};
    tools.state.acknowledged=true;tools.renderSelection();tools.renderPreview();
    globalThis.campaign={id:"${id(7)}",title:"En attente",body:"Supprimer",status:"queued",createdAt:1792050000000,mediaId:null,
      counts:{delivered:2,pending:1,sending:0,skipped:0,cancelled:0,failed:0},recipients:[{client:{pseudonym:"En attente"},state:"pending",reason:null}]};
    tools.campaigns.set(campaign.id,campaign);tools.renderHistory();tools.renderDetail(campaign);`);
  const before = h.run("JSON.stringify({draft:tools.state.draft,ids:[...tools.state.selected.keys()],ack:tools.state.acknowledged})");
  h.switch("en");
  assert.equal(h.ids.get("confirm").textContent, "Send to 1 client");
  assert.equal(h.ids.get("preview").textContent, "Check and prepare to send");
  assert.equal(h.ids.get("acknowledge-label").textContent, "Individual delivery prepared for 1 client.");
  assert.match(h.ids.get("preview-list").textContent, /En attente · Access inactive · photo already shared/);
  assert.match(h.ids.get("campaign-detail").textContent, /En attentePending · 2 delivered/); assert.match(h.ids.get("campaign-detail").textContent, /Supprimer/);
  assert.ok(h.ids.get("history").textContent.includes(new Date(1792050000000).toLocaleString("en-US")), h.ids.get("history").textContent);
  assert.match(h.ids.get("selected").textContent, /En attenteRemove/); assert.match(h.ids.get("contacts").textContent, /SupprimerEn attente · Active access/);
  assert.equal(h.run("JSON.stringify({draft:tools.state.draft,ids:[...tools.state.selected.keys()],ack:tools.state.acknowledged})"), before); assert.equal(h.calls.length, 0);
  h.switch("fr"); assert.equal(h.ids.get("confirm").textContent, "Envoyer à 1 client");
  h.run("tools.clearPrivate()"); h.switch("en");
  assert.equal(h.ids.get("broadcast-content").hidden, true); assert.equal(h.ids.get("campaign-detail").textContent, ""); assert.equal(h.ids.get("selected").textContent, "");
});

test("FR/EN selected counts update immediately while eligibility remains unprepared and no request is sent", () => {
  const h = harness(); h.model("broadcast-model.js");
  const executable = files["broadcast.js"].replace(/^import \{([^\n]+)\} from "\/broadcast-model\.js";/, "const {$1} = model;");
  h.run(`(() => {${executable}\nglobalThis.tools = {state,renderSelection,clearPrivate};})();`); h.visible();
  h.run(`document.getElementById("broadcast-content").hidden=false;tools.state.visible=true;tools.state.session={id:"${id(1)}",csrf:"${"a".repeat(43)}",expiresAt:Date.now()+3600000,mediaEnabled:true,largeAudiencesEnabled:true};
    for(const value of [3,5])tools.state.contacts.set(value.toString(16).padStart(32,"0"),{id:value.toString(16).padStart(32,"0"),client:{id:(value+1).toString(16).padStart(32,"0"),pseudonym:"Synthetic"},nickname:"",canSend:true});
    model.selectRecipient(tools.state,"${id(3)}",true);tools.renderSelection();`);
  assert.equal(h.ids.get("acknowledge-label").textContent, "1 destinataire choisi · à vérifier.");
  h.switch("en"); assert.equal(h.ids.get("acknowledge-label").textContent, "1 recipient selected · needs checking.");
  h.run(`model.selectRecipient(tools.state,"${id(5)}",true);tools.renderSelection();`);
  assert.equal(h.ids.get("acknowledge-label").textContent, "2 recipients selected · need checking.");
  h.run(`model.selectRecipient(tools.state,"${id(3)}",false);tools.renderSelection();`);
  assert.equal(h.ids.get("acknowledge-label").textContent, "1 recipient selected · needs checking.");
  assert.equal(h.ids.get("confirm").disabled, true); assert.equal(h.calls.length, 0);
  h.switch("fr"); assert.equal(h.ids.get("acknowledge-label").textContent, "1 destinataire choisi · à vérifier."); h.run("tools.clearPrivate()");
});

test("CRM switching preserves raw names, label collisions, notes, inputs and selected conversation without requests", async () => {
  const h = harness(); h.visible(); h.model("crm-model.js");
  const inboxHead = new Element(), chatHead = new Element(); h.document.body.append(inboxHead, chatHead); const calls = [];
  h.context.adapter = { inboxHead, chatHead, onContacts() {}, onError() {},
    async request(path) { calls.push(path); return path.includes("/labels?") ? { labels: [{ id: id(8), kind: "tag", name: "Supprimer", memberCount: 1, version: "1" }], hasMore: false, nextCursor: null }
      : { conversationId: id(3), client: { pseudonym: "En attente", email: "private@example.invalid" }, nickname: "Enregistrer la fiche", notes: "Supprimer", reminderAt: 1792050000000,
        labels: [{ id: id(8), kind: "tag", name: "Supprimer" }], version: "1", access: { state: "active", expiresAt: 1792060000000 } }; } };
  const source = files["crm.js"].replace(/^import \{([^\n]+)\} from "\/crm-model\.js";/, "const {$1} = model;").replace("export function createCrmUI", "function createCrmUI");
  h.run(`(() => {${source}\nglobalThis.crm = createCrmUI(adapter);})();`);
  await h.context.crm.initialize(); h.context.crm.selectConversation(id(3));
  for (const callback of chatHead.querySelectorAll("button")[0].events.get("click")) callback(); await flush();
  const nickname = h.document.body.querySelectorAll("input").find((node) => node.name === "nickname"), notes = h.document.body.querySelectorAll("textarea").find((node) => node.name === "notes");
  assert.equal(nickname.value, "Enregistrer la fiche"); notes.value = "Brouillon privé Supprimer";
  const before = calls.length; h.switch("en");
  assert.equal(nickname.value, "Enregistrer la fiche"); assert.equal(notes.value, "Brouillon privé Supprimer");
  assert.match(h.document.body.textContent, /Profile · En attente/); assert.match(h.document.body.textContent, /private@example.invalid/);
  assert.match(h.document.body.textContent, /Supprimer/); assert.equal(calls.length, before);
  h.switch("fr"); assert.equal(notes.value, "Brouillon privé Supprimer"); assert.equal(calls.length, before);
  const managerButton = h.document.body.querySelectorAll("button").find((node) => node.textContent === "Tags et groupes");
  for (const callback of managerButton.events.get("click")) callback(); await flush();
  const manager = h.document.body.querySelectorAll(".crm-label-dialog")[0];
  const labelName = manager.querySelectorAll("input").find((node) => node.value === "Supprimer"), managerReads = calls.length;
  h.switch("en"); assert.equal(labelName.value, "Supprimer"); assert.equal(labelName.getAttribute("aria-label"), "Rename Supprimer");
  const deleteButton = manager.querySelectorAll("button").find((node) => node.textContent === "Delete");
  for (const callback of deleteButton.events.get("click")) callback();
  assert.match(manager.textContent, /Remove “Supprimer” from 1 profile and delete it/);
  h.switch("fr"); assert.match(manager.textContent, /Retirer « Supprimer » de 1 fiche/); assert.equal(calls.length, managerReads);
  h.context.crm.clear(); h.switch("en"); assert.equal(h.document.body.textContent.includes("private@example.invalid"), false);
});





test("broadcast feature checks cannot postpone cookie renewal and offline recovery preserves the draft", async () => {
  let offline = false;
  // Advance time explicitly between steps; keep deadline/clock reads within
  // each step identical so the retry's exact 30000ms assertion is deterministic.
  let now = 1792598400000;
  const admin = { user: { id: id(1), role: "admin", pseudonym: "Jessie" }, csrf: "a".repeat(43), expiresAt: now + 180 * 86400000 };
  const h = harness({ now: () => now, respond: () => {
    if (offline) throw new TypeError("offline");
    return { ok: true, status: 200, json: async () => ({ ...admin, mediaEnabled: true }) };
  } }); h.model("broadcast-model.js");
  const executable = files["broadcast.js"].replace(/^import \{([^\n]+)\} from "\/broadcast-model\.js";/, "const {$1} = model;");
  h.run(`(() => {${executable}\nglobalThis.tools = {state,armExpiry,verifySession};})();`); h.visible();
  h.context.admin = admin;
  h.run(`tools.state.visible=true;tools.state.session={id:admin.user.id,csrf:admin.csrf,expiresAt:admin.expiresAt,mediaEnabled:true,largeAudiencesEnabled:false};tools.state.draft.body="Brouillon privé";tools.armExpiry();`);
  // Repeated feature proofs re-arm the timer but keep the earlier cookie due
  // date. Even a server-side sliding expiry must not restart that five minutes.
  const firstDelay = [...h.timers.values()][0].delay;
  now += 15000; admin.expiresAt += 15000;
  await h.run("tools.verifySession(model.broadcastTicket(tools.state))");
  assert.ok([...h.timers.values()].some((timer) => timer.delay <= firstDelay));
  assert.ok([...h.timers.values()].some((timer) => timer.delay <= firstDelay - 15000));
  offline = true;
  const sessionTimer = [...h.timers].find(([, timer]) => timer.delay <= 300000);
  h.timers.delete(sessionTimer[0]); now += sessionTimer[1].delay; sessionTimer[1].callback(); await flush();
  assert.equal(h.ids.get("broadcast-content").hidden, true); assert.equal(h.run("tools.state.draft.body"), "Brouillon privé");
  assert.ok([...h.timers.values()].some((timer) => timer.delay === 30000));
  offline = false; await h.online();
  assert.equal(h.ids.get("broadcast-content").hidden, false); assert.equal(h.run("tools.state.draft.body"), "Brouillon privé");
  assert.ok(h.calls.filter((call) => call.path === "/api/auth/session").length >= 2);
  assert.equal(h.calls.filter((call) => call.options.method === "POST").length, 0);
});

// Administrator chat tools share the translation runtime with the private pages.
// Conflicting generic copy would reject an entire later catalog atomically.
test("all private-interface catalogs can coexist and every static broadcast marker has a registered translation", async () => {
  const h = harness(), dictionary = new Map();
  const names = ["help-link.js", ...(await readdir(new URL("../public/", import.meta.url))).filter((name) => /^i18n-.+\.js$/.test(name))];
  for (const name of names) {
    const source = await readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
    assert.doesNotThrow(() => h.run(source), name);
    vm.runInNewContext(source, {
      JessieI18n: { register(values) { for (const [key, value] of Object.entries(values)) dictionary.set(key, value); }, getLanguage: () => "fr", onChange() {} },
      document: { querySelectorAll: () => [] },
    });
  }
  for (const node of h.root.querySelectorAll("[data-jm-i18n],[data-jm-i18n-placeholder],[data-jm-i18n-title],[data-jm-i18n-aria-label]")) {
    for (const name of ["data-jm-i18n", "data-jm-i18n-placeholder", "data-jm-i18n-title", "data-jm-i18n-aria-label"]) {
      const source = node.getAttribute(name); if (source !== null) assert.ok(dictionary.has(source), `Missing UI translation: ${source}`);
    }
  }
});

test("broadcast video labels, live progress and typed campaign details switch FR/EN without altering private draft or audience", () => {
  const h = harness(); h.model("broadcast-model.js");
  const executable = files["broadcast.js"].replace(/^import \{([^\n]+)\} from "\/broadcast-model\.js";/, "const {$1} = model;");
  h.run(`(() => {${executable}\nglobalThis.videoTools={state,renderControls,renderPreview,renderDetail,notice};})();`); h.visible();
  h.run(`document.getElementById("broadcast-content").hidden=false;videoTools.state.visible=true;videoTools.state.session={id:"${id(1)}",csrf:"${"a".repeat(43)}",expiresAt:Date.now()+3600000,mediaEnabled:true,largeAudiencesEnabled:true,videoEnabled:true};
    videoTools.state.draft={title:"Private raw title",body:"Private raw caption",mediaId:null,videoId:"${id(88)}",allowRepeatMedia:false};
    videoTools.state.preview={eligibleCount:1,totalCount:1,excludedCount:0,repeatCount:1,audience:{mode:"all"},previewToken:"synthetic.preview",recipients:[{client:{pseudonym:"Vidéo"},eligible:true,reason:null,repeatMedia:true}]};
    videoTools.renderControls();videoTools.renderPreview();videoTools.notice("Chargement de la vidéo… {percent} %",false,"video-status",{percent:JessieI18n.numberParam(50)});
    videoTools.renderDetail({id:"${id(5)}",title:"Private raw title",body:"",videoId:"${id(88)}",mediaId:null,status:"queued",counts:{total:1,pending:1,sending:0,delivered:0,skipped:0,cancelled:0,failed:0}});`);
  const before = h.run("JSON.stringify({draft:videoTools.state.draft,preview:videoTools.state.preview})");
  h.switch("en");
  assert.equal(h.ids.get("pick-video").textContent, "Add a video"); assert.equal(h.ids.get("upload-video").textContent, "Upload video");
  assert.equal(h.ids.get("video-progress").getAttribute("aria-label"), "Video upload progress"); assert.equal(h.ids.get("video-status").textContent, "Uploading video… 50%");
  assert.match(h.ids.get("preview-list").textContent, /Vidéo · Ready to receive · video already shared/);
  assert.match(h.ids.get("repeat-label").textContent, /send this video again/); assert.match(h.ids.get("campaign-detail").textContent, /Video without a captionA video attached/);
  assert.equal(h.run("JSON.stringify({draft:videoTools.state.draft,preview:videoTools.state.preview})"), before); assert.equal(h.calls.length, 0);
  h.switch("fr"); assert.equal(h.ids.get("video-status").textContent, "Chargement de la vidéo… 50 %");
});
