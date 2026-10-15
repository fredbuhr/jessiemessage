/* Explicit interface translation only. User content is never discovered or
 * translated by scanning text. Session storage contains one language choice. */
(() => {
  "use strict";
  const KEY = "jessiemessage.language", MARKER = "data-jm-i18n-bound";
  const attributes = ["placeholder", "title", "aria-label"], dictionary = new Map(), listeners = new Set();
  const constants = new WeakMap(), parameterSlots = new WeakMap(), descriptors = new WeakMap();
  let parameterBindings = new WeakMap();
  const selector = ["[data-jm-i18n]", ...attributes.map((name) => `[data-jm-i18n-${name}]`), `[${MARKER}]`].join(",");
  const token = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  const dateOptions = new Set(["localeMatcher", "calendar", "numberingSystem", "dateStyle", "timeStyle", "weekday", "era", "year", "month", "day", "hour", "minute", "second", "timeZoneName", "timeZone", "hour12", "hourCycle", "formatMatcher", "dayPeriod", "fractionalSecondDigits"]);
  const numberOptions = new Set(["localeMatcher", "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay", "useGrouping", "minimumIntegerDigits", "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits", "notation", "compactDisplay", "signDisplay", "numberingSystem", "roundingPriority", "roundingIncrement", "roundingMode", "trailingZeroDisplay"]);
  const invalid = () => { throw new TypeError("invalid_interface_translation"); };
  function source(value) { if (typeof value !== "string" || value.length > 16384 || !value.isWellFormed()) invalid(); return value; }
  function own(value, maximum = 64) {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const result = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(result);
    if (keys.length > maximum || keys.some((key) => typeof key !== "string" || !result[key].enumerable || !Object.hasOwn(result[key], "value"))) invalid();
    return result;
  }
  function placeholders(value) { return [...new Set([...value.matchAll(token)].map((match) => match[1]))].sort(); }
  function paramsFor(template, input = {}) {
    const values = own(input), needed = new Set(placeholders(template)), result = Object.create(null);
    for (const [name, descriptor] of Object.entries(values)) {
      const value = descriptor.value;
      if (!(typeof value === "string" && value.length <= 16384 && value.isWellFormed()
        || typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || value === null
        || value && typeof value === "object" && descriptors.has(value))) invalid();
      if (needed.has(name)) result[name] = value;
    }
    return result;
  }
  function optionsFor(input, allowed) {
    const values = own(input), result = Object.create(null);
    for (const [name, descriptor] of Object.entries(values)) {
      const value = descriptor.value;
      if (!allowed.has(name) || !["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) invalid();
      result[name] = value;
    }
    return result;
  }
  let language = typeof navigator?.language === "string" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
  try { const stored = globalThis.sessionStorage?.getItem(KEY); if (stored === "fr" || stored === "en") language = stored; } catch {}
  const locale = () => language === "fr" ? "fr-FR" : "en-US";
  function valueText(value, depth) {
    const descriptor = value && typeof value === "object" ? descriptors.get(value) : null;
    if (!descriptor) return String(value);
    if (descriptor.kind === "date") return new Date(descriptor.value).toLocaleString(locale(), descriptor.options);
    if (descriptor.kind === "number") return descriptor.value.toLocaleString(locale(), descriptor.options);
    return translate(descriptor.source, descriptor.params, depth + 1);
  }
  function translate(template, params, depth = 0) {
    if (depth > 8) invalid();
    const translated = language === "en" ? dictionary.get(template) ?? template : template;
    const result = translated.replace(token, (whole, key) => Object.hasOwn(params, key) ? valueText(params[key], depth) : whole);
    if (result.length > 65536) invalid(); return result;
  }
  function t(template, params = {}) { source(template); return translate(template, paramsFor(template, params)); }
  function descriptor(kind, value, options) { const result = Object.freeze({}); descriptors.set(result, { kind, value, options }); return result; }
  function dateParam(value, options = {}) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) invalid();
    const safe = optionsFor(options, dateOptions); new Date(value).toLocaleString(locale(), safe); return descriptor("date", value, safe);
  }
  function numberParam(value, options = {}) {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid();
    const safe = optionsFor(options, numberOptions); value.toLocaleString(locale(), safe); return descriptor("number", value, safe);
  }
  function messageParam(template, params = {}) {
    source(template); const safe = paramsFor(template, params);
    let depth = 1;
    for (const value of Object.values(safe)) depth = Math.max(depth, 1 + (descriptors.get(value)?.depth ?? 0));
    if (depth > 8) invalid();
    const result = Object.freeze({}); descriptors.set(result, { kind: "message", source: template, params: safe, depth }); return result;
  }
  function nodeValid(node) { if (!node || typeof node.setAttribute !== "function" || typeof node.getAttribute !== "function" || typeof node.removeAttribute !== "function") invalid(); }
  const markerFor = (slot) => slot === "text" ? "data-jm-i18n" : `data-jm-i18n-${slot}`;
  const currentValue = (node, slot) => slot === "text" ? node.textContent : node.getAttribute(slot);
  const write = (node, slot, value) => { if (slot === "text") node.textContent = value; else node.setAttribute(slot, value); };
  function mapFor(map, node) { let value = map.get(node); if (!value) { value = new Map(); map.set(node, value); } return value; }
  function refreshMarker(node) {
    if (constants.get(node)?.size || parameterBindings.get(node)?.size) node.setAttribute(MARKER, ""); else node.removeAttribute(MARKER);
  }
  function drop(node, slot) {
    constants.get(node)?.delete(slot); parameterBindings.get(node)?.delete(slot); parameterSlots.get(node)?.delete(slot);
    node.removeAttribute(markerFor(slot)); refreshMarker(node);
  }
  function bind(node, slot, template, params = {}) {
    nodeValid(node); source(template); const safe = paramsFor(template, params), parameterized = Object.keys(safe).length > 0;
    const record = { source: template, params: safe, last: translate(template, safe) };
    constants.get(node)?.delete(slot); parameterBindings.get(node)?.delete(slot);
    const slots = parameterSlots.get(node) ?? new Set(); parameterSlots.set(node, slots);
    if (parameterized) slots.add(slot); else slots.delete(slot);
    mapFor(parameterized ? parameterBindings : constants, node).set(slot, record);
    // Explicit calls initialize freshly created or hidden UI before insertion.
    if (currentValue(node, slot) !== record.last) write(node, slot, record.last); refreshMarker(node); return record.last;
  }
  function text(node, template, params = {}) { return bind(node, "text", template, params); }
  function attr(node, name, template, params = {}) { if (!attributes.includes(name)) invalid(); return bind(node, name, template, params); }
  function nodes(root, selected = selector) {
    const result = Array.from(root?.querySelectorAll?.(selected) ?? []);
    if (root && typeof root.getAttribute === "function" && (selected === selector ? ["data-jm-i18n", MARKER, ...attributes.map((name) => `data-jm-i18n-${name}`)].some((name) => root.getAttribute(name) !== null) : root.getAttribute("data-jm-language") !== null)) result.unshift(root);
    return result;
  }
  function forget(node) {
    nodeValid(node);
    for (const target of new Set([node, ...nodes(node)])) {
      constants.delete(target); parameterBindings.delete(target); parameterSlots.delete(target);
      for (const name of [MARKER, "data-jm-i18n", ...attributes.map((name) => `data-jm-i18n-${name}`)]) target.removeAttribute(name);
    }
  }
  function rawText(node, value) { forget(node); node.textContent = value; }
  function visible(node) {
    if (!node.isConnected || document.visibilityState === "hidden") return false;
    for (let current = node; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.("aria-hidden") === "true" || current.getAttribute?.("inert") !== null && current.getAttribute?.("inert") !== undefined) return false;
      if (typeof globalThis.getComputedStyle === "function") { const style = globalThis.getComputedStyle(current); if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility)) return false; }
    }
    return true;
  }
  function apply(root = document) {
    document.documentElement.lang = language;
    for (const node of nodes(root)) {
      if (!node.isConnected) continue;
      for (const slot of ["text", ...attributes]) {
        const record = parameterBindings.get(node)?.get(slot) ?? constants.get(node)?.get(slot);
        if (record) {
          if (currentValue(node, slot) !== record.last) { drop(node, slot); continue; }
          if (Object.keys(record.params).length && !visible(node)) { drop(node, slot); continue; }
          const translated = translate(record.source, record.params); if (translated !== record.last) write(node, slot, translated); record.last = translated;
          continue;
        }
        if (parameterSlots.get(node)?.has(slot)) { drop(node, slot); continue; }
        const marked = node.getAttribute(markerFor(slot)); if (marked === null) continue;
        // Text markers designate only a UI leaf, never a message/card ancestor.
        if (slot === "text" && node.children?.length) { drop(node, slot); continue; }
        const template = marked || currentValue(node, slot);
        const value = currentValue(node, slot);
        const original = typeof template === "string" && (value === template || slot === "text" && typeof value === "string"
          && value.replace(/\s+/gu, " ").trim() === template.replace(/\s+/gu, " ").trim());
        if (!original) { drop(node, slot); continue; }
        bind(node, slot, template);
      }
      refreshMarker(node);
    }
    for (const button of nodes(root, "[data-jm-language]")) {
      button.textContent = language === "fr" ? "EN" : "FR";
      button.setAttribute("aria-label", language === "fr" ? "Switch to English" : "Passer en français");
    }
  }
  function purgeParameters() {
    parameterBindings = new WeakMap();
    for (const node of nodes(document)) { for (const slot of [...parameterSlots.get(node) ?? []]) drop(node, slot); refreshMarker(node); }
  }
  function register(input) {
    const entries = own(input, 10000), changes = [];
    for (const [french, descriptor] of Object.entries(entries)) {
      const english = descriptor.value; source(french); source(english);
      if (JSON.stringify(placeholders(french)) !== JSON.stringify(placeholders(english)) || dictionary.has(french) && dictionary.get(french) !== english) invalid();
      changes.push([french, english]);
    }
    for (const [french, english] of changes) dictionary.set(french, english); apply();
  }
  function setLanguage(value) {
    if (value !== "fr" && value !== "en") return false;
    try { globalThis.sessionStorage?.setItem(KEY, value); } catch {}
    if (value === language) { apply(); return true; }
    language = value; apply();
    for (const listener of [...listeners]) { try { listener(language); } catch {} }
    return true;
  }
  function onChange(listener) { if (typeof listener !== "function") invalid(); listeners.add(listener); return () => listeners.delete(listener); }
  globalThis.JessieI18n = Object.freeze({ register, t, text, attr, rawText, forget, dateParam, numberParam, messageParam, getLanguage: () => language, setLanguage, onChange, apply });
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-jm-language]");
    if (!button || button.disabled || button.getAttribute?.("aria-disabled") === "true") return;
    event.preventDefault(); setLanguage(language === "fr" ? "en" : "fr");
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") purgeParameters(); });
  window.addEventListener("pagehide", purgeParameters);
  document.addEventListener("DOMContentLoaded", () => apply());
  apply();
})();
