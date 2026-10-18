import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";
import { spawnWebDriverProcess } from "./browser/webdriver.mjs";

const supported = process.platform === "linux";

function ready(child) {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => finish(new Error("Synthetic process did not become ready")), 10000);
    const finish = (error, value) => {
      clearTimeout(timer); child.stdout.off("data", data); child.off("error", failed);
      if (error) reject(error); else resolve(value);
    };
    const failed = () => finish(new Error("Synthetic process did not start"));
    const data = (chunk) => {
      text += chunk.toString();
      if (text.length > 4096) return failed();
      const line = text.split("\n")[0];
      if (!text.includes("\n")) return;
      try {
        const value = JSON.parse(line);
        if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return failed();
        finish(null, value);
      } catch { failed(); }
    };
    child.stdout.on("data", data); child.once("error", failed);
  });
}

function reachable(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.once("connect", () => done(true)); socket.once("error", () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

function syntheticDriver({ parentExits = false, ignoreTerm = false } = {}) {
  const descendant = `
    import { createServer } from 'node:net';
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}
    const server = createServer(socket => socket.end());
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `;
  const source = `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(descendant)}],
      { stdio: ['ignore', process.stdout, process.stderr, 'ipc'] });
    child.once('error', () => process.exit(2));
    child.once('message', value => {
      process.stdout.write(JSON.stringify(value) + '\\n', () => {
        ${parentExits ? "process.exit(0);" : ""}
      });
    });
  `;
  return spawnWebDriverProcess(process.execPath, ["--input-type=module", "-e", source]);
}

test("WebDriver teardown kills its own TERM-resistant descendant without a session id and preserves another owned group", {
  skip: !supported, timeout: 20000,
}, async () => {
  const owner = syntheticDriver({ ignoreTerm: true }), other = syntheticDriver();
  try {
    const [created, unrelated] = await Promise.all([ready(owner.child), ready(other.child)]);
    assert.equal(await reachable(created.port), true);
    assert.equal(await reachable(unrelated.port), true);
    const started = Date.now(), closing = owner.close();
    assert.equal(owner.close(), closing, "concurrent cleanup shares the same operation");
    await closing;
    assert.ok(Date.now() - started < 7000, "teardown stays within its bounded TERM/KILL budget");
    assert.equal(await reachable(created.port), false, "the descendant server stops even though TERM was ignored");
    assert.equal(owner.child.stdout.destroyed, true);
    assert.equal(owner.child.stderr.destroyed, true);
    assert.equal(await reachable(unrelated.port), true, "cleanup targets no other process group");
  } finally {
    const cleaned = await Promise.allSettled([owner.close(), other.close()]);
    assert.deepEqual(cleaned.map((result) => result.status), ["fulfilled", "fulfilled"], "both owned groups are cleaned up");
  }
});

test("WebDriver teardown still closes descendants and inherited pipes after the driver has already exited", {
  skip: !supported, timeout: 15000,
}, async () => {
  const owner = syntheticDriver({ parentExits: true });
  try {
    const exit = new Promise((resolve) => owner.child.once("exit", resolve));
    const created = await ready(owner.child);
    await exit;
    assert.equal(await reachable(created.port), true, "the descendant outlives its parent before teardown");
    assert.equal(owner.child.stdout.destroyed, false, "the descendant retains the output pipe");
    await owner.close();
    assert.equal(await reachable(created.port), false);
    assert.equal(owner.child.stdout.destroyed, true);
    assert.equal(owner.child.stderr.destroyed, true);
  } finally { await owner.close(); }
});

test("WebDriver teardown handles a failed spawn without signalling an absent process id", { timeout: 5000 }, async () => {
  const owner = spawnWebDriverProcess("/jessiemessage-test-no-such-executable", []);
  await new Promise((resolve) => owner.child.once("error", resolve));
  await owner.close();
  assert.equal(owner.child.pid, undefined);
  assert.equal(owner.child.stdout.destroyed, true);
  assert.equal(owner.child.stderr.destroyed, true);
});
