import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../scripts/preflight.mjs";
import { PLATFORM_CHECK_NAMES } from "../server/preflight/platform.mjs";

test("platform CLI passes only the explicitly selected private path mode from its own environment", async () => {
  for (const mode of [undefined, "strict", "linux-dirfd"]) {
    let received;
    const result = await main(["platform", "--offline", "--scratch", "/private/probe"],
      mode === undefined ? {} : { JESSIEMESSAGE_PRIVATE_PATH_MODE: mode }, {
        inspectPlatform: async (options) => {
          received = options;
          return { valid: true, checks: PLATFORM_CHECK_NAMES.map((name) => ({ name, status: "pass" })) };
        },
      });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(received, { scratch: "/private/probe", mediaRoot: null,
      ...(mode === "linux-dirfd" ? { pathMode: mode } : {}) });
  }
});

test("an unknown private path mode stops the platform CLI before any probe and is sanitized", async () => {
  let called = false;
  const result = await main(["platform", "--offline"], { JESSIEMESSAGE_PRIVATE_PATH_MODE: "synthetic-private-invalid" }, {
    inspectPlatform: async () => { called = true; throw Error("not expected"); },
  });
  assert.equal(called, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.error, "PREFLIGHT_OPERATION");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-invalid/);
});
