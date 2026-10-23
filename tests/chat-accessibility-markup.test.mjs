import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/chat.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/chat.css", import.meta.url), "utf8");

function parseMarkup(source) {
  const root = { tag: "document", attributes: {}, children: [], parent: null, text: "" };
  const stack = [root], ids = new Map();
  const voids = new Set(["meta", "link", "img", "input", "br"]);
  for (const match of source.matchAll(/<![^>]*>|<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi)) {
    if (match[1]) { assert.equal(stack.pop().tag, match[1]); continue; }
    if (match[2]) {
      const node = { tag: match[2], attributes: {}, children: [], parent: stack.at(-1), text: "" };
      for (const attribute of match[3].matchAll(/([a-zA-Z][\w:-]*)(?:\s*=\s*"([^"]*)")?/g)) node.attributes[attribute[1]] = attribute[2] ?? "";
      if (node.attributes.id) { assert.equal(ids.has(node.attributes.id), false); ids.set(node.attributes.id, node); }
      node.parent.children.push(node);
      if (!voids.has(node.tag)) stack.push(node);
    } else if (match[4]) stack.at(-1).text += match[4];
  }
  assert.equal(stack.length, 1);
  return { root, ids };
}

function declarations(selector) {
  const result = new Map();
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(",").map((part) => part.trim()).includes(selector)) continue;
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon !== -1) result.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return result;
}

test("chat has an empty dedicated polite announcement outside the non-live message history", () => {
  const { ids } = parseMarkup(html), announcement = ids.get("message-announcement");
  assert.ok(announcement);
  assert.equal(announcement.parent, ids.get("chat"));
  assert.equal(announcement.text.trim(), "");
  assert.equal(announcement.children.length, 0);
  assert.equal(announcement.attributes.class, "sr-only");
  assert.equal(announcement.attributes.role, "status");
  assert.equal(announcement.attributes["aria-live"], "polite");
  assert.equal(announcement.attributes["aria-atomic"], "true");
  assert.equal(Object.hasOwn(announcement.attributes, "hidden"), false);
  assert.equal(Object.hasOwn(announcement.attributes, "aria-hidden"), false);
  assert.equal(ids.get("messages").attributes.role, "list");
  for (const id of ["workspace", "chat", "message-scroll", "messages"]) {
    assert.equal(ids.get(id).attributes["aria-live"], undefined);
    assert.notEqual(ids.get(id).attributes.role, "log");
  }
});

test("chat keyboard destinations and composer instructions keep their explicit relationships and translation markers", () => {
  const { ids } = parseMarkup(html), workspace = ids.get("workspace");
  const skip = workspace.children.find((node) => node.attributes.class === "conversation-skip");
  assert.ok(skip);
  assert.equal(skip.tag, "a");
  assert.equal(skip.attributes.href, "#message-scroll");
  assert.equal(skip.attributes["data-jm-i18n"], "Aller à la conversation");
  assert.equal(ids.get("message-scroll").attributes.tabindex, "0");
  assert.equal(ids.get("message-scroll").attributes["data-jm-i18n-aria-label"], "Historique de la conversation");
  assert.equal(ids.get("inbox-title").attributes.tabindex, "-1");
  assert.equal(ids.get("message-body").attributes["aria-describedby"], "composer-help");
  assert.equal(ids.get("message-body").attributes["data-jm-i18n-placeholder"], "Écris ton message…");
  assert.equal(ids.get("composer-help").attributes["data-jm-i18n"], "Message privé · 4 096 caractères maximum");
});

test("account access stays in Options and the exclusive inbox/conversation buttons retain native relationships", () => {
  const { ids } = parseMarkup(html), account = ids.get("account-link"), menu = ids.get("chat-menu");
  assert.equal(account.attributes.href, "/access");
  assert.equal(account.attributes["data-jm-i18n"], "Mon accès");
  assert.equal(account.parent.parent, menu);
  assert.equal(ids.get("client-aside").children.some(node => node.tag === "a"), false, "the client aside has no duplicate account shortcut");
  for (const id of ["open-account-menu", "open-conversation-menu"]) {
    const button = ids.get(id);
    assert.equal(button.tag, "button");
    assert.equal(button.attributes.type, "button");
    assert.equal(button.attributes["aria-controls"], "chat-menu");
    assert.equal(button.attributes["aria-expanded"], "false");
    assert.ok(button.attributes["data-jm-i18n-aria-label"]);
  }
  assert.equal(declarations(".page.has-conversation #open-account-menu").get("display"), "none");
  assert.equal(declarations(".page:not(.has-conversation) #open-conversation-menu").get("display"), "none");
  assert.equal(declarations(".icon-button").get("min-width"), "44px");
  assert.equal(declarations(".icon-button").get("height"), "44px");
});

test("chat CSS keeps explicit keyboard focus and the skip link out of the visual flow until focused", () => {
  for (const selector of ["button:focus-visible", "a:focus-visible", "input:focus-visible", "textarea:focus-visible", ".message-scroll:focus-visible", "#inbox-title:focus-visible", '.message[tabindex="-1"]:focus-visible']) {
    assert.match(declarations(selector).get("outline") ?? "", /^2px solid /, selector);
  }
  assert.equal(declarations(".message-scroll:focus-visible").get("outline-offset"), "-3px");
  assert.equal(declarations(".photo-open:focus-visible").get("outline-offset"), "-3px");
  assert.equal(declarations(".conversation-skip").get("position"), "fixed");
  assert.equal(declarations(".conversation-skip:focus").get("transform"), "none");
  assert.match(css, /@media\(max-width:780px\)\{\.workspace\.is-admin:not\(\.selected\) \.conversation-skip\{display:none\}\}/);
  assert.equal(declarations(".delete-message").get("min-height"), "44px");
  assert.equal(declarations(".delete-message").get("min-width"), "44px");
});
