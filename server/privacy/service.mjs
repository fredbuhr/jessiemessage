import { readFile } from "node:fs/promises";
import { DECISIONS, fields, failPrivacy, validateDraft } from "./draft.mjs";
import { createPrivacyFiles } from "./files.mjs";

async function defaultDraft() {
  const source = await readFile(new URL("../../docs/privacy-notice-draft.md", import.meta.url), "utf8");
  const fr = source.split("## Français — tes données dans JessieMessage\n")[1]?.split("## English — your data in JessieMessage\n")[0]?.trim();
  const en = source.split("## English — your data in JessieMessage\n")[1]?.split("## Références de rédaction\n")[0]?.trim();
  return validateDraft({ answers: Object.fromEntries(DECISIONS.map(id => [id, ""])), notice: { fr, en } });
}
export async function createPrivacyService({ directory, key, clock = Date.now }, internal = {}) {
  const initial = await defaultDraft(), files = internal.files ?? createPrivacyFiles(directory, key);
  const view = (revision, prepared) => ({ version: 1, revision, updatedAt: prepared?.updatedAt ?? null,
    publication: "draft_only", retention: "not_enabled", answered: DECISIONS.filter(id => (prepared?.draft ?? initial).answers[id].trim()),
    draft: structuredClone(prepared?.draft ?? initial) });
  return Object.freeze({
    async read() { const state = await files.read(); return view(state.revision, state.prepared); },
    async save(body, authorize) {
      fields(body, ["revision", "draft"]);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER - 1) failPrivacy("input");
      const draft = validateDraft(body.draft), now = clock();
      if (!Number.isSafeInteger(now) || now < 1 || now > 253402300799999) failPrivacy();
      const prepared = { updatedAt: now, draft };
      const next = await files.save(prepared, body.revision, authorize);
      return view(next, prepared);
    },
    close() { files.close(); },
  });
}
