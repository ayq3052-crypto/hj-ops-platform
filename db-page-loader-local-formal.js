(() => {
  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.body.appendChild(script);
  });

  const load = async () => {
    const response = await fetch("/__hj_payment_test_data", { cache: "no-store" });
    if (!response.ok) throw new Error(`3052 唯讀資料載入失敗：${response.status}`);
    const data = await response.json();
    // CRM 維持本次載入的即時讀取結果；繳費表則深拷貝成瀏覽器內的隔離副本。
    window.HJ_CRM_SOURCE_DATA = structuredClone(data.crmSource);
    window.hjCrmSourceData = window.HJ_CRM_SOURCE_DATA;
    window.hjImportedPaymentData = structuredClone(data.paymentImported);
    window.hjImportedPaymentDataByYear = structuredClone(data.paymentImportedByYear);
    window.hjDefaultPaymentRows = structuredClone(data.paymentCurrent);
    document.body.dataset.formalCustomerCount = String(data.counts.customers);
    document.body.dataset.formalPaymentRowCount = String(data.counts.paymentRows);
    document.body.dataset.copied2026RowCount = String(data.counts.copied2026Rows);
    document.body.dataset.generated2026RowCount = String(data.counts.generated2026Rows);
    document.body.dataset.generated2027RowCount = String(data.counts.generated2027Rows);
    const safety = document.querySelector(".smart-test-safety span");
    if (safety) safety.textContent = `已複製 2026 繳費表 ${data.counts.copied2026Rows} 筆｜補回 2026 缺漏 ${data.counts.generated2026Rows} 筆｜V2 生成 2027 ${data.counts.generated2027Rows} 筆｜不寫回正式資料`;
    await loadScript("./ops/roc-date.js?v=20260721-canonical-date-1");
    await loadScript("./ops/contract-pricing.js?v=20260721-canonical-date-1");
    await loadScript("./ops/payment-audit-engine.js?v=20260721-canonical-v-1");
    await loadScript("./ops/payments.js?v=20260721-structured-stage-1");
    await loadScript("./ops/payment-smart-import-v2.js?v=20260721-structured-stage-1");
    await loadScript("./ops/payment-smart-test-ui.js?v=20260721-canonical-v-1");
  };

  load().catch((error) => {
    console.error(error);
    const panel = document.createElement("div");
    panel.className = "smart-test-preview";
    panel.textContent = error.message;
    document.body.prepend(panel);
  });
})();
