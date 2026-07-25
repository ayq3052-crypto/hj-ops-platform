(() => {
  const crmStorageKey = "hj-crm-clean-v5-data-repair";
  const requiredTestRuntimeVersion = "20260723-payment-history-preserve-1";
  let platformDataPromise = null;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `隔離資料讀取失敗：${response.status}`);
    return payload;
  };

  const requireCurrentTestRuntime = (payload) => {
    if (payload?.testRuntimeVersion !== requiredTestRuntimeVersion) {
      throw new Error("測試 CRM 與繳費表版本不同步，請重新開啟兩個測試連結");
    }
    return payload;
  };

  const loadPlatformData = async () => {
    if (!platformDataPromise) platformDataPromise = requestJson("/__hj_payment_test_data").then(requireCurrentTestRuntime);
    return platformDataPromise;
  };

  const applyPlatformGlobals = async () => {
    const data = await loadPlatformData();
    window.HJ_CRM_SOURCE_DATA = clone(data.crmSource);
    window.hjCrmSourceData = window.HJ_CRM_SOURCE_DATA;
    window.hjImportedPaymentData = clone(data.paymentImported || {});
    window.hjImportedPaymentDataByYear = clone(data.paymentImportedByYear || {});
    window.hjDefaultPaymentRows = clone(data.paymentCurrent || []);
    window.hjFutureDraftItems = [];
    window.HJ_STAMP_ASSETS = {};
    return data;
  };

  const refreshPlatformData = async () => {
    platformDataPromise = null;
    return loadPlatformData();
  };

  const syncCrmYearData = async (crmData) => {
    const result = requireCurrentTestRuntime(await requestJson("/__hj_test_crm/full-source", {
      method: "PUT",
      body: JSON.stringify({ crmSource: crmData }),
    }));
    platformDataPromise = null;
    return { rows: result.rows || 0 };
  };

  const saveCrmRow = async (row, options = {}) => {
    const result = requireCurrentTestRuntime(await requestJson("/__hj_test_crm/full-row", {
      method: "PUT",
      body: JSON.stringify({ venue: row.venue, year: options.year, row, options }),
    }));
    platformDataPromise = null;
    return result.row;
  };

  const installLocalStorageSync = () => {
    // 隔離頁也走和正式頁相同的顯式儲存路徑；不再用 localStorage 背景整批覆蓋。
    window.__hjTestCrmStorageSyncInstalled = true;
  };

  window.HJ_DB = {
    ensureSession: async () => ({ user: { id: "isolated-crm-test" } }),
    applyPlatformGlobals,
    refreshPlatformData,
    migrateLegacyCrmYears: async () => ({ migrated: false, rows: 0 }),
    clearLegacyLocalDataForDb: () => localStorage.removeItem(crmStorageKey),
    installLocalStorageSync,
    syncCrmYearData,
    saveCrmRow,
    markCrmYearSyncPending: () => {},
  };
})();
