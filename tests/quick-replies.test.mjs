import test from "node:test";
import assert from "node:assert/strict";
import { quickReplyOptions, appendQuickReply } from "../public/quick-replies.js";
import { validBody } from "../public/chat-model.js";

test("French and English phrases remain ordinary editable message text", () => {
  for (const language of ["fr", "en"]) {
    const options = quickReplyOptions(language);
    assert.equal(options.length, 6); assert.equal(new Set(options.map(reply => reply.id)).size, 6);
    for (const reply of options) assert.equal(validBody(reply.text), true);
    options[0].text = "Modified caller copy";
    assert.notEqual(quickReplyOptions(language)[0].text, options[0].text);
  }
  assert.equal(appendQuickReply("", "good-night", "fr"), "Bonne nuit, bisous 😘");
  assert.equal(appendQuickReply("", "good-night", "en"), "Good night, kisses 😘");
});
test("adding a reply preserves the existing draft verbatim, including whitespace and markup", () => {
  for (const prefix of ["Mon brouillon", "  Texte personnel  ", "Déjà une ligne\n", "<b>Private</b> 😊"]) {
    const result = appendQuickReply(prefix, "thanks", "fr");
    assert.equal(result, prefix + (prefix.endsWith("\n") ? "" : "\n") + "Merci pour ton message 💛");
  }
});
test("text and photo captions respect their existing character limits without truncation", () => {
  const phrase = quickReplyOptions("fr").find(reply => reply.id === "thanks").text;
  for (const [image, maximum] of [[false, 4096], [true, 1000]]) {
    const prefix = "x".repeat(maximum - phrase.length - 1);
    assert.equal(appendQuickReply(prefix, "thanks", "fr", image).length, maximum);
    assert.throws(() => appendQuickReply(prefix + "x", "thanks", "fr", image), /quick_reply_draft_limit/);
  }
});
test("unknown choices and invalid drafts fail without including private text in errors", () => {
  for (const args of [["private", "unknown", "fr"], ["private", "thanks", "de"], [null, "thanks", "fr"], ["private", "thanks", "fr", "yes"]]) {
    assert.throws(() => appendQuickReply(...args), { name: "TypeError", message: "invalid_quick_reply" });
  }
  for (const draft of ["Private\u0000", "Private\ud800"]) assert.throws(() => appendQuickReply(draft, "thanks", "en"), { name: "RangeError", message: "quick_reply_draft_limit" });
});
