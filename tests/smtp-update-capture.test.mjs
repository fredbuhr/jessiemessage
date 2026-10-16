import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("SMTP update capture masks both entries, checks first, preserves exact bytes and does not export secrets", async (t) => {
  const secret = " Synthetic SMTP 'quoted' $() — ";
  const args = ["--private-directory", "/synthetic/private", "--private-path-mode", "linux-dirfd"];
  const directory = await mkdtemp(path.join(process.cwd(), ".jm-smtp-update-capture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin"); await mkdir(bin);
  const probe = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { assert.equal(Boolean(process.env.CI), false); t.skip("Python unavailable"); return; }
  assert.equal(probe.status, 0); const python = probe.stdout.trim();
  await writeFile(path.join(bin, "node"), `#!${python}\nimport json,os,sys\nsecret=${JSON.stringify(secret)}\nif len(sys.argv)>2 and sys.argv[2]=='check':\n if sys.argv[3:]!=${JSON.stringify(args)}: print('INPUT_BLOCKED'); sys.exit(2)\n print('CHECK_READY'); sys.exit(0)\nsource=sys.stdin.buffer.read()\nprint(json.dumps({'stdinExact':source==secret.encode('utf-8'),'argumentLeak':secret in ' '.join(sys.argv),'environmentLeak':any(secret in v for v in os.environ.values()),'nodeOverridesAbsent':'NODE_OPTIONS' not in os.environ and 'NODE_PATH' not in os.environ}))\n`, { mode: 0o700 });
  const driver = `import errno,json,os,pty,select,subprocess,sys,time
try: master,slave=pty.openpty()
except OSError: print(json.dumps({'unavailable':True})); sys.exit(0)
argv=json.loads(sys.argv[1]); secret=json.loads(sys.argv[2]); mode=sys.argv[3]
child=subprocess.Popen(argv,stdin=slave,stdout=slave,stderr=slave,env=os.environ.copy()); os.close(slave)
output=b''; sent=0; limit=time.monotonic()+10
try:
 while time.monotonic()<limit:
  ready,_,_=select.select([master],[],[],.05)
  if ready:
   try: chunk=os.read(master,65536)
   except OSError as error:
    if error.errno==errno.EIO: break
    raise
   if not chunk: break
   output+=chunk
   if b'Nouveau mot de passe SMTP' in output and sent==0: os.write(master,secret.encode('utf-8')+b'\\n'); sent=1
   if b'Confirmer le mot de passe SMTP' in output and sent==1: os.write(master,b'\\x04' if mode=='cancel' else (secret if mode=='match' else 'different').encode('utf-8')+b'\\n'); sent=2
  if child.poll() is not None and not ready: break
finally:
 if child.poll() is None: child.kill()
 status=child.wait(); os.close(master)
print(json.dumps({'status':status,'sent':sent,'output':output.decode('utf-8','replace')}))`;
  for (const mode of ["match", "mismatch", "cancel", "invalid"]) {
    const selected = mode === "invalid" ? [...args, "--password", "forbidden"] : args;
    const result = spawnSync(python, ["-c", driver, JSON.stringify(["bash", "scripts/capture-smtp-update.sh", ...selected]), JSON.stringify(secret), mode], {
      encoding: "utf8", timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        NODE_OPTIONS: "--trace-warnings", NODE_PATH: "synthetic-unused", JM_SMTP_UPDATE_PASSWORD: secret, JM_SMTP_UPDATE_CONFIRMATION: secret },
    });
    assert.equal(result.status, 0, result.stderr); const observed = JSON.parse(result.stdout);
    if (observed.unavailable) { assert.equal(Boolean(process.env.CI), false, "CI requires usable PTY devices"); t.skip("PTY unavailable"); return; }
    assert.equal(observed.output.includes(secret), false);
    if (mode === "match") {
      assert.equal(observed.status, 0); assert.equal(observed.sent, 2);
      assert.match(observed.output, /"stdinExact": true, "argumentLeak": false, "environmentLeak": false, "nodeOverridesAbsent": true/);
    } else {
      assert.equal(observed.status, mode === "invalid" ? 2 : 1); assert.equal(observed.output.includes("stdinExact"), false);
      if (mode === "invalid") assert.equal(observed.sent, 0);
    }
  }
});
