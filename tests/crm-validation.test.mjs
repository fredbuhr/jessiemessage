import test from "node:test";
import assert from "node:assert/strict";
import {
  CrmInputError, validateLabelName, validateNickname, validateNotes, validateSearch,
  validateId, validateVersion, validateLabelIds, validateReminder,
} from "../server/crm/validation.mjs";

const invalid = (error) => error instanceof CrmInputError && error.code === "CRM_INPUT";
const id = "0123456789abcdef0123456789abcdef";

test("CRM labels normalize names for display and compatibility/case-sensitive deduplication keys", () => {
  assert.deepEqual(validateLabelName("  VIP\u00a0\u3000France  "), { name: "VIP France", normalizedName: "vip france" });
  assert.deepEqual(validateLabelName("Cafe\u0301"), { name: "Café", normalizedName: "café" });
  assert.deepEqual(validateLabelName("ＶＩＰ"), { name: "ＶＩＰ", normalizedName: "vip" });
  assert.deepEqual(validateLabelName("ÉTÉ 🎉 العربية"), { name: "ÉTÉ 🎉 العربية", normalizedName: "été 🎉 العربية" });
  assert.deepEqual(validateLabelName("<b>client</b>"), { name: "<b>client</b>", normalizedName: "<b>client</b>" });
});

test("CRM names reject malformed, invisible, control and bidi-only inputs without echoing content", () => {
  for (const value of [undefined, null, [], {}, 1, Buffer.from("name"), "", "   ", "\u00a0\u3000", "\u200b\u200d", "\ue000", "a\ud800", "\udfff", "a\u202eb", "a\u2066b", "x\n", "x\r", "x\t"]) {
    assert.throws(() => validateLabelName(value), invalid);
  }
  for (const value of [undefined, null, [], {}, 1, Buffer.from("name"), "\u200b\u200d", "a\ud800", "a\u202eb", "a\u2066b", "x\n", "x\r", "x\t"]) {
    assert.throws(() => validateNickname(value), invalid);
  }
});

test("CRM names enforce their original and normalized length limits", () => {
  assert.equal(validateLabelName("x".repeat(64)).name.length, 64);
  assert.equal(validateNickname("界".repeat(64)), "界".repeat(64));
  assert.throws(() => validateLabelName("x".repeat(65)), invalid);
  assert.throws(() => validateNickname("x".repeat(65)), invalid);
  // One Arabic compatibility character expands to 18 code units under NFKC.
  assert.throws(() => validateLabelName("\ufdfa".repeat(8)), invalid);
  assert.equal(validateNickname(""), "");
  assert.equal(validateNickname("  \u00a0"), "");
  assert.equal(validateNickname("  Cafe\u0301 \u3000 Jess  "), "Café Jess");
});

test("CRM names reject every C0/C1/DEL and directional embedding/isolate control", () => {
  const controls = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127), ...Array.from({ length: 5 }, (_, i) => i + 0x202a), ...Array.from({ length: 4 }, (_, i) => i + 0x2066)];
  for (const control of controls) {
    const value = `a${String.fromCodePoint(control)}b`;
    assert.throws(() => validateLabelName(value), invalid);
    assert.throws(() => validateNickname(value), invalid);
    assert.throws(() => validateSearch(value), invalid);
  }
});

test("CRM notes preserve exact empty, whitespace, Unicode, newlines and literal markup", () => {
  for (const notes of ["", " \t\r\n ", "\u200b\ufeff", "  Notes privées  ", "é", "e\u0301", "\ufeffDébut", "العربية 中文 🎉", "a\u202eb", "<script>alert('literal')</script>"]) {
    assert.equal(validateNotes(notes), notes);
  }
});

test("CRM notes reject invalid strings and controls except tab/LF/CR", () => {
  for (const notes of [undefined, null, true, 1, {}, [], Buffer.from("notes"), "x\ud800", "\udfff"]) assert.throws(() => validateNotes(notes), invalid);
  const forbidden = [...Array.from({ length: 32 }, (_, i) => i).filter((i) => ![9, 10, 13].includes(i)), ...Array.from({ length: 33 }, (_, i) => i + 127)];
  for (const control of forbidden) assert.throws(() => validateNotes(`a${String.fromCodePoint(control)}b`), invalid);
});

