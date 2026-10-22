// Product task markup/controllers in Chrome against a synthetic loopback API.
// No production data, SQL connection, push, mail or actual message send.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const id = number => number.toString(16).padStart(32, "0"), conversationId = id(100);
const assets = ["tasks.html", "tasks.js", "tasks-model.js", "tasks.css", "admin-navigation.css", "i18n.js", "i18n-tools.js", "i18n.css", "session-clock.js", "help-link.js",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-32.png", "brand/icon-128.png"];
let driver;
before(async () => { driver = await startWebDriver(); }, { timeout: 60000 });
after(async () => { await driver?.close(); });
const bootstrap = `window.__taskErrors=[];window.__taskResponses=[];window.__taskCancelled=[];
addEventListener('error',event=>window.__taskErrors.push(String(event.message)));
addEventListener('unhandledrejection',event=>window.__taskErrors.push(String(event.reason?.message??event.reason)));
addEventListener('securitypolicyviolation',event=>window.__taskErrors.push('CSP:'+event.violatedDirective));
const fixtureFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(...args)=>{const path=new URL(args[0],location.origin).pathname;
try{const response=await fixtureFetch(...args),read=response.json.bind(response);response.json=async()=>{const data=await read();window.__taskResponses.push({path,method:args[1]?.method??'GET',data});return data};return response}
catch(error){if(error.name==='AbortError')window.__taskCancelled.push(path);throw error}};`;

async function fixture({ uncertain = false } = {}) {
  const resources = new Map(await Promise.all(assets.map(async name => ["/" + name, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const state = { owner: 1, tasks: new Map(), writes: [], requests: [], commits: new Map(), dropped: false, errors: [], denied: null, postDenied: null, holdLists: false, pendingLists: [] };
  const session = () => ({ user: { id: id(8000 + state.owner), role: "admin", pseudonym: "Synthetic Jessie" },
    csrf: state.owner === 1 ? "A".repeat(43) : "B".repeat(42) + "A", expiresAt: Date.now() + 8 * 3600000 });
  const profile = () => ({ conversationId, client: { id: id(2), pseudonym: "Client synthétique", email: "synthetic@example.invalid", status: "active" },
    access: { state: "active", expiresAt: null }, nickname: "", notes: "", reminderAt: null, labels: [], version: "0", updatedAt: null });
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"), path = url.pathname;
    state.requests.push({ path, method: request.method });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, value) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
    if (path === "/api/auth/session") { json(state.denied ?? 200, state.denied ? { error: "unauthorized" } : session()); return; }
    if (path === "/api/auth/logout") { for await (const _chunk of request) { /* Synthetic logout. */ } json(200, {}); return; }
    if (path === `/api/admin/crm/conversations/${conversationId}`) { json(200, profile()); return; }
    if (path === "/api/admin/crm/tasks/summary") { json(200, { dueCount: state.owner === 1 ? [...state.tasks.values()].filter(task => !task.done && task.dueAt !== null && task.dueAt <= Date.now()).length : 0, serverTime: Date.now() }); return; }
    if (path === "/api/admin/crm/tasks" && request.method === "GET") {
      const filter = url.searchParams.get("filter") ?? "open", afterId = url.searchParams.get("afterId"), limit = Number(url.searchParams.get("limit") ?? 50);
      const selected = state.owner === 1 ? [...state.tasks.values()].filter(task => (!url.searchParams.get("conversationId") || task.conversationId === url.searchParams.get("conversationId"))
        && (filter === "done" ? task.done : !task.done) && (filter !== "due" || task.dueAt !== null && task.dueAt <= Date.now()) && (!afterId || task.id > afterId)).sort((a, b) => a.id.localeCompare(b.id)) : [];
      const tasks = selected.slice(0, limit), hasMore = selected.length > tasks.length;
      const page = { tasks, hasMore, nextCursor: hasMore ? tasks.at(-1).id : null, serverTime: Date.now() };
      if (state.holdLists) { state.pendingLists.push(() => json(200, page)); return; }
      json(200, page); return;
    }
    if (/^\/api\/admin\/crm\/tasks\/[a-f0-9]{32}$/.test(path) && request.method === "GET") {
      const task = state.owner === 1 ? state.tasks.get(path.split("/").at(-1)) : null;
      json(task ? 200 : 404, task ? { task } : { error: "not_found" }); return;
    }
    if (/^\/api\/admin\/crm\/tasks\/[a-f0-9]{32}$/.test(path) && request.method === "POST") {
      let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 65536) throw new Error("fixture_budget"); }
      const body = JSON.parse(raw), taskId = path.split("/").at(-1), previous = state.tasks.get(taskId), payload = JSON.stringify(body);
      state.writes.push({ id: taskId, body }); assert.equal(request.headers["x-csrf-token"], session().csrf);
      if (state.postDenied) { json(state.postDenied, { error: "csrf_failed" }); return; }
      const committed = state.commits.get(taskId + ":" + body.expectedVersion);
      if (committed && committed.payload === payload) { json(200, { task: committed.task, duplicate: true }); return; }
      if (state.owner !== 1 || body.expectedVersion !== (previous?.version ?? "0")) { json(409, { error: "record_changed" }); return; }
      const now = Date.now(), task = { id: taskId, conversationId: body.conversationId, clientName: "Client synthétique", title: body.title,
        dueAt: body.dueAt, done: body.done, version: String(Number(body.expectedVersion) + 1), createdAt: previous?.createdAt ?? now, updatedAt: now };
      state.tasks.set(taskId, task); state.commits.set(taskId + ":" + body.expectedVersion, { payload, task });
      if (uncertain && !state.dropped) {
        state.dropped = true;
        response.writeHead(201, { "Content-Type": "application/json", "Content-Length": "128", Connection: "close" }); response.end('{"task":'); return;
      }
      json(201, { task, duplicate: false }); return;
    }
    if (path === "/task-fixture.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bootstrap); return; }
    if (path === "/__seed") { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><title>Synthetic tasks</title>"); return; }
    if (path === "/admin/tasks") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(resources.get("/tasks.html").toString().replace("<head>", '<head><script src="/task-fixture.js"></script>')); return; }
    if (resources.has(path)) {
      const type = { js: "text/javascript", css: "text/css", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" }[path.split(".").at(-1)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }); response.end(resources.get(path)); return;
    }
    json(404, { error: "not_found" });
  })().catch(error => { state.errors.push(error.message); if (!response.headersSent) response.writeHead(500); response.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { state, origin: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function openPage(source, width = 320, language = "fr") {
  const page = await driver.browser({ origin: source.origin, width, height: 780 });
  try {
    await page.navigate("/__seed"); await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language);
    await page.navigate(`/admin/tasks?conversationId=${conversationId}`);
    await waitUntil(() => page.execute("return !document.getElementById('tasks-content').hidden && !document.getElementById('new-task').hidden && !document.getElementById('new-task').disabled"), "task session and private client context");
    assert.equal(await page.execute("return document.documentElement.lang"), language); return page;
  } catch (error) { await page.close(); throw error; }
}
async function chooseFilter(page, value) {
  await page.execute("const filter=document.getElementById('task-filter');filter.value=arguments[0];filter.dispatchEvent(new Event('change',{bubbles:true}))", value);
}
async function setDue(page, offset) {
  await page.execute(`const d=new Date(Date.now()+arguments[0]),pad=n=>String(n).padStart(2,'0');
    const input=document.getElementById('task-due');input.value=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());input.dispatchEvent(new Event('input',{bubbles:true}));`, offset);
}
async function browserErrors(page, source) {
  assert.deepEqual(await page.execute("return window.__taskErrors"), []); assert.deepEqual(source.state.errors, []);
  assert.equal(source.state.requests.some(request => /notification|broadcast|mail|smtp/.test(request.path)), false, "private task actions do not send messages or notifications");
}

test("Chrome mobile FR/EN: create, postpone, complete and reopen a private client task without overflow", { timeout: 150000 }, async () => {
  for (const [width, language] of [[320, "fr"], [390, "en"]]) {
    const source = await fixture(); let page;
    const title = "Fermer <script>texte littéral</script> 💋";
    try {
      page = await openPage(source, width, language); await page.click("#new-task");
      await waitUntil(() => page.execute("return document.getElementById('task-dialog').open"), "task editor opens");
      await page.type("#task-title", title); await setDue(page, -3600000); await page.click("#save-task");
      await waitUntil(() => source.state.tasks.size === 1 && page.execute("return !document.getElementById('task-dialog').open && document.querySelectorAll('.task-card').length===1"), "one persisted task and closed editor");
      const taskId = [...source.state.tasks.keys()][0];
      assert.equal(source.state.tasks.get(taskId).title, title);
      assert.equal(await page.execute("return document.querySelector('.task-card').textContent.includes(arguments[0])", title), true, "raw private text remains literal");
      assert.equal(await page.execute("return document.querySelectorAll('.task-card script').length"), 0);
      await chooseFilter(page, "due");
      await waitUntil(() => page.execute("return document.querySelectorAll('.task-card').length===1"), "overdue task is available in due view");
      await page.click('[data-task-action="postpone"]');
      await waitUntil(() => page.execute("return document.getElementById('task-dialog').open"), "postpone editor opens");
      await setDue(page, 24 * 3600000); await page.click("#save-task");
      await waitUntil(() => source.state.tasks.get(taskId).version === "2" && page.execute("return !document.getElementById('task-dialog').open && document.querySelectorAll('.task-card').length===0"), "postponed task leaves the due view");
      assert.ok(source.state.tasks.get(taskId).dueAt > Date.now());
      await chooseFilter(page, "open"); await waitUntil(() => page.execute("return document.querySelectorAll('.task-card').length===1"), "future task remains open");
      await page.click('[data-task-action="complete"]');
      await waitUntil(() => source.state.tasks.get(taskId).done && page.execute("return !document.getElementById('task-dialog').open && document.querySelectorAll('.task-card').length===0"), "completed task leaves open view");
      await chooseFilter(page, "done"); await waitUntil(() => page.execute("return document.querySelectorAll('.task-card').length===1"), "completed task remains available");
      await page.click('[data-task-action="reopen"]');
      await waitUntil(() => !source.state.tasks.get(taskId).done && page.execute("return !document.getElementById('task-dialog').open && document.querySelectorAll('.task-card').length===0"), "task can be reopened");
      assert.deepEqual(source.state.writes.map(write => write.body.expectedVersion), ["0", "1", "2", "3"]);
      assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"), true);
      await browserErrors(page, source);
    } finally { await page?.close(); await source.close(); }
  }
});

test("Chrome: a lost task acknowledgement retries one stable request and a conflict preserves the unsaved draft", { timeout: 90000 }, async () => {
  const source = await fixture({ uncertain: true }); let page;
  try {
    page = await openPage(source); await page.click("#new-task"); await page.type("#task-title", "Private synthetic request"); await page.click("#save-task");
    await waitUntil(() => page.execute("return !document.getElementById('task-uncertain').hidden && !document.getElementById('retry-task').disabled"), "task save is uncertain and retry is explicit");
    assert.equal(source.state.tasks.size, 1); assert.equal(source.state.writes.length, 1);
    assert.equal(await page.execute("return document.getElementById('task-fields').disabled"), true);
    await page.click("#retry-task");
    await waitUntil(() => source.state.writes.length === 2 && page.execute("return !document.getElementById('task-dialog').open && document.querySelectorAll('.task-card').length===1"), "retry acknowledges the same task");
    assert.deepEqual(source.state.writes[0], source.state.writes[1]); assert.equal(source.state.tasks.size, 1); assert.equal(source.state.commits.size, 1);
    await page.click('[data-task-action="edit"]'); await page.type("#task-title", "Keep this local draft");
    const taskId = [...source.state.tasks.keys()][0]; source.state.tasks.set(taskId, { ...source.state.tasks.get(taskId), title: "Saved on the other device", version: "2", updatedAt: Date.now() });
    await page.click("#save-task");
    await waitUntil(() => page.execute("return !document.getElementById('task-conflict').hidden && document.getElementById('saved-title').textContent==='Saved on the other device'"), "conflict exposes the saved task");
    assert.equal(await page.execute("return document.getElementById('task-title').value"), "Keep this local draft");
    assert.equal(source.state.tasks.get(taskId).title, "Saved on the other device");
    await page.click("#overwrite-task");
    await waitUntil(() => source.state.tasks.get(taskId).version === "3" && page.execute("return !document.getElementById('task-dialog').open"), "an explicit comparison choice saves against the current revision");
    assert.equal(source.state.tasks.get(taskId).title, "Keep this local draft");
    assert.deepEqual(source.state.writes.map(write => write.body.expectedVersion), ["0", "0", "1", "2"]);
    await browserErrors(page, source);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: hiding the page clears private task markup, same-owner resume preserves drafts and replacement accounts purge them", { timeout: 90000 }, async () => {
  const source = await fixture(); let page;
  const visibility = async value => { await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,value:arguments[0]});document.dispatchEvent(new Event('visibilitychange'))", value); };
  try {
    page = await openPage(source); await page.click("#new-task"); await page.type("#task-title", "Private unsaved owner-one title");
    await visibility("hidden");
    await waitUntil(() => page.execute("return document.getElementById('tasks-content').hidden && document.getElementById('task-title').value==='' && !document.getElementById('task-dialog').open"), "hidden page has no private draft in markup");
    await visibility("visible");
    await waitUntil(() => page.execute("return !document.getElementById('tasks-content').hidden"), "same-owner session resumes");
    assert.equal(await page.execute("return document.getElementById('task-title').value"), "Private unsaved owner-one title");
    await visibility("hidden"); source.state.owner = 2; await visibility("visible");
    await waitUntil(() => page.execute("return !document.getElementById('tasks-content').hidden && document.getElementById('task-title').value==='' && document.querySelectorAll('.task-card').length===0"), "new account cannot see the old task draft");
    assert.equal(source.state.writes.length, 0); assert.equal(await page.execute("return document.body.textContent.includes('Private unsaved owner-one title')"), false);
    assert.equal(await page.execute("return Object.keys(localStorage).length"), 0);
    await browserErrors(page, source);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: the common task view spans clients and paginates without truncating the private work list", { timeout: 60000 }, async () => {
  const source = await fixture(); let page;
  const now = Date.now();
  for (let number = 1; number <= 51; number += 1) source.state.tasks.set(id(number), { id: id(number), conversationId: number % 2 ? conversationId : id(101),
    clientName: number % 2 ? "Premier client synthétique" : "Second client synthétique", title: `Synthetic private task ${number}`, dueAt: number === 1 ? now - 3600000 : null,
    done: false, version: "1", createdAt: now - 60000, updatedAt: now - 60000 });
  try {
    page = await openPage(source, 390); await page.click("#all-clients");
    await waitUntil(() => page.execute("return !document.getElementById('tasks-content').hidden && document.querySelectorAll('.task-card').length===50 && !document.getElementById('more-tasks').hidden"), "bounded first page covers multiple clients");
    assert.equal(await page.execute("return document.getElementById('new-task').hidden"), true);
    assert.equal(await page.execute("return document.getElementById('task-list').textContent.includes('Premier client synthétique') && document.getElementById('task-list').textContent.includes('Second client synthétique')"), true);
    await page.click("#more-tasks");
    await waitUntil(() => page.execute("return document.querySelectorAll('.task-card').length===51 && document.getElementById('more-tasks').hidden"), "last task is accessible on the next page");
    assert.equal(await page.execute("return new Set([...document.querySelectorAll('.task-card')].map(card=>card.dataset.taskId)).size"), 51);
    await chooseFilter(page, "due");
    await waitUntil(() => page.execute("return document.querySelectorAll('.task-card').length===1 && document.getElementById('task-list').textContent.includes('Synthetic private task 1')"), "common due filter preserves only actionable deadlines");
    assert.equal(source.state.writes.length, 0); await browserErrors(page, source);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: a CSRF refusal freezes an uncertain task until connection refresh and explicit retry", { timeout: 60000 }, async () => {
  const source = await fixture(); source.state.postDenied = 403; let page;
  try {
    page = await openPage(source); await page.click("#new-task"); await page.type("#task-title", "Synthetic request after connection refresh"); await page.click("#save-task");
    await waitUntil(() => page.execute("return !document.getElementById('task-uncertain').hidden && document.getElementById('retry-task').disabled && !document.getElementById('reload').hidden"), "CSRF rejection requires refreshing the connection");
    assert.equal(source.state.tasks.size, 0); assert.equal(source.state.writes.length, 1);
    assert.equal(await page.execute("return document.getElementById('task-title').value"), "Synthetic request after connection refresh");
    await page.click("#close-task"); source.state.postDenied = null; await page.click("#reload");
    await waitUntil(() => page.execute("return !document.getElementById('tasks-content').hidden && !document.getElementById('new-task').disabled && document.getElementById('reload').hidden"), "the same session is checked again before resuming");
    assert.equal(source.state.writes.length, 1, "refresh alone does not resubmit a task");
    await page.click("#new-task"); await page.click("#retry-task");
    await waitUntil(() => source.state.tasks.size === 1 && page.execute("return !document.getElementById('task-dialog').open"), "the original request is explicitly resumed");
    assert.deepEqual(source.state.writes[0], source.state.writes[1]); await browserErrors(page, source);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: a list read begun before a save cannot restore the old private task after the mutation", { timeout: 60000 }, async () => {
  const source = await fixture(); let page;
  const now = Date.now(), taskId = id(1);
  source.state.tasks.set(taskId, { id: taskId, conversationId, clientName: "Client synthétique", title: "Older persisted task title", dueAt: null, done: false, version: "1", createdAt: now - 60000, updatedAt: now - 60000 });
  try {
    page = await openPage(source); await waitUntil(() => page.execute("return document.querySelectorAll('.task-card').length===1"), "initial task loaded");
    source.state.holdLists = true; await page.click("#refresh-tasks");
    await waitUntil(() => source.state.pendingLists.length === 1, "old list snapshot is held before a mutation");
    await page.click('[data-task-action="edit"]'); await page.type("#task-title", "Newly committed task title"); source.state.holdLists = false;
    await page.click("#save-task");
    await waitUntil(() => source.state.tasks.get(taskId).version === "2" && page.execute("return !document.getElementById('task-dialog').open && document.getElementById('task-list').textContent.includes('Newly committed task title')"), "save refreshes the list without waiting for its obsolete read");
    const baseline = await page.execute("return window.__taskResponses.length");
    source.state.pendingLists[0]();
    await waitUntil(() => page.execute("if(window.__taskCancelled.includes('/api/admin/crm/tasks'))return true;const responses=window.__taskResponses.slice(arguments[0]);const index=responses.findIndex(item=>item.path==='/api/admin/crm/tasks'&&item.data.tasks?.[0]?.title==='Older persisted task title');return index>=0&&responses.slice(index+1).some(item=>item.path==='/api/auth/session')", baseline), "obsolete list response is cancelled or its final account proof settles");
    assert.equal(await page.execute("return document.getElementById('task-list').textContent.includes('Newly committed task title') && !document.getElementById('task-list').textContent.includes('Older persisted task title')"), true);
    await browserErrors(page, source);
  } finally { await page?.close(); await source.close(); }
});
