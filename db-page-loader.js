(() => {
  const pageScripts = {
    crm: ["./app.js?v=20260629-contract-print-1"],
    contracts: ["./contracts.js?v=20260701-registration-renewal-stamp-1"],
    payments: ["./ops/payments.js?v=20260629-payment-search-2"],
    drafts: ["./ops/drafts.js?v=20260629-contract-print-1"],
  };

  const statusText = {
    crm: "正在載入 CRM 資料...",
    contracts: "正在載入合約資料...",
    payments: "正在載入繳費表...",
    drafts: "正在載入訊息草稿...",
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.defer = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.body.appendChild(script);
  });

  const showState = (message, tone = "loading") => {
    let panel = document.querySelector("#dbLoadState");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "dbLoadState";
      panel.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:9999",
        "max-width:360px",
        "border:1px solid rgba(95,111,97,.28)",
        "border-radius:10px",
        "background:rgba(254,255,252,.94)",
        "box-shadow:0 14px 34px rgba(30,36,33,.12)",
        "color:#1e2421",
        "font:800 14px/1.5 -apple-system,BlinkMacSystemFont,'Noto Sans TC',sans-serif",
        "padding:12px 14px",
      ].join(";");
      document.body.appendChild(panel);
    }
    panel.textContent = message;
    panel.dataset.tone = tone;
    panel.style.borderColor = tone === "error" ? "rgba(180,35,24,.34)" : "rgba(95,111,97,.28)";
    panel.style.color = tone === "error" ? "#b42318" : "#1e2421";
    return panel;
  };

  const hideStateSoon = () => {
    const panel = document.querySelector("#dbLoadState");
    if (panel) window.setTimeout(() => panel.remove(), 700);
  };

  const loadPage = async () => {
    const page = document.documentElement.dataset.dbPage || document.body.dataset.dbPage;
    if (!page || !pageScripts[page]) return;
    showState(statusText[page] || "正在載入資料...");
    try {
      await window.HJ_DB.ensureSession();
      await window.HJ_DB.applyPlatformGlobals();
      window.HJ_DB.clearLegacyLocalDataForDb();
      if (page !== "payments") window.HJ_DB.installLocalStorageSync();
      for (const script of pageScripts[page]) await loadScript(script);
      if (page === "payments") {
        window.setTimeout(() => window.HJ_DB.installLocalStorageSync(), 1200);
      }
      hideStateSoon();
    } catch (error) {
      console.error(error);
      showState(`資料庫讀取失敗：${error.message || error}`, "error");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPage, { once: true });
  } else {
    loadPage();
  }
})();
