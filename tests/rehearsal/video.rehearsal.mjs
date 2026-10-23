// The production authority is mapped inside this one Chrome process to the
// owned loopback TLS fixture. The attestation precedes every credential/mutation.
// The wildcard DNS rule has no public fallback; no real account is exercised.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";
import { createAuthenticationFixture } from "./auth-fixture.mjs";
import { VIDEO_CREATION_ENABLED, QUICK_REPLIES_WRITABLE } from "../../server/release-features.mjs";

async function attest(page, fixture) {
  await page.navigate(`/__video_rehearsal/${fixture.videoAttestation}`);
  assert.equal(await page.execute("return document.body.textContent"), fixture.videoAttestation,
    "credentials are entered only after proving the owned loopback fixture");
}
async function ready(page, role) {
  await waitUntil(() => page.execute("return location.pathname===arguments[0]&&!!document.getElementById('workspace')&&!document.getElementById('workspace').hidden&&!!document.getElementById('message-body')&&!document.getElementById('message-body').disabled", role === "admin" ? "/admin/messages" : "/messages"), "SQL36 video conversation ready at its authenticated role destination", 20000);
}
async function login(page, fixture, role, recoveryIndex = 0) {
  await attest(page, fixture);
  if (role === "admin") {
    await page.navigate("/admin/login");
    await waitUntil(() => page.execute("return !!document.getElementById('login-form')&&!document.getElementById('login-form').hidden&&!document.getElementById('login-button').disabled"), "administrator login form");
    await page.type("#email", fixture.email); await page.type("#password", fixture.password);
    await page.type("#factor", fixture.recoveryCodes[recoveryIndex]); await page.click("#login-button");
    await waitUntil(() => page.execute("return !!document.getElementById('connected')&&!document.getElementById('connected').hidden"), "administrator MFA session");
    await page.navigate("/admin/messages");
    await waitUntil(() => page.execute("return !!document.querySelector('#conversations [data-conversation-id]')"), "synthetic client in administrator inbox");
    await page.click("#conversations [data-conversation-id]");
  } else {
    await page.navigate("/access");
    await waitUntil(() => page.execute("return !!document.getElementById('client-login-form')&&!document.getElementById('client-login-form').hidden&&!document.querySelector('#client-login-form button[type=submit]').disabled"), "client login form");
    await page.type("#login-email", fixture.client.email); await page.type("#login-password", fixture.client.password);
    await page.click("#client-login-form button[type=submit]");
    // The current sign-in flow opens the authenticated conversation directly.
  }
  await ready(page, role);
  assert.equal(await page.execute("return document.getElementById('open-video-gallery').hidden"), false);
}
async function json(page, role, path, body = null) {
  return page.executeAsync(`const role=arguments[0],path=arguments[1],body=arguments[2],done=arguments[arguments.length-1];
    (async()=>{if(!path.startsWith('/api/')||new URL(path,location.origin).origin!==location.origin)return {status:0};
      let headers={};if(body!==null){const r=await fetch(role==='admin'?'/api/auth/session':'/api/access/session',{cache:'no-store'});
        if(r.status!==200)return {status:r.status};const s=await r.json();headers={'Content-Type':'application/json','X-CSRF-Token':s.csrf};}
      const r=await fetch(path,{method:body===null?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,
        ...(body===null?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};
    })().then(done,()=>done({status:0}));`, role, path, body);
}
async function selectVideo(page, base64) {
  await page.click("#open-composer-tools");
  await waitUntil(() => page.execute("const n=document.getElementById('pick-video');return !!n&&!n.hidden&&!n.disabled&&n.getClientRects().length>0"), "video choice available through composer tools");
  // Assigning the FileList replaces only the OS picker, as in other native
  // rehearsals; metadata preparation and all HTTP/SQL/storage remain real.
  assert.equal(await page.execute(`const bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0)),t=new DataTransfer();
    t.items.add(new File([bytes],'synthetic-decodable.mp4',{type:'video/mp4'}));const input=document.getElementById('video-file');
    input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;`, base64), true);
  // The ordinary picker click closes this panel. Close it here because the OS
  // dialog itself was substituted and must not cover the Send control.
  await page.click("#close-composer-tools");
  await waitUntil(() => page.execute("const v=document.querySelector('#video-preview video');return !!v&&v.videoWidth===96&&v.videoHeight===64&&v.duration>1.9&&!document.getElementById('send').disabled"), "real H264 metadata preview enables explicit send");
}
async function visible(page, caption) {
  await waitUntil(() => page.execute(`return [...document.querySelectorAll('#messages article')].some(n=>
    n.querySelector('.photo-caption')?.textContent===arguments[0]&&n.querySelector('.video-message video.private-video')?.getAttribute('src')?.startsWith('/api/video/'));`, caption), "persisted video with caption and private URL", 20000);
}
async function decodeAndSeek(page, caption) {
  const result = await page.executeAsync(`const caption=arguments[0],done=arguments[arguments.length-1];
    const v=[...document.querySelectorAll('#messages article')].find(n=>n.querySelector('.photo-caption')?.textContent===caption)?.querySelector('video');
    if(!v){done({error:'missing'});return;}let settled=false;const timer=setTimeout(()=>finish({error:'timeout',ready:v.readyState,code:v.error?.code??null}),8000);
    function finish(value){if(settled)return;settled=true;clearTimeout(timer);v.removeEventListener('loadeddata',loaded);v.removeEventListener('seeked',seeked);v.removeEventListener('error',failed);v.pause();done(value);}
    function failed(){finish({error:'decode',code:v.error?.code??null});}
    function seeked(){finish({width:v.videoWidth,height:v.videoHeight,duration:v.duration,time:v.currentTime,error:v.error?.code??null,blob:v.currentSrc.startsWith('blob:')});}
    function loaded(){v.currentTime=1;}
    v.addEventListener('loadeddata',loaded,{once:true});v.addEventListener('seeked',seeked,{once:true});v.addEventListener('error',failed,{once:true});v.preload='auto';v.load();`, caption);
  assert.equal(result.error, null, `native decode/seek: ${JSON.stringify(result)}`);
  assert.equal(result.width, 96); assert.equal(result.height, 64);
  assert.ok(result.duration >= 1.9 && result.duration <= 2.1); assert.ok(Math.abs(result.time - 1) < 0.1);
  assert.equal(result.blob, false, "playback uses the authenticated Range URL");
}
async function range(page, path) {
  return page.executeAsync(`const path=arguments[0],done=arguments[arguments.length-1];
    if(!path.startsWith('/api/video/')||new URL(path,location.origin).origin!==location.origin){done({status:0});return;}
    fetch(path,{headers:{Range:'bytes=0-127'},cache:'no-store',credentials:'same-origin'}).then(async r=>done({status:r.status,
      range:r.headers.get('Content-Range'),type:r.headers.get('Content-Type'),cache:r.headers.get('Cache-Control'),bytes:(await r.arrayBuffer()).byteLength}),()=>done({status:0}));`, path);
}

