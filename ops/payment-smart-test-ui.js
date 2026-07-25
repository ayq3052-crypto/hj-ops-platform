(() => {
  const requiredTestRuntimeVersion = "20260723-payment-history-preserve-1";
  const testRowsKey = "hjSmartPaymentTestV2RowsClean20260724";
  const deletedRowsKey = "hjSmartPaymentTestV2DeletedRowsClean20260724";
  const preferredVenueKey = "hjSmartPaymentTestPreferredVenue";
  let currentPreview = null;
  let selectedTestRenewal = null;
  let selectedTestPaymentIdentity = "";
  const byId = (id) => document.getElementById(id);
  const value = (id) => String(byId(id)?.value || "").trim();
  const escapeHtml = (input) => String(input ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  const activeCrmRows = () => {
    const source = window.HJ_CRM_SOURCE_DATA || window.hjCrmSourceData;
    if (!source?.venues) return [];
    const rows = Object.entries(source.venues).flatMap(([venue, data]) => {
      const years = data?.years || {};
      return Object.entries(years).flatMap(([year, rows]) => (rows || [])
        .filter((row) => window.HJCrmCycle?.isPaymentEligible?.(row, year) ?? row.folder !== "ended")
        .map((row) => ({ ...row, venue, crmYear: Number(year) })));
    });
    const seenSourceCycles = new Set();
    return rows
      .sort((left, right) => Number(left.isProjection === true) - Number(right.isProjection === true))
      .filter((row) => {
      const key = `${row.venue}|${window.HJCrmCycle?.cycleKey?.(row) || `${normalizedText(row.id)}|${row.start}|${row.end}`}`;
      if (row.isProjection === true && seenSourceCycles.has(key)) return false;
      if (row.isProjection !== true) seenSourceCycles.add(key);
      return true;
      });
  };

  const findCrmRows = (customerNo) => {
    const visibleVenue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    const normalizeCustomerNo = window.HJPaymentSmartImportV2?.normalizeCustomerNo || normalizedText;
    return activeCrmRows().filter((row) => row.venue === visibleVenue && normalizeCustomerNo(row.id) === normalizeCustomerNo(customerNo));
  };
  const crmDateIndex = (value) => window.HJPaymentSmartImportV2?.parseRocDate?.(value)?.monthIndex ?? -Infinity;
  const findCurrentCrm = (customerNo) => findCrmRows(customerNo)
    .filter((row) => row.isCurrentContract !== false)
    .sort((left, right) => Number(right.contractPeriod || 0) - Number(left.contractPeriod || 0) || crmDateIndex(right.start) - crmDateIndex(left.start))[0];

  const refreshCrmSource = async () => {
    if (["127.0.0.1", "localhost"].includes(location.hostname)) {
      const response = await fetch("/__hj_payment_test_data", { cache: "no-store" });
      if (!response.ok) throw new Error(`CRM 即時重讀失敗：${response.status}`);
      const data = await response.json();
      if (data.testRuntimeVersion !== requiredTestRuntimeVersion) {
        throw new Error("測試 CRM 與繳費表版本不同步，請重新開啟兩個測試連結");
      }
      window.HJ_CRM_SOURCE_DATA = structuredClone(data.crmSource);
      window.hjCrmSourceData = window.HJ_CRM_SOURCE_DATA;
      window.HJPaymentYears?.syncFromCrm?.();
      return;
    }
    if (window.HJ_DB?.refreshPlatformData) {
      const data = await window.HJ_DB.refreshPlatformData();
      window.HJ_CRM_SOURCE_DATA = data.crmSource;
      window.hjCrmSourceData = data.crmSource;
      window.HJPaymentYears?.syncFromCrm?.();
    }
  };

  const crmFingerprint = (crm) => {
    const normalized = window.HJPaymentSmartImportV2.normalizeCrmRecord(crm || {});
    return JSON.stringify([
      normalized.venue, normalized.customerNo, normalized.name, normalized.company, normalized.service,
      normalized.paymentCycle, normalized.contractYears,
      normalized.contractStart, normalized.contractEnd,
      normalized.amount, normalized.pricePlan,
      normalized.hasSecondStage ? "true" : "false",
      normalized.stage1Years, normalized.stage1Start, normalized.stage1End,
      normalized.stage2Years, normalized.stage2Start, normalized.stage2End, normalized.stage2Amount, normalized.stage2Kind,
      JSON.stringify(normalized.pricingStages || []),
    ].map((value) => String(value ?? "").normalize("NFKC").trim()));
  };

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
    const customerLabel = `${preview.crm?.customerNo || ""} ${preview.crm?.company || preview.crm?.name || ""}`.trim();
    const currentRow = preview.currentPayment
      ? `${preview.currentPayment.dueKey}｜本期續約收款（沿用目前到期列，不另增重複列）｜${preview.currentPayment.paymentCycle}｜${preview.currentPayment.monthlyPrice}/m｜${preview.currentPayment.amountDue}`
      : "";
    const futureRows = preview.payments
      .map((row) => `${row.dueKey}｜${row.section}｜${row.paymentCycle}｜${row.monthlyPrice}/m｜${row.amountDue}`);
    const rows = [currentRow, ...futureRows].filter(Boolean).map(escapeHtml).join("<br>");
    const crm = preview.crm || {};
    const crmSummary = `${crm.customerNo || ""}｜${crm.service || ""}｜${crm.paymentCycle || ""}｜${crm.contractStart || ""} → ${crm.contractEnd || "無到期日"}｜${crm.amount || ""}`;
    const reminderSummary = preview.reminder
      ? `<small>合約到期提醒：${escapeHtml(preview.reminder.dueKey)}｜${escapeHtml(preview.reminder.paymentCycle)}｜${preview.reminder.monthlyPrice == null ? "待人工確認" : `${escapeHtml(preview.reminder.monthlyPrice)}/m`}</small>`
      : "<small>持續月繳，不產生續約提醒</small>";
    panel.innerHTML = `<strong>${escapeHtml(customerLabel)}｜只預覽，尚未新增（未來 ${preview.payments.length} 筆＋到期提醒 ${preview.reminder ? 1 : 0} 筆）</strong><small>CRM 新循環：${escapeHtml(crmSummary)}</small><span>${rows || "沒有新繳費列"}</span>${reminderSummary}<button id="confirmSmartTestPreview" type="button">確認新增到隔離測試</button><button id="closeSmartTestPreview" type="button">關閉預覽</button>`;
    byId("confirmSmartTestPreview").addEventListener("click", commitPreview);
    byId("closeSmartTestPreview").addEventListener("click", closePreview);
  };

  const closePreview = () => {
    currentPreview = null;
    byId("smartTestPreview")?.remove();
  };

  const closeManualEditor = () => byId("smartTestManualEditor")?.remove();

  const storedTestRows = () => JSON.parse(localStorage.getItem(testRowsKey) || "[]");

  const selectedTestPayment = () => {
    if (!selectedTestPaymentIdentity) return null;
    return storedTestRows().find((row) =>
      window.HJPaymentSmartImportV2.previewIdentity(row) === selectedTestPaymentIdentity
    ) || null;
  };

  const closeTestPaymentSelection = ({ hideEditor = true } = {}) => {
    selectedTestPaymentIdentity = "";
    document.querySelectorAll(".payment-row.smart-test-inserted.selected")
      .forEach((node) => node.classList.remove("selected"));
    byId("rowBasics")?.setAttribute("hidden", "");
    document.querySelector(".sheet-shell")?.classList.remove("has-row-basics");
    if (hideEditor) byId("rowEditor")?.setAttribute("hidden", "");
  };

  const repairStoredDerivedRows = () => {
    const rows = JSON.parse(localStorage.getItem(testRowsKey) || "[]");
    if (!rows.length) return;
    let changed = false;
    rows.forEach((row) => {
      const isUneditedSmartRow =
        row.type === "renewal-reminder" ||
        String(row.note || "") === "測試版智慧帶入";
      if (!isUneditedSmartRow || row.paidDate || row.paidAmount || row.invoice) return;
      const matchingCrm = activeCrmRows()
        .filter((crm) => crm.venue === row.venue)
        .filter((crm) => window.HJPaymentSmartImportV2.normalizeCustomerNo(crm.id) === window.HJPaymentSmartImportV2.normalizeCustomerNo(row.customerNo))
        .filter((crm) => window.HJRocDate?.same?.(crm.start, row.contractStart) && window.HJRocDate?.same?.(crm.end, row.contractEnd))
        .sort((left, right) => Number(right.isCurrentContract === true) - Number(left.isCurrentContract === true))[0];
      if (!matchingCrm) return;
      const normalized = window.HJPaymentSmartImportV2.normalizeCrmRecord(matchingCrm);
      const price = window.HJPaymentSmartImportV2.monthlyPriceAt(
        normalized,
        Number(row.dueYear) * 12 + Number(row.dueMonth) - 1,
      );
      if (price.error) return;
      const next = {
        paymentCycle: normalized.paymentCycle,
        section: window.HJPaymentSmartImportV2.displaySection(normalized.service, normalized.paymentCycle),
        monthlyPrice: price.monthly,
        amountDue: price.monthly * window.HJPaymentSmartImportV2.cycleMonths(normalized.paymentCycle),
      };
      if (Object.entries(next).some(([key, value]) => row[key] !== value)) {
        Object.assign(row, next);
        changed = true;
      }
    });
    if (changed) localStorage.setItem(testRowsKey, JSON.stringify(rows));
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

  const paymentStatusFromVisibleRow = (node) => {
    const paidDate = String(node.children[7]?.textContent || "").trim();
    const paidAmount = String(node.children[8]?.textContent || "").trim();
    const invoice = String(node.children[10]?.textContent || "").trim();
    if (paidDate && paidAmount && invoice) return { key: "done", label: "完成" };
    if (paidDate && paidAmount) return { key: "invoice", label: "待開發票" };
    if (!paidDate && !paidAmount) return { key: "unpaid", label: "待收款" };
    return { key: "check", label: "確認" };
  };

  const restoreRenewalPresentation = (node) => {
    node.classList.remove("smart-test-renewal-confirmed", "unpaid", "invoice", "done", "check");
    node.classList.add("renewal");
    const badge = node.querySelector(".sheet-status");
    if (badge) {
      badge.className = "sheet-status renewal";
      badge.textContent = "確認續約";
    }
  };

  const showConfirmedRenewalAsCurrentWork = (node) => {
    const status = paymentStatusFromVisibleRow(node);
    node.hidden = false;
    node.classList.remove("renewal", "unpaid", "invoice", "done", "check");
    node.classList.add("smart-test-renewal-confirmed", status.key);
    const badge = node.querySelector(".sheet-status");
    if (badge) {
      badge.className = `sheet-status ${status.key}`;
      badge.textContent = status.label;
    }
  };

  const selectTestRenewal = (row, article) => {
    closePreview();
    closeTestPaymentSelection();
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
    const previewFingerprint = crmFingerprint(currentPreview.crm);
    const exactMatches = liveMatches.filter((row) => crmFingerprint(row) === previewFingerprint);
    const liveCrm = exactMatches[0];
    if (exactMatches.length !== 1 || !liveCrm) {
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
    const currentNote = currentPreview.currentPayment ? "本期續約收款沿用目前到期列，未另增重複列；" : "";
    byId("smartTestPreview")?.insertAdjacentHTML("beforeend", `<small>${currentNote}已隔離新增 ${result.inserted.length} 筆；重按不會重複。</small>`);
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
    body.querySelectorAll(".smart-test-renewal-confirmed").forEach(restoreRenewalPresentation);
    const venue = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    const year = Number(value("yearSelect") || new Date().getFullYear());
    const month = Number(document.querySelector(`.month-tab[data-venue="${venue}"].active`)?.dataset.month?.replace(/\D/g, ""));
    const allIsolatedRows = JSON.parse(localStorage.getItem(testRowsKey) || "[]");
    const searchQuery = normalizedText(value("paymentSearch"));
    const rows = allIsolatedRows
      .filter((row) => row.venue === venue && row.dueYear === year && row.dueMonth === month)
      .filter((row) => !searchQuery || [
        row.customerNo,
        row.name,
        row.company,
        row.paymentCycle,
        row.note,
      ].some((field) => normalizedText(field).includes(searchQuery)));

    const confirmedRenewals = [
      ...allIsolatedRows.filter((row) => row.venue === venue),
      ...formalHistory()
        .filter((row) => row.venue === venue && !String(row.note || "").startsWith("合約到期"))
        .map((row) => ({
          customerNo: row.customerNo || row.id,
          contractStart: row.contractStart || row.start,
        })),
    ];
    body.querySelectorAll(".payment-row.renewal:not(.smart-test-inserted)").forEach((node) => {
      const customerNo = normalizedText(node.children[0]?.textContent);
      const oldContractEnd = String(node.children[5]?.textContent || "").trim();
      const resolved = confirmedRenewals.some((row) =>
        normalizedText(row.customerNo) === customerNo && isSameOrNextDay(oldContractEnd, row.contractStart)
      );
      if (!resolved) return;
      showConfirmedRenewalAsCurrentWork(node);
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
      const identity = window.HJPaymentSmartImportV2.previewIdentity(row);
      article.className = `payment-row smart-test-inserted${row.type === "renewal-reminder" ? " renewal" : ""}${identity === selectedTestPaymentIdentity ? " selected" : ""}`;
      article.dataset.testIdentity = identity;
      const isReminder = row.type === "renewal-reminder";
      article.innerHTML = `
        <span>${escapeHtml(row.customerNo)}</span><span>${escapeHtml(row.name || "")}</span><strong>${escapeHtml(row.company || "")}</strong>
        <span>${escapeHtml(row.paymentCycle)}</span><span>${escapeHtml(row.contractStart)}</span><span>${escapeHtml(row.contractEnd)}</span>
        <span>${row.monthlyPrice == null || row.monthlyPrice === "" ? "" : `${escapeHtml(row.monthlyPrice)}/m`}</span><span>${escapeHtml(row.paidDate)}</span><span>${escapeHtml(row.paidAmount)}</span><span>${escapeHtml(row.nextDate)}</span><span>${escapeHtml(row.invoice)}</span>
        <span class="status-note-cell"><b class="sheet-status ${isReminder ? "renewal" : ""}">${isReminder ? "確認續約" : "測試"}</b><em>${escapeHtml(isReminder ? "合約到期，先確認續約" : row.note || "隔離新增，不在正式資料")}</em></span>`;
      article.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isReminder) selectTestRenewal(row, article);
        else if (selectedTestPaymentIdentity === article.dataset.testIdentity) closeTestPaymentSelection();
        else openTestEditor(article.dataset.testIdentity);
      });
      body.insertBefore(article, anchor);
    }
  };

  const reconcileVisibleSummary = () => {
    const summary = document.querySelector("[data-venue-summary].selected-venue");
    const body = byId("paymentRows");
    if (!summary || !body) return;
    const formalRows = Array.from(body.querySelectorAll(".payment-row:not(.smart-test-inserted)"));
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

  const syncTestRowInTable = (row) => {
    const identity = window.HJPaymentSmartImportV2.previewIdentity(row);
    const article = Array.from(document.querySelectorAll(".payment-row.smart-test-inserted"))
      .find((node) => node.dataset.testIdentity === identity);
    if (!article) return;
    const cells = article.children;
    cells[1].textContent = row.name || "";
    cells[2].textContent = row.company || "";
    cells[3].textContent = row.paymentCycle || "";
    cells[4].textContent = row.contractStart || "";
    cells[5].textContent = row.contractEnd || "";
    cells[6].textContent = row.monthlyPrice == null || row.monthlyPrice === "" ? "" : `${row.monthlyPrice}/m`;
    cells[7].textContent = row.paidDate || "";
    cells[8].textContent = row.paidAmount || "";
    cells[9].textContent = row.nextDate || "";
    cells[10].textContent = row.invoice || "";
    const status = row.manualStatus === "nonbillable"
      ? { key: "nonbillable", label: "不收款" }
      : row.paidDate && row.paidAmount && row.invoice
        ? { key: "done", label: "完成" }
        : row.paidDate && row.paidAmount
          ? { key: "invoice", label: "待開發票" }
          : { key: "unpaid", label: "待收款" };
    const badge = article.querySelector(".sheet-status");
    if (badge) {
      badge.className = `sheet-status ${status.key}`;
      badge.textContent = status.label;
    }
  };

  const saveSelectedTestPayment = (changes, { rerender = false } = {}) => {
    if (!selectedTestPaymentIdentity) return null;
    const rows = storedTestRows();
    const row = rows.find((item) =>
      window.HJPaymentSmartImportV2.previewIdentity(item) === selectedTestPaymentIdentity
    );
    if (!row) return null;
    Object.assign(row, changes);
    selectedTestPaymentIdentity = window.HJPaymentSmartImportV2.previewIdentity(row);
    localStorage.setItem(testRowsKey, JSON.stringify(rows));
    if (rerender) {
      renderIsolatedRows();
      openTestEditor(selectedTestPaymentIdentity, { scroll: false });
    } else {
      syncTestRowInTable(row);
      reconcileVisibleSummary();
    }
    return row;
  };

  const annualSearchMatches = (term) => {
    const query = normalizedText(term);
    if (!query) return [];
    const { venue, targetYear } = visiblePeriod();
    const rows = [
      ...formalHistory()
        .filter((row) => row.venue === venue && Number(row.year) === targetYear)
        .map((row) => ({
          customerNo: row.customerNo || row.id,
          name: row.name || "",
          company: row.company || "",
          month: Number(row.month),
        })),
      ...storedTestRows()
        .filter((row) => row.venue === venue && Number(row.dueYear) === targetYear)
        .map((row) => ({
          customerNo: row.customerNo,
          name: row.name || "",
          company: row.company || "",
          month: Number(row.dueMonth),
        })),
    ];
    const matching = rows.filter((row) =>
      [row.customerNo, row.name, row.company].some((field) => normalizedText(field).includes(query))
    );
    const grouped = new Map();
    matching.forEach((row) => {
      const key = `${normalizedText(row.customerNo)}|${normalizedText(row.company || row.name)}`;
      const item = grouped.get(key) || {
        customerNo: row.customerNo,
        company: row.company || row.name || "",
        months: new Set(),
      };
      if (Number.isInteger(row.month) && row.month >= 1 && row.month <= 12) item.months.add(row.month);
      grouped.set(key, item);
    });
    return Array.from(grouped.values())
      .map((item) => ({ ...item, months: Array.from(item.months).sort((a, b) => a - b) }))
      .sort((left, right) =>
        Number(normalizedText(right.customerNo) === query) - Number(normalizedText(left.customerNo) === query) ||
        String(left.customerNo).localeCompare(String(right.customerNo), "zh-Hant", { numeric: true })
      );
  };

  const renderAnnualSearchHint = () => {
    const hint = byId("annualPaymentSearchHint");
    if (!hint) return;
    const term = value("paymentSearch");
    if (!term) {
      hint.hidden = true;
      hint.textContent = "";
      return;
    }
    const matches = annualSearchMatches(term);
    hint.hidden = false;
    hint.textContent = matches.length
      ? matches.slice(0, 3).map((item) =>
        `${item.customerNo}｜${item.company}｜在 ${item.months.map((month) => `${month}月`).join("、")}`
      ).join("；")
      : "本年度查無資料";
  };

  const renderSelectedTestBasics = () => {
    const row = selectedTestPayment();
    const panel = byId("rowBasics");
    if (!row || !panel) return;
    panel.hidden = false;
    document.querySelector(".sheet-shell")?.classList.add("has-row-basics");
    byId("rowBasicsContext").textContent = `${row.customerNo} ${row.company || row.name || ""}`;
    byId("editSection").value = row.section || "";
    byId("editName").value = row.name || "";
    byId("editCompany").value = row.company || "";
    byId("editCycle").value = row.paymentCycle || "";
    byId("editStart").value = row.contractStart || "";
    byId("editEnd").value = row.contractEnd || "";
    byId("editPrice").value = row.monthlyPrice ?? "";
  };

  const openTestEditor = (identity, { scroll = true } = {}) => {
    const rows = storedTestRows();
    const row = rows.find((item) => window.HJPaymentSmartImportV2.previewIdentity(item) === identity);
    if (!row) return;
    closePreview();
    closeManualEditor();
    selectedTestRenewal = null;
    selectedTestPaymentIdentity = identity;
    document.querySelectorAll(".payment-row.selected").forEach((node) => node.classList.remove("selected"));
    Array.from(document.querySelectorAll(".payment-row.smart-test-inserted"))
      .find((node) => node.dataset.testIdentity === identity)
      ?.classList.add("selected");

    const reminder = byId("contractReminder");
    if (reminder) reminder.hidden = true;
    const editor = byId("rowEditor");
    if (!editor) return;
    editor.hidden = false;
    byId("editorTitle").textContent = `${row.customerNo} ${row.company || row.name || ""}`;
    byId("paidDateLabel").textContent = "繳費日";
    byId("paidAmountLabel").textContent = "繳費金額";
    byId("invoiceLabel").textContent = "發票已開";
    byId("nextDateField").hidden = false;
    byId("editPaidDate").value = row.paidDate || "";
    byId("editPaidAmount").value = row.paidAmount || "";
    byId("editNextDate").value = row.nextDate || "";
    byId("editInvoice").checked = Boolean(row.invoice);
    byId("editManualStatus").value = row.manualStatus || "normal";
    byId("editNote").value = row.note || "";
    byId("restoreFromClosing").hidden = true;
    byId("toggleRowBasics").hidden = false;
    byId("deleteSelectedRow").hidden = false;
    byId("rowBasics").hidden = true;
    document.querySelector(".sheet-shell")?.classList.remove("has-row-basics");
    if (scroll) editor.scrollIntoView({ block: "nearest" });
  };

  const install = () => {
    const smartButton = byId("checkCrmButton");
    const addButton = byId("addCustomerButton");
    const renewalButton = byId("smartFillRenewal");
    const paymentSearch = byId("paymentSearch");
    if (paymentSearch && !byId("annualPaymentSearchHint")) {
      const hint = document.createElement("output");
      hint.id = "annualPaymentSearchHint";
      hint.className = "annual-payment-search-hint";
      hint.hidden = true;
      paymentSearch.closest(".sheet-search")?.insertAdjacentElement("afterend", hint);
    }
    if (paymentSearch && paymentSearch.dataset.isolatedSearchBound !== "true") {
      paymentSearch.dataset.isolatedSearchBound = "true";
      paymentSearch.addEventListener("input", () => window.setTimeout(() => {
        renderIsolatedRows();
        renderAnnualSearchHint();
      }, 0));
    }
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
        const crmMatches = findCrmRows(customerNo).filter((row) => row.isCurrentContract !== false);
        if (crmMatches.length > 1) {
          showPreview({ ok: false, errors: ["同一館別＋編號有兩筆目前合約；已停止，請先整理 CRM"], payments: [], reminder: null });
          return;
        }
        const crm = findCurrentCrm(customerNo) || formCrm();
        if (findCurrentCrm(customerNo)) {
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
        const selectedCells = document.querySelector(".payment-row.selected")?.children || [];
        const selectedStart = selectedTestRenewal?.contractStart || value("editStart") || String(selectedCells[4]?.textContent || "").trim();
        const selectedEnd = selectedTestRenewal?.contractEnd || value("editEnd") || String(selectedCells[5]?.textContent || "").trim();
        const sameDate = (left, right) => window.HJRocDate?.same?.(left, right) || String(left || "").trim() === String(right || "").trim();
        const crm = findCrmRows(customerNo)
          // 正式 CRM 目前循環匯入隔離頁時可能是 historical；它和隔離頁內
          // 人工確認的 confirmed 都是已成立循環。投影列不是新循環，不能帶入。
          .filter((row) => row.isProjection !== true)
          .filter((row) => window.HJCrmCycle?.isConfirmed?.(row, row.crmYear) ?? ["historical", "confirmed"].includes(row.cycleState))
          .filter((row) => row.isCurrentContract !== false)
          .filter((row) => !(sameDate(selectedStart, row.start) && sameDate(selectedEnd, row.end)))
          .filter((row) => crmDateIndex(row.start) >= crmDateIndex(selectedEnd))
          .sort((left, right) => crmDateIndex(left.start) - crmDateIndex(right.start) || Number(left.contractPeriod || 0) - Number(right.contractPeriod || 0))[0];
        if (!crm) {
          showPreview({ ok: false, errors: ["3052 CRM 尚未建立新的已確認續約循環"], payments: [], reminder: null });
          return;
        }
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
      renderAnnualSearchHint();
    }, 0);
    let venueBeforeYearChange = document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar || "taichung";
    document.querySelectorAll(".month-tab, [data-venue-toolbar]").forEach((control) => control.addEventListener("click", () => {
      selectedTestRenewal = null;
      closeTestPaymentSelection();
      closePreview();
      closeManualEditor();
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
      closeTestPaymentSelection();
      closePreview();
      closeManualEditor();
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
      paymentBody.addEventListener("click", (event) => {
        const row = event.target.closest(".payment-row:not(.smart-test-inserted)");
        if (!row) return;
        selectedTestRenewal = null;
        closeTestPaymentSelection();
        closePreview();
        closeManualEditor();
      });
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

    const paymentEditor = byId("rowEditor");
    if (paymentEditor) {
      const paymentInputFields = {
        editPaidDate: "paidDate",
        editPaidAmount: "paidAmount",
        editNextDate: "nextDate",
        editNote: "note",
      };
      paymentEditor.addEventListener("input", (event) => {
        const field = paymentInputFields[event.target.id];
        if (!selectedTestPaymentIdentity || !field) return;
        event.stopImmediatePropagation();
        saveSelectedTestPayment({ [field]: event.target.value.trim() });
      }, true);
      paymentEditor.addEventListener("change", (event) => {
        if (!selectedTestPaymentIdentity) return;
        if (event.target.id === "editInvoice") {
          event.stopImmediatePropagation();
          saveSelectedTestPayment({ invoice: event.target.checked ? "✔️" : "" });
        } else if (event.target.id === "editManualStatus") {
          event.stopImmediatePropagation();
          saveSelectedTestPayment({ manualStatus: event.target.value });
        }
      }, true);
      paymentEditor.addEventListener("click", (event) => {
        if (!selectedTestPaymentIdentity) return;
        if (event.target.id === "toggleRowBasics") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (byId("rowBasics")?.hidden) renderSelectedTestBasics();
          else {
            byId("rowBasics").hidden = true;
            document.querySelector(".sheet-shell")?.classList.remove("has-row-basics");
          }
        } else if (event.target.id === "deleteSelectedRow") {
          event.preventDefault();
          event.stopImmediatePropagation();
          const row = selectedTestPayment();
          if (!row || !window.confirm(`確定刪除隔離測試列 ${row.customerNo}？正式資料不會變更。`)) return;
          const rows = storedTestRows();
          const remaining = rows.filter((item) =>
            window.HJPaymentSmartImportV2.previewIdentity(item) !== selectedTestPaymentIdentity
          );
          const deleted = JSON.parse(localStorage.getItem(deletedRowsKey) || "[]");
          if (!deleted.some((item) => window.HJPaymentSmartImportV2.previewIdentity(item) === selectedTestPaymentIdentity)) {
            deleted.push(row);
          }
          localStorage.setItem(testRowsKey, JSON.stringify(remaining));
          localStorage.setItem(deletedRowsKey, JSON.stringify(deleted));
          closeTestPaymentSelection();
          renderIsolatedRows();
          reconcileVisibleSummary();
        }
      }, true);
    }

    const basicPanel = byId("rowBasics");
    if (basicPanel) {
      const basicInputFields = {
        editName: "name",
        editCompany: "company",
        editStart: "contractStart",
        editEnd: "contractEnd",
      };
      basicPanel.addEventListener("input", (event) => {
        if (!selectedTestPaymentIdentity) return;
        const field = basicInputFields[event.target.id];
        if (!field && event.target.id !== "editPrice") return;
        event.stopImmediatePropagation();
        if (event.target.id === "editPrice") {
          const rawPrice = event.target.value.replace(/,/g, "").trim();
          if (!rawPrice) return;
          const monthlyPrice = Number(rawPrice);
          if (Number.isFinite(monthlyPrice)) {
            const row = selectedTestPayment();
            const interval = window.HJPaymentSmartImportV2.cycleMonths(row?.paymentCycle);
            saveSelectedTestPayment({
              monthlyPrice,
              amountDue: monthlyPrice * interval,
            });
          }
          return;
        }
        saveSelectedTestPayment({ [field]: event.target.value.trim() });
      }, true);
      basicPanel.addEventListener("change", (event) => {
        if (!selectedTestPaymentIdentity) return;
        if (event.target.id === "editSection") {
          event.stopImmediatePropagation();
          saveSelectedTestPayment({ section: event.target.value }, { rerender: true });
        } else if (event.target.id === "editCycle") {
          event.stopImmediatePropagation();
          const row = selectedTestPayment();
          const interval = window.HJPaymentSmartImportV2.cycleMonths(event.target.value);
          saveSelectedTestPayment({
            paymentCycle: event.target.value,
            amountDue: Number(row?.monthlyPrice || 0) * interval,
          }, { rerender: true });
        }
      }, true);
      basicPanel.addEventListener("blur", (event) => {
        if (!selectedTestPaymentIdentity || event.target.id !== "editPrice") return;
        event.stopImmediatePropagation();
      }, true);
    }

    document.addEventListener("click", (event) => {
      if (!selectedTestPaymentIdentity) return;
      if (event.target.closest("#rowEditor, #rowBasics, .payment-row.smart-test-inserted")) return;
      closeTestPaymentSelection();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === testRowsKey || event.key === deletedRowsKey) renderIsolatedRows();
    });
    document.body.dataset.replacementReady = "false";
    const preferredVenue = sessionStorage.getItem(preferredVenueKey);
    if (preferredVenue && preferredVenue !== document.querySelector("[data-venue-toolbar].selected-venue")?.dataset.venueToolbar) {
      document.querySelector(`.month-tab[data-venue="${preferredVenue}"].active`)?.click();
    }
    repairStoredDerivedRows();
    renderIsolatedRows();
    reconcileVisibleSummary();
  };

  if (document.readyState === "complete") window.setTimeout(install, 0);
  else window.addEventListener("load", () => window.setTimeout(install, 0), { once: true });
})();
