import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const user = "synthetic-smtp-user", password = "synthetic SMTP password ' $() —";
const args = ["--private-directory", "/synthetic/private", "--private-path-mode", "linux-dirfd", "--smtp-host", "smtp.example.invalid", "--smtp-port", "587"];

test("SMTP capture requires a personal interactive terminal and rejects piped secrets without printing them", () => {
  const result = spawnSync("bash", ["scripts/capture-messaging.sh", ...args], { encoding: "utf8", input: `${user}\n${password}`, timeout: 5000 });
  assert.equal(result.status, 2); assert.equal(result.stdout, ""); assert.match(result.stderr, /^MESSAGING_CAPTURE_TTY:/);
  assert.equal(result.stderr.includes(password), false);
});

test("SMTP capture checks first, masks all personal entries and never sends credentials through argv/environment", async (t) => {
  const directory = await mkdtemp(path.join(process.cwd(), ".jm-messaging-capture-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin"); await mkdir(bin);
  const probe = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { assert.equal(Boolean(process.env.CI), false, "CI requires the Python PTY driver"); t.skip("Python unavailable"); return; }
  assert.equal(probe.status, 0); const python = probe.stdout.trim();
  await writeFile(path.join(bin, "node"), `#!${python}\nimport json,os,sys\nuser=${JSON.stringify(user)}\npassword=${JSON.stringify(password)}\nif len(sys.argv)>2 and sys.argv[2]=='check':\n if sys.argv[3:]!=${JSON.stringify(args)}: print('INPUT_BLOCKED'); sys.exit(2)\n print('CHECK_READY'); sys.exit(0)\nsource=sys.stdin.buffer.read()\nprint(json.dumps({'stdinExact':source==(user+'\\n'+password).encode('utf-8'),'argumentLeak':any(s in ' '.join(sys.argv) for s in [user,password]),'environmentLeak':any(s in v for s in [user,password] for v in os.environ.values()),'nodeOverridesAbsent':'NODE_OPTIONS' not in os.environ and 'NODE_PATH' not in os.environ}))\n`, { mode: 0o700 });
  const driver = `import errno,json,os,pty,select,subprocess,sys,time
try: master,slave=pty.openpty()
except OSError: print(json.dumps({'unavailable':True})); sys.exit(0)
argv=json.loads(sys.argv[1]); user=json.loads(sys.argv[2]); password=json.loads(sys.argv[3]); mode=sys.argv[4]
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
   if b'Identifiant SMTP' in output and sent==0: os.write(master,user.encode('utf-8')+b'\\n'); sent=1
   if b'Mot de passe SMTP' in output and sent==1: os.write(master,password.encode('utf-8')+b'\\n'); sent=2
   if b'Confirmer le mot de passe SMTP' in output and sent==2: os.write(master,(password if mode=='match' else 'different').encode('utf-8')+b'\\n'); sent=3
  if child.poll() is not None and not ready: break
finally:
 if child.poll() is None: child.kill()
 status=child.wait(); os.close(master)
print(json.dumps({'status':status,'sent':sent,'output':output.decode('utf-8','replace')}))`;
  for (const mode of ["match", "mismatch", "invalid"]) {
    const selected = mode === "invalid" ? [...args, "--password", "forbidden"] : args;
    const result = spawnSync(python, ["-c", driver, JSON.stringify(["bash", "scripts/capture-messaging.sh", ...selected]), JSON.stringify(user), JSON.stringify(password), mode], {
      encoding: "utf8", timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: "--trace-warnings", NODE_PATH: "synthetic-unused",
        JM_MESSAGING_SMTP_USER: user, JM_MESSAGING_SMTP_PASSWORD: password, JM_MESSAGING_SMTP_CONFIRMATION: password },
    });
    assert.equal(result.status, 0, result.stderr); const observed = JSON.parse(result.stdout);
    if (observed.unavailable) { assert.equal(Boolean(process.env.CI), false, "CI requires usable PTY devices"); t.skip("PTY unavailable"); return; }
    assert.equal(observed.output.includes(password), false, observed.output); assert.equal(observed.output.includes(user), false, observed.output);
    if (mode === "match") {
      assert.equal(observed.status, 0, observed.output); assert.equal(observed.sent, 3);
      assert.match(observed.output, /"stdinExact": true, "argumentLeak": false, "environmentLeak": false, "nodeOverridesAbsent": true/);
    } else {
      assert.equal(observed.status, mode === "invalid" ? 2 : 1, observed.output);
      assert.equal(observed.output.includes("stdinExact"), false); if (mode === "invalid") assert.equal(observed.sent, 0);
    }
  }
});
