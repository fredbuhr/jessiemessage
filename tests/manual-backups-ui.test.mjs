import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { harness, html, catalogue, controller, archive, backupRequest, snapshot, response, flush } from "./helpers/manual-backups-ui.mjs";

const posts = f => f.calls.filter(call => call.options.method === "POST");
test("manual backup interface translates every static label and exposes only the requested simple controls", () => {
  const dictionary = {}; vm.runInNewContext(catalogue, { JessieI18n: { register: value => Object.assign(dictionary, value) } });
  for (const match of html.matchAll(/data-jm-i18n(?:-aria-label|-title|-placeholder)?="([^"]*)"/g)) assert.equal(typeof dictionary[match[1]], "string", match[1]);
  assert.doesNotMatch(html, /Windows|PC|GPG|quotidienne|destination|calendrier|récurrence|restaur/);
  assert.doesNotMatch(controller, /\.blob\(|createObjectURL|localStorage|sessionStorage/);
});
test("opening and translating the page makes no capture; explicit creation submits a single CSRF protected identifier", async () => {
  let input = snapshot(); const f = await harness({ summary: () => response(input), post(path, options) {
    input = snapshot(backupRequest(JSON.parse(options.body).requestId)); return response({ version: 1, mode: "manual", request: input.request }, 202);
  } });
  assert.equal(f.get("backup-content").hidden, false); assert.equal(posts(f).length, 0);
  f.language("en"); assert.equal(f.get("create-backup").textContent, "Create a backup");
  await f.click("create-backup"); await f.click("create-backup");
  assert.equal(posts(f).length, 1); assert.match(JSON.parse(posts(f)[0].options.body).requestId, /^[0-9a-f]{32}$/);
  assert.equal(posts(f)[0].options.headers["X-CSRF-Token"], "A".repeat(43));
  assert.equal(f.get("create-backup").disabled, true); assert.equal(f.get("capture-state").textContent, "Backup request queued.");
  assert.ok(f.writes.every(([key]) => key === "jessiemessage.language"));
});
test("a lost acknowledgement polls durable state without replaying and offers the completed encrypted archive", async () => {
  let input = snapshot(), submitted;
  const f = await harness({ summary: () => response(input), post(path, options) { submitted = JSON.parse(options.body).requestId; input = snapshot(backupRequest(submitted, "running")); throw new TypeError("connection closed"); } });
  await f.click("create-backup"); assert.match(f.get("backup-status").textContent, /pas encore confirmé/); assert.equal(f.get("backup-content").hidden, true);
  await f.tick(); assert.equal(f.get("capture-state").textContent, "Sauvegarde en cours. La messagerie peut être momentanément indisponible.");
  input = snapshot(backupRequest(submitted, "complete"), archive()); await f.tick();
  assert.equal(f.get("capture-state").textContent, "Sauvegarde terminée."); assert.equal(f.get("download-backup").hidden, false); assert.equal(f.get("create-backup").disabled, false); assert.equal(posts(f).length, 1);
  await f.click("download-backup");
  assert.deepEqual(f.downloads, [{ href: `/api/admin/backups/archives/${archive().id}`, filename: archive().filename }]);
  assert.equal(f.calls.at(-1).path, "/api/auth/session", "the session is revalidated just before native download navigation");
});
test("an unconfirmed request keeps its identifier for an explicit retry after GET proves there is no durable receipt", async () => {
  let count = 0; const f = await harness({ post(path, options) { if (++count === 1) throw new TypeError("offline"); return response({ version: 1, mode: "manual", request: backupRequest(JSON.parse(options.body).requestId) }, 202); } });
  await f.click("create-backup"); await f.tick(); assert.equal(f.get("create-backup").textContent, "Réessayer la demande");
  await f.online(); assert.equal(posts(f).length, 1);
  await f.click("create-backup"); assert.equal(posts(f).length, 2); assert.equal(posts(f)[0].options.body, posts(f)[1].options.body);
});
test("an explicit retry that discovers completion reads the result without requesting another capture", async () => {
  let input = snapshot(), submitted; const f = await harness({ summary: () => response(input), post(path, options) { submitted = JSON.parse(options.body).requestId; throw new TypeError("offline"); } });
  await f.click("create-backup"); await f.tick(); input = snapshot(backupRequest(submitted, "complete"), archive());
  await f.click("create-backup"); assert.equal(posts(f).length, 1); assert.equal(f.get("capture-state").textContent, "Sauvegarde terminée.");
});
test("visibility hides private dates and the pending POST is not replayed on return", async () => {
  let release; const pending = new Promise(resolve => { release = resolve; }); let submitted;
  const f = await harness({ summary: snapshot(null, archive()), post(path, options) { submitted = JSON.parse(options.body).requestId; return pending; } });
  await f.click("create-backup"); await f.visibility("hidden"); f.language("en");
  assert.equal(f.get("backup-content").hidden, true); assert.equal(f.get("archive-details").textContent, ""); assert.equal(f.get("capture-state").textContent, "");
  f.setSummary(snapshot(backupRequest(submitted, "running"), archive())); await f.visibility("visible");
  release(response({ version: 1, mode: "manual", request: backupRequest(submitted) }, 202)); await flush();
  assert.equal(posts(f).length, 1); assert.equal(f.get("create-backup").disabled, true); assert.match(f.get("capture-state").textContent, /Backup in progress/);
});
test("transient server interruption while running never claims the capture failed and reconnects by GET only", async () => {
  const f = await harness({ summary: snapshot(backupRequest(undefined, "running"), archive()) });
  f.setSummary(() => response({ error: "backups_unavailable" }, 503)); await f.tick();
  assert.equal(f.get("backup-content").hidden, true); assert.match(f.get("backup-status").textContent, /connexion est momentanément indisponible/);
  assert.equal(f.get("backup-status").classList.contains("is-error"), false);
  f.setSummary(snapshot(backupRequest(undefined, "complete"), archive())); await f.tick(); assert.equal(f.get("download-backup").hidden, false); assert.equal(posts(f).length, 0);
});
test("replacement administrator proof suppresses an old download and clears previous request state", async () => {
  const f = await harness({ summary: snapshot(backupRequest(undefined, "complete"), archive()) });
  f.setSession({ ...f.session(), csrf: "B".repeat(43) }); await f.click("download-backup");
  assert.equal(f.downloads.length, 0); assert.match(f.get("backup-status").textContent, /session a changé/); assert.equal(posts(f).length, 0);
});
test("a client session cannot expose administrator backup content or request a capture", async () => {
  const f = await harness({ auth: session => response({ ...session, user: { ...session.user, role: "client" } }) });
  assert.equal(f.get("backup-content").hidden, true); assert.equal(f.calls.some(call => call.path === "/api/admin/backups"), false);
  assert.deepEqual(f.redirects, ["/admin/login?continue=%2Fadmin%2Fbackups"]); assert.equal(posts(f).length, 0);
});
for (const [code, text] of [["EXPIRED", /expiré/], ["INTERRUPTED", /interrompue/], ["PREFLIGHT_FAILED", /préparation a échoué/], ["CAPTURE_FAILED", /n’a pas abouti/], ["CANCELLED", /annulée/]]) test(`durable failure ${code} has a simple explanation and retains the previous archive`, async () => {
  const f = await harness({ summary: snapshot(backupRequest(undefined, "failed", code), archive()) });
  assert.match(f.get("capture-state").textContent, text); assert.equal(f.get("create-backup").disabled, false); assert.equal(f.get("download-backup").hidden, false);
  f.language("en"); assert.doesNotMatch(f.get("capture-state").textContent, new RegExp(code)); assert.equal(posts(f).length, 0);
});
test("an invalid archive path is rejected before any private result or download is exposed", async () => {
  const f = await harness({ summary: snapshot(null, { ...archive(), id: "../../private" }) });
  assert.equal(f.get("backup-content").hidden, true); assert.equal(f.get("download-backup").hidden, true); assert.equal(f.downloads.length, 0);
});
