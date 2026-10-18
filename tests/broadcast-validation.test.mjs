import test from "node:test";
import assert from "node:assert/strict";
import { BroadcastInputError, validateId, validateVersion, validatePreview, validateCampaign, validatePayload } from "../server/broadcast/validation.mjs";

const first = "0123456789abcdef0123456789abcdef", last = "f".repeat(32);
const campaign = (changes = {}) => ({ clientCampaignId: "1".repeat(32), title: "Une diffusion privée", body: "Bonjour !", mediaId: null,
  allowRepeatMedia: false, conversationIds: [last, first], ...changes });
const invalid = (error) => error instanceof BroadcastInputError && error.code === "BROADCAST_INPUT";

test("broadcast identifiers and optimistic versions use canonical fixed byte and uint64 representations", () => {
  assert.deepEqual(validateId(first), Buffer.from(first, "hex"));
  for (const value of [undefined, null, 1, Buffer.from(first, "hex"), first.toUpperCase(), first.slice(1), `${first}0`, `${first}\n`, ` ${first}`, `${first} `, "g".repeat(32)]) {
    assert.throws(() => validateId(value), invalid);
  }
  for (const value of ["0", "1", "4294967296", "18446744073709551615"]) assert.equal(validateVersion(value), value);
  for (const value of [undefined, null, 0, 1, 1n, {}, [], "", "00", "01", "+1", "-1", "1.0", "1e2", " 1", "1 ", "1\n", "18446744073709551616", "999999999999999999999", "١"]) {
    assert.throws(() => validateVersion(value), invalid);
  }
});

test("broadcast selection is explicit, bounded, unique and canonically sorted without mutating input", () => {
  const input = { conversationIds: [last, first], mediaId: first };
  const copy = structuredClone(input);
  assert.deepEqual(validatePreview(input), { conversationIds: [Buffer.from(first, "hex"), Buffer.from(last, "hex")], mediaId: Buffer.from(first, "hex") });
  assert.deepEqual(input, copy);
  const hundred = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(32, "0"));
  assert.equal(validatePreview({ conversationIds: hundred, mediaId: null }).conversationIds.length, 100);
  for (const conversationIds of [undefined, null, {}, first, [], [first, first], [first.toUpperCase()], [Buffer.from(first, "hex")], Array(1), [first, ...Array(1)], [...hundred, last]]) {
    assert.throws(() => validatePreview({ conversationIds, mediaId: null }), invalid);
    assert.throws(() => validateCampaign(campaign({ conversationIds })), invalid);
  }
});

test("broadcast input requires every exact field and rejects inherited or executable objects", () => {
  const full = campaign();
  for (const name of Object.keys(full)) {
    const missing = { ...full }; delete missing[name];
    assert.throws(() => validateCampaign(missing), invalid);
  }
  for (const input of [undefined, null, [], "payload", { ...full, extra: true }, { ...full, [Symbol("hidden")]: true }, Object.create(full)]) {
    assert.throws(() => validateCampaign(input), invalid);
  }
  const getter = { ...full };
  Object.defineProperty(getter, "title", { enumerable: true, get() { throw new Error("Must not execute"); } });
  assert.throws(() => validateCampaign(getter), invalid);
  assert.throws(() => validatePreview({ conversationIds: [first], mediaId: null, extra: true }), invalid);
  assert.throws(() => validatePreview({ conversationIds: [first] }), invalid);
  assert.throws(() => validatePreview({ conversationIds: [first], mediaId: undefined }), invalid);
  assert.throws(() => validateCampaign(campaign({ allowRepeatMedia: 1 })), invalid);
});

test("broadcast titles preserve exact text while rejecting malformed, invisible and control content", () => {
  for (const title of ["  Été privé  ", "Cafe\u0301", "\ufeffDébut", "العربية 中文 🎉", "<b>Texte</b>", "界".repeat(80)]) {
    assert.equal(validateCampaign(campaign({ title })).title, title);
  }
  for (const title of [undefined, null, 1, {}, "", " ", "\u200b\u200d", "\ue000", "x\ud800", "x".repeat(81)]) {
    assert.throws(() => validateCampaign(campaign({ title })), invalid);
  }
  const controls = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127), ...Array.from({ length: 5 }, (_, i) => i + 0x202a), ...Array.from({ length: 4 }, (_, i) => i + 0x2066)];
  for (const control of controls) assert.throws(() => validateCampaign(campaign({ title: `a${String.fromCodePoint(control)}b` })), invalid);
});

test("broadcast plain text preserves existing chat semantics and maximum Unicode bodies", () => {
  for (const body of ["  Bonjour  ", "ligne\r\n\tfin", "e\u0301", "\ufeffDébut", "<script>texte</script>", "界".repeat(4096), "😀".repeat(2048)]) {
    assert.equal(validateCampaign(campaign({ body })).body, body);
  }
  for (const body of [undefined, null, false, 1, [], {}, "", " \t\n ", "\u200b\u200d", "x\ud800", "x\u0000", "x\u0080", "x".repeat(4097), "😀".repeat(2049)]) {
    assert.throws(() => validateCampaign(campaign({ body })), invalid);
  }
});

test("broadcast photo captions use existing chat caption validation including explicit empty text", () => {
  for (const body of ["", " Bonjour ", "ligne\nfin", "界".repeat(1000), "😀".repeat(500)]) {
    assert.equal(validateCampaign(campaign({ body, mediaId: first })).body, body);
  }
  for (const body of [undefined, null, false, 1, [], {}, "   ", "\u200b\u200d", "x\ud800", "x\u0000", "x".repeat(1001), "😀".repeat(501)]) {
    assert.throws(() => validateCampaign(campaign({ body, mediaId: first })), invalid);
  }
  for (const mediaId of [undefined, false, "", first.toUpperCase(), Buffer.from(first, "hex")]) {
    assert.throws(() => validateCampaign(campaign({ mediaId })), invalid);
  }
});

test("broadcast encrypted payload canonicalization excludes caller retry identity and retains exact content", () => {
  const { clientCampaignId, ...payload } = campaign();
  assert.deepEqual(validatePayload(payload), { title: payload.title, body: payload.body, mediaId: null, allowRepeatMedia: false, conversationIds: [first, last] });
  assert.throws(() => validatePayload({ clientCampaignId, ...payload }), invalid);
  assert.throws(() => validatePayload({ ...payload, mediaId: undefined }), invalid);
  assert.deepEqual(validatePayload({ ...payload, mediaId: first, body: "" }).mediaId, first);
});

test("broadcast input failures expose only a neutral stable error", () => {
  const secret = "Synthetic private marker\u0000";
  for (const attempt of [() => validateId(secret), () => validateVersion(secret), () => validateCampaign(campaign({ body: secret }))]) {
    assert.throws(attempt, (error) => {
      assert.ok(invalid(error));
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
      return true;
    });
  }
});
