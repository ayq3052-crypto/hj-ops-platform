(() => {
  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.body.appendChild(script);
  });

  const load = async () => {
    try {
      await window.HJ_DB.ensureSession();
      await window.HJ_DB.applyPlatformGlobals();
      // 隔離測試頁絕不安裝正式資料 localStorage 同步寫入器。
      await loadScript("./ops/roc-date.js?v=20260721-canonical-date-1");
      await loadScript("./ops/contract-pricing.js?v=20260721-canonical-date-1");
      await loadScript("./ops/payment-audit-engine.js?v=20260721-canonical-v-1");
      await loadScript("./ops/payment-smart-import-v2.js?v=20260721-structured-stage-1");
      await loadScript("./ops/payment-smart-copy-builder.js");
      const copy = window.HJPaymentSmartCopyBuilder.build({
        crmSource: window.HJ_CRM_SOURCE_DATA,
        paymentImportedByYear: window.hjImportedPaymentDataByYear,
      });
      window.hjImportedPaymentData = copy.paymentImported;
      window.hjImportedPaymentDataByYear = copy.paymentImportedByYear;
      window.hjDefaultPaymentRows = copy.paymentCurrent;
      document.body.dataset.copied2026RowCount = String(copy.counts.copied2026Rows);
      document.body.dataset.generated2026RowCount = String(copy.counts.generated2026Rows);
      document.body.dataset.generated2027RowCount = String(copy.counts.generated2027Rows);
      await loadScript("./ops/payments.js?v=20260721-structured-stage-1");
      // 必須最後載入 UI，讓它以複製按鈕方式移除舊智慧帶入監聽器。
      await loadScript("./ops/payment-smart-test-ui.js");
    } catch (error) {
      console.error(error);
      document.body.dataset.testLoadError = "true";
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})();
