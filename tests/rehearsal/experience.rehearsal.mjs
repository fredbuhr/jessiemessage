// Real HTTPS/SQL38 application, real cookies and UI; disposable loopback only.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createAuthenticationFixture } from "./auth-fixture.mjs";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";

const catalogue = JSON.parse(await readFile(new URL("../../public/preferences-catalogue.json", import.meta.url), "utf8"));
const firstChoice = catalogue.categories[0].preferences[0].id, secondChoice = catalogue.categories[0].preferences[1].id;
const catalogueVersion = catalogue.meta.version;
const cookieName = role => role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
async function attest(page, fixture) {
  await page.navigate(`/__video_rehearsal/${fixture.videoAttestation}`);
  assert.equal(await page.execute("return document.body.textContent"), fixture.videoAttestation, "credentials stay on the attested owned loopback fixture");
}
async function json(page, role, path, body = null, authenticated = true) {
  return page.executeAsync(`const role=arguments[0],path=arguments[1],body=arguments[2],auth=arguments[3],done=arguments[arguments.length-1];
    (async()=>{let headers={};if(body!==null){headers['Content-Type']='application/json';if(auth){const session=await fetch(role==='admin'?'/api/auth/session':'/api/access/session',{cache:'no-store'});if(session.status!==200)return{status:session.status};headers['X-CSRF-Token']=(await session.json()).csrf;}else{headers['X-Jessie-Request']='1';}}
      const response=await fetch(path,{method:body===null?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,...(body===null?{}:{body:JSON.stringify(body)})});
      return{status:response.status,data:await response.json()};})().then(done,()=>done({status:0}));`, role, path, body, authenticated);
}
async function ready(page, role) {
  await waitUntil(() => page.execute("return location.pathname===arguments[0]&&!!document.getElementById('workspace')&&!document.getElementById('workspace').hidden&&!!document.getElementById('message-body')&&!document.getElementById('message-body').disabled", role === "admin" ? "/admin/messages" : "/messages"), "real experience conversation ready", 20000);
}
async function login(page, fixture, role, { credentials = null, password = null, recoveryIndex = 0 } = {}) {
  await attest(page, fixture);
  if (role === "admin") {
    await page.navigate("/admin/login");
    await waitUntil(() => page.execute("return !!document.getElementById('login-form')&&!document.getElementById('login-form').hidden&&!document.getElementById('login-button').disabled"), "admin credentials available");
    await page.type("#email", fixture.email); await page.type("#password", password ?? fixture.password);
    await page.click("#toggle-password"); assert.equal(await page.execute("return document.getElementById('password').type"), "text");
    await page.click("#toggle-password"); await page.type("#factor", fixture.recoveryCodes[recoveryIndex]); await page.click("#login-button");
    await waitUntil(() => page.execute("return !!document.getElementById('connected')&&!document.getElementById('connected').hidden"), "admin MFA session established", 20000);
    await page.navigate("/admin/messages");
    await waitUntil(() => page.execute("return !!document.querySelector('#conversations [data-conversation-id]')"), "admin conversations loaded");
    // Pick the primary synthetic client, independent of the other client's sort order.
    const selected = await page.execute("const nodes=[...document.querySelectorAll('#conversations [data-conversation-id]')];return nodes.find(n=>n.querySelector('strong')?.textContent==='Synthetic browser client')?.getAttribute('data-conversation-id')");
    if (await page.execute("return document.getElementById('show-clients')?.checkVisibility()===true")) await page.click("#show-clients");
    assert.match(selected ?? "", /^[a-f0-9]{32}$/); await page.click(`[data-conversation-id="${selected}"]`);
  } else {
    await page.navigate("/access");
    await waitUntil(() => page.execute("return !!document.getElementById('client-login-form')&&!document.getElementById('client-login-form').hidden&&!document.querySelector('#client-login-form button[type=submit]').disabled"), "client credentials available");
    const owner = credentials ?? fixture.client;
    await page.type("#login-email", owner.email); await page.type("#login-password", password ?? owner.password);
    await page.click("#login-password + .password-eye"); assert.equal(await page.execute("return document.getElementById('login-password').type"), "text");
    await page.click("#login-password + .password-eye"); await page.click("#client-login-form button[type=submit]");
  }
  await ready(page, role);
}
async function openMenu(page) {
  const opener = await page.execute("return ['open-conversation-menu','open-account-menu'].find(id=>{const node=document.getElementById(id);return node&&!node.hidden&&!node.disabled&&node.getClientRects().length})");
  assert.ok(opener); await page.click(`#${opener}`);
  await waitUntil(() => page.execute("return document.getElementById('chat-menu').hidden===false"), "profile menu opened");
}
async function openProfile(page) {
  await openMenu(page);
  await page.click("#open-profile");
  await waitUntil(() => page.execute("return !!document.querySelector('.profile-dialog')?.open&&!document.querySelector('.profile-pseudonym').disabled&&!!document.querySelector('.preferences-search')&&!document.querySelector('.preferences-search').disabled"), "real profile and private preferences loaded", 20000);
}
async function captureProfile(page, role, width) {
  const initial = await page.execute("return {categories:document.querySelectorAll('.profile-dialog .preference-category').length,open:document.querySelectorAll('.profile-dialog .preference-category[open]').length,buttons:document.querySelectorAll('.profile-dialog .preference-category button').length}");
  assert.deepEqual(initial, { categories: 25, open: 0, buttons: 0 }, "the complete catalogue stays collapsed and is rendered lazily on a phone as well as desktop");
  await page.click(".profile-password summary");
  const controls = await page.execute(`return [...document.querySelectorAll('.profile-password input')].map(input=>({type:input.type,empty:input.value==='',autocomplete:input.autocomplete,
    eye:{type:input.nextElementSibling.type,label:input.nextElementSibling.getAttribute('aria-label'),pressed:input.nextElementSibling.getAttribute('aria-pressed'),width:input.nextElementSibling.getBoundingClientRect().width,height:input.nextElementSibling.getBoundingClientRect().height}}))`);
  assert.equal(controls.length, 3);
  assert.deepEqual(controls.map(value => value.autocomplete), ["current-password", "new-password", "new-password"]);
  for (const value of controls) {
    assert.equal(value.type, "password"); assert.equal(value.empty, true); assert.equal(value.eye.type, "button");
    assert.equal(value.eye.label, "Afficher le mot de passe"); assert.equal(value.eye.pressed, "false");
    assert.ok(value.eye.width >= 44 && value.eye.height >= 44, "each eye has a usable touch target");
  }
  await page.click(".profile-password-current + .password-eye");
  assert.equal(await page.execute("return document.querySelector('.profile-password-current').type"), "text");
  await page.click(".profile-password-current + .password-eye");
  assert.equal(await page.execute("return document.querySelector('.profile-password-current').type"), "password");
  await page.click(".profile-password summary");
  await page.execute("document.querySelector('.profile-dialog .preferences-section').scrollIntoView({block:'start'})");
  const layout = await page.execute(`const d=document.querySelector('.profile-dialog').getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,left:d.left,right:d.right,height:d.height,windowHeight:innerHeight,
    search:document.querySelector('.profile-dialog .preferences-search').getBoundingClientRect().right}`);
  assert.equal(layout.viewport, width); assert.ok(layout.document <= width && layout.left >= 0 && layout.right <= width + 1 && layout.search <= width + 1);
  assert.ok(layout.height <= layout.windowHeight + 1, "the profile scrolls within the visible viewport");
  const directory = new URL("../../artifacts/homepage/", import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL(`experience-${role}-${width}-profile.png`, directory), Buffer.from(await page.screenshot(), "base64"));
}
async function captureReadOnlyPreferences(page) {
  await page.execute("document.querySelector('.crm-client-preferences').scrollIntoView({block:'start'})");
  assert.equal(await page.execute("const d=document.querySelector('.crm-dialog').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&d.left>=0&&d.right<=innerWidth+1&&d.height<=innerHeight+1"), true, "the read-only client profile fits the administrator viewport");
  const directory = new URL("../../artifacts/homepage/", import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL("experience-admin-1280-client-preferences.png", directory), Buffer.from(await page.screenshot(), "base64"));
}
async function saveChoice(page, choice) {
  await page.type(".preferences-search", choice === firstChoice ? "STRAIGHT" : "GAY");
  await waitUntil(() => page.execute("return !!document.querySelector('[data-preference-id=\"'+arguments[0]+'\"]')", choice), "bilingual alias exposes the existing preference button");
  await page.click(`[data-preference-id="${choice}"]`);
  await page.click(".preferences-actions button:first-child");
  await waitUntil(() => page.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "server confirms preference save");
}
async function changePassword(page, role, currentPassword, replacement) {
  const before = (await page.cookies()).find(cookie => cookie.name === cookieName(role)); assert.ok(before);
  await openProfile(page); await page.click(".profile-password summary");
  await page.type(".profile-password-current", "incorrect synthetic password");
  await page.type(".profile-password-new", replacement); await page.type(".profile-password-confirmation", replacement);
  await page.click(".profile-password-save");
  await waitUntil(() => page.execute("return document.querySelector('.profile-password-status')?.textContent==='Le mot de passe actuel est incorrect.'"), "wrong current password leaves session and draft intact");
  assert.equal((await json(page, role, role === "admin" ? "/api/auth/session" : "/api/access/session")).status, 200);
  assert.equal(await page.execute("return document.querySelector('.profile-password-new').value"), replacement);
  await page.type(".profile-password-current", currentPassword);
  await page.click(".profile-password-save");
  await waitUntil(async () => {
    const value = (await page.cookies()).find(cookie => cookie.name === cookieName(role)); return value?.value && value.value !== before.value;
  }, "HTTP cookie rotated after deliberate password change", 20000);
  await waitUntil(() => page.execute("return !!document.getElementById('workspace')&&!document.getElementById('workspace').hidden"), "renewed session reopens workspace", 20000);
  if (role === "admin") {
    await waitUntil(() => page.execute("return !![...document.querySelectorAll('#conversations [data-conversation-id]')].find(n=>n.querySelector('strong')?.textContent==='Synthetic browser client')"), "renewed admin inbox");
    const selected = await page.execute("return [...document.querySelectorAll('#conversations [data-conversation-id]')].find(n=>n.querySelector('strong')?.textContent==='Synthetic browser client').getAttribute('data-conversation-id')");
    if (await page.execute("return document.getElementById('show-clients')?.checkVisibility()===true")) await page.click("#show-clients");
    await page.click(`[data-conversation-id="${selected}"]`);
  }
  await ready(page, role);
  assert.equal((await json(page, role, role === "admin" ? "/api/auth/session" : "/api/access/session")).status, 200, "current browser remains authenticated");
  return before.value;
}
async function createPhoto(page, conversationId) {
  return page.executeAsync(`const id=arguments[0],done=arguments[arguments.length-1];(async()=>{
    const session=await(await fetch('/api/access/session',{cache:'no-store'})).json(),headers={'X-CSRF-Token':session.csrf};
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));const upload=await fetch('/api/media/client/assets',{method:'POST',headers:{...headers,'Content-Type':'image/jpeg'},body:blob});
    if(upload.status!==201)return{status:upload.status};const asset=(await upload.json()).asset;
    const response=await fetch('/api/media/client/conversations/'+id+'/messages',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({clientMessageId:crypto.randomUUID().replaceAll('-',''),mediaId:asset.id,caption:'Synthetic retained photo'})});
    const data=await response.json();return{status:response.status,data};})().then(done,()=>done({status:0}));`, conversationId);
}
async function imageReadable(page, path) {
  return page.executeAsync(`const path=arguments[0],done=arguments[arguments.length-1];(async()=>{const response=await fetch(path,{cache:'no-store',credentials:'same-origin'});if(response.status!==200)return{status:response.status};const image=await createImageBitmap(await response.blob());const result={status:200,width:image.width,height:image.height};image.close();return result;})().then(done,()=>done({status:0}));`, path);
}
async function selectPhotos(page, bytes, count, offset = 0) {
  // Replace only the OS picker; decoding, normalization, uploads and sends use
  // the production controller and actual SQL-backed HTTPS endpoints.
  const added = await page.executeAsync(`const bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0)),count=arguments[1],offset=arguments[2],done=arguments[arguments.length-1];
    (async()=>{const files=new DataTransfer(),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
      try{for(let i=0;i<count;i++){const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
        context.fillStyle='rgb('+(20+(offset+i)*30)+',80,160)';context.fillRect(0,0,24,24);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));if(!blob)return false;
        files.items.add(new File([blob],'synthetic-photo-'+(offset+i)+'.jpg',{type:'image/jpeg'}));}
        // chooseFile clears input.value synchronously. Chrome also clears the
        // assigned live FileList, so snapshot its count before that event.
        const added=files.files.length,input=document.getElementById('image-file');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return added;
      }finally{bitmap.close();}})().then(done,()=>done(false));`, bytes, count, offset);
  assert.equal(added, count, "each synthetic photo has distinct pixels so existing content deduplication remains meaningful");
}
async function waitReplyUI(page, needed) {
  await waitUntil(() => page.execute(`const section=document.querySelector('.reply-followup'),text=section?.querySelector('p')?.textContent;
    return !!section&&!section.hidden&&[...section.querySelectorAll('button')].every(button=>!button.disabled)
      &&(arguments[0]?text==='À répondre'||text?.startsWith('Attente depuis le '):text==='Traité');`, needed), "actual administrator follow-up state synchronized", 20000);
}
async function restoreFetch(page) {
  await page.execute("if(window.__experienceTransport){window.fetch=window.__experienceTransport.original;delete window.__experienceTransport;}");
}

