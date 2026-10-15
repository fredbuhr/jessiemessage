import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const secret = "synthetic backup phrase — five words";
const args = ["--private-directory", "/synthetic/private", "--output", "synthetic.json.gpg"];

test("private-secret capture refuses noninteractive input without exposing it", () => {
  const result = spawnSync("bash", ["scripts/capture-private-secrets.sh", ...args], {
    encoding: "utf8", input: secret, timeout: 5000,
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^PRIVATE_SECRETS_TTY:/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
});

test("personal backup capture checks first, masks both entries and never exports or appends the phrase", async (t) => {
  const directory = await mkdtemp(path.join(process.cwd(), ".jm-secrets-capture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin"); await mkdir(bin);
  const probe = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    assert.equal(Boolean(process.env.CI), false, "CI requires the Python PTY driver");
    t.skip("Python PTY driver unavailable"); return;
  }
  assert.equal(probe.status, 0); const python = probe.stdout.trim();
  await writeFile(path.join(bin, "node"), `#!${python}\nimport json, os, sys\nexpected=${JSON.stringify(secret)}\nif len(sys.argv)>2 and sys.argv[2]=='check':\n if sys.argv[3:]!=${JSON.stringify(args)}: print('PRIVATE_SECRETS_USAGE'); sys.exit(2)\n print('CHECK_READY'); sys.exit(0)\nsource=sys.stdin.buffer.read()\nprint(json.dumps({'stdinExact':source==expected.encode('utf-8'),'argumentLeak':expected in ' '.join(sys.argv),'environmentLeak':any(expected in v for v in os.environ.values()),'nodeOverridesAbsent':'NODE_OPTIONS' not in os.environ and 'NODE_PATH' not in os.environ}))\n`, { mode: 0o700 });
  const driver = `import errno, json, os, pty, select, subprocess, sys, time
try: master, slave=pty.openpty()
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
   if b'Phrase du coffre,' in output and sent==0:
    os.write(master,secret.encode('utf-8')+b'\\n'); sent=1
   if b'Confirmer la phrase du coffre' in output and sent==1:
    os.write(master,b'\\x04' if mode=='cancel' else (secret if mode=='match' else 'different synthetic phrase').encode('utf-8')+b'\\n'); sent=2
  if child.poll() is not None and not ready: break
finally:
 if child.poll() is None: child.kill()
 status=child.wait(); os.close(master)
print(json.dumps({'status':status,'sent':sent,'output':output.decode('utf-8','replace')}))`;
  for (const mode of ["match", "mismatch", "cancel", "invalid"]) {
    const selected = mode === "invalid" ? [...args, "--password", "forbidden"] : args;
    const result = spawnSync(python, ["-c", driver, JSON.stringify(["bash", "scripts/capture-private-secrets.sh", ...selected]), JSON.stringify(secret), mode], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, JM_SECRETS_PASSWORD: secret,
        JM_SECRETS_CONFIRMATION: secret, NODE_OPTIONS: "--trace-warnings", NODE_PATH: "synthetic-unused" },
    });
    assert.equal(result.status, 0, result.stderr); const observed = JSON.parse(result.stdout);
    if (observed.unavailable) {
      assert.equal(Boolean(process.env.CI), false, "CI requires usable PTY devices");
      t.skip("PTY devices unavailable"); return;
    }
    assert.equal(observed.output.includes(secret), false, observed.output);
    if (mode === "match") {
      assert.equal(observed.status, 0, observed.output); assert.equal(observed.sent, 2);
      assert.match(observed.output, /"stdinExact": true, "argumentLeak": false, "environmentLeak": false, "nodeOverridesAbsent": true/);
    } else {
      assert.equal(observed.status, mode === "invalid" ? 2 : 1, observed.output);
      assert.equal(observed.output.includes("stdinExact"), false);
      if (mode === "invalid") assert.equal(observed.sent, 0);
      assert.match(observed.output, mode === "mismatch" ? /PRIVATE_SECRETS_MISMATCH/ : mode === "cancel" ? /PRIVATE_SECRETS_CANCELLED/ : /PRIVATE_SECRETS_USAGE/);
    }
  }
});
