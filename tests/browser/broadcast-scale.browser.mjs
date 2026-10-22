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
addEventListener('error',event=>window.__scaleErrors.push(String(event.message)));
addEventListener('unhandledrejection',event=>window.__scaleErrors.push(String(event.reason?.message??event.reason)));
addEventListener('securitypolicyviolation',event=>window.__scaleErrors.push('CSP:'+event.violatedDirective));
// Advance only the product's 30-second history poll, retaining its actual
// callback and all other timeout/session/transport behavior.
const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window),polls=new Map();
window.setTimeout=(callback,delay,...args)=>{const handle=nativeSetTimeout(()=>{polls.delete(handle);callback(...args)},delay);if(delay===30000)polls.set(handle,()=>callback(...args));return handle;};
window.clearTimeout=handle=>{polls.delete(handle);return nativeClearTimeout(handle)};
window.__runScalePoll=async()=>{const entry=[...polls].at(-1);if(!entry)throw Error('No product history poll');nativeClearTimeout(entry[0]);polls.delete(entry[0]);await entry[1]();};
`;

async function fixture({ largeAudiencesEnabled = true, uncertain = false, seed = false, videoEnabled = false, holdVideoUpload = false } = {}) {
  const files = new Map(await Promise.all(assets.map(async name => ["/" + name, await readFile(new URL(name, publicRoot))])));
  const html = files.get("/broadcast.html").toString().replace("<head>", '<head><script src="/scale-fixture.js"></script>');
  const contacts = Array.from({ length: 2500 }, (_, index) => ({ id: id(index + 1), client: { id: id(10000 + index), pseudonym: `Scale client ${String(index + 1).padStart(4, "0")}` }, crm: { nickname: "" }, canSend: true }));
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]));
  const state = { owner: 1, requests: [], creates: [], campaigns: new Map(), dropped: false, ownerByCampaign: new Map(), previewInputs: [], delivered: 0, uploads: [] };
  const session = () => ({ user: { id: id(8000 + state.owner), role: "admin", pseudonym: `Synthetic Jessie ${state.owner}` }, csrf: state.owner === 1 ? "A".repeat(43) : "B".repeat(42) + "A",
    expiresAt: Date.now() + 8 * 3600000, mediaEnabled: false, ...(largeAudiencesEnabled ? { largeAudiencesEnabled: true } : {}), ...(videoEnabled ? { videoEnabled: true } : {}) });
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
    const campaign = makeCampaign({ clientCampaignId: id(9900), title: "Synthetic existing compact campaign", body: "A private historical body" }, contacts);
    state.campaigns.set(campaign.id, campaign); state.ownerByCampaign.set(campaign.id, 1);
  }
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"); state.requests.push({ path: url.pathname + url.search, method: request.method });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, body) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); };
    const page = (rows, key = "id") => { const after = url.searchParams.get("afterId"), limit = Number(url.searchParams.get("limit") ?? 50); const rest = rows.filter(row => after === null || row[key] > after), values = rest.slice(0, limit), hasMore = rest.length > limit;
      return { values, hasMore, nextCursor: hasMore ? values.at(-1)[key] : null }; };
    if (["/api/broadcast/admin/session", "/api/auth/session"].includes(url.pathname)) { json(200, session()); return; }
    if (url.pathname === "/api/admin/crm/labels") { json(200, { labels: [], nextCursor: null, hasMore: false }); return; }
    if (url.pathname === "/api/admin/crm/contacts") {
      const rows = state.owner === 1 ? url.searchParams.get("q") ? contacts.slice(0, 175) : contacts : [], selected = page(rows);
      json(200, { contacts: selected.values, hasMore: selected.hasMore, nextCursor: selected.nextCursor }); return;
    }
    if (url.pathname === "/api/video/admin/assets" && request.method === "POST" && videoEnabled) {
      assert.equal(request.headers["content-type"], "video/mp4"); assert.equal(request.headers["x-csrf-token"], session().csrf);
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
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
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
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
  await waitUntil(() => page.execute("return document.querySelectorAll('#preview-list li').length>0 && !document.getElementById('acknowledge').disabled"), "bounded recipient preview");
  assert.equal(await page.execute("return document.querySelectorAll('#preview-list li').length"), Math.min(expected, 50));
  const text = await page.execute("return document.getElementById('acknowledge-label').textContent");
  assert.ok(text.replace(/[^0-9]/gu, "").includes(String(expected)), "confirmation names the full audience count");
  assert.equal(await page.execute("return document.getElementById('confirm').disabled"), true, "review alone never confirms a campaign");
}
async function errors(page) { assert.deepEqual(await page.execute("return window.__scaleErrors"), []); }
async function confirmWithKeyboard(page) {
  await page.click("#acknowledge"); await page.key("\uE004");
  assert.equal(await page.execute("return document.activeElement.id"), "confirm"); await page.key("\uE007");
}

test("Chrome mobile FR/EN: all 2,500 and filtered 175 are explicitly reviewed with bounded DOM and paginated details", { timeout: 180000 }, async () => {
  for (const width of [320, 390]) for (const language of ["fr", "en"]) {
    const source = await fixture(); let page;
    try {
      page = await open(source, width, language); await chooseMode(page, "all"); await compose(page); await preview(page, 2500);
      assert.equal(source.state.creates.length, 0);
      assert.equal(await page.execute("return document.querySelectorAll('#contacts .contact-row').length<=50 && document.querySelectorAll('#selected li').length<=50 && document.documentElement.scrollWidth<=innerWidth"), true);
      assert.match(await page.execute("return document.getElementById('preview-sample').textContent"), /50/u);
      await page.click("#acknowledge"); await chooseMode(page, "filtered");
      assert.equal(await page.execute("return !document.getElementById('acknowledge').checked && document.getElementById('confirm').disabled && document.querySelectorAll('#preview-list li').length===0"), true, "changing audience invalidates preview and acknowledgment");
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

test("Chrome broadcast video FR/EN mobile/desktop: native preview, one raw upload, typed audience and exact uncertain campaign retry", { timeout: 120000 }, async () => {
  for (const [width, language] of [[390, "fr"], [1280, "en"]]) {
    const source = await fixture({ videoEnabled: true, uncertain: true }); let page;
    try {
      page = await open(source, width, language); await chooseMode(page, "filtered"); await compose(page, "Synthetic video campaign", "Synthetic private video caption");
      await selectVideo(page);
      assert.equal(source.state.uploads.length, 0); assert.equal(source.state.creates.length, 0);
      assert.equal(await page.execute("return document.getElementById('preview').disabled&&document.getElementById('confirm').disabled"), true);
      assert.equal(await page.execute("return document.getElementById('upload-video').textContent"), language === "fr" ? "Charger la vidéo" : "Upload video");
      assert.equal(await page.execute("return document.querySelector('#video-preview video').autoplay"), false);
      await page.click("#upload-video");
      await waitUntil(() => page.execute("return document.getElementById('upload-video').hidden&&!document.getElementById('preview').disabled"), "uploaded attachment enables audience verification");
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
    page = await open(source, 390, "en"); await chooseMode(page, "all"); await compose(page); await selectVideo(page); await page.click("#upload-video");
    await waitUntil(() => source.state.uploads.length === 1 && page.execute("return !document.getElementById('cancel-video').hidden"), "native upload awaits its server acknowledgement");
    assert.equal(await page.execute("return document.getElementById('preview').disabled&&document.getElementById('confirm').disabled&&!document.getElementById('video-progress').hidden"), true);
    await page.click("#cancel-video");
    await waitUntil(() => page.execute("return document.getElementById('cancel-video').hidden&&document.getElementById('video-status').textContent.includes('Upload cancelled')"), "cancel aborts the upload and exposes a translated result");
    await page.click("#remove-video");
    assert.equal(await page.execute("return document.querySelectorAll('#video-preview video').length===0&&document.getElementById('video-progress').hidden"), true);
    assert.equal(source.state.uploads.length, 1); assert.equal(source.state.creates.length, 0); assert.equal(source.state.previewInputs.length, 0); await errors(page);
  } finally { await page?.close(); await source.close(); }
});
