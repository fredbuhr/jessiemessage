import test from "node:test";
import assert from "node:assert/strict";
import { emojiCategories, emojiOptions, insertEmoji } from "../public/emoji-catalog.js";
import { validBody } from "../public/chat-model.js";

test("the local bilingual catalogue offers distinct choices and useful translated categories", () => {
  const french = emojiOptions("fr"), english = emojiOptions("en");
  assert.ok(french.length >= 150 && french.length <= 200);
  assert.equal(new Set(french.map((entry) => entry.id)).size, french.length);
  assert.equal(new Set(french.map((entry) => entry.text)).size, french.length);
  assert.deepEqual(french.map((entry) => entry.id), english.map((entry) => entry.id));
  assert.equal(emojiCategories("fr")[0].label, "Tous");
  assert.equal(emojiCategories("en")[0].label, "All");
  assert.equal(emojiCategories("fr").find((entry) => entry.id === "hearts").label, "Cœurs");
  assert.equal(emojiCategories("en").find((entry) => entry.id === "hearts").label, "Hearts");
  for (const entry of french) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(validBody(entry.text), true);
    assert.equal(typeof entry.label, "string"); assert.ok(entry.label.length > 0);
    assert.ok(emojiCategories("fr").some((category) => category.id === entry.category));
  }
  for (const category of emojiCategories("fr").slice(1)) {
    const entries = emojiOptions("fr", { category: category.id });
    assert.ok(entries.length > 0); assert.ok(entries.every((entry) => entry.category === category.id));
  }
});

test("search accepts French and English aliases, accents, case, several words and Unicode", () => {
  assert.deepEqual(emojiOptions("en", { query: "  BISOUS BRÛLANT  " }).map((entry) => entry.id), ["hot-kiss"]);
  assert.ok(emojiOptions("fr", { query: "kiss face" }).some((entry) => entry.id === "kiss-face"));
  assert.ok(emojiOptions("en", { query: "PÊCHE" }).some((entry) => entry.id === "peach"));
  assert.ok(emojiOptions("fr", { query: "COEUR ROUGE" }).some((entry) => entry.id === "red-heart"));
  assert.ok(emojiOptions("fr", { query: "❤" }).some((entry) => entry.id === "red-heart"));
  assert.deepEqual(emojiOptions("fr", { category: "combos", query: "😘🔥" }).map((entry) => entry.id), ["hot-kiss"]);
  assert.deepEqual(emojiOptions("fr", { category: "hearts", query: "bisous" }), []);
  assert.deepEqual(emojiOptions("en", { query: "no-such-emoji-phrase" }), []);
});

test("returned choices and categories cannot mutate the local catalogue", () => {
  const options = emojiOptions("fr"), categories = emojiCategories("en");
  options[0].text = "caller replacement"; options[0].label = "caller label"; options.pop();
  categories[0].label = "caller category"; categories.pop();
  assert.equal(emojiOptions("fr")[0].text, "😀");
  assert.equal(emojiCategories("en")[0].label, "All");
  assert.equal(emojiOptions("fr").find((entry) => entry.id === "kiss-face").text, "😘");
});

test("insertion preserves the draft verbatim around a cursor or replaces its selection", () => {
  const draft = "  Bonjour <b>toi</b>\n";
  assert.deepEqual(insertEmoji(draft, "kiss-face", { start: 10 }), { value: "  Bonjour 😘<b>toi</b>\n", caret: 12 });
  assert.deepEqual(insertEmoji("Un mot ici", "red-heart", { start: 3, end: 6 }), { value: "Un ❤️ ici", caret: 5 });
  assert.deepEqual(insertEmoji("", "kiss-face"), { value: "😘", caret: 2 });
  assert.deepEqual(insertEmoji("Bonjour", "hot-kiss"), { value: "Bonjour😘🔥", caret: 11 });
  assert.equal(draft, "  Bonjour <b>toi</b>\n");
});

test("multi-codepoint text and surrogate pairs retain their UTF-16 selection boundaries", () => {
  assert.deepEqual(insertEmoji("A😘B", "red-heart", { start: 1, end: 3 }), { value: "A❤️B", caret: 3 });
  const heart = emojiOptions("fr").find((entry) => entry.id === "heart-on-fire").text;
  assert.deepEqual(insertEmoji("ab", "heart-on-fire", { start: 1 }), { value: `a${heart}b`, caret: 1 + heart.length });
  assert.throws(() => insertEmoji("A😘B", "kiss-face", { start: 2 }), { name: "TypeError", message: "invalid_emoji" });
  assert.throws(() => insertEmoji("A😘B", "kiss-face", { start: 1, end: 2 }), { name: "TypeError", message: "invalid_emoji" });
});

test("text and photo captions keep their existing limits without silently truncating", () => {
  for (const [image, maximum] of [[false, 4096], [true, 1000]]) {
    const prefix = "x".repeat(maximum - 2);
    assert.equal(insertEmoji(prefix, "kiss-face", { image }).value.length, maximum);
    assert.throws(() => insertEmoji(prefix + "x", "kiss-face", { image }), { name: "RangeError", message: "emoji_draft_limit" });
    const full = "x".repeat(maximum);
    assert.equal(insertEmoji(full, "kiss-face", { start: 0, end: 2, image }).value.length, maximum);
  }
});

test("invalid options, selections and malformed text fail without including private text", () => {
  for (const args of [
    [null, "kiss-face"], ["Private", "unknown"], ["Private", "kiss-face", null], ["Private", "kiss-face", []],
    ["Private", "kiss-face", { start: -1 }], ["Private", "kiss-face", { start: 8 }],
    ["Private", "kiss-face", { start: 2, end: 1 }], ["Private", "kiss-face", { start: 0.5 }],
    ["Private", "kiss-face", { end: NaN }], ["Private", "kiss-face", { image: "yes" }],
    ["Private", "kiss-face", { unexpected: true }], ["Private\ud800", "kiss-face"],
  ]) assert.throws(() => insertEmoji(...args), { name: "TypeError", message: "invalid_emoji" });
  assert.throws(() => insertEmoji("Private\u0000", "kiss-face"), { name: "RangeError", message: "emoji_draft_limit" });
  assert.throws(() => emojiCategories("de"), { name: "TypeError", message: "invalid_emoji" });
  for (const input of [{ category: "missing" }, { query: "x".repeat(129) }, { query: "\ud800" }, { query: "\n" }]) {
    assert.throws(() => emojiOptions("fr", input), { name: "TypeError", message: "invalid_emoji" });
  }
});
