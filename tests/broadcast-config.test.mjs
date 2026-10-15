import test from "node:test";
import assert from "node:assert/strict";
import { broadcastConfiguration, BroadcastConfigError } from "../server/broadcast/config.mjs";

test("broadcasts are opt in and disabled configuration ignores unused dependencies", () => {
  assert.deepEqual(broadcastConfiguration({}), { enabled: false });
  assert.deepEqual(broadcastConfiguration({ JESSIEMESSAGE_ENABLE_BROADCAST: "0", JESSIEMESSAGE_ENABLE_CRM: "invalid" }, { crmEnabled: "invalid" }), { enabled: false });
  assert.deepEqual(broadcastConfiguration({ JESSIEMESSAGE_ENABLE_BROADCAST: "1" }, { crmEnabled: true }), { enabled: true });
});

test("broadcast configuration accepts only exact flags and an explicitly enabled CRM", () => {
  for (const flag of ["", "true", "false", "01", "2", "1\n", " 1", 1, true, null]) {
    assert.throws(() => broadcastConfiguration({ JESSIEMESSAGE_ENABLE_BROADCAST: flag }, { crmEnabled: true }), { code: "BROADCAST_CONFIG" });
  }
  for (const crmEnabled of [undefined, false, "1", "true", 1, null]) {
    assert.throws(() => broadcastConfiguration({ JESSIEMESSAGE_ENABLE_BROADCAST: "1" }, { crmEnabled }), { code: "BROADCAST_CONFIG" });
  }
  assert.throws(() => broadcastConfiguration({ JESSIEMESSAGE_ENABLE_BROADCAST: "1" }), { code: "BROADCAST_CONFIG" });
});

test("broadcast configuration errors retain no private input", () => {
  const secret = "synthetic-private-setting";
  assert.throws(() => broadcastConfiguration({ JESSIEMESSAGE_ENABLE_BROADCAST: secret }), (error) => {
    assert.ok(error instanceof BroadcastConfigError);
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
    return true;
  });
});
