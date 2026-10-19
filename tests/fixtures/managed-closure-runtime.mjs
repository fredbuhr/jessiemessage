import { fork } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { createManagedRuntime } from "../../server/backup/managed-runtime.mjs";

/** Real IPC shim, HTTP listener, active request and producer drain. All data is
 * disposable and local; no application credentials or transport is loaded. */
export async function managedClosureFixture(t, directory, { accountClosures = true } = {}) {
  const probe = createServer(); await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const file = path.join(directory, "synthetic-child.mjs"), marker = path.join(directory, "synthetic-events.txt");
  await writeFile(marker, "", { mode: 0o600 });
  const shim = new URL("../../scripts/private-messaging-child.mjs", import.meta.url).href;
  const lifecycle = new URL("../../server/lifecycle.mjs", import.meta.url).href;
  await writeFile(file, `
import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { run, parseArguments } from ${JSON.stringify(shim)};
import { createShutdown } from ${JSON.stringify(lifecycle)};
const marker=${JSON.stringify(marker)}, port=${port};
const pending=new Set(); const record=text=>{const p=appendFile(marker,text+'\\n');pending.add(p);p.finally(()=>pending.delete(p));return p;};
await run(parseArguments(process.argv.slice(2)),{loadRuntime:async()=>({
 async main(args, options){await options.startServer({PORT:String(port)},{});},
 async start(env, options){
  if(Boolean(options.accountClosures)!==${accountClosures})throw new Error('Unexpected managed closure capability');
  let requestCount=0, waiting=[];
  const server=createServer((req,res)=>{
   if(req.url==='/api/ready'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ready"}');return;}
   requestCount++;res.writeHead(200);res.write('started');
   setTimeout(async()=>{await record('request-finished');res.end('done');requestCount--;if(!requestCount){for(const fn of waiting)fn();waiting=[];}},120);
  });
  server.waitForRequests=()=>requestCount?new Promise(resolve=>waiting.push(resolve)):Promise.resolve();
  let timer=setInterval(()=>void record('producer'),10), stopping;
  const mailWorker={stop(){if(!stopping){clearInterval(timer);stopping=Promise.all([...pending]).then(()=>record('producer-stopped'));}return stopping;},async close(){await stopping;await record('transport-closed');},async abort(){}};
  await new Promise(done=>server.listen(port,'127.0.0.1',done));
  return {drain:createShutdown({server,mailWorker,pool:{async end(){await record('pool-closed');}},diagnostics:{async close(){await record('diagnostics-closed');}},graceMilliseconds:1000,deadlineMilliseconds:2500})};
 }
})});
`, { mode: 0o600 });
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("JESSIEMESSAGE_")
    && !["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"].includes(name)));
  const children = [], runtime = createManagedRuntime({ runtimeDirectory: "/synthetic-reviewed-runtime", privateDirectory: "/synthetic-private-config",
    operationsDirectory: directory, accountClosures, port, environment: { ...environment, PORT: String(port), JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" } },
  { startupMilliseconds: 4000, stopMilliseconds: 3500, forkClient(_shim, args, settings) { const child = fork(file, args, settings); children.push(child); return child; } });
  t.after(async () => { await runtime.destroy(); for (const child of children) { try { child.kill("SIGKILL"); } catch {} } });
  return { runtime, marker, children, origin: `http://127.0.0.1:${port}` };
}
