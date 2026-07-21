(function initCustomerId(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HJCustomerId = api;
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => api.install(root.document), { once: true });
    else api.install(root.document);
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function customerIdFactory() {
  function normalize(value) {
    const raw = String(value ?? "").normalize("NFKC").trim();
    if (/^v\d*$/iu.test(raw)) return `V${raw.slice(1)}`;
    return raw;
  }

  function isHuanrui(value) {
    return /^V\d+$/u.test(normalize(value));
  }

  function normalizeInput(input) {
    if (!input) return "";
    const before = String(input.value ?? "");
    const after = normalize(before);
    if (after === before) return after;
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    input.value = after;
    if (selectionStart !== null && selectionEnd !== null && typeof input.setSelectionRange === "function") {
      const delta = after.length - before.length;
      input.setSelectionRange(Math.max(0, selectionStart + delta), Math.max(0, selectionEnd + delta));
    }
    return after;
  }

  function bindInput(input) {
    if (!input || input.dataset.hjCustomerIdBound === "true") return;
    input.dataset.hjCustomerIdBound = "true";
    input.addEventListener("input", () => normalizeInput(input));
    input.addEventListener("change", () => normalizeInput(input));
    input.addEventListener("blur", () => normalizeInput(input));
  }

  function install(rootNode = document) {
    rootNode.querySelectorAll?.("[data-customer-id-input]").forEach(bindInput);
  }

  return Object.freeze({ normalize, isHuanrui, normalizeInput, bindInput, install });
});