test("real HTTPS SQL38: private profiles across devices and own-password rotation preserve history and media", { timeout: 240000 }, async t => {
  const driver = await startWebDriver(); let fixture; const pages = [];
  try {
    fixture = await createAuthenticationFixture({ messaging: true, video: true, experience: true });
    const browser = async width => { const page = await driver.browser({ origin: fixture.origin, primaryFixturePort: fixture.primaryFixturePort, width, acceptInsecureCerts: true }); pages.push(page); return page; };
    const client = await browser(320), clientDevice = await browser(1280), other = await browser(375), admin = await browser(1280), adminDevice = await browser(320);
    await login(client, fixture, "client"); await login(clientDevice, fixture, "client"); await login(other, fixture, "client", { credentials: fixture.otherClient });
    await login(admin, fixture, "admin"); await login(adminDevice, fixture, "admin", { recoveryIndex: 1 });
    const conversation = (await json(client, "client", "/api/chat/client/conversation")).data.id;
    const otherConversation = (await json(other, "client", "/api/chat/client/conversation")).data.id;
    assert.notEqual(conversation, otherConversation);
    const caption = "Synthetic encrypted history retained after explicit password changes";
    const sent = await json(client, "client", `/api/chat/client/conversations/${conversation}/messages`, { clientMessageId: randomBytes(16).toString("hex"), body: caption }); assert.equal(sent.status, 201);
    const photo = await createPhoto(client, conversation); assert.equal(photo.status, 201);
    const mediaPath = `/api/media/client/conversations/${conversation}/messages/${photo.data.message.id}/full`;
    assert.equal((await imageReadable(client, mediaPath)).status, 200);

    await t.test("own choices are optional, bilingual-searchable, encrypted and synchronized; other clients cannot read them", async () => {
      await openProfile(client); await captureProfile(client, "client", 320); await saveChoice(client, firstChoice); await client.click(".profile-close");
      const stored = await json(clientDevice, "client", "/api/profile/client/preferences"); assert.equal(stored.status, 200); assert.deepEqual(stored.data.selectedIds, [firstChoice]);
      await openProfile(clientDevice); await captureProfile(clientDevice, "client", 1280); assert.equal(await clientDevice.execute("return document.querySelector('.preferences-selected button')?.textContent"), catalogue.categories[0].preferences[0].fr); await clientDevice.click(".profile-close");
      assert.deepEqual((await json(other, "client", "/api/profile/client/preferences")).data.selectedIds, []);
      assert.ok([403, 404].includes((await json(other, "client", `/api/profile/client/conversations/${conversation}/preferences`)).status));
      const invalid = await json(client, "client", "/api/profile/client/preferences", { expectedVersion: stored.data.version, catalogueVersion, selectedIds: ["pref_unknown_entry"] }); assert.equal(invalid.status, 400);
      await openProfile(admin); await captureProfile(admin, "admin", 1280); await saveChoice(admin, secondChoice); await admin.click(".profile-close");
      assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
      await openProfile(adminDevice); await captureProfile(adminDevice, "admin", 320); await adminDevice.click(".profile-close");
      assert.deepEqual((await json(admin, "admin", `/api/profile/admin/conversations/${conversation}/preferences`)).data.selectedIds, [firstChoice]);
      assert.equal((await json(admin, "admin", `/api/profile/admin/conversations/${conversation}/preferences`, { expectedVersion: stored.data.version, catalogueVersion, selectedIds: [] })).status, 405);
      // Fiche shares the conversation options menu; closing the own-profile
      // dialog does not reopen that menu automatically.
      await openMenu(admin); await admin.click(".crm-fiche-button");
      await waitUntil(() => admin.execute("return !!document.querySelector('.crm-dialog')?.open&&!document.querySelector('.crm-client-preferences').hidden"), "authorized admin client-profile preferences entry");
      await admin.click(".crm-client-preferences summary");
      await waitUntil(() => admin.execute("return document.querySelector('.crm-client-preferences .preferences-selected .preference-choice')?.textContent===arguments[0]", catalogue.categories[0].preferences[0].fr), "client preferences are rendered read-only in the actual CRM profile");
      assert.equal(await admin.execute("const panel=document.querySelector('.crm-client-preferences');return panel.querySelector('.preferences-actions').hidden&&panel.querySelector('.preferences-search-label').hidden&&!panel.querySelector('[data-preference-id]')"), true);
      await captureReadOnlyPreferences(admin);
      await admin.click(".crm-dialog .dialog-head button");
      const state = await fixture.privatePreferencesState([firstChoice, secondChoice]); assert.equal(state.rows, 2); assert.equal(state.encrypted, true);
      assert.deepEqual((await json(other, "client", "/api/profile/client/preferences")).data.selectedIds, []);
    });
    await t.test("public Jessie profile is an explicit admin snapshot; temporary hiding preserves the private draft after actual session proof", async () => {
      const anonymous = await browser(320), displayName = "Synthetic Jessie public profile", bio = "A synthetic public introduction for the isolated rehearsal.";
      const publicChoices = [firstChoice, secondChoice];
      await attest(anonymous, fixture);
      assert.equal((await json(anonymous, null, "/api/public/jessie")).status, 404, "saving private preferences has not published anything");
      const capability = await json(admin, "admin", "/api/chat/admin/capabilities");
      assert.equal(capability.status, 200); assert.equal(capability.data.profile.publicationEnabled, true, "actual configured service enables the admin controls");
      assert.notEqual((await json(client, "client", "/api/chat/client/capabilities")).data.profile.publicationEnabled, true);
      await openProfile(admin);
      await waitUntil(() => admin.execute("const section=document.querySelector('.profile-publication');return !!section&&!section.hidden&&!section.querySelector('input').disabled&&!section.querySelector('.profile-publication-actions button').disabled"), "SQL-backed administrator can load the publication controller");
      await admin.execute(`const original=window.fetch;window.__publicationTransport={original,writes:0};
        window.fetch=function(input,options={}){const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
          if(path==='/api/profile/admin/publication'&&options.method==='POST')window.__publicationTransport.writes++;
          return original.call(this,input,options);};`);
      try {
        await admin.type(".preferences-search", "STRAIGHT");
        await waitUntil(() => admin.execute("return !!document.querySelector('[data-preference-id=\"'+arguments[0]+'\"]')", firstChoice), "additional unsaved private choice available");
        await admin.click(`[data-preference-id="${firstChoice}"]`);
        await admin.type(".profile-publication input", displayName); await admin.type(".profile-publication textarea", bio);
        await admin.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__profileRehearsalHidden?'hidden':'visible'});window.__profileRehearsalHidden=true;document.dispatchEvent(new Event('visibilitychange'))");
        assert.equal(await admin.execute("return document.querySelector('.profile-dialog').open"), false);
        await admin.execute("window.__profileRehearsalHidden=false;document.dispatchEvent(new Event('visibilitychange'))");
        await waitUntil(() => admin.execute("return !document.getElementById('workspace').hidden&&document.querySelector('.profile-dialog').matches(':modal')&&!document.querySelector('.preferences-section').hidden&&!document.querySelector('.profile-publication input').disabled"), "actual session GET permits same-owner profile restoration", 20000);
        assert.equal(await admin.execute("return document.querySelector('.preferences-search').value"), "STRAIGHT");
        assert.deepEqual(await admin.execute("return [...document.querySelectorAll('.preferences-selected button')].map(node=>node.textContent).sort()"), catalogue.categories[0].preferences.slice(0, 2).map(choice => choice.fr).sort());
        assert.equal(await admin.execute("return document.querySelector('.profile-publication textarea').value"), bio);
        assert.equal(await admin.execute("return __publicationTransport.writes"), 0, "visibility restoration has not published the retained draft");
        assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice], "the extra choice remains unsaved in the real SQL store");
        await admin.click(".profile-publication-actions button:first-child");
        await waitUntil(() => admin.execute("return document.querySelector('.profile-publication-status').textContent==='Profil public publié.'"), "explicit publish acknowledged", 20000);
        assert.equal(await admin.execute("return __publicationTransport.writes"), 1);
        const published = await json(anonymous, null, "/api/public/jessie");
        assert.equal(published.status, 200); assert.deepEqual(published.data, { displayName, bio, catalogueVersion, selectedIds: publicChoices });
        assert.equal((await anonymous.cookies()).some(cookie => [cookieName("admin"), cookieName("client")].includes(cookie.name)), false, "public reads have no authenticated cookie");
        await anonymous.navigate("/jessie");
        await waitUntil(() => anonymous.execute("return !document.getElementById('public-profile-content').hidden&&document.getElementById('public-profile-name').textContent===arguments[0]", displayName), "public page renders without signing in", 20000);
        assert.equal(await anonymous.execute("return document.getElementById('public-profile-bio').textContent"), bio);
        assert.deepEqual(await anonymous.execute("return [...document.querySelectorAll('.public-preference-list li')].map(node=>node.textContent)"), catalogue.categories[0].preferences.slice(0, 2).map(choice => choice.fr));
        assert.equal(await anonymous.execute("return document.documentElement.scrollWidth<=innerWidth"), true, "public profile fits a 320px screen");
        const directory = new URL("../../artifacts/homepage/", import.meta.url); await mkdir(directory, { recursive: true });
        await writeFile(new URL("experience-public-320-profile.png", directory), Buffer.from(await anonymous.screenshot(), "base64"));
        const current = await json(admin, "admin", "/api/profile/admin/publication"); assert.equal(current.status, 200);
        const forbidden = await json(client, "client", "/api/profile/admin/publication", { expectedVersion: current.data.version, published: false, displayName, bio, catalogueVersion, selectedIds: publicChoices });
        assert.ok([401, 403].includes(forbidden.status), "a real client session cannot perform an admin publication write");
        assert.deepEqual((await json(anonymous, null, "/api/public/jessie")).data, published.data);
        await admin.click(`[data-preference-id="${firstChoice}"]`); await admin.click(".preferences-actions button:first-child");
        await waitUntil(() => admin.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "private changes saved separately", 20000);
        assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
        assert.deepEqual((await json(anonymous, null, "/api/public/jessie")).data, published.data, "saving a private change does not update the public snapshot");
        assert.equal((await json(admin, "admin", "/api/profile/admin/publication")).data.version, current.data.version);
        assert.equal(await admin.execute("return __publicationTransport.writes"), 1);
        await admin.click(".profile-publication-actions button:nth-child(2)");
        await waitUntil(() => admin.execute("return document.querySelector('.profile-publication-status').textContent==='Profil public retiré.'"), "explicit unpublish acknowledged", 20000);
        assert.equal(await admin.execute("return __publicationTransport.writes"), 2);
        assert.equal((await json(anonymous, null, "/api/public/jessie")).status, 404);
        await anonymous.navigate("/jessie");
        await waitUntil(() => anonymous.execute("return document.getElementById('public-profile-content').hidden&&document.getElementById('public-profile-status').textContent==='Ce profil n’est pas disponible pour le moment.'"), "withdrawn public content is no longer rendered", 20000);
      } finally {
        await admin.execute("if(window.__publicationTransport){window.fetch=__publicationTransport.original;delete window.__publicationTransport;}if(document.querySelector('.profile-dialog')?.open)document.querySelector('.profile-close').click();");
      }
    });
    await t.test("five real photo drafts survive one lost committed batch acknowledgement without new uploads or duplicate SQL messages", async () => {
      const before = await json(client, "client", `/api/chat/client/conversations/${conversation}/messages`); assert.equal(before.status, 200);
      const bytes = await client.execute(`const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const context=canvas.getContext('2d');
        context.fillStyle='#b52f68';context.fillRect(0,0,96,64);context.fillStyle='#153f68';context.fillRect(48,0,48,64);return canvas.toDataURL('image/jpeg').split(',')[1];`);
      await selectPhotos(client, bytes, 5);
      await waitUntil(() => client.execute("return document.querySelectorAll('.photo-batch-item').length===5&&[...document.querySelectorAll('.photo-batch-item img')].every(image=>image.complete&&image.naturalWidth===96)"), "five real JPEG previews before sending");
      const initial = await client.execute("return [...document.querySelectorAll('.photo-batch-item')].map(node=>node.dataset.photoId)");
      await client.click(".photo-batch-item:nth-child(2) button"); assert.equal(await client.execute("return document.querySelectorAll('.photo-batch-item').length"), 4);
      await selectPhotos(client, bytes, 1, 5);
      await waitUntil(() => client.execute("return document.querySelectorAll('.photo-batch-item').length===5&&[...document.querySelectorAll('.photo-batch-item img')].every(image=>image.complete&&image.naturalWidth===96)"), "one replacement photo joins the existing preview selection");
      const selected = await client.execute("return [...document.querySelectorAll('.photo-batch-item')].map(node=>node.dataset.photoId)");
      assert.deepEqual(selected.slice(0, 4), [initial[0], ...initial.slice(2)]); assert.equal(selected.includes(initial[1]), false); assert.equal(new Set(selected).size, 5);
      const batchCaption = "Synthetic one-caption five-photo selection"; await client.type("#message-body", batchCaption);
      await client.execute(`const original=window.fetch.bind(window),batchPath=arguments[0];
        const state=window.__experienceTransport={original,uploads:[],batches:[],lost:false};
        window.fetch=async(input,options={})=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
          const mutation=options.method==='POST',response=await original(input,options);
          if(mutation&&path==='/api/media/client/assets'){const data=await response.clone().json();state.uploads.push({status:response.status,id:data.asset?.id});}
          if(mutation&&path===batchPath){const data=await response.clone().json();state.batches.push({body:JSON.parse(options.body),status:response.status,results:data.results});
            if(!state.lost&&response.ok&&data.results?.length===5&&data.results.every(row=>row.message)){state.lost=true;throw new TypeError('Synthetic lost committed photo ACK');}}
          return response;};`, `/api/media/client/conversations/${conversation}/messages/batch`);
      try {
        assert.deepEqual(await client.execute("return {uploads:__experienceTransport.uploads.length,batches:__experienceTransport.batches.length}"), { uploads: 0, batches: 0 });
        await client.click("#send");
        await waitUntil(() => client.execute("return __experienceTransport.lost&&!document.getElementById('send').disabled&&document.getElementById('send').textContent==='Réessayer les photos restantes'&&[...document.querySelectorAll('.photo-batch-item span')].every(node=>node.textContent==='À réessayer')"), "committed batch with lost ACK requires one explicit retry", 30000);
        const uncertain = await client.execute("return {uploads:__experienceTransport.uploads,batches:__experienceTransport.batches}");
        assert.equal(uncertain.uploads.length, 5); assert.ok(uncertain.uploads.every(upload => upload.status === 201)); assert.equal(new Set(uncertain.uploads.map(upload => upload.id)).size, 5);
        assert.equal(uncertain.batches.length, 1); assert.equal(uncertain.batches[0].status, 200); assert.deepEqual(uncertain.batches[0].body.messages.map(message => message.clientMessageId), selected);
        assert.ok(uncertain.batches[0].results.every(row => row.message && row.duplicate === false));
        const committed = await json(clientDevice, "client", `/api/chat/client/conversations/${conversation}/messages`); assert.equal(committed.status, 200);
        assert.equal(committed.data.messages.length, before.data.messages.length + 5, "the first real batch committed exactly five SQL-backed messages");
        await client.click("#send");
        await waitUntil(() => client.execute("return document.getElementById('photo-batch').hidden&&document.getElementById('message-body').value===''"), "same selection acknowledged after explicit retry", 30000);
        const confirmed = await client.execute("return {uploads:__experienceTransport.uploads,batches:__experienceTransport.batches}");
        assert.equal(confirmed.uploads.length, 5, "the retry does not upload any original twice"); assert.equal(confirmed.batches.length, 2);
        assert.deepEqual(confirmed.batches[1].body, confirmed.batches[0].body, "all five original idempotency keys, media IDs and captions are reused");
        assert.ok(confirmed.batches[1].results.every(row => row.duplicate === true));
        const history = await json(clientDevice, "client", `/api/chat/client/conversations/${conversation}/messages`); assert.equal(history.status, 200);
        const photos = history.data.messages.filter(message => selected.includes(message.clientMessageId));
        assert.equal(history.data.messages.length, before.data.messages.length + 5); assert.equal(photos.length, 5); assert.equal(new Set(photos.map(message => message.id)).size, 5);
        assert.ok(photos.every(message => message.media)); assert.equal(new Set(photos.map(message => message.media.id)).size, 5);
        assert.equal(photos.filter(message => message.body === batchCaption).length, 1); assert.equal(photos.filter(message => message.body === "").length, 4);
        assert.equal(history.data.messages.some(message => message.clientMessageId === initial[1]), false, "the removed draft never became a message");
        assert.equal((await imageReadable(clientDevice, photos[0].media.fullUrl)).status, 200);
      } finally { await restoreFetch(client); }
    });
    await t.test("real reply controls keep reads pending and synchronize manual handling, reopening and one observed individual reply", async () => {
      assert.equal(await client.execute("return document.getElementById('photo-batch').hidden&&document.getElementById('image-draft').hidden&&document.getElementById('message-body').value===''"), true, "the previous photo exercise finished without leaving an accidental attachment or caption");
      const question = "Synthetic client request requiring an individual answer";
      await client.type("#message-body", question); await client.click("#send");
      await waitUntil(() => admin.execute("return [...document.querySelectorAll('#messages article')].some(node=>node.textContent.includes(arguments[0]))", question), "real incoming client text reaches the administrator", 20000);
      for (const page of [admin, adminDevice]) await waitReplyUI(page, true);
      const incoming = await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(incoming.status, 200);
      const questionMessage = incoming.data.messages.find(message => message.body === question); assert.ok(questionMessage); assert.equal(incoming.data.conversation.reply.needed, true);
      await admin.execute("const history=document.getElementById('message-scroll');history.scrollTop=history.scrollHeight;history.dispatchEvent(new Event('scroll'));");
      await waitUntil(async () => {
        const current = await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/messages`);
        return current.status === 200 && BigInt(current.data.conversation.lastReadSequence) >= BigInt(questionMessage.sequence);
      }, "the actual administrator scroll posts a persisted read receipt", 20000);
      const read = await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(read.data.conversation.reply.needed, true, "reading the client message never handles it");
      await admin.click(".reply-followup > button:nth-of-type(2)");
      for (const page of [admin, adminDevice]) await waitReplyUI(page, false);
      const handled = await json(adminDevice, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(handled.data.conversation.reply.handledThrough, questionMessage.sequence);
      await adminDevice.click(".reply-followup > button:nth-of-type(1)");
      for (const page of [adminDevice, admin]) await waitReplyUI(page, true);
      const reopened = await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(reopened.data.conversation.reply.needed, true);
      assert.equal(await client.execute("return document.querySelector('.reply-followup')===null"), true, "the client sees none of the private administrator follow-up");
      const answer = "Synthetic individual response handles the viewed request";
      await admin.execute(`const original=window.fetch.bind(window),target=arguments[0],state=window.__experienceTransport={original,answers:[]};
        window.fetch=async(input,options={})=>{if(options.method==='POST'&&new URL(typeof input==='string'?input:input.url,location.origin).pathname===target)state.answers.push(JSON.parse(options.body));return original(input,options);};`, `/api/chat/admin/conversations/${conversation}/messages`);
      try {
        await admin.type("#message-body", answer); await admin.click("#send");
        await waitUntil(() => client.execute("return [...document.querySelectorAll('#messages article')].filter(node=>node.textContent.includes(arguments[0])).length===1", answer), "individual response delivered through real controller and SQL", 20000);
        for (const page of [admin, adminDevice]) await waitReplyUI(page, false);
        const commands = await admin.execute("return __experienceTransport.answers"); assert.equal(commands.length, 1);
        assert.equal(commands[0].replyThrough, questionMessage.sequence, "the UI binds the response to the observed client sequence"); assert.equal(commands[0].replyVersion, reopened.data.conversation.reply.version);
        const complete = await json(adminDevice, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(complete.status, 200);
        assert.equal(complete.data.conversation.reply.needed, false); assert.equal(complete.data.conversation.reply.handledThrough, questionMessage.sequence);
        assert.equal(complete.data.messages.filter(message => message.body === answer).length, 1);
      } finally { await restoreFetch(admin); }
    });
    const resetToken = await fixture.seedClientResetToken();
    const encryptedBefore = await fixture.privatePreferencesState([firstChoice, secondChoice]);
    await t.test("client password change retains current browser and ciphertext, revokes old device/reset link, and preserves photo reads", async () => {
      const newPassword = "client88"; const oldToken = await changePassword(client, "client", fixture.client.password, newPassword);
      assert.equal(await fixture.sessionRemainsActive("client", oldToken), false);
      assert.equal((await json(clientDevice, "client", "/api/access/session")).status, 401);
      const reset = await json(other, "client", "/api/access/recovery/reset", { token: resetToken, password: "reset888" }, false); assert.equal(reset.status, 401); assert.equal(reset.data.error, "invalid_reset_link");
      const staleLogin = await json(other, "client", "/api/access/login", { email: fixture.client.email, password: fixture.client.password }, false); assert.equal(staleLogin.status, 401);
      await login(clientDevice, fixture, "client", { password: newPassword });
      assert.deepEqual((await json(clientDevice, "client", "/api/profile/client/preferences")).data.selectedIds, [firstChoice]);
      const history = await json(client, "client", `/api/chat/client/conversations/${conversation}/messages`); assert.equal(history.status, 200); assert.ok(history.data.messages.some(message => message.body === caption));
      assert.equal((await imageReadable(client, mediaPath)).status, 200);
      assert.deepEqual(await fixture.privatePreferencesState([firstChoice, secondChoice]), encryptedBefore);
      await client.type("#message-body", "Synthetic message after password rotation"); await client.click("#send");
      await waitUntil(() => client.execute("return [...document.querySelectorAll('#messages article')].some(node=>node.textContent.includes('Synthetic message after password rotation'))"), "real chat adapter adopted renewed CSRF");
    });
    await t.test("admin password change preserves MFA and current session, requires one new sign-in elsewhere and retains private selections", async () => {
      const newPassword = "admin888"; const oldToken = await changePassword(admin, "admin", fixture.password, newPassword);
      assert.equal(await fixture.sessionRemainsActive("admin", oldToken), false);
      assert.equal((await json(adminDevice, "admin", "/api/auth/session")).status, 401);
      await login(adminDevice, fixture, "admin", { password: newPassword, recoveryIndex: 2 });
      assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
      const history = await json(admin, "admin", `/api/chat/admin/conversations/${conversation}/messages`); assert.equal(history.status, 200); assert.ok(history.data.messages.some(message => message.body === caption));
      assert.deepEqual(await fixture.privatePreferencesState([firstChoice, secondChoice]), encryptedBefore);
    });
    await t.test("clearing client choices affects only that profile and remains cleared on the other current device", async () => {
      await openProfile(client); await client.click(".preferences-actions button:nth-child(2)"); await client.click(".preferences-actions button:first-child");
      await waitUntil(() => client.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "clear confirmed by real server"); await client.click(".profile-close");
      const cleared = await json(clientDevice, "client", "/api/profile/client/preferences");
      assert.equal(cleared.status, 200, "the reconnected client device can read its cleared preferences"); assert.deepEqual(cleared.data.selectedIds, []);
      assert.deepEqual((await json(adminDevice, "admin", "/api/profile/admin/preferences")).data.selectedIds, [secondChoice]);
      assert.equal((await imageReadable(client, mediaPath)).status, 200);
    });
  } finally { for (const page of pages.reverse()) await page.close(); await fixture?.stop(); await driver.close(); }
});
