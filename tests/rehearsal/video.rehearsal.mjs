// The production authority is mapped inside this one Chrome process to the
// owned loopback TLS fixture. The attestation precedes every credential/mutation.
// The wildcard DNS rule has no public fallback; no real account is exercised.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";
import { createAuthenticationFixture } from "./auth-fixture.mjs";

async function attest(page, fixture) {
  await page.navigate(`/__video_rehearsal/${fixture.videoAttestation}`);
  assert.equal(await page.execute("return document.body.textContent"), fixture.videoAttestation,
    "credentials are entered only after proving the owned loopback fixture");
}
async function ready(page) {
  await waitUntil(() => page.execute("return !!document.getElementById('workspace')&&!document.getElementById('workspace').hidden&&!document.getElementById('message-body').disabled"), "SQL36 video conversation ready", 20000);
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
    await waitUntil(() => page.execute("const n=document.getElementById('client-chat-link');return !!n&&!n.hidden&&n.getClientRects().length>0"), "active client conversation link");
    await page.click("#client-chat-link");
  }
  await ready(page);
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

test("real HTTPS SQL36 runtime: both roles upload H264, decode/seek, replay idempotently, browse gallery and revoke content", { timeout: 240000 }, async t => {
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
    const caption = "Synthetic client H264 caption", reply = "Synthetic Jessie H264 reply", draft = "Unsent private draft";
    await admin.type("#message-body", draft);
    await selectVideo(client, base64); await client.type("#message-body", caption); await client.click("#send");
    await visible(client, caption); await visible(admin, caption);
    assert.equal(await admin.execute("return document.getElementById('message-body').value"), draft);
    await decodeAndSeek(client, caption); await decodeAndSeek(admin, caption);
    const history = await json(client, "client", `/api/chat/client/conversations/${id}/messages`);
    assert.equal(history.status, 200); const message = history.data.messages.find(value => value.body === caption);
    assert.ok(message?.video); assert.equal(message.video.bytes, 12536);
    const partial = await range(client, message.video.contentUrl);
    assert.deepEqual(partial, { status: 206, range: "bytes 0-127/12536", type: "video/mp4", cache: "no-store", bytes: 128 });
    const replay = await json(client, "client", `/api/video/client/conversations/${id}/messages`, { clientMessageId: message.clientMessageId, videoId: message.video.id, caption });
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
    const removed = await json(client, "client", `/api/chat/client/conversations/${id}/messages/${message.id}/delete`, {});
    assert.equal(removed.status, 200);
    assert.equal((await range(client, message.video.contentUrl)).status, 404, "a deleted message cannot fetch its former content");
    await waitUntil(() => admin.execute("return document.querySelectorAll('#messages .video-message video').length===1"), "peer polling removes the revoked video", 20000);
    t.diagnostic("Real SQL36/configured index, independent MFA/client cookies, personal reply CRUD across two admin sessions with conflict/exact replay and client denial, 375/390/1280px, raw upload, stored ciphertext, native H264 decode and seek, Range206, same-key replay, two-role captions, gallery and deletion denial passed on owned loopback only.");
  } finally {
    try { for (const page of pages) await page.close(); }
    finally { try { await fixture?.stop(); } finally { await driver.close(); } }
  }
});
