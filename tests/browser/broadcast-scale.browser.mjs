// Real product markup/modules and Chrome; all API data below is a local,
// synthetic fixture. No account, message, database, mail or push provider is used.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const id = number => number.toString(16).padStart(32, "0");
const publicRoot = new URL("../../public/", import.meta.url);
const assets = ["broadcast.html", "broadcast.js", "broadcast-model.js", "broadcast.css", "session-clock.js", "i18n.js", "i18n.css", "i18n-tools.js", "i18n-broadcast.js", "help-link.js",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-16.png", "brand/icon-32.png", "brand/icon-48.png", "brand/icon-64.png",
  "brand/icon-128.png", "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png"];
const videoBytes = Buffer.from(await readFile(new URL("../fixtures/video-decodable.mp4.base64", import.meta.url), "utf8"), "base64");
let driver;
before(async () => { driver = await startWebDriver(); }, { timeout: 60000 });
after(async () => { await driver?.close(); });

const bootstrap = `
window.__scaleErrors=[];
window.__scalePointerEvents=[];
addEventListener('error',event=>window.__scaleErrors.push(String(event.message)));
addEventListener('unhandledrejection',event=>window.__scaleErrors.push(String(event.reason?.message??event.reason)));
addEventListener('securitypolicyviolation',event=>window.__scaleErrors.push('CSP:'+event.violatedDirective));
for(const type of ['pointerdown','pointerup','click'])addEventListener(type,event=>{
  const target=event.target,button=document.getElementById('upload-video'),rect=button?.getBoundingClientRect();
  const box=value=>({x:Math.round(value.x),y:Math.round(value.y),width:Math.round(value.width),height:Math.round(value.height)}),visual=window.visualViewport;
  window.__scalePointerEvents.push({type,targetId:target?.id??null,targetTag:target?.tagName??null,buttonId:target?.closest?.('button')?.id??null,
    trusted:event.isTrusted,fieldsetDisabled:document.getElementById('composition')?.disabled??null,
    x:Math.round(event.clientX),y:Math.round(event.clientY),uploadRect:rect?box(rect):null,uploadClientRects:Array.from(button?.getClientRects()??[],box),
    viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,visual:visual?{width:visual.width,height:visual.height,offsetLeft:visual.offsetLeft,offsetTop:visual.offsetTop,pageLeft:visual.pageLeft,pageTop:visual.pageTop,scale:visual.scale}:null}});
  if(window.__scalePointerEvents.length>18)window.__scalePointerEvents.shift();
},true);
// Advance only the product's 30-second history poll, retaining its actual
// callback and all other timeout/session/transport behavior.
const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window),polls=new Map();
window.setTimeout=(callback,delay,...args)=>{const handle=nativeSetTimeout(()=>{polls.delete(handle);callback(...args)},delay);if(delay===30000)polls.set(handle,()=>callback(...args));return handle;};
window.clearTimeout=handle=>{polls.delete(handle);return nativeClearTimeout(handle)};
window.__runScalePoll=async()=>{const entry=[...polls].at(-1);if(!entry)throw Error('No product history poll');nativeClearTimeout(entry[0]);polls.delete(entry[0]);await entry[1]();};
`;

