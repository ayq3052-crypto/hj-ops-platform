(() => {
  const testRowsKey = "hjSmartPaymentTestV2Rows";
  const deletedRowsKey = "hjSmartPaymentTestV2DeletedRows";
  const preferredVenueKey = "hjSmartPaymentTestPreferredVenue";
  let currentPreview = null;
  let selectedTestRenewal = null;
  const byId = (id) => document.getElementById(id);
  const value = (id) => String(byId(id)?.value || "").trim();
  const escapeHtml = (input) => String(input ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  const activeCrmRows = () => {
    const source = window.HJ_CRM_SOURCE_DATA || window.hjCrmSourceData;
    if (!source?.venues) return [];
    return Object.entries(source.venues).flatMap(([venue, data]) => {
      const years = data?.years || {};
      const year = data?.activeYear || Object.keys(years).sort().at(-1);
      return (years[year] || []).filter((row) => row.folder !== "ended").map((row) => ({ ...row, venue }));
    });
  };

  const findCrmRows = (customerNo) => {
    const visibleVenue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    const normalizeCustomerNo = window.HJPaymentSmartImportV2?.normalizeCustomerNo || normalizedText;
    return activeCrmRows().filter((row) => row.venue === visibleVenue && normalizeCustomerNo(row.id) === normalizeCustomerNo(customerNo));
  };
  const findCrm = (customerNo) => findCrmRows(customerNo)[0];

  const refreshCrmSource = async () => {
    if (["127.0.0.1", "localhost"].includes(location.hostname)) {
      const response = await fetch("/__hj_payment_test_data", { cache: "no-store" });
      if (!response.ok) throw new Error(`CRM 即時重讀失敗：${response.status}`);
      const data = await response.json();
      window.HJ_CRM_SOURCE_DATA = structuredClone(data.crmSource);
      window.hjCrmSourceData = window.HJ_CRM_SOURCE_DATA;
      return;
    }
    if (window.HJ_DB?.refreshPlatformData) {
      const data = await window.HJ_DB.refreshPlatformData();
      window.HJ_CRM_SOURCE_DATA = data.crmSource;
      window.hjCrmSourceData = data.crmSource;
    }
  };

  const crmFingerprint = (crm) => JSON.stringify([
    crm?.venue, crm?.customerNo || crm?.id, crm?.name, crm?.company, crm?.service || crm?.item,
    crm?.paymentCycle || crm?.cycle,
    window.HJRocDate?.normalize?.(crm?.contractStart || crm?.start) || crm?.contractStart || crm?.start,
    window.HJRocDate?.normalize?.(crm?.contractEnd || crm?.end) || crm?.contractEnd || crm?.end,
    crm?.amount, crm?.pricePlan, crm?.hasSecondStage,
    crm?.stage1Years, window.HJRocDate?.normalize?.(crm?.stage1Start) || crm?.stage1Start, window.HJRocDate?.normalize?.(crm?.stage1End) || crm?.stage1End,
    crm?.stage2Years, window.HJRocDate?.normalize?.(crm?.stage2Start) || crm?.stage2Start, window.HJRocDate?.normalize?.(crm?.stage2End) || crm?.stage2End, crm?.stage2Amount, crm?.stage2Kind,
    JSON.stringify(crm?.pricingStages || []),
  ].map((value) => String(value ?? "").normalize("NFKC").trim()));

  const normalizedText = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();
  const hasConflictingContent = (existing, incoming) => [
    [existing?.service || existing?.item, incoming?.service || incoming?.item],
    [existing?.section, incoming?.section],
    [existing?.paymentCycle || existing?.cycle, incoming?.paymentCycle || incoming?.cycle],
    [existing?.monthlyPrice ?? existing?.price, incoming?.monthlyPrice ?? incoming?.price],
    [existing?.amountDue ?? existing?.amount, incoming?.amountDue ?? incoming?.amount],
  ].some(([left, right]) => normalizedText(left) && normalizedText(right) && normalizedText(left) !== normalizedText(right));

  const formalHistory = () => {
    const source = window.hjImportedPaymentDataByYear || {};
    return Object.entries(source).flatMap(([venue, years]) =>
      Object.entries(years || {}).flatMap(([year, months]) =>
        Object.entries(months || {}).flatMap(([monthLabel, rows]) =>
          (rows || []).map((row) => ({
            ...row,
            venue,
            year: Number(year),
            month: Number(String(monthLabel).replace(/\D/g, "")),
            source_snapshot: row,
          }))
        )
      )
    );
  };

  const formCrm = () => ({
    venue: visiblePeriod().venue,
    customerNo: value("newCustomerId"),
    name: value("newCustomerName"),
    company: value("newCustomerCompany"),
    service: byId("newCustomerSection")?.selectedOptions?.[0]?.textContent || value("newCustomerSection"),
    paymentCycle: value("newCustomerCycle"),
    contractStart: value("newCustomerStart"),
    contractEnd: value("newCustomerEnd"),
    amount: value("newCustomerPrice"),
    status: "active",
  });

  const visiblePeriod = () => {
    const venue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    return {
      venue,
      targetYear: Number(value("yearSelect") || new Date().getFullYear()),
      targetMonth: Number(document.querySelector(`.month-tab[data-venue="${venue}"].active`)?.dataset.month?.replace(/\D/g, "")),
    };
  };

  const showPreview = (preview) => {
    currentPreview = preview;
    let panel = byId("smartTestPreview");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "smartTestPreview";
      panel.className = "smart-test-preview";
      document.querySelector(".sheet-heading")?.insertAdjacentElement("afterend", panel);
    }
    if (!preview.ok) {
      panel.innerHTML = `<strong>暫停，需人工確認</strong><span>${preview.errors.join("；")}</span><button id="closeSmartTestPreview" type="button">關閉預覽</button>`;
      byId("closeSmartTestPreview").addEventListener("click", closePreview);
      return;
    }
    const rows = preview.payments.map((row) => `${row.dueKey}｜${row.section}｜${row.paymentCycle}｜${row.amountDue}`).join("<br>");
    const crm = preview.crm || {};
    const crmSummary = `${crm.service || ""}｜${crm.paymentCycle || ""}｜${crm.contractStart || ""} → ${crm.contractEnd || "無到期日"}｜${crm.amount || ""}`;
    panel.innerHTML = `<strong>只預覽，尚未新增（${preview.payments.length} 筆）</strong><small>CRM 新循環：${escapeHtml(crmSummary)}</small><span>${rows || "沒有新繳費列"}</span>${preview.reminder ? `<small>合約到期提醒：${preview.reminder.dueKey}</small>` : "<small>持續月繳，不產生續約提醒</small>"}<button id="confirmSmartTestPreview" type="button">確認新增到隔離測試</button><button id="closeSmartTestPreview" type="button">關閉預覽</button>`;
    byId("confirmSmartTestPreview").addEventListener("click", commitPreview);
    byId("closeSmartTestPreview").addEventListener("click", closePreview);
  };

  const closePreview = () => {
    currentPreview = null;
    byId("smartTestPreview")?.remove();
  };

  const dateSerial = (value) => {
    const parsed = window.HJPaymentSmartImportV2.parseRocDate(value);
    return parsed ? Math.floor(Date.UTC(parsed.westernYear, parsed.month - 1, parsed.day) / 86400000) : null;
  };

  const isSameOrNextDay = (oldEnd, newStart) => {
    const oldSerial = dateSerial(oldEnd);
    const newSerial = dateSerial(newStart);
    return oldSerial !== null && newSerial !== null && (newSerial === oldSerial || newSerial === oldSerial + 1);
  };

  const selectTestRenewal = (row, article) => {
    selectedTestRenewal = row;
    document.querySelectorAll(".payment-row.smart-test-inserted.selected").forEach((node) => node.classList.remove("selected"));
    article.classList.add("selected");
    const editor = byId("rowEditor");
    if (editor) editor.hidden = false;
    if (byId("editorTitle")) byId("editorTitle").textContent = `${row.customerNo} ${row.company || row.name || ""}`;
    const reminder = byId("contractReminder");
    if (reminder) reminder.hidden = false;
    if (byId("contractReminderText")) {
      byId("contractReminderText").textContent = `${row.customerNo} ${row.company || row.name || ""}：先在測試 CRM 建好下一期資料，再智慧帶入續約資料。`;
    }
    byId("rowEditor")?.scrollIntoView({ block: "nearest" });
  };

  const commitPreviewUnlocked = async () => {
    if (!currentPreview?.ok) return;
    try {
      await refreshCrmSource();
    } catch (error) {
      showPreview({ ok: false, errors: [error.message], payments: [], reminder: null });
      return;
    }
    const liveMatches = findCrmRows(currentPreview.crm?.customerNo || "");
    const liveCrm = liveMatches[0];
    if (liveMatches.length !== 1 || !liveCrm || crmFingerprint(liveCrm) !== crmFingerprint(currentPreview.crm)) {
      showPreview({ ok: false, errors: ["CRM 已在預覽後變更；舊預覽已作廢，請重新智慧帶入"], payments: [], reminder: null });
      return;
    }
    const current = JSON.parse(localStorage.getItem(testRowsKey) || "[]");
    const deleted = JSON.parse(localStorage.getItem(deletedRowsKey) || "[]");
    const deletedIdentities = new Set(deleted.map((row) => window.HJPaymentSmartImportV2.previewIdentity(row)));
    const formalRows = formalHistory();
    const comparableFormalRows = formalRows.map((row) => ({
      venue: row.venue,
      customerNo: row.id,
      contractStart: row.start,
      contractEnd: row.end,
      dueYear: row.year,
      dueMonth: row.month,
      type: String(row.note || "").startsWith("合約到期") ? "renewal-reminder" : "payment",
      service: row.service || row.item,
      section: row.section,
      paymentCycle: row.cycle,
      monthlyPrice: row.price,
      amountDue: row.amount,
    }));
    const allExisting = [...comparableFormalRows, ...current];
    const existingByIdentity = new Map(allExisting.map((row) => [window.HJPaymentSmartImportV2.previewIdentity(row), row]));
    const existingIdentities = new Set(existingByIdentity.keys());
    const candidates = [...currentPreview.payments, currentPreview.reminder].filter(Boolean);
    const conflict = candidates.find((row) => {
      const existing = existingByIdentity.get(window.HJPaymentSmartImportV2.previewIdentity(row));
      return existing && hasConflictingContent(existing, row);
    });
    if (conflict) {
      showPreview({
        ok: false,
        errors: [`同一館別＋編號＋CRM 合約循環＋月份已有不同內容（${conflict.dueKey}）；已停止新增，請人工確認`],
        payments: [],
        reminder: null,
      });
      return;
    }
    const canInsert = (row) => {
      const identity = window.HJPaymentSmartImportV2.previewIdentity(row);
      return !deletedIdentities.has(identity) && !existingIdentities.has(identity);
    };
    const safePreview = {
      ...currentPreview,
      payments: currentPreview.payments.filter(canInsert),
      reminder: currentPreview.reminder && canInsert(currentPreview.reminder) ? currentPreview.reminder : null,
    };
    const result = window.HJPaymentSmartImportV2.insertPreview(current, safePreview);
    localStorage.setItem(testRowsKey, JSON.stringify(result.rows));
    renderIsolatedRows();
    byId("smartTestPreview")?.insertAdjacentHTML("beforeend", `<small>已隔離新增 ${result.inserted.length} 筆；重按不會重複。</small>`);
  };

  const commitPreview = async () => {
    if (navigator.locks?.request) {
      await navigator.locks.request("hj-payment-smart-test-write", commitPreviewUnlocked);
      return;
    }
    await commitPreviewUnlocked();
  };

  const renderIsolatedRows = () => {
    document.querySelectorAll(".smart-test-inserted").forEach((node) => node.remove());
    const body = byId("paymentRows");
    if (!body) return;
    body.querySelectorAll(".smart-test-renewal-resolved").forEach((node) => {
      node.classList.remove("smart-test-renewal-resolved");
      node.hidden = false;
    });
    const venue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    const year = Number(value("yearSelect") || new Date().getFullYear());
    const month = Number(document.querySelector(`.month-tab[data-venue="${venue}"].active`)?.dataset.month?.replace(/\D/g, ""));
    const allIsolatedRows = JSON.parse(localStorage.getItem(testRowsKey) || "[]");
    const rows = allIsolatedRows
      .filter((row) => row.venue === venue && row.dueYear === year && row.dueMonth === month);

    const confirmedRenewals = allIsolatedRows.filter((row) => row.type === "payment" && row.venue === venue);
    body.querySelectorAll(".payment-row.renewal:not(.smart-test-inserted)").forEach((node) => {
      const customerNo = normalizedText(node.children[0]?.textContent);
      const oldContractEnd = String(node.children[5]?.textContent || "").trim();
      const resolved = confirmedRenewals.some((row) =>
        normalizedText(row.customerNo) === customerNo && isSameOrNextDay(oldContractEnd, row.contractStart)
      );
      if (!resolved) return;
      node.classList.add("smart-test-renewal-resolved");
      node.hidden = true;
    });
    if (!rows.length) return;

    const sectionOrder = ["年繳 / 2Y", "辦公室", "營登", "自由座"];
    const sectionRank = (section) => {
      const rank = sectionOrder.indexOf(String(section || "").trim());
      return rank === -1 ? sectionOrder.length : rank;
    };
    const closingHeading = () => Array.from(body.children).find((node) =>
      node.classList?.contains("payment-section") && /^待遷出/.test(node.textContent.trim())
    );
    const ensureSectionHeading = (sectionName) => {
      const existing = Array.from(body.children).find((node) =>
        node.classList?.contains("payment-section") && node.textContent.trim() === sectionName
      );
      if (existing) return existing;

      const heading = document.createElement("div");
      heading.className = "payment-section smart-test-inserted";
      heading.textContent = sectionName;
      const nextSection = Array.from(body.children).find((node) =>
        node.classList?.contains("payment-section") &&
        !/^待遷出/.test(node.textContent.trim()) &&
        sectionRank(node.textContent) > sectionRank(sectionName)
      );
      body.insertBefore(heading, nextSection || closingHeading() || null);
      return heading;
    };
    const insertionAnchor = (heading) => {
      let node = heading.nextElementSibling;
      while (node && !node.classList.contains("payment-section")) node = node.nextElementSibling;
      return node;
    };

    const sortedRows = [...rows].sort((left, right) =>
      sectionRank(left.section) - sectionRank(right.section) ||
      String(left.customerNo || "").localeCompare(String(right.customerNo || ""), "zh-Hant", { numeric: true })
    );
    for (const row of sortedRows) {
      const heading = ensureSectionHeading(row.section || "待確認");
      const anchor = insertionAnchor(heading);
      const article = document.createElement("article");
      article.className = `payment-row smart-test-inserted${row.type === "renewal-reminder" ? " renewal" : ""}`;
      article.dataset.testIdentity = window.HJPaymentSmartImportV2.previewIdentity(row);
      const isReminder = row.type === "renewal-reminder";
      article.innerHTML = `
        <span>${escapeHtml(row.customerNo)}</span><span>${escapeHtml(row.name || "")}</span><strong>${escapeHtml(row.company || "")}</strong>
        <span>${escapeHtml(row.paymentCycle)}</span><span>${escapeHtml(row.contractStart)}</span><span>${escapeHtml(row.contractEnd)}</span>
        <span>${row.monthlyPrice == null || row.monthlyPrice === "" ? "" : `${escapeHtml(row.monthlyPrice)}/m`}</span><span>${escapeHtml(row.paidDate)}</span><span>${escapeHtml(row.paidAmount)}</span><span>${escapeHtml(row.nextDate)}</span><span>${escapeHtml(row.invoice)}</span>
        <span class="status-note-cell"><b class="sheet-status ${isReminder ? "renewal" : ""}">${isReminder ? "確認續約" : "測試"}</b><em>${escapeHtml(isReminder ? "合約到期，先確認續約" : row.note || "隔離新增，不在正式資料")}</em></span>`;
      article.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isReminder) selectTestRenewal(row, article);
        else openTestEditor(article.dataset.testIdentity);
      });
      body.insertBefore(article, anchor);
    }
  };

  const reconcileVisibleSummary = () => {
    const summary = document.querySelector("[data-venue-summary].selected-venue");
    const body = byId("paymentRows");
    if (!summary || !body) return;
    const formalRows = Array.from(body.querySelectorAll(".payment-row:not(.smart-test-inserted):not(.smart-test-renewal-resolved)"));
    const venue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    const year = Number(value("yearSelect") || new Date().getFullYear());
    const month = Number(document.querySelector(`.month-tab[data-venue="${venue}"].active`)?.dataset.month?.replace(/\D/g, ""));
    const isolatedRows = JSON.parse(localStorage.getItem(testRowsKey) || "[]")
      .filter((row) => row.venue === venue && row.dueYear === year && row.dueMonth === month);
    const formalSpecial = formalRows.filter((row) =>
      ["renewal", "closing", "nonbillable", "check"].some((status) => row.classList.contains(status))
    ).length;
    const isolatedStatus = isolatedRows.reduce((counts, row) => {
      if (row.type === "renewal-reminder") counts.special += 1;
      else if (row.paidDate && row.paidAmount && !row.invoice) counts.invoice += 1;
      else if (!row.paidDate && !row.paidAmount) counts.unpaid += 1;
      else if (!(row.paidDate && row.paidAmount && row.invoice)) counts.special += 1;
      return counts;
    }, { unpaid: 0, invoice: 0, special: 0 });
    const counts = {
      all: formalRows.length + isolatedRows.length,
      unpaid: formalRows.filter((row) => row.classList.contains("unpaid")).length + isolatedStatus.unpaid,
      invoice: formalRows.filter((row) => row.classList.contains("invoice")).length + isolatedStatus.invoice,
      special: formalSpecial + isolatedStatus.special,
    };
    const targets = {
      all: summary.querySelector('[data-summary-count="all"]'),
      unpaid: summary.querySelector('[data-summary-count="unpaid"]'),
      invoice: summary.querySelector('[data-summary-count="invoice"]'),
      special: summary.querySelector('[data-summary-count="closing"]'),
    };
    Object.entries(targets).forEach(([key, target]) => {
      if (target) target.textContent = String(counts[key]);
    });
  };

  const openTestEditor = (identity) => {
    const rows = JSON.parse(localStorage.getItem(testRowsKey) || "[]");
    const row = rows.find((item) => window.HJPaymentSmartImportV2.previewIdentity(item) === identity);
    if (!row) return;
    let editor = byId("smartTestManualEditor");
    if (!editor) {
      editor = document.createElement("section");
      editor.id = "smartTestManualEditor";
      editor.className = "smart-test-preview smart-test-manual-editor";
      document.querySelector(".sheet-heading")?.insertAdjacentElement("afterend", editor);
    }
    editor.innerHTML = `
      <strong>隔離測試列人工編輯：${escapeHtml(row.customerNo)} ${escapeHtml(row.company)}</strong>
      <label>區塊<input id="smartEditSection" value="${escapeHtml(row.section)}"></label>
      <label>姓名<input id="smartEditName" value="${escapeHtml(row.name)}"></label>
      <label>公司<input id="smartEditCompany" value="${escapeHtml(row.company)}"></label>
      <label>方式<input id="smartEditCycle" value="${escapeHtml(row.paymentCycle)}"></label>
      <label>起始<input id="smartEditStart" value="${escapeHtml(row.contractStart)}"></label>
      <label>到期<input id="smartEditEnd" value="${escapeHtml(row.contractEnd)}"></label>
      <label>單價<input id="smartEditPrice" value="${escapeHtml(row.monthlyPrice)}"></label>
      <label>繳費日<input id="smartEditPaidDate" value="${escapeHtml(row.paidDate)}"></label>
      <label>繳費金額<input id="smartEditPaidAmount" value="${escapeHtml(row.paidAmount)}"></label>
      <label>下次繳費<input id="smartEditNextDate" value="${escapeHtml(row.nextDate)}"></label>
      <label>發票<input id="smartEditInvoice" value="${escapeHtml(row.invoice)}"></label>
      <label>備註<input id="smartEditNote" value="${escapeHtml(row.note)}"></label>
      <button id="saveSmartTestEdit" type="button">保存隔離修改</button>
      <button id="deleteSmartTestRow" type="button">刪除隔離列</button>`;
    byId("saveSmartTestEdit").addEventListener("click", () => {
      const editedPrice = Number(value("smartEditPrice").replace(/,/g, ""));
      const editedCycle = value("smartEditCycle").toUpperCase();
      Object.assign(row, {
        section: value("smartEditSection"),
        name: value("smartEditName"),
        company: value("smartEditCompany"),
        paymentCycle: editedCycle,
        contractStart: value("smartEditStart"),
        contractEnd: value("smartEditEnd"),
        monthlyPrice: Number.isFinite(editedPrice) ? editedPrice : row.monthlyPrice,
        amountDue: Number.isFinite(editedPrice) && window.HJPaymentSmartImportV2.cycleMonths(editedCycle)
          ? editedPrice * window.HJPaymentSmartImportV2.cycleMonths(editedCycle)
          : row.amountDue,
        paidDate: value("smartEditPaidDate"),
        paidAmount: value("smartEditPaidAmount"),
        nextDate: value("smartEditNextDate"),
        invoice: value("smartEditInvoice"),
        note: value("smartEditNote"),
      });
      localStorage.setItem(testRowsKey, JSON.stringify(rows));
      renderIsolatedRows();
      editor.insertAdjacentHTML("beforeend", "<small>隔離修改已保存；正式資料未變更。</small>");
    });
    byId("deleteSmartTestRow").addEventListener("click", () => {
      const identityToDelete = window.HJPaymentSmartImportV2.previewIdentity(row);
      const remaining = rows.filter((item) => window.HJPaymentSmartImportV2.previewIdentity(item) !== identityToDelete);
      const deleted = JSON.parse(localStorage.getItem(deletedRowsKey) || "[]");
      if (!deleted.some((item) => window.HJPaymentSmartImportV2.previewIdentity(item) === identityToDelete)) deleted.push(row);
      localStorage.setItem(testRowsKey, JSON.stringify(remaining));
      localStorage.setItem(deletedRowsKey, JSON.stringify(deleted));
      renderIsolatedRows();
      editor.innerHTML = `<strong>隔離列已刪除，正式資料未變更。</strong><button id="restoreSmartTestRow" type="button">復原刪除</button>`;
      byId("restoreSmartTestRow").addEventListener("click", () => {
        const currentRows = JSON.parse(localStorage.getItem(testRowsKey) || "[]");
        const deletedRows = JSON.parse(localStorage.getItem(deletedRowsKey) || "[]");
        const restored = deletedRows.find((item) => window.HJPaymentSmartImportV2.previewIdentity(item) === identityToDelete);
        if (restored && !currentRows.some((item) => window.HJPaymentSmartImportV2.previewIdentity(item) === identityToDelete)) currentRows.push(restored);
        localStorage.setItem(testRowsKey, JSON.stringify(currentRows));
        localStorage.setItem(deletedRowsKey, JSON.stringify(deletedRows.filter((item) => window.HJPaymentSmartImportV2.previewIdentity(item) !== identityToDelete)));
        renderIsolatedRows();
        editor.innerHTML = "<strong>隔離列已復原。</strong>";
      });
    });
  };

  const install = () => {
    const smartButton = byId("checkCrmButton");
    const addButton = byId("addCustomerButton");
    const renewalButton = byId("smartFillRenewal");
    if (smartButton) {
      const safe = smartButton.cloneNode(true);
      safe.textContent = "智慧帶入預覽";
      smartButton.replaceWith(safe);
      safe.addEventListener("click", async () => {
        try {
          await refreshCrmSource();
        } catch (error) {
          showPreview({ ok: false, errors: [error.message], payments: [], reminder: null });
          return;
        }
        const customerNo = value("newCustomerId");
        const crmMatches = findCrmRows(customerNo);
        if (crmMatches.length > 1) {
          showPreview({ ok: false, errors: ["同一館別＋編號有兩筆有效 CRM；已停止，請先整理 CRM"], payments: [], reminder: null });
          return;
        }
        const crm = findCrm(customerNo) || formCrm();
        if (findCrm(customerNo)) {
          byId("newCustomerName").value = crm.name || "";
          byId("newCustomerCompany").value = crm.company || "";
          byId("newCustomerCycle").value = crm.cycle || "";
          byId("newCustomerStart").value = crm.start || "";
          byId("newCustomerEnd").value = crm.end || "";
          byId("newCustomerPrice").value = crm.amount || "";
        }
        showPreview(window.HJPaymentSmartImportV2.buildPreview({ crm, history: formalHistory(), mode: "new", ...visiblePeriod() }));
      });
    }
    if (addButton) {
      const safe = addButton.cloneNode(true);
      safe.textContent = "測試新增（隔離）";
      addButton.replaceWith(safe);
      safe.addEventListener("click", commitPreview);
    }
    if (renewalButton) {
      const safe = renewalButton.cloneNode(true);
      safe.textContent = "智慧續約預覽";
      renewalButton.replaceWith(safe);
      safe.addEventListener("click", async () => {
        try {
          await refreshCrmSource();
        } catch (error) {
          showPreview({ ok: false, errors: [error.message], payments: [], reminder: null });
          return;
        }
        const customerNo = selectedTestRenewal?.customerNo || (byId("editorTitle")?.textContent || "").trim().split(/\s+/)[0];
        const crmMatches = findCrmRows(customerNo);
        if (crmMatches.length > 1) {
          showPreview({ ok: false, errors: ["同一館別＋編號有兩筆有效 CRM；已停止，請先整理 CRM"], payments: [], reminder: null });
          return;
        }
        const crm = findCrm(customerNo);
        if (!crm) {
          showPreview({ ok: false, errors: ["3052 CRM 查不到這個館別＋編號"], payments: [], reminder: null });
          return;
        }
        const selectedCells = document.querySelector(".payment-row.selected")?.children || [];
        const selectedStart = selectedTestRenewal?.contractStart || value("editStart") || String(selectedCells[4]?.textContent || "").trim();
        const selectedEnd = selectedTestRenewal?.contractEnd || value("editEnd") || String(selectedCells[5]?.textContent || "").trim();
        const sameDate = (left, right) => window.HJRocDate?.same?.(left, right) || String(left || "").trim() === String(right || "").trim();
        if (sameDate(selectedStart, crm.start) && sameDate(selectedEnd, crm.end)) {
          showPreview({ ok: false, errors: ["3052 CRM 尚未建立新的續約循環"], payments: [], reminder: null });
          return;
        }
        const oldEnd = window.HJPaymentSmartImportV2.parseRocDate(selectedEnd);
        const newStart = window.HJPaymentSmartImportV2.parseRocDate(crm.start);
        const selectedStartDate = window.HJPaymentSmartImportV2.parseRocDate(selectedStart);
        const newEnd = window.HJPaymentSmartImportV2.parseRocDate(crm.end);
        const selectedEndDate = window.HJPaymentSmartImportV2.parseRocDate(selectedEnd);
        const isSameStartExtension = selectedStartDate && newStart && selectedEndDate && newEnd &&
          selectedStartDate.dayIndex === newStart.dayIndex && newEnd.dayIndex > selectedEndDate.dayIndex;
        if (oldEnd && newStart && newStart.dayIndex < oldEnd.dayIndex && !isSameStartExtension) {
          showPreview({ ok: false, errors: ["CRM 新循環起始月份早於舊循環到期月份，需人工確認"], payments: [], reminder: null });
          return;
        }
        showPreview(window.HJPaymentSmartImportV2.buildPreview({ crm, history: formalHistory(), mode: "renewal", ...visiblePeriod() }));
      });
    }
    const restoreVisibleIsolatedRows = () => window.setTimeout(() => {
      renderIsolatedRows();
      reconcileVisibleSummary();
    }, 0);
    let venueBeforeYearChange = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    document.querySelectorAll(".month-tab, [data-venue-toolbar]").forEach((control) => control.addEventListener("click", () => {
      selectedTestRenewal = null;
      const selectedVenue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar;
      if (selectedVenue) {
        venueBeforeYearChange = selectedVenue;
        sessionStorage.setItem(preferredVenueKey, selectedVenue);
      }
      restoreVisibleIsolatedRows();
    }));
    byId("yearSelect")?.addEventListener("pointerdown", () => {
      venueBeforeYearChange = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || venueBeforeYearChange;
    });
    byId("yearSelect")?.addEventListener("focus", () => {
      venueBeforeYearChange = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || venueBeforeYearChange;
    });
    byId("yearSelect")?.addEventListener("change", () => window.setTimeout(() => {
      selectedTestRenewal = null;
      const active = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar;
      if (active !== venueBeforeYearChange) {
        document.querySelector(`.month-tab[data-venue="${venueBeforeYearChange}"].active`)?.click();
      }
      sessionStorage.setItem(preferredVenueKey, venueBeforeYearChange);
      renderIsolatedRows();
      reconcileVisibleSummary();
    }, 0));
    const paymentBody = byId("paymentRows");
    if (paymentBody) {
      let repairQueued = false;
      new MutationObserver((mutations) => {
        const formalRowsChanged = mutations.some((mutation) =>
          [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
            node.nodeType === 1 && !node.classList.contains("smart-test-inserted")
          )
        );
        if (formalRowsChanged && !repairQueued) {
          repairQueued = true;
          window.setTimeout(() => {
            repairQueued = false;
            renderIsolatedRows();
            reconcileVisibleSummary();
          }, 0);
          return;
        }
        reconcileVisibleSummary();
      }).observe(paymentBody, { childList: true });
    }
    window.addEventListener("storage", (event) => {
      if (event.key === testRowsKey || event.key === deletedRowsKey) renderIsolatedRows();
    });
    document.body.dataset.replacementReady = "false";
    const preferredVenue = sessionStorage.getItem(preferredVenueKey);
    if (preferredVenue && preferredVenue !== document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar) {
      document.querySelector(`.month-tab[data-venue="${preferredVenue}"].active`)?.click();
    }
    renderIsolatedRows();
    reconcileVisibleSummary();
  };

  if (document.readyState === "complete") window.setTimeout(install, 0);
  else window.addEventListener("load", () => window.setTimeout(install, 0), { once: true });
})();
