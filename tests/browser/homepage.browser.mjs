// Real public server, homepage, assets, translations and keyboard navigation.
// Everything stays on loopback, without a database, account or private content.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createAppServer } from "../../server/index.mjs";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const screenshots = new URL("../../artifacts/homepage/", import.meta.url);
const copy = {
  fr: { title: "On garde le contact ?", action: "Ouvrir ma conversation", access: "Accès sur invitation, réservé aux adultes.", help: "Aide et confidentialité", page: "Jessie — Mon espace privé" },
  en: { title: "Shall we stay in touch?", action: "Open my conversation", access: "For invited adults only.", help: "Help and privacy", page: "Jessie — My private space" }
};

async function ready(page, language) {
  await waitUntil(() => page.execute("return document.documentElement.lang === arguments[0] && document.querySelector('h1')?.textContent === arguments[1]", language, copy[language].title), "translated real homepage");
  await page.executeAsync("const done = arguments[arguments.length - 1]; document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))");
}

async function geometry(page) {
  const layout = await page.execute(`const viewport = document.documentElement.clientWidth;
    const controls = [...document.querySelectorAll('.topbar a, .topbar button, .entry-link, .footer a')];
    const content = [...document.querySelectorAll('.topbar, h1, .subtitle, .intro-copy, .entry-action, .invitation-note, .signoff, .footer')];
    return { viewport, width: document.documentElement.scrollWidth,
      inside: content.every(node => { const r = node.getBoundingClientRect(); return r.left >= -1 && r.right <= viewport + 1; }),
      readable: content.every(node => node.scrollWidth <= node.clientWidth + 1),
      controls: controls.every(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && r.left >= -1 && r.right <= viewport + 1 && node.scrollWidth <= node.clientWidth + 1; }),
      oneAction: document.querySelectorAll('main a').length === 1,
      noPreview: !document.querySelector('.preview, .bubble, .avatar, input, textarea, [contenteditable]'),
      noAdmin: ![...document.querySelectorAll('a')].some(node => new URL(node.href).pathname.startsWith('/admin')),
      brandLoaded: document.querySelector('.brand img').complete && document.querySelector('.brand img').naturalWidth === 128
    };`);
  assert.equal(layout.width <= layout.viewport + 1, true, "no horizontal overflow");
  assert.equal(layout.inside && layout.readable, true, "all homepage copy stays readable inside the viewport");
  assert.equal(layout.controls, true, "navigation and primary action retain 44px targets with fitting labels");
  assert.equal(layout.oneAction, true, "there is one primary navigation action");
  assert.equal(layout.noPreview, true, "the fake conversation and composer are absent");
  assert.equal(layout.noAdmin, true, "the public homepage has no administration link");
  assert.equal(layout.brandLoaded, true, "the actual approved brand asset loads");
}

async function capture(page, name) {
  const encoded = await page.screenshot();
  assert.equal(typeof encoded, "string");
  const png = Buffer.from(encoded, "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the browser returns a real PNG");
  await mkdir(screenshots, { recursive: true });
  await writeFile(new URL(`${name}.png`, screenshots), png);
}

test("real Chrome: homepage is personal, translated and usable by keyboard at 320px, 390px and desktop", { timeout: 180000 }, async t => {
  const driver = await startWebDriver();
  const server = createAppServer(), requests = [];
  server.on("request", request => requests.push(new URL(request.url, "http://localhost").pathname));
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const language of ["fr", "en"]) for (const width of [320, 390, 1280]) await t.test(`${language}, ${width}px`, async () => {
      const page = await driver.browser({ origin, width });
      try {
        await page.navigate("/help");
        await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", language);
        requests.length = 0;
        await page.navigate("/"); await ready(page, language);
        assert.equal(await page.execute("return document.title"), copy[language].page);
        assert.equal(await page.execute("return document.querySelector('.entry-link').textContent"), copy[language].action);
        assert.equal(await page.execute("return document.querySelector('.access-note').textContent"), copy[language].access);
        assert.equal(await page.execute("return document.querySelector('[data-help-link]').textContent"), copy[language].help);
        assert.equal(await page.execute("return document.querySelector('[data-help-link]').getAttribute('href')"), `/help#lang=${language}`);
        await geometry(page);
        assert.equal(requests.some(path => path.startsWith("/api/")), false, "opening the public homepage does not check or reveal account state");
        await capture(page, `home-${language}-${width}-top`);
        if (await page.execute("return document.documentElement.scrollHeight > innerHeight + 1")) {
          await page.execute("scrollTo(0, document.documentElement.scrollHeight)");
          await capture(page, `home-${language}-${width}-bottom`);
          await page.execute("scrollTo(0, 0)");
        }
        await tabUntil(page, ".skip-link"); await page.key("\uE007");
        assert.equal(await page.execute("return document.activeElement.id"), "main", "the native skip link moves keyboard focus to the main content");
        await tabUntil(page, "#language-switch"); await page.key("\uE007");
        const other = language === "fr" ? "en" : "fr";
        await ready(page, other); await geometry(page);
        assert.equal(await page.execute("return document.activeElement.id"), "language-switch", "the language switch retains keyboard focus");
        assert.equal(await page.execute("return getComputedStyle(document.activeElement).outlineStyle"), "solid", "keyboard focus has a visible outline");
        await tabUntil(page, ".entry-link"); await page.key("\uE007");
        await waitUntil(() => page.execute("return location.pathname === '/app' && document.documentElement.lang === arguments[0]", other), "native primary action reaches the real entry page with the chosen language");
      } finally { await page.close(); }
    });
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await driver.close();
  }
});