async function fixture({ largeAudiencesEnabled = true, uncertain = false, seed = false, videoEnabled = false, videoCreationEnabled = true, seedVideo = false, holdVideoUpload = false } = {}) {
  const files = new Map(await Promise.all(assets.map(async name => ["/" + name, await readFile(new URL(name, publicRoot))])));
  const html = files.get("/broadcast.html").toString().replace("<head>", '<head><script src="/scale-fixture.js"></script>');
  const contacts = Array.from({ length: 2500 }, (_, index) => ({ id: id(index + 1), client: { id: id(10000 + index), pseudonym: `Scale client ${String(index + 1).padStart(4, "0")}` }, crm: { nickname: "" }, canSend: true }));
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]));
  const state = { owner: 1, requests: [], creates: [], campaigns: new Map(), dropped: false, ownerByCampaign: new Map(), previewInputs: [], delivered: 0, uploads: [], uploadAttempts: [], blockSessionProofs: false, heldSessionProofs: 0 };
  const sessionResponses = [];
  const releaseSessionProofs = () => { state.blockSessionProofs = false; for (const send of sessionResponses.splice(0)) send(); };
  const session = () => ({ user: { id: id(8000 + state.owner), role: "admin", pseudonym: `Synthetic Jessie ${state.owner}` }, csrf: state.owner === 1 ? "A".repeat(43) : "B".repeat(42) + "A",
    expiresAt: Date.now() + 8 * 3600000, mediaEnabled: false, ...(largeAudiencesEnabled ? { largeAudiencesEnabled: true } : {}), ...(videoEnabled ? { videoEnabled: true, ...(videoCreationEnabled === false ? { videoCreationEnabled: false } : {}) } : {}) });
  const targets = audience => audience?.mode === "all" ? contacts : audience?.mode === "filtered" ? contacts.slice(0, 175)
    : contacts.filter(contact => audience.conversationIds.includes(contact.id));
  function makeCampaign(input, selected) {
    const at = Date.now();
    return { id: id(9000 + state.campaigns.size), clientCampaignId: input.clientCampaignId, title: input.title, body: input.body, mediaId: null, allowRepeatMedia: false,
      ...(input.videoId ? { videoId: input.videoId, formatVersion: 3, audienceMode: input.audience.mode } : {}),
      status: "queued", createdAt: at, updatedAt: at, expiresAt: at + 604800000,
      counts: { total: selected.length, pending: selected.length, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 }, targetIds: selected.map(contact => contact.id) };
  }
  function summary(campaign) {
    const { targetIds, ...value } = campaign;
    return value;
  }
  if (seed) {
    const campaign = makeCampaign({ clientCampaignId: id(9900), title: "Synthetic existing compact campaign", body: "A private historical body", ...(seedVideo ? { videoId: id(7000), audience: { mode: "all" } } : {}) }, contacts);
    state.campaigns.set(campaign.id, campaign); state.ownerByCampaign.set(campaign.id, 1);
  }
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"); state.requests.push({ path: url.pathname + url.search, method: request.method });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, body) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); };
    const page = (rows, key = "id") => { const after = url.searchParams.get("afterId"), limit = Number(url.searchParams.get("limit") ?? 50); const rest = rows.filter(row => after === null || row[key] > after), values = rest.slice(0, limit), hasMore = rest.length > limit;
      return { values, hasMore, nextCursor: hasMore ? values.at(-1)[key] : null }; };
    if (["/api/broadcast/admin/session", "/api/auth/session"].includes(url.pathname)) {
      if (state.blockSessionProofs) { state.heldSessionProofs += 1; sessionResponses.push(() => { if (!response.destroyed) json(200, session()); }); }
      else json(200, session());
      return;
    }
    if (url.pathname === "/api/admin/crm/labels") { json(200, { labels: [], nextCursor: null, hasMore: false }); return; }
    if (url.pathname === "/api/admin/crm/contacts") {
      const rows = state.owner === 1 ? url.searchParams.get("q") ? contacts.slice(0, 175) : contacts : [], selected = page(rows);
      json(200, { contacts: selected.values, hasMore: selected.hasMore, nextCursor: selected.nextCursor }); return;
    }
    if (url.pathname === "/api/video/admin/assets" && request.method === "POST" && videoEnabled) {
      const attempt = { contentTypeMatches: request.headers["content-type"] === "video/mp4", csrfMatches: request.headers["x-csrf-token"] === session().csrf, bytes: null, bodyMatches: null };
      state.uploadAttempts.push(attempt);
      assert.equal(request.headers["content-type"], "video/mp4"); assert.equal(request.headers["x-csrf-token"], session().csrf);
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      attempt.bytes = bytes.length; attempt.bodyMatches = bytes.equals(videoBytes);
      assert.deepEqual(bytes, videoBytes); state.uploads.push(bytes.length);
      if (!holdVideoUpload) json(201, { id: id(7000), bytes: bytes.length, mime: "video/mp4" });
      return;
    }
    if (url.pathname === "/api/broadcast/admin/preview" && request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); state.previewInputs.push(input);
      const selected = targets(input.audience ?? { mode: "selected", conversationIds: input.conversationIds });
      const recipients = selected.slice(0, largeAudiencesEnabled ? 50 : selected.length).map(contact => ({ conversationId: contact.id, client: contact.client, eligible: true, reason: null, repeatMedia: false }));
      json(200, { recipients, eligibleCount: selected.length, repeatCount: 0, ...(input.audience ? { totalCount: selected.length, excludedCount: 0, previewToken: "synthetic.preview-token" } : {}) }); return;
    }
    if (url.pathname === "/api/broadcast/admin/campaigns" && request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); state.creates.push(input);
      const existing = [...state.campaigns.values()].find(campaign => campaign.clientCampaignId === input.clientCampaignId);
      const selected = targets(input.audience ?? { mode: "selected", conversationIds: input.conversationIds });
      const campaign = existing ?? makeCampaign(input, selected);
      if (!existing) { state.campaigns.set(campaign.id, campaign); state.ownerByCampaign.set(campaign.id, state.owner); }
      if (uncertain && !state.dropped) {
        state.dropped = true;
        // Commit precedes a native incomplete response. Closing before headers
        // lets Chrome retry a POST on a reused socket; deliver headers first so
        // only the user's explicit retry can acknowledge this same campaign.
        response.writeHead(201, { "Content-Type": "application/json", "Content-Length": "128", Connection: "close" });
        response.end('{"campaign":'); return;
      }
      json(existing ? 200 : 201, { campaign: summary(campaign), duplicate: !!existing }); return;
    }
    const matching = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})(?:\/(summary|recipients|cancel))?$/u.exec(url.pathname);
    if (matching) {
      const campaign = state.campaigns.get(matching[1]);
      if (!campaign || state.ownerByCampaign.get(campaign.id) !== state.owner) { json(404, { error: "not_found" }); return; }
      if (matching[2] === "recipients") {
        const rows = campaign.targetIds.map((conversationId, index) => ({ conversationId, client: contactsById.get(conversationId).client,
          state: index < campaign.counts.delivered ? "delivered" : campaign.status === "cancelled" ? "cancelled" : "pending",
          reason: campaign.status === "cancelled" && index >= campaign.counts.delivered ? "cancelled" : null,
          messageId: index < campaign.counts.delivered ? id(20000 + index) : null, deliveredAt: index < campaign.counts.delivered ? campaign.updatedAt : null }));
        const selected = page(rows, "conversationId"); json(200, { campaignId: campaign.id, recipients: selected.values, hasMore: selected.hasMore, nextCursor: selected.nextCursor }); return;
      }
      if (matching[2] === "cancel" && request.method === "POST") { for await (const _chunk of request) { /* empty fixture body */ }
        campaign.status = "cancelled"; campaign.updatedAt += 1; campaign.counts.cancelled += campaign.counts.pending; campaign.counts.pending = 0; json(200, summary(campaign)); return;
      }
      json(200, summary(campaign)); return;
    }
    if (["/api/broadcast/admin/campaigns", "/api/broadcast/admin/activity"].includes(url.pathname)) {
      const campaigns = [...state.campaigns.values()].filter(campaign => state.ownerByCampaign.get(campaign.id) === state.owner).map(summary);
      json(200, url.pathname.endsWith("activity") ? { campaigns: campaigns.slice().reverse() } : { campaigns, hasMore: false, nextCursor: null }); return;
    }
    if (url.pathname === "/scale-fixture.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bootstrap); return; }
    if (url.pathname === "/admin/broadcasts") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
    if (files.has(url.pathname)) { const extension = url.pathname.split(".").at(-1), mime = { js: "text/javascript", css: "text/css", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" }[extension] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }); response.end(files.get(url.pathname)); return; }
    json(404, { error: "fixture_not_found" });
  })().catch(() => { if (!response.destroyed) { response.writeHead(500, { "Content-Type": "application/json" }); response.end('{"error":"fixture_failure"}'); } }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { state, releaseSessionProofs, origin: `http://127.0.0.1:${server.address().port}`, close: async () => { releaseSessionProofs(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function open(source, width, language = "fr") {
  const page = await driver.browser({ origin: source.origin, width, height: 780 });
  await page.navigate("/admin/broadcasts");
  await waitUntil(() => page.execute("return !document.getElementById('broadcast-content').hidden && document.querySelectorAll('#contacts .contact-row').length===50"), "real broadcast controller bootstrap");
  if (language === "en") await page.click("[data-jm-language]");
  assert.equal(await page.execute("return document.documentElement.lang"), language);
  return page;
}
async function chooseMode(page, mode) {
  await page.execute("const select=document.getElementById('audience-mode');select.value=arguments[0];select.dispatchEvent(new Event('change',{bubbles:true}));", mode);
}
async function compose(page, title = "Synthetic private title", body = "Synthetic private body 💬") {
  await page.type("#campaign-title", title); await page.type("#campaign-body", body);
}
async function preview(page, expected) {
  await waitUntil(() => page.execute("return !document.getElementById('preview').disabled"), "preview is enabled for the explicit audience");
  await page.click("#preview");
  await waitUntil(() => page.execute("return document.querySelectorAll('#preview-list li').length>0 && !document.getElementById('confirm').disabled"), "bounded recipient preview");
  assert.equal(await page.execute("return document.querySelectorAll('#preview-list li').length"), Math.min(expected, 50));
  const text = await page.execute("return document.getElementById('acknowledge-label').textContent");
  assert.ok(text.replace(/[^0-9]/gu, "").includes(String(expected)), "confirmation names the full audience count");
  assert.equal(await page.execute("return document.getElementById('confirm').disabled"), false, "prepared recipients enable only the explicit send button");
}
async function errors(page) { assert.deepEqual(await page.execute("return window.__scaleErrors"), []); }
async function confirmWithKeyboard(page) {
  await page.execute("document.getElementById('confirm').focus()");
  assert.equal(await page.execute("return document.activeElement.id"), "confirm"); await page.key("\uE007");
}

async function suspendAndBlockResume(source, page) {
  const posts = source.state.requests.filter(request => request.method === "POST").length;
  // Exercise the actual DOM lifecycle handlers in Chrome without changing
  // document.visibilityState. These synthetic persisted events do not claim
  // an OS background/freeze transition or a native BFCache restoration.
  await page.execute("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));");
  assert.equal(await page.execute("return document.getElementById('broadcast-content').hidden && getComputedStyle(document.getElementById('broadcast-content')).display==='none'"), true, "suspension conceals private content synchronously");
  const held = source.state.heldSessionProofs; source.state.blockSessionProofs = true;
  await page.execute("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));");
  await waitUntil(() => source.state.heldSessionProofs > held, "resume waits on a fresh session proof");
  assert.equal(await page.execute("return document.getElementById('broadcast-content').hidden && getComputedStyle(document.getElementById('broadcast-content')).display==='none'"), true, "draft and recipients stay concealed until the session proof succeeds");
  assert.equal(source.state.requests.filter(request => request.method === "POST").length, posts, "resume never submits a preview or campaign automatically");
}

test("Chrome: suspended text and explicit recipient return only after session proof, and another account purges them", { timeout: 60000 }, async () => {
  const source = await fixture(); let page;
  try {
    page = await open(source, 390); await compose(page, "Suspended private title", "Suspended private body");
    await page.click("#contacts input[type=checkbox]");
    assert.equal(await page.execute("return document.querySelectorAll('#selected li').length"), 1);
    await suspendAndBlockResume(source, page); source.releaseSessionProofs();
    await waitUntil(() => page.execute("return !document.getElementById('broadcast-content').hidden && document.getElementById('campaign-title').value==='Suspended private title' && document.getElementById('campaign-body').value==='Suspended private body' && document.querySelectorAll('#selected li').length===1"), "the same session restores the exact draft and selected recipient");
    assert.match(await page.execute("return document.querySelector('#selected li').textContent"), /Scale client 0001/u);
    assert.equal(source.state.previewInputs.length, 0); assert.equal(source.state.creates.length, 0);
    await suspendAndBlockResume(source, page); source.state.owner = 2; source.releaseSessionProofs();
    await waitUntil(() => page.execute("return !document.getElementById('broadcast-content').hidden && document.getElementById('campaign-title').value==='' && document.getElementById('campaign-body').value==='' && document.querySelectorAll('#selected li').length===0 && document.querySelectorAll('#history button').length===0 && document.getElementById('campaign-detail').hidden"), "a new owner receives an empty composition after verification");
    assert.equal(source.state.requests.filter(request => request.method === "POST").length, 0); await errors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: a suspended uncertain confirmation retains its exact key and only an explicit retry can acknowledge it", { timeout: 60000 }, async () => {
  const source = await fixture({ uncertain: true }); let page;
  try {
    page = await open(source, 320, "en"); await compose(page, "Suspended uncertain title", "Suspended uncertain body");
    await page.click("#contacts input[type=checkbox]"); await preview(page, 1); await confirmWithKeyboard(page);
    await waitUntil(() => page.execute("return !document.getElementById('uncertain').hidden && !document.getElementById('retry').disabled"), "the incomplete committed response retains an uncertain confirmation");
    assert.equal(source.state.creates.length, 1); const original = structuredClone(source.state.creates[0]);
    await suspendAndBlockResume(source, page); source.releaseSessionProofs();
    await waitUntil(() => page.execute("return !document.getElementById('broadcast-content').hidden && !document.getElementById('uncertain').hidden && !document.getElementById('retry').disabled && document.getElementById('composition').disabled"), "the same session restores the frozen explicit retry");
    assert.equal(source.state.creates.length, 1); assert.equal(source.state.previewInputs.length, 1);
    assert.equal(await page.execute("return document.getElementById('campaign-title').value==='Suspended uncertain title' && document.getElementById('campaign-body').value==='Suspended uncertain body' && document.querySelectorAll('#selected li').length===1"), true);
    await page.click("#retry");
    await waitUntil(() => source.state.creates.length === 2 && page.execute("return document.getElementById('uncertain').hidden && !document.getElementById('campaign-detail').hidden"), "the user's explicit retry acknowledges the existing campaign");
    assert.deepEqual(source.state.creates[1], original); assert.equal(source.state.campaigns.size, 1); await errors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome mobile FR/EN: all 2,500 and filtered 175 are explicitly reviewed with bounded DOM and paginated details", { timeout: 180000 }, async () => {
  for (const width of [320, 390]) for (const language of ["fr", "en"]) {
    const source = await fixture(); let page;
    try {
      page = await open(source, width, language); await chooseMode(page, "all"); await compose(page); await preview(page, 2500);
      assert.equal(source.state.creates.length, 0);
      assert.equal(await page.execute("return document.querySelectorAll('#contacts .contact-row').length<=50 && document.querySelectorAll('#selected li').length<=50 && document.documentElement.scrollWidth<=innerWidth"), true);
      assert.match(await page.execute("return document.getElementById('preview-sample').textContent"), /50/u);
      await chooseMode(page, "filtered");
      assert.equal(await page.execute("return document.getElementById('confirm').disabled && document.querySelectorAll('#preview-list li').length===0"), true, "changing audience invalidates preview and acknowledgment");
      await page.type("#search", "Scale"); await page.click("#filters button[type=submit]"); await preview(page, 175);
      await chooseMode(page, "all"); await preview(page, 2500); await confirmWithKeyboard(page);
      await waitUntil(() => source.state.creates.length === 1 && page.execute("return !document.getElementById('campaign-detail').hidden && document.querySelectorAll('#campaign-detail .recipient-list li').length===50"), "confirmed large campaign and bounded detail");
      assert.equal(source.state.creates[0].audience.mode, "all"); assert.equal(source.state.creates[0].previewToken, "synthetic.preview-token");
      assert.ok(!Object.hasOwn(source.state.creates[0], "conversationIds"));
      await page.click("#recipients-more");
      await waitUntil(() => page.execute("return document.querySelector('#campaign-detail .recipient-list li')?.textContent.includes('0051')"), "second recipient page");
      assert.equal(await page.execute("return document.querySelectorAll('#campaign-detail .recipient-list li').length"), 50);
      await page.click("#recipients-previous");
      await waitUntil(() => page.execute("return document.querySelector('#campaign-detail .recipient-list li')?.textContent.includes('0001')"), "previous recipient page");
      const pageReads = source.state.requests.filter(request => request.path.includes("/recipients?")).length;
      await page.execute("window.__scaleFirstRecipient=document.querySelector('#campaign-detail .recipient-list li')");
      const campaign = [...source.state.campaigns.values()][0]; campaign.status = "running"; campaign.updatedAt += 1; campaign.counts.pending -= 37; campaign.counts.delivered += 37;
      const summaryReads = source.state.requests.filter(request => request.path.endsWith(`/${campaign.id}/summary`)).length;
      assert.equal(await page.executeAsync("const done=arguments[arguments.length-1];window.__runScalePoll().then(()=>done(true),()=>done(false));"), true);
      await waitUntil(() => source.state.requests.filter(request => request.path.endsWith(`/${campaign.id}/summary`)).length > summaryReads, "poll reads a fresh summary");
      assert.equal(source.state.requests.filter(request => request.path.includes("/recipients?")).length, pageReads, "ordinary poll never reloads recipient pages");
      assert.equal(await page.execute("return window.__scaleFirstRecipient===document.querySelector('#campaign-detail .recipient-list li')"), true, "summary polling preserves recipient rows");
      assert.equal(source.state.requests.some(request => new RegExp(`/campaigns/${campaign.id}$`).test(request.path)), false, "no unbounded legacy detail GET is needed");
      await errors(page);
    } finally { await page?.close(); await source.close(); }
  }
});

test("Chrome: manual selection exceeds 100 across contact pages while contacts and selected DOM stay at 50", { timeout: 90000 }, async () => {
  const source = await fixture(); let page;
  try {
    page = await open(source, 390); await compose(page);
    for (let index = 0; index < 3; index++) {
      // Dispatch normal checkbox clicks on the real rendered controls. Query
      // each current node because every selection rerenders its visible page.
      await page.execute("for(let index=0;index<50;index++){const input=document.querySelectorAll('#contacts input[type=checkbox]')[index];if(!input.checked)input.click();}");
      assert.equal(await page.execute("return document.querySelectorAll('#selected li').length"), 50);
      assert.ok(!(await page.execute("return document.getElementById('selected-count').textContent")).includes("/ 100"));
      if (index < 2) { await page.click("#more-contacts"); await waitUntil(() => page.execute("return document.querySelector('#contacts .contact-row')?.textContent.includes(arguments[0])", String(index * 50 + 51).padStart(4, "0")), "next contact page replaces the current page"); }
    }
    assert.match(await page.execute("return document.getElementById('selected-count').textContent"), /150/u);
    assert.equal(await page.execute("return document.querySelectorAll('#contacts .contact-row').length"), 50);
    await page.click("#selected-more");
    await waitUntil(() => page.execute("return document.querySelector('#selected li')?.textContent.includes('0051')"), "selected recipients use a separate bounded page");
    await page.click("#selected-previous"); await preview(page, 150);
    assert.equal(source.state.previewInputs.at(-1).audience.conversationIds.length, 150);
    assert.equal(new Set(source.state.previewInputs.at(-1).audience.conversationIds).size, 150);
    assert.equal(source.state.creates.length, 0); await errors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: lost confirmation freezes its exact audience, retry uses one ID, and changed account purges private data", { timeout: 90000 }, async () => {
  const source = await fixture({ uncertain: true }); let page;
  try {
    page = await open(source, 320); await chooseMode(page, "all"); await compose(page, "Old owner private title", "Old owner private body"); await preview(page, 2500);
    await confirmWithKeyboard(page);
    await waitUntil(() => page.execute("return !document.getElementById('uncertain').hidden && !document.getElementById('retry').disabled"), "uncertain confirmation keeps an explicit retry");
    assert.equal(source.state.creates.length, 1);
    assert.equal(await page.execute("return document.getElementById('composition').disabled && document.getElementById('audience-mode').disabled"), true, "immutable pending send freezes composition and scope");
    await page.click("#retry");
    await waitUntil(() => source.state.creates.length === 2 && page.execute("return document.getElementById('uncertain').hidden && !document.getElementById('campaign-detail').hidden"), "explicit retry acknowledges the original campaign");
    assert.deepEqual(source.state.creates[1], source.state.creates[0]); assert.equal(source.state.campaigns.size, 1);
    source.state.owner = 2; await page.click("#refresh-history");
    await waitUntil(() => page.execute("return document.getElementById('campaign-title').value==='' && document.getElementById('campaign-body').value==='' && document.querySelectorAll('#history button').length===0 && document.getElementById('campaign-detail').hidden"), "changed account clears old content and campaign details");
    assert.equal(source.state.creates.length, 2, "account change never replays a private POST");
    assert.equal(await page.execute("return document.body.textContent.includes('Old owner private')"), false); await errors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: compatibility capability hides global creation while existing 2,500-recipient history stays paginated", { timeout: 60000 }, async () => {
  const source = await fixture({ largeAudiencesEnabled: false, seed: true }); let page;
  try {
    page = await open(source, 390, "en");
    assert.equal(await page.execute("return document.getElementById('audience-options').hidden"), true);
    assert.equal(await page.execute("return document.getElementById('video-options').hidden"), true);
    await page.click("#history button");
    await waitUntil(() => page.execute("return document.querySelectorAll('#campaign-detail .recipient-list li').length===50"), "compatible version reads the first bounded compact page");
    await page.click("#recipients-more");
    await waitUntil(() => page.execute("return document.querySelector('#campaign-detail .recipient-list li')?.textContent.includes('0051')"), "compatible version reads another compact page");
    assert.equal(source.state.creates.length, 0); assert.equal(source.state.previewInputs.length, 0); await errors(page);
  } finally { await page?.close(); await source.close(); }
});

async function selectVideo(page) {
  await page.execute("const bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'synthetic-broadcast.mp4',{type:'video/mp4'}));const input=document.getElementById('video-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));", videoBytes.toString("base64"));
  await waitUntil(() => page.execute("const player=document.querySelector('#video-preview video');return player?.videoWidth===96&&player.videoHeight===64&&player.duration>1.5&&!document.getElementById('upload-video').disabled"), "native MP4 preview is decoded before upload");
}

async function assertVideoViewport(page, width) {
  const viewport = await page.execute("const input=document.getElementById('video-file'),rect=input.getBoundingClientRect(),style=getComputedStyle(input),root=document.documentElement,visual=window.visualViewport;return {width:innerWidth,height:innerHeight,clientWidth:root.clientWidth,scrollWidth:root.scrollWidth,visual:visual?{width:visual.width,height:visual.height,offsetLeft:visual.offsetLeft,offsetTop:visual.offsetTop,scale:visual.scale}:null,activeElement:{id:document.activeElement?.id,tag:document.activeElement?.tagName},file:{width:rect.width,height:rect.height,position:style.position,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],border:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth]}}");
  assert.equal(viewport.width, width, `the hidden video control must not enlarge the requested viewport: ${JSON.stringify(viewport)}`);
  assert.ok(viewport.scrollWidth <= viewport.clientWidth, `video selection must not create horizontal overflow: ${JSON.stringify(viewport)}`);
  assert.equal(viewport.file.position, "absolute"); assert.equal(viewport.file.width, 1); assert.equal(viewport.file.height, 1);
  assert.deepEqual(viewport.file.padding, ["0px", "0px", "0px", "0px"]); assert.deepEqual(viewport.file.border, ["0px", "0px", "0px", "0px"]);
}

async function waitForVideoUpload(source, page, check, description) {
  try { await waitUntil(check, description); }
  catch (error) {
    const browser = await page.execute("const byId=id=>document.getElementById(id);return {status:byId('video-status').textContent,error:byId('video-status').classList.contains('is-error'),uploadHidden:byId('upload-video').hidden,uploadDisabled:byId('upload-video').disabled,cancelHidden:byId('cancel-video').hidden,compositionDisabled:byId('composition').disabled,previewDisabled:byId('preview').disabled,pageVisible:document.visibilityState==='visible',errors:window.__scaleErrors,pointerEvents:window.__scalePointerEvents}");
    // Every value belongs to this synthetic fixture. Keep diagnostic transport
    // phases separate so a failed header/body assertion cannot look like an
    // upload that never reached the local server.
    assert.fail(`${error.message}; ${JSON.stringify({ browser, attempts: source.state.uploadAttempts,
      requestPaths: source.state.requests.filter(request => request.path === '/api/video/admin/assets').map(request => request.method) })}`);
  }
}

async function clickVideoButton(page, buttonId) {
  const geometry = await page.executeAsync("const id=arguments[0],done=arguments[arguments.length-1],button=document.getElementById(id);button.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});const measure=()=>{const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};requestAnimationFrame(()=>{const first=measure();requestAnimationFrame(()=>{const second=measure(),target=document.elementFromPoint(second.x+second.width/2,second.y+second.height/2);done({first,second,enabled:!button.matches(':disabled'),centerHitsButton:target===button||button.contains(target)})})})", buttonId);
  assert.equal(geometry.enabled, true, `${buttonId}: enabled before the native click`);
  assert.ok(geometry.second.width > 0 && geometry.second.height > 0 && geometry.centerHitsButton,
    `${buttonId}: visible center must hit the button: ${JSON.stringify(geometry)}`);
  assert.ok(["x", "y", "width", "height"].every(name => Math.abs(geometry.first[name] - geometry.second[name]) < 0.5),
    `${buttonId}: native target geometry must settle across two animation frames: ${JSON.stringify(geometry)}`);
  await page.execute("window.__scalePointerEvents.length=0");
  await page.click(`#${buttonId}`);
  const events = await page.execute("return window.__scalePointerEvents");
  assert.ok(events.some(event => event.type === "click" && event.buttonId === buttonId && event.trusted && event.fieldsetDisabled === false),
    `Native ${buttonId} click must reach the enabled button: ${JSON.stringify(events)}`);
}

test("Chrome broadcast video FR/EN mobile/desktop: native preview, one raw upload, typed audience and exact uncertain campaign retry", { timeout: 120000 }, async () => {
  for (const [width, language] of [[390, "fr"], [1280, "en"]]) {
    const source = await fixture({ videoEnabled: true, uncertain: true }); let page;
    try {
      page = await open(source, width, language); await chooseMode(page, "filtered"); await compose(page, "Synthetic video campaign", "Synthetic private video caption");
      await selectVideo(page); await assertVideoViewport(page, width);
      assert.equal(source.state.uploads.length, 0); assert.equal(source.state.creates.length, 0);
      assert.equal(await page.execute("return document.getElementById('preview').disabled&&document.getElementById('confirm').disabled"), true);
      assert.equal(await page.execute("return document.getElementById('upload-video').textContent"), language === "fr" ? "Charger la vidéo" : "Upload video");
      assert.equal(await page.execute("return document.querySelector('#video-preview video').autoplay"), false);
      await clickVideoButton(page, "upload-video");
      await waitForVideoUpload(source, page, () => page.execute("return document.getElementById('upload-video').hidden&&!document.getElementById('preview').disabled"), "uploaded attachment enables audience verification");
      assert.deepEqual(source.state.uploads, [videoBytes.length]); await preview(page, 175);
      assert.equal(source.state.previewInputs.at(-1).videoId, id(7000)); assert.equal(source.state.previewInputs.at(-1).mediaId, null);
      await confirmWithKeyboard(page);
      await waitUntil(() => page.execute("return !document.getElementById('uncertain').hidden&&!document.getElementById('retry').disabled"), "lost campaign response requires an explicit retry");
      assert.equal(source.state.uploads.length, 1); await page.click("#retry");
      await waitUntil(() => page.execute("return document.getElementById('uncertain').hidden&&!document.getElementById('campaign-detail').hidden&&document.querySelectorAll('#campaign-detail .recipient-list li').length===50"), "typed campaign is acknowledged and shown with bounded recipient history");
      assert.equal(source.state.uploads.length, 1); assert.deepEqual(source.state.creates[0], source.state.creates[1]);
      assert.equal(source.state.creates[0].videoId, id(7000)); assert.equal(source.state.creates[0].mediaId, null);
      assert.equal(await page.execute("return document.querySelectorAll('#video-preview video').length===0&&document.documentElement.scrollWidth<=innerWidth"), true);
      assert.match(await page.execute("return document.getElementById('campaign-detail').textContent"), language === "fr" ? /Une vidéo jointe/ : /A video attached/);
      await errors(page);
    } finally { await page?.close(); await source.close(); }
  }
});

test("Chrome broadcast video upload can be cancelled while awaiting ACK without any campaign or automatic upload retry", { timeout: 60000 }, async () => {
  const source = await fixture({ videoEnabled: true, holdVideoUpload: true }); let page;
  try {
    page = await open(source, 390, "en"); await chooseMode(page, "all"); await compose(page); await selectVideo(page); await assertVideoViewport(page, 390); await clickVideoButton(page, "upload-video");
    await waitForVideoUpload(source, page, () => source.state.uploads.length === 1 && page.execute("return !document.getElementById('cancel-video').hidden"), "native upload awaits its server acknowledgement");
    assert.equal(await page.execute("return document.getElementById('preview').disabled&&document.getElementById('confirm').disabled&&!document.getElementById('video-progress').hidden"), true);
    await clickVideoButton(page, "cancel-video");
    await waitUntil(() => page.execute("return document.getElementById('cancel-video').hidden&&document.getElementById('video-status').textContent.includes('Upload cancelled')"), "cancel aborts the upload and exposes a translated result");
    await clickVideoButton(page, "remove-video");
    assert.equal(await page.execute("return document.querySelectorAll('#video-preview video').length===0&&document.getElementById('video-progress').hidden"), true);
    assert.equal(source.state.uploads.length, 1); assert.equal(source.state.creates.length, 0); assert.equal(source.state.previewInputs.length, 0); await errors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome compatibility preserves existing v3 video campaign details while hiding new video creation", { timeout: 45000 }, async () => {
  const source = await fixture({ videoEnabled: true, videoCreationEnabled: false, seed: true, seedVideo: true }); let page;
  try {
    page = await open(source, 390, "en"); assert.equal(await page.execute("return document.getElementById('video-options').hidden"), true);
    await waitUntil(() => page.execute("return document.querySelectorAll('.history-row').length===1"), "existing typed video campaign remains visible");
    await page.click(".history-row"); await waitUntil(() => page.execute("return document.getElementById('campaign-detail').textContent.includes('A video attached')"), "existing v3 detail is readable");
    await page.execute("const transfer=new DataTransfer();transfer.items.add(new File(['synthetic'],'blocked.mp4',{type:'video/mp4'}));const input=document.getElementById('video-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));");
    assert.equal(await page.execute("return document.querySelectorAll('#video-preview video').length"), 0); assert.equal(source.state.uploads.length, 0); assert.equal(source.state.creates.length, 0);
    await errors(page);
  } finally { await page?.close(); await source.close(); }
});
