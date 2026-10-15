import test from "node:test";
import assert from "node:assert/strict";
import { SITE_CONTACT_EMAIL, SITE_DOMAIN, isOfficialOrigin } from "../server/site.mjs";

test("site identity uses the address selected for all JessieMessage contact", () => {
  assert.equal(SITE_DOMAIN, "jessiemessage.com");
  assert.equal(SITE_CONTACT_EMAIL, "contact@jessiemessage.com");
});

test("official origins require canonical HTTPS and exact hostname boundaries", () => {
  for (const origin of ["https://jessiemessage.com", "https://www.jessiemessage.com",
    "https://pilot.jessiemessage.com:8443", "https://a.b.jessiemessage.com"]) {
    assert.equal(isOfficialOrigin(origin), true, origin);
  }
  for (const origin of [undefined, null, {}, "", "jessiemessage.com", "http://jessiemessage.com",
    "https://jessiemessage.com/", "https://jessiemessage.com/private", "https://jessiemessage.com?x=1",
    "https://jessiemessage.com#fragment", "https://person@jessiemessage.com", "https://JESSIEMESSAGE.COM",
    "https://jessiemessage.com:443", "https://jessiemessage.com\n", "https://ｊessiemessage.com",
    "https://eviljessiemessage.com", "https://jessiemessage.com.attacker.invalid",
    "https://example.invalid", "https://jessiemessage.com."]) {
    assert.equal(isOfficialOrigin(origin), false, String(origin));
  }
});