async function rejectedUpload(page, role, base64) {
  return page.executeAsync(`const role=arguments[0],base64=arguments[1],done=arguments[arguments.length-1];
    (async()=>{const s=await (await fetch(role==='admin'?'/api/auth/session':'/api/access/session',{cache:'no-store'})).json();
      const r=await fetch('/api/video/'+role+'/assets',{method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'Content-Type':'video/mp4','X-CSRF-Token':s.csrf},body:Uint8Array.from(atob(base64),c=>c.charCodeAt(0))});
      return {status:r.status,data:await r.json()};})().then(done,()=>done({status:0}));`, role, base64);
}
async function videoZip(page, role, conversationId) {
  return page.executeAsync(`const role=arguments[0],id=arguments[1],done=arguments[arguments.length-1];
    (async()=>{const s=await (await fetch(role==='admin'?'/api/auth/session':'/api/access/session',{cache:'no-store'})).json();
      const path=role==='admin'?'/api/admin/crm/conversations/'+id+'/export':'/api/chat/client/conversations/'+id+'/export';
      const r=await fetch(path,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},
        body:JSON.stringify({includePhotos:false,includeVideos:true})});
      const data=await r.arrayBuffer();if(data.byteLength<22||data.byteLength>1048576)return {status:r.status,error:'size'};
      const view=new DataView(data),end=data.byteLength-22;if(view.getUint32(end,true)!==0x06054b50)return {status:r.status,error:'footer'};
      const entries=view.getUint16(end+10,true),names=[],decoder=new TextDecoder();let offset=view.getUint32(end+16,true);
      for(let i=0;i<entries;i++){if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw Error();
        const n=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true);
        if(offset+46+n+extra+comment>end)throw Error();names.push(decoder.decode(new Uint8Array(data,offset+46,n)));offset+=46+n+extra+comment;}
      return {status:r.status,type:r.headers.get('Content-Type'),bytes:data.byteLength,names};
    })().then(done,()=>done({status:0,error:'archive'}));`, role, conversationId);
}
async function qualifyCompatibility(t, fixture, client, admin, secondAdmin, base64) {
  assert.equal(VIDEO_CREATION_ENABLED, false); assert.equal(QUICK_REPLIES_WRITABLE, false);
  const seeded = fixture.compatibilityData; assert.ok(seeded);
  const before = await fixture.compatibilityState(); assert.equal(before.videos, 2); assert.equal(before.links, 2); assert.equal(before.campaigns, 1);
  const endpoint = "/api/admin/quick-replies", initialReplies = await json(admin, "admin", endpoint);
  assert.equal(initialReplies.status, 200); assert.deepEqual(initialReplies.data, { ...seeded.replies, writable: false });
  assert.deepEqual((await json(secondAdmin, "admin", endpoint)).data, initialReplies.data);
  assert.equal((await json(client, "client", endpoint)).status, 401);
  const deniedReplies = await json(admin, "admin", endpoint, { expectedVersion: seeded.replies.version, replies: [] });
  assert.deepEqual(deniedReplies, { status: 403, data: { error: "feature_read_only" } });
  for (const [page, role] of [[client, "client"], [admin, "admin"]]) {
    const capability = await json(page, role, `/api/chat/${role}/capabilities`);
    assert.equal(capability.status, 200); assert.equal(capability.data.video.enabled, true); assert.equal(capability.data.video.creationEnabled, false);
    assert.deepEqual(await rejectedUpload(page, role, base64), { status: 403, data: { error: role === "admin" ? "feature_read_only" : "video_admin_only" } });
    const source = seeded.seeded.find(value => value.role === role);
    const deniedSend = await json(page, role, `/api/video/${role}/conversations/${seeded.conversationId}/messages`, {
      clientMessageId: role === "client" ? "1".repeat(32) : "2".repeat(32), videoId: source.asset.id, caption: "Refused new video message" });
    assert.deepEqual(deniedSend, { status: 403, data: { error: role === "admin" ? "feature_read_only" : "video_admin_only" } });
    await visible(page, source.caption); await decodeAndSeek(page, source.caption);
    await page.click("#open-composer-tools");
    assert.equal(await page.execute("const n=document.getElementById('pick-video');return n.hidden||n.disabled"), true);
    await page.click("#close-composer-tools");
  }
  const broadcastCapability = await json(admin, "admin", "/api/broadcast/admin/session");
  assert.equal(broadcastCapability.status, 200); assert.equal(broadcastCapability.data.videoEnabled, true); assert.equal(broadcastCapability.data.videoCreationEnabled, false);
  const deniedCampaign = await json(admin, "admin", "/api/broadcast/admin/campaigns", { ...seeded.campaignInput, clientCampaignId: "e".repeat(32) });
  assert.deepEqual(deniedCampaign, { status: 403, data: { error: "feature_read_only" } });
  const repeated = await json(admin, "admin", "/api/broadcast/admin/campaigns", seeded.campaignInput);
  assert.equal(repeated.status, 200); assert.equal(repeated.data.duplicate, true); assert.equal(repeated.data.campaign.id, seeded.campaignId);
  assert.deepEqual(await fixture.compatibilityState(), before, "refused creation and exact campaign acknowledgement preserve persisted content");
  const history = await json(client, "client", `/api/chat/client/conversations/${seeded.conversationId}/messages`);
  assert.equal(history.status, 200); assert.equal(history.data.messages.length, 2);
  const clientMessage = history.data.messages.find(value => value.body === seeded.seeded.find(value => value.role === "client").caption);
  assert.deepEqual(await range(client, clientMessage.video.contentUrl), { status: 206, range: "bytes 0-127/12536", type: "video/mp4", cache: "no-store", bytes: 128 });
  assert.deepEqual(await fixture.runExistingVideoCampaign(), { delivered: 1, deferred: 0, failed: 0 });
  await visible(client, seeded.campaignInput.body); await decodeAndSeek(client, seeded.campaignInput.body);
  const delivered = await json(client, "client", `/api/chat/client/conversations/${seeded.conversationId}/messages`);
  assert.equal(delivered.data.messages.length, 3); assert.equal(delivered.data.messages.filter(value => value.body === seeded.campaignInput.body).length, 1);
  await client.click("#open-conversation-menu"); await client.click("#open-video-gallery");
  await waitUntil(() => client.execute("return document.getElementById('video-gallery').open&&document.querySelectorAll('#video-grid video').length===3"), "compatibility gallery keeps all existing video messages");
  await client.click("#close-video-gallery");
  for (const [page, role] of [[client, "client"], [admin, "admin"]]) {
    const archive = await videoZip(page, role, seeded.conversationId);
    assert.equal(archive.status, 200, JSON.stringify(archive)); assert.equal(archive.type, "application/zip");
    assert.equal(archive.names.filter(name => name.endsWith(".mp4")).length, 2, "ZIP retains both originals and deduplicates a repeated video");
    assert.equal(archive.names.some(name => /quick-replies|privacy-preparation|operations/.test(name)), false);
  }
  assert.deepEqual((await json(admin, "admin", endpoint)).data, initialReplies.data);
  assert.equal(await fixture.videoFileCount(), 2);
  const removed = await json(client, "client", `/api/chat/client/conversations/${seeded.conversationId}/messages/${clientMessage.id}/delete`, {});
  assert.equal(removed.status, 200); assert.equal((await range(client, clientMessage.video.contentUrl)).status, 404);
  t.diagnostic("Compatibility SQL36: historical client rows seeded explicitly before boot, admin rows through real direct services; seed sessions revoked; configured primary application refuses new uploads/messages/campaigns/personal-reply mutation, preserves existing H264 decode/Range/gallery/two-role ZIP, exact campaign acknowledgement and stored catalogue. A separately owned real v3 worker delivers the pre-existing campaign; configured background producers stay stopped.");
}

