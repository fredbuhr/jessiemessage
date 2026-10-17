import test from "node:test";
import assert from "node:assert/strict";
import { fork, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(new URL("../scripts/private-checkpoint-child.mjs", import.meta.url));
const wrapperUrl = new URL("../scripts/private-checkpoint-child.mjs", import.meta.url).href;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function fixture(t, source) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "checkpoint-ipc-")), file = join(directory, "fixture.mjs"), receipt = join(directory, "cleanup.json");
  await writeFile(file, `import {run} from ${JSON.stringify(wrapperUrl)}; import {writeFile} from 'node:fs/promises';\n${source.replaceAll("CLEANUP_RECEIPT", JSON.stringify(receipt))}`);
  const child = fork(file, [], { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
  const events = [];
  child.on("message", value => events.push(value));
  const exited = new Promise(resolveExit => child.once("exit", (exitCode, signal) => resolveExit({ exitCode, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; await rm(directory, { recursive: true, force: true }); });
  const waitFor = async type => { const until = Date.now() + 2000; while (!events.some(value => value.type === type)) { assert.ok(Date.now() < until, `child reached ${type}`); await sleep(5); } };
  return { child, exited, receipt, events, waitFor, output: () => ({ stdout, stderr }) };
}
const outcome = `catch(error){if(error.code!=='PRIVATE_CHECKPOINT_CHILD')throw error;process.exitCode=1;}`;

test("successful capture receives unchanged arguments and a live AbortSignal, then exits zero without an open IPC channel", async t => {
  const f = await fixture(t, `try { const result=await run(['capture-application','--offline','--profile','photos-notify-recovery-crm-broadcast'],{async loadMain(){return async(args,{signal})=>{
    if(!(signal instanceof AbortSignal)||signal.aborted)throw Error('bad signal');
    await writeFile(CLEANUP_RECEIPT,JSON.stringify({args,calls:1,cleaned:true}));return {status:'application_checkpoint_saved'};
  };}}); if(result.status!=='application_checkpoint_saved')throw Error('bad result'); } ${outcome}`);
  assert.deepEqual(await f.exited, { exitCode: 0, signal: null });
  assert.deepEqual(JSON.parse(await readFile(f.receipt, "utf8")), { args: ["capture-application", "--offline", "--profile", "photos-notify-recovery-crm-broadcast"], calls: 1, cleaned: true });
});

for (const action of ["SIGTERM", "SIGINT", "disconnect"]) {
  test(`${action} aborts an actual child operation, waits for its cleanup and exits unsuccessfully`, { timeout: 3000 }, async t => {
    const f = await fixture(t, `try { await run(['capture-application','--offline'],{async loadMain(){return async(args,{signal})=>{
      let release;const interrupted=new Promise(resolve=>{release=resolve;});signal.addEventListener('abort',release,{once:true});
      process.send({type:'capturing'});await interrupted;
      await new Promise(resolve=>setTimeout(resolve,80));await writeFile(CLEANUP_RECEIPT,JSON.stringify({aborted:signal.aborted,cleaned:true}));
      return {status:'application_checkpoint_saved'};
    };}}); } ${outcome}`);
    await f.waitFor("capturing");
    if (action === "disconnect") f.child.disconnect(); else f.child.kill(action);
    await sleep(20); assert.equal(f.child.exitCode, null); assert.equal(f.child.signalCode, null);
    assert.deepEqual(await f.exited, { exitCode: 1, signal: null });
    assert.deepEqual(JSON.parse(await readFile(f.receipt, "utf8")), { aborted: true, cleaned: true });
    assert.deepEqual(f.output(), { stdout: "", stderr: "" });
  });
}

test("cancellation during dynamic loading cannot start the checkpoint operation", async t => {
  const f = await fixture(t, `try { await run(['capture-application','--offline'],{async loadMain(){process.send({type:'loading'});await new Promise(resolve=>setTimeout(resolve,100));return async()=>{await writeFile(CLEANUP_RECEIPT,'unexpected');};}}); } ${outcome}`);
  await f.waitFor("loading"); f.child.kill("SIGTERM"); assert.deepEqual(await f.exited, { exitCode: 1, signal: null });
  await assert.rejects(readFile(f.receipt), { code: "ENOENT" });
});

test("private failures from dynamic loader or capture are replaced by the same closed error", async t => {
  for (const loader of ["throw Error('secret SQL password');", "return async()=>{throw Error('secret private file');};"]) {
    const f = await fixture(t, `try { await run(['capture-application','--offline'],{async loadMain(){${loader}}}); }catch(error){await writeFile(CLEANUP_RECEIPT,JSON.stringify({code:error.code,message:error.message,cause:error.cause}));process.exitCode=1;}`);
    assert.deepEqual(await f.exited, { exitCode: 1, signal: null });
    const result = JSON.parse(await readFile(f.receipt, "utf8"));
    assert.deepEqual(result, { code: "PRIVATE_CHECKPOINT_CHILD", message: "The managed private checkpoint was not confirmed." });
  }
});

test("production entry refuses execution without IPC before opening checkpoint configuration", async () => {
  await assert.rejects(promisify(execFile)(process.execPath, [wrapper, "capture-application", "--offline", "--private-directory", "/missing"], { timeout: 1000 }), error => error.code === 1
    && /^PRIVATE_CHECKPOINT_CHILD: The managed private checkpoint was not confirmed\.\n$/.test(error.stderr) && error.stdout === "");
});

test("production entry preserves the existing checkpoint parser and rejects unknown switches", async t => {
  const f = await fixture(t, `try { await run(['capture-application','--offline','--fixture','invalid']); }catch(error){process.stderr.write(error.code+'\\n');process.exitCode=1;}`);
  assert.deepEqual(await f.exited, { exitCode: 1, signal: null }); assert.equal(f.output().stderr, "PRIVATE_CHECKPOINT_CHILD\n");
});
