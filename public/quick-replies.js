import { validBody, validCaption } from "./chat-model.js";

// Built-in phrases only. No customer text or personal settings are persisted.
const replies = Object.freeze([
  { id: "hello", fr: "Bonjour, contente de te retrouver 😊", en: "Hi, lovely to see you again 😊" },
  { id: "how-are-you", fr: "Comment vas-tu aujourd’hui ?", en: "How are you today?" },
  { id: "thanks", fr: "Merci pour ton message 💛", en: "Thanks for your message 💛" },
  { id: "later", fr: "Je te réponds un peu plus tard.", en: "I’ll reply a little later." },
  { id: "tonight", fr: "Je me connecte ce soir. À tout à l’heure !", en: "I’ll be online this evening. See you later!" },
  { id: "good-night", fr: "Bonne nuit, bisous 😘", en: "Good night, kisses 😘" },
].map(Object.freeze));

export function quickReplyOptions(language) {
  if (language !== "fr" && language !== "en") throw new TypeError("invalid_quick_reply");
  return replies.map(reply => ({ id: reply.id, text: reply[language] }));
}

export function appendQuickReply(draft, replyId, language, image = false) {
  const reply = quickReplyOptions(language).find(reply => reply.id === replyId);
  if (!reply || typeof draft !== "string" || typeof image !== "boolean") throw new TypeError("invalid_quick_reply");
  const value = draft + (draft && !draft.endsWith("\n") ? "\n" : "") + reply.text;
  if (!(image ? validCaption(value) : validBody(value))) throw new RangeError("quick_reply_draft_limit");
  return value;
}