test("CRM notes enforce 8000 JavaScript code units while preserving maximum multibyte content", () => {
  for (const notes of ["x".repeat(8000), "界".repeat(8000), "😀".repeat(4000)]) assert.equal(validateNotes(notes), notes);
  for (const notes of ["x".repeat(8001), "界".repeat(8001), "😀".repeat(4001)]) assert.throws(() => validateNotes(notes), invalid);
});

test("CRM searches trim and compose text while retaining literal percent, underscore and inner spaces", () => {
  assert.equal(validateSearch("  Cafe\u0301 %_  Jess  "), "Café %_  Jess");
  assert.equal(validateSearch("  "), "");
  assert.equal(validateSearch("界".repeat(80)), "界".repeat(80));
  for (const value of [null, 1, {}, "x".repeat(81), "x\ud800", "x\n", "x\u0000"]) assert.throws(() => validateSearch(value), invalid);
});

test("CRM identifiers are exact lowercase 16-byte hexadecimal values, without newline aliases", () => {
  assert.deepEqual(validateId(id), Buffer.from(id, "hex"));
  for (const value of [undefined, null, 1, Buffer.from(id, "hex"), id.toUpperCase(), id.slice(1), `${id}0`, `${id}\n`, `${id}\r`, ` ${id}`, `${id} `, `${id.slice(0, 31)}\n`, "g".repeat(32)]) assert.throws(() => validateId(value), invalid);
});

test("CRM versions require canonical uint32 decimal strings and positive label/note revisions", () => {
  for (const value of ["0", "1", "9", "10", "4294967295"]) assert.equal(validateVersion(value), value);
  for (const value of ["1", "4294967295"]) assert.equal(validateVersion(value, { allowZero: false }), value);
  assert.throws(() => validateVersion("0", { allowZero: false }), invalid);
  for (const value of [undefined, null, 0, 1, 1n, [], {}, "", "00", "01", "+1", "-0", "-1", "1.0", "1e2", "0x1", " 1", "1 ", "1\n", "0\r", "1\r\n", "4294967296", "99999999999999", "١"]) assert.throws(() => validateVersion(value), invalid);
});

test("CRM label bindings are bounded, unique and sorted canonical identifiers", () => {
  const values = ["f".repeat(32), "0".repeat(32), id];
  const copy = [...values];
  assert.deepEqual(validateLabelIds(values).map((value) => value.toString("hex")), [...values].sort());
  assert.deepEqual(values, copy);
  assert.deepEqual(validateLabelIds([]), []);
  const full = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(32, "0"));
  assert.equal(validateLabelIds(full).length, 32);
  for (const value of [null, undefined, {}, id, [id, id], [id.toUpperCase()], [Buffer.from(id, "hex")], Array(1), [id, ...Array(1)], [...full, "f".repeat(32)]]) assert.throws(() => validateLabelIds(value), invalid);
});

test("CRM reminder timestamps accept explicit absence or finite integer UTC milliseconds through year 9999", () => {
  for (const value of [null, 0, 1, 1770000000000, 253402300799999]) assert.equal(validateReminder(value), value);
  for (const value of [undefined, "1770000000000", "", false, {}, [], new Date(), NaN, Infinity, -Infinity, -1, 0.1, 253402300800000, Number.MAX_SAFE_INTEGER]) assert.throws(() => validateReminder(value), invalid);
});

test("CRM input errors expose only a stable code and neutral message", () => {
  const privateValue = "Synthetic private input marker\u0000";
  for (const validate of [validateLabelName, validateNickname, validateNotes, validateSearch, validateId, validateVersion, validateLabelIds, validateReminder]) {
    assert.throws(() => validate(privateValue), (error) => {
      assert.ok(invalid(error));
      assert.equal(error.message.includes(privateValue), false);
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
      return true;
    });
  }
});
