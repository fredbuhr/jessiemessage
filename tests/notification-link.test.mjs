import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../public/notification-link.js", import.meta.url), "utf8");
test("notification navigation carries only one opaque reference to fixed role-specific pages, including login", () => {
  const reference = "ab".repeat(16), context = { location: { hash: `#notification=${reference}` } };
  vm.runInNewContext(source, context); const link = context.JessieNotificationLink;
  assert.equal(link.read(), reference);
  for (const value of ["", "#notification=bad", `#notification=${reference}&next=https://evil.invalid`, `#notification=${reference}&notification=${reference}`, `#invitation=${reference}`, `#notification=${reference.toUpperCase()}`]) assert.equal(link.read(value), null);
  assert.equal(link.destination("client", reference), `/messages#notification=${reference}`);
  assert.equal(link.destination("admin", reference), `/admin/messages#notification=${reference}`);
  assert.equal(link.destination("client", reference, true), `/access#notification=${reference}`);
  assert.equal(link.destination("admin", reference, true), `/admin/login#notification=${reference}`);
  assert.equal(link.destination("https://evil.invalid", reference), null);
  assert.equal(link.destination("client", "bad"), null);
  assert.equal(link.destination("__proto__", reference), null);
});
