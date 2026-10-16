import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/session-clock.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { scheduleSessionCheck } = context.JessieSessionClock;

function scheduler(now = 1000000) {
  const timers = [];
  const cleared = [];
  return { timers, cleared, options: {
    clock: () => now,
    setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeoutFn: (id) => cleared.push(id)
  } };
}

test("a 180-day session checks again in five minutes without overflowing a browser timer", () => {
  const fake = scheduler();
  let checks = 0;
  scheduleSessionCheck(1000000 + 180 * 86400000, () => { checks += 1; }, fake.options);
  assert.equal(fake.timers[0].delay, 300000);
  assert.equal(checks, 0);
  fake.timers[0].callback();
  assert.equal(checks, 1);
  fake.timers[0].callback();
  assert.equal(checks, 1, "a timer must only trigger one server check");
  assert.equal(fake.timers.length, 1, "the caller decides how to handle the server response");
});

test("a nearby or expired deadline schedules a bounded recheck without a tight retry loop", () => {
  for (const [expiry, expected] of [[1002500, 2500], [1000010, 1000], [999000, 1000]]) {
    const fake = scheduler();
    scheduleSessionCheck(expiry, () => {}, fake.options);
    assert.equal(fake.timers[0].delay, expected);
  }
});

test("cancelling a hidden page's check is idempotent and ignores an already queued callback", () => {
  const fake = scheduler();
  let checks = 0;
  const cancel = scheduleSessionCheck(2000000, () => { checks += 1; }, fake.options);
  cancel(); cancel(); fake.timers[0].callback();
  assert.deepEqual(fake.cleared, [1]);
  assert.equal(checks, 0);
});

test("invalid clocks and timer bounds cannot turn into an immediate session loop", () => {
  for (const expiresAt of [NaN, Infinity, -1, "2000000", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => scheduleSessionCheck(expiresAt, () => {}, scheduler().options), /Invalid session check/);
  }
  for (const maxDelayMs of [0, 999, Infinity, 2147483648]) {
    assert.throws(() => scheduleSessionCheck(2000000, () => {}, { ...scheduler().options, maxDelayMs }), /Invalid session check/);
  }
  assert.throws(() => scheduleSessionCheck(2000000, () => {}, { ...scheduler().options, clock: () => NaN }), /Invalid session clock/);
});
