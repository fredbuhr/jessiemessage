import test from "node:test";
import assert from "node:assert/strict";
import { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji } from "../public/emoji-catalog.js";
import { validBody } from "../public/chat-model.js";

test("the local bilingual catalogue offers distinct choices and useful translated categories", () => {
  const french = emojiOptions("fr"), english = emojiOptions("en");
  assert.ok(french.length > 180, "the existing catalogue is enriched with additional choices");
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

test("five skin tones replace supported gestures without multiplying the grid or recolouring objects", () => {
  const frenchTones = emojiSkinTones("fr"), englishTones = emojiSkinTones("en");
  assert.deepEqual(frenchTones.map(tone => tone.id), ["default", "light", "medium-light", "medium", "medium-dark", "dark"]);
  assert.deepEqual(englishTones.map(tone => tone.id), frenchTones.map(tone => tone.id));
  assert.notEqual(frenchTones.at(-1).label, englishTones.at(-1).label);
  const originals = emojiOptions("fr");
  for (const [skinTone, thumb, peace] of [
    ["default", "👍", "✌️"], ["light", "👍🏻", "✌🏻"], ["medium-light", "👍🏼", "✌🏼"],
    ["medium", "👍🏽", "✌🏽"], ["medium-dark", "👍🏾", "✌🏾"], ["dark", "👍🏿", "✌🏿"],
  ]) {
    const choices = emojiOptions("fr", { skinTone }), find = id => choices.find(entry => entry.id === id);
    assert.deepEqual(choices.map(entry => entry.id), originals.map(entry => entry.id));
    assert.equal(new Set(choices.map(entry => entry.text)).size, choices.length);
    assert.equal(find("thumbs-up").text, thumb);
    assert.equal(find("peace").text, peace, "the modifier replaces VS16 after the gesture base");
    assert.equal(find("kiss-face").text, "😘"); assert.equal(find("peach").text, "🍑");
    assert.equal(find("heart-on-fire").text, "❤️‍🔥");
    for (const choice of choices) assert.equal(validBody(choice.text), true);
  }
  assert.equal(emojiOptions("en", { skinTone: "dark", query: "👍🏿" }).some(entry => entry.id === "thumbs-up"), true);
  frenchTones[0].id = "changed"; frenchTones[0].label = "changed"; frenchTones.pop();
  assert.equal(emojiSkinTones("fr")[0].id, "default"); assert.equal(emojiSkinTones("fr").length, 6);
});

test("a toned choice inserts its actual Unicode text and retains text and photo limits", () => {
  assert.deepEqual(insertEmoji("A😘B", "thumbs-up", { start: 1, end: 3, skinTone: "dark" }), { value: "A👍🏿B", caret: 5 });
  assert.deepEqual(insertEmoji("", "peace", { skinTone: "dark" }), { value: "✌🏿", caret: 3 });
  for (const [image, maximum] of [[false, 4096], [true, 1000]]) {
    const draft = "x".repeat(maximum - 4);
    assert.equal(insertEmoji(draft, "thumbs-up", { image, skinTone: "dark" }).value.length, maximum);
    assert.throws(() => insertEmoji(draft + "x", "thumbs-up", { image, skinTone: "dark" }), { name: "RangeError", message: "emoji_draft_limit" });
  }
});

test("adult characters, couples and combinations keep valid modifier positions before ZWJ sequences", () => {
  const choices = emojiOptions("fr", { skinTone: "dark" }), find = id => choices.find(entry => entry.id === id);
  for (const [id, expected] of [
    ["curly-person", "🧑🏿‍🦱"], ["hand-raised", "🙋🏿"], ["heart-hands", "🫶🏿"],
    ["women-kiss", "👩🏿‍❤️‍💋‍👩🏿"], ["men-heart", "👨🏿‍❤️‍👨🏿"],
    ["couple-kiss", "💏🏿"], ["loving-couple", "💑🏿"],
    ["sparkling-love", "🫶🏿✨"], ["dance-night", "💃🏿🪩"],
  ]) {
    assert.equal(find(id).text, expected, id);
    assert.equal(insertEmoji("", id, { skinTone: "dark" }).value, expected, id);
  }
  assert.ok(find("curly-person").label.includes("foncée"), "the accessible name identifies the selected variant");
});

test("suggestive fruit and vegetable choices are searchable by French and English names", () => {
  for (const [query, id, text] of [
    ["aubergine", "eggplant", "🍆"], ["eggplant", "eggplant", "🍆"],
    ["concombre", "cucumber", "🥒"], ["cucumber", "cucumber", "🥒"], ["courgette", "cucumber", "🥒"],
  ]) {
    const found = emojiOptions("fr", { query }).find(entry => entry.id === id);
    assert.equal(found?.text, text, query);
  }
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
  assert.throws(() => emojiSkinTones("de"), { name: "TypeError", message: "invalid_emoji" });
  for (const skinTone of [null, "", "black", "🏿", {}, 5]) {
    assert.throws(() => emojiOptions("fr", { skinTone }), { name: "TypeError", message: "invalid_emoji" });
    assert.throws(() => insertEmoji("Private", "thumbs-up", { skinTone }), { name: "TypeError", message: "invalid_emoji" });
  }
  for (const input of [{ category: "missing" }, { query: "x".repeat(129) }, { query: "\ud800" }, { query: "\n" }]) {
    assert.throws(() => emojiOptions("fr", input), { name: "TypeError", message: "invalid_emoji" });
  }
});
