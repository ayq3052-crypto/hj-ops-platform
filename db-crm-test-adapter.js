(() => {
  const crmStorageKey = "hj-crm-clean-v5-data-repair";
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

  const loadPlatformData = async () => {
    if (!platformDataPromise) platformDataPromise = requestJson("/__hj_payment_test_data");
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
    const result = await requestJson("/__hj_test_crm/full-source", {
      method: "PUT",
      body: JSON.stringify({ crmSource: crmData }),
    });
    platformDataPromise = null;
    return { rows: result.rows || 0 };
  };

  const saveCrmRow = async (row, options = {}) => {
    const result = await requestJson("/__hj_test_crm/full-row", {
      method: "PUT",
      body: JSON.stringify({ venue: row.venue, year: options.year, row }),
    });
    platformDataPromise = null;
    return result.row;
  };

  const installLocalStorageSync = () => {
    if (window.__hjTestCrmStorageSyncInstalled) return;
    window.__hjTestCrmStorageSyncInstalled = true;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithIsolatedCrmSync(key, value) {
      originalSetItem.call(this, key, value);
      if (this !== localStorage || key !== crmStorageKey) return;
      try {
        const parsed = JSON.parse(value);
        window.__HJ_TEST_CRM_LAST_SYNC = syncCrmYearData(parsed).catch((error) => {
          console.error("隔離 CRM 完整同步失敗", error);
          throw error;
        });
      } catch (error) {
        console.error("隔離 CRM 資料格式錯誤", error);
      }
    };
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