test(VIDEO_CREATION_ENABLED ? "real HTTPS SQL36 runtime: admin-only H264 upload, client refusal, two-role decode/seek, idempotent replay and gallery"
  : "compatibility HTTPS SQL36 runtime: refuses creation and preserves existing video, campaign, catalogue and ZIP", { timeout: 240000 }, async t => {
  const base64 = (await readFile(new URL("../fixtures/video-decodable.mp4.base64", import.meta.url), "utf8")).trim();
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes.length, 12536); assert.equal(createHash("sha256").update(bytes).digest("hex"), "9a0d76c9b49754508350d3f571d195de6745809662836b338b7fbb400a6d15e5");
  bytes.fill(0);
  const driver = await startWebDriver(); let fixture; const pages = [];
  try {
    fixture = await createAuthenticationFixture({ messaging: true, video: true });
    const client = await driver.browser({ origin: fixture.origin, primaryFixturePort: fixture.primaryFixturePort, width: 390, acceptInsecureCerts: true }); pages.push(client);
    const admin = await driver.browser({ origin: fixture.origin, primaryFixturePort: fixture.primaryFixturePort, width: 1280, acceptInsecureCerts: true }); pages.push(admin);
    await login(client, fixture, "client"); await login(admin, fixture, "admin");
    const secondAdmin = await driver.browser({ origin: fixture.origin, primaryFixturePort: fixture.primaryFixturePort, width: 375, acceptInsecureCerts: true }); pages.push(secondAdmin);
    await login(secondAdmin, fixture, "admin", 1);
    if (!VIDEO_CREATION_ENABLED) { await qualifyCompatibility(t, fixture, client, admin, secondAdmin, base64); return; }
    const endpoint = "/api/admin/quick-replies";
    const initialReplies = await json(admin, "admin", endpoint);
    assert.equal(initialReplies.status, 200); assert.deepEqual(initialReplies.data, { version: "0", replies: [] });
    const savedReply = { id: "c".repeat(32), title: "Synthetic saved phrase", body: "Private <saved phrase> 💛", language: "fr" };
    const createdReplies = await json(admin, "admin", endpoint, { expectedVersion: "0", replies: [savedReply] });
    assert.equal(createdReplies.status, 200); assert.deepEqual(createdReplies.data, { version: "1", replies: [savedReply] });
    assert.deepEqual((await json(secondAdmin, "admin", endpoint)).data, createdReplies.data, "independent MFA sessions share the durable administrator catalogue");
    const changedReply = { ...savedReply, body: "Private updated phrase 💛" };
    const changedReplies = await json(admin, "admin", endpoint, { expectedVersion: "1", replies: [changedReply] });
    assert.equal(changedReplies.status, 200); assert.deepEqual(changedReplies.data, { version: "2", replies: [changedReply] });
    const stale = await json(secondAdmin, "admin", endpoint, { expectedVersion: "1", replies: [{ ...savedReply, body: "Stale draft must not overwrite" }] });
    assert.equal(stale.status, 409);
    assert.deepEqual((await json(secondAdmin, "admin", endpoint)).data, changedReplies.data);
    const replayReplies = await json(admin, "admin", endpoint, { expectedVersion: "1", replies: [changedReply] });
    assert.equal(replayReplies.status, 200); assert.deepEqual(replayReplies.data, changedReplies.data, "an exact uncertain save does not advance the revision again");
    assert.equal((await json(client, "client", endpoint)).status, 401, "the client cookie cannot read the administrator's phrases");
    const emptyReplies = await json(secondAdmin, "admin", endpoint, { expectedVersion: "2", replies: [] });
    assert.equal(emptyReplies.status, 200); assert.deepEqual(emptyReplies.data, { version: "3", replies: [] });
    assert.deepEqual((await json(admin, "admin", endpoint)).data, emptyReplies.data, "deleting the last phrase preserves the durable revision");
    const conversation = await json(client, "client", "/api/chat/client/conversation");
    assert.equal(conversation.status, 200); const id = conversation.data.id;
    const caption = "Synthetic Jessie first H264 caption", reply = "Synthetic Jessie H264 reply", draft = "Unsent private draft";
    await client.type("#message-body", draft);
    await client.click("#open-composer-tools");
    assert.equal(await client.execute("const n=document.getElementById('pick-video');return n.hidden||n.disabled"), true);
    await client.click("#close-composer-tools");
    assert.deepEqual(await rejectedUpload(client, "client", base64), { status: 403, data: { error: "video_admin_only" } });
    assert.equal(await fixture.videoFileCount(), 0, "client rejection created no durable video");
    await selectVideo(admin, base64); await admin.type("#message-body", caption); await admin.click("#send");
    await visible(client, caption); await visible(admin, caption);
    assert.equal(await client.execute("return document.getElementById('message-body').value"), draft);
    await decodeAndSeek(client, caption); await decodeAndSeek(admin, caption);
    const history = await json(client, "client", `/api/chat/client/conversations/${id}/messages`);
    assert.equal(history.status, 200); const message = history.data.messages.find(value => value.body === caption);
    assert.ok(message?.video); assert.equal(message.video.bytes, 12536);
    const partial = await range(client, message.video.contentUrl);
    assert.deepEqual(partial, { status: 206, range: "bytes 0-127/12536", type: "video/mp4", cache: "no-store", bytes: 128 });
    const refusedReuse = await json(client, "client", `/api/video/client/conversations/${id}/messages`, { clientMessageId: "a".repeat(32), videoId: message.video.id, caption });
    assert.deepEqual(refusedReuse, { status: 403, data: { error: "video_admin_only" } });
    const ownHistory = await json(admin, "admin", `/api/chat/admin/conversations/${id}/messages`);
    const ownMessage = ownHistory.data.messages.find(value => value.id === message.id); assert.ok(ownMessage?.clientMessageId);
    const replay = await json(admin, "admin", `/api/video/admin/conversations/${id}/messages`, { clientMessageId: ownMessage.clientMessageId, videoId: message.video.id, caption });
    assert.equal(replay.status, 200); assert.equal(replay.data.message.id, message.id);
    await admin.type("#message-body", ""); await selectVideo(admin, base64); await admin.type("#message-body", reply); await admin.click("#send");
    await visible(admin, reply); await visible(client, reply); await decodeAndSeek(client, reply);
    assert.equal(await fixture.videoFileCount(), 2, "one encrypted object per actual upload");
    const after = await json(client, "client", `/api/chat/client/conversations/${id}/messages`);
    assert.equal(after.data.messages.filter(value => value.video).length, 2, "idempotent replay added no third message");
    await client.click("#open-conversation-menu"); await client.click("#open-video-gallery");
    await waitUntil(() => client.execute("return document.getElementById('video-gallery').open&&document.querySelectorAll('#video-grid video').length===2"), "private gallery reads both persisted videos");
    await client.click("#close-video-gallery");
    assert.equal(await client.execute("return document.querySelectorAll('#video-grid video[src]').length"), 0);
    const forbiddenDelete = await json(client, "client", `/api/chat/client/conversations/${id}/messages/${message.id}/delete`, {});
    assert.equal(forbiddenDelete.status, 404);
    const removed = await json(admin, "admin", `/api/chat/admin/conversations/${id}/messages/${message.id}/delete`, {});
    assert.equal(removed.status, 200);
    assert.equal((await range(client, message.video.contentUrl)).status, 404, "a deleted message cannot fetch its former content");
    await waitUntil(() => admin.execute("return document.querySelectorAll('#messages .video-message video').length===1"), "peer polling removes the revoked video", 20000);
    t.diagnostic("Real SQL36/configured index, independent MFA/client cookies, personal reply CRUD across two admin sessions with conflict/exact replay and client denial, 375/390/1280px, raw upload, stored ciphertext, native H264 decode and seek, Range206, same-key admin replay, client upload/reuse refusal, two-role reads, gallery and deletion denial passed on owned loopback only.");
  } finally {
    try { for (const page of pages) await page.close(); }
    finally { try { await fixture?.stop(); } finally { await driver.close(); } }
  }
});
