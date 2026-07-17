(function installPaymentAuditEngine(global) {
  "use strict";

  const ACTIVE_BRANCHES = new Set(["taichung", "huanrui"]);
  const ENDING_PATTERN = /(?:已結束|結案|遷出完成|ended|closed|inactive)/i;
  const NON_BILLABLE_PATTERN = /(?:不收款|免收|不用收|no[ _-]?pay|non[ _-]?billable)/i;
  const PAID_PATTERN = /(?:完成|已收款|已繳|paid|complete)/i;
  const PENDING_PATTERN = /(?:待收款|催款|確認續約|待續約|pending|renew)/i;

  function text(value) {
    return String(value ?? "").trim();
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizedVenue(value) {
    const raw = text(value).toLowerCase();
    if (/環瑞|huanrui|hr/.test(raw)) return "huanrui";
    if (/台中|taichung|tc/.test(raw)) return "taichung";
    return raw;
  }

  function branchOf(row) {
    return normalizedVenue(row?.branch_code || row?.branch || row?.venue || row?.館別);
  }

  function customerId(row) {
    return text(row?.customer_no || row?.contract_no || row?.id || row?.編號).toUpperCase();
  }

  function cycleOf(row) {
    const raw = text(
      row?.payment_cycle
      || row?.cycle
      || row?.source_snapshot?.cycle
      || row?.繳費方式
      || row?.方式,
    ).toUpperCase().replace(/\s+/g, "");
    if (raw === "MONTHLY") return "M";
    if (/^\d+$/.test(raw)) return `${raw}M`;
    return raw;
  }

  function cadenceMonths(cycle) {
    if (cycle === "M") return 1;
    if (cycle === "3M") return 3;
    if (cycle === "6M") return 6;
    if (cycle === "Y" || cycle === "1Y" || cycle === "2Y" || cycle === "3Y") return 12;
    return 0;
  }

  function parseDate(value) {
    const raw = text(value).replace(/[年月.]/g, "/").replace(/日/g, "").replace(/-/g, "/");
    const parts = raw.split("/").filter(Boolean).map(part => Number(part));
    if (parts.length < 2 || parts.some(number => !Number.isFinite(number))) return null;
    let [year, month, day = 1] = parts;
    if (year < 1911) year += 1911;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return {
      year,
      month,
      day,
      monthIndex: year * 12 + month - 1,
      iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  }

  function sourceStart(row) {
    return row?.contract_start || row?.start_date || row?.source_snapshot?.start || row?.起始日 || row?.起始日期;
  }

  function sourceEnd(row) {
    return row?.contract_end || row?.end_date || row?.source_snapshot?.end || row?.到期日 || row?.合約到期日;
  }

  function rowMonth(row) {
    const explicit = Number(row?.month || row?.月份);
    if (explicit >= 1 && explicit <= 12) return explicit;
    return parseDate(row?.period_start || sourceStart(row))?.month || 0;
  }

  function rowYear(row) {
    const explicit = Number(row?.year || row?.年度);
    if (explicit > 1900) return explicit;
    return parseDate(row?.period_start || sourceStart(row))?.year || 0;
  }

  function rowStatus(row) {
    return text(
      row?.status
      || row?.manualStatus
      || row?.manual_status
      || row?.state
      || row?.source_snapshot?.status
      || row?.狀態
      || row?.備註,
    );
  }

  function isEnding(row) {
    return ENDING_PATTERN.test(text(row?.crm_status || row?.folder || rowStatus(row)));
  }

  function isNonBillable(row) {
    return NON_BILLABLE_PATTERN.test(rowStatus(row));
  }

  function isPaid(row) {
    const paidAmount = Number(row?.payment_amount || row?.paid_amount || row?.paidAmount || row?.繳費金額 || 0);
    const paidDate = text(row?.payment_date || row?.paid_at || row?.paidDate || row?.繳費日);
    return paidAmount > 0 || Boolean(paidDate) || PAID_PATTERN.test(rowStatus(row));
  }

  function monthlyAmount(row) {
    const direct = Number(row?.monthly_amount || row?.monthlyAmount || 0);
    if (direct > 0) return direct;
    const raw = text(row?.source_snapshot?.price || row?.price || row?.單價 || row?.金額);
    const matches = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || [];
    return Number(matches[0] || 0);
  }

  function companyName(row) {
    return text(row?.company_name || row?.companyName || row?.source_snapshot?.company || row?.公司名稱 || row?.公司);
  }

  function customerName(row) {
    return text(row?.customer_name || row?.name || row?.source_snapshot?.name || row?.姓名);
  }

  function serviceType(row) {
    return text(
      row?.service_type
      || row?.item
      || row?.source_snapshot?.service
      || row?.項目
      || row?.區塊
      || row?.section
      || row?.source_snapshot?.section,
    );
  }

  function normalizedService(row) {
    const value = serviceType(row).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    if (/自由座|共享座位|共享辦公室|free.?seat|cowork/.test(value)) return "free-seat";
    if (/辦公室|office/.test(value) && !/營登|營業登記|虛擬辦公室|virtual.?office/.test(value)) {
      return "office";
    }
    if (/營登|營業登記|虛擬辦公室|virtual.?office/.test(value)) return "registration";
    return "";
  }

  function sameService(paymentRow, crmRow) {
    const paymentService = normalizedService(paymentRow);
    const crmService = normalizedService(crmRow);
    if (!paymentService || !crmService) return true;
    return paymentService === crmService;
  }

  function expectedMonths(row, year) {
    const cycle = cycleOf(row);
    const cadence = cadenceMonths(cycle);
    const start = parseDate(sourceStart(row));
    const end = parseDate(sourceEnd(row));
    if (!cadence || !start) {
      return {
        cycle,
        months: [],
        reason: !cadence ? "UNKNOWN_CYCLE" : "MISSING_START_DATE",
      };
    }

    const months = [];
    for (let month = 1; month <= 12; month += 1) {
      const index = year * 12 + month - 1;
      if (index < start.monthIndex) continue;
      if (end && index > end.monthIndex) continue;
      if ((index - start.monthIndex) % cadence === 0) months.push(month);
    }
    return { cycle, months, reason: "" };
  }

  function flattenRowsByMonth(rowsByMonth, fallbackYear) {
    if (Array.isArray(rowsByMonth)) return clone(rowsByMonth);
    const rows = [];
    Object.entries(rowsByMonth || {}).forEach(([month, monthRows]) => {
      const monthNumber = Number(text(month).replace(/月$/u, ""));
      (Array.isArray(monthRows) ? monthRows : []).forEach(row => {
        rows.push({ ...clone(row), month: rowMonth(row) || monthNumber, year: rowYear(row) || fallbackYear });
      });
    });
    return rows;
  }

  function rowLabel(row) {
    return {
      venue: branchOf(row),
      year: rowYear(row),
      month: rowMonth(row),
      id: customerId(row),
      name: customerName(row),
      company: companyName(row),
      service: serviceType(row),
      cycle: cycleOf(row),
      start: parseDate(sourceStart(row))?.iso || text(sourceStart(row)),
      end: parseDate(sourceEnd(row))?.iso || text(sourceEnd(row)),
      monthlyAmount: monthlyAmount(row),
      status: rowStatus(row),
    };
  }

  function periodKey(row) {
    const label = rowLabel(row);
    return [label.venue, label.year, label.month, label.id, label.cycle, label.start, label.end].join("|");
  }

  function customerMonthKey(row) {
    const label = rowLabel(row);
    return [label.venue, label.year, label.month, label.id].join("|");
  }

  function groupBy(rows, keyFor) {
    const groups = new Map();
    rows.forEach(row => {
      const key = keyFor(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function sameContractPeriod(paymentRow, crmRow) {
    const paymentStart = parseDate(sourceStart(paymentRow));
    const crmStart = parseDate(sourceStart(crmRow));
    if (!paymentStart || !crmStart) return false;
    return paymentStart.iso === crmStart.iso;
  }

  function mismatchFields(paymentRow, crmRow) {
    if (!sameContractPeriod(paymentRow, crmRow)) return [];
    const fields = [];
    const payment = rowLabel(paymentRow);
    const crm = rowLabel(crmRow);
    if (payment.cycle && crm.cycle && payment.cycle !== crm.cycle) {
      fields.push({ field: "繳費方式", payment: payment.cycle, crm: crm.cycle });
    }
    if (payment.end && crm.end && payment.end !== crm.end) {
      fields.push({ field: "到期日", payment: payment.end, crm: crm.end });
    }
    if (payment.monthlyAmount > 0 && crm.monthlyAmount > 0 && payment.monthlyAmount !== crm.monthlyAmount) {
      fields.push({ field: "月租", payment: payment.monthlyAmount, crm: crm.monthlyAmount });
    }
    const paymentService = normalizedService(paymentRow);
    const crmService = normalizedService(crmRow);
    if (paymentService && crmService && paymentService !== crmService) {
      fields.push({ field: "服務項目", payment: payment.service, crm: crm.service });
    }
    return fields;
  }

  function auditYear(input = {}) {
    const venue = normalizedVenue(input.venue);
    const year = Number(input.year);
    if (!ACTIVE_BRANCHES.has(venue) || !Number.isInteger(year)) {
      throw new TypeError("auditYear requires a supported venue and a four-digit year");
    }

    const crmRows = clone(input.crmRows || []).filter(row => branchOf(row) === venue);
    const paymentRows = flattenRowsByMonth(input.paymentRowsByMonth, year)
      .filter(row => branchOf(row) === venue && rowYear(row) === year);
    const activeCrm = crmRows.filter(row => !isEnding(row));
    const crmById = new Map(activeCrm.map(row => [customerId(row), row]));
    const currentRowsByCustomerMonth = groupBy(paymentRows, customerMonthKey);

    const unschedulable = [];
    const missing = [];
    activeCrm.forEach(row => {
      const id = customerId(row);
      if (!id) return;
      const expected = expectedMonths(row, year);
      if (expected.reason) {
        unschedulable.push({
          code: expected.reason,
          evidence: "CRM",
          ...rowLabel(row),
        });
        return;
      }
      expected.months.forEach(month => {
        const key = [venue, year, month, id].join("|");
        const rowsInMonth = currentRowsByCustomerMonth.get(key) || [];
        const hasCurrentCharge = rowsInMonth.some(paymentRow => (
          !isEnding(paymentRow)
          && sameService(paymentRow, row)
          && (sameContractPeriod(paymentRow, row) || !isNonBillable(paymentRow))
        ));
        if (hasCurrentCharge) return;
        missing.push({
          code: "MISSING_EXPECTED_ROW",
          evidence: "CRM_SCHEDULE",
          venue,
          year,
          month,
          id,
          name: customerName(row),
          company: companyName(row),
          service: serviceType(row),
          cycle: expected.cycle,
          start: parseDate(sourceStart(row))?.iso || text(sourceStart(row)),
          end: parseDate(sourceEnd(row))?.iso || text(sourceEnd(row)),
        });
      });
    });

    const billableRows = paymentRows.filter(row => !isEnding(row) && !isNonBillable(row));
    const exactDuplicates = [...groupBy(billableRows, periodKey).values()]
      .filter(rows => rows.length > 1)
      .map(rows => ({
        code: "EXACT_DUPLICATE",
        evidence: "PAYMENT_ROWS",
        count: rows.length,
        rows: rows.map(rowLabel),
      }));

    const multiplePeriods = [...groupBy(billableRows, customerMonthKey).values()]
      .filter(rows => new Set(rows.map(periodKey)).size > 1)
      .map(rows => ({
        code: "MULTIPLE_PERIODS_IN_MONTH",
        evidence: "PAYMENT_ROWS",
        count: rows.length,
        rows: rows.map(rowLabel),
      }));

    const mismatches = billableRows.flatMap(row => {
      const crm = crmById.get(customerId(row));
      if (!crm) return [];
      const fields = mismatchFields(row, crm);
      return fields.length ? [{
        code: "CURRENT_PERIOD_MISMATCH",
        evidence: "PAYMENT_ROW_MATCHES_CRM_START",
        row: rowLabel(row),
        fields,
      }] : [];
    });

    const nonBillable = paymentRows.filter(isNonBillable).map(row => ({
      code: "NON_BILLABLE_ROW",
      evidence: "PAYMENT_STATUS",
      ...rowLabel(row),
    }));
    const endedIncluded = paymentRows.filter(isEnding).map(row => ({
      code: "ENDED_ROW_INCLUDED",
      evidence: "PAYMENT_STATUS",
      ...rowLabel(row),
    }));
    const pendingRows = billableRows
      .filter(row => !isPaid(row) && PENDING_PATTERN.test(rowStatus(row)))
      .map(row => ({
        code: "PAYMENT_FOLLOW_UP",
        evidence: "PAYMENT_STATUS",
        notifiedAt: text(row?.notified_at || row?.notification_date || row?.通知日),
        ...rowLabel(row),
      }));

    return {
      venue,
      year,
      missing,
      exactDuplicates,
      multiplePeriods,
      mismatches,
      nonBillable,
      endedIncluded,
      unschedulable,
      pendingRows,
      summary: {
        missing: missing.length,
        exactDuplicates: exactDuplicates.length,
        multiplePeriods: multiplePeriods.length,
        mismatches: mismatches.length,
        nonBillable: nonBillable.length,
        endedIncluded: endedIncluded.length,
        unschedulable: unschedulable.length,
      },
    };
  }

  function auditCustomer(input = {}) {
    const id = text(input.customerId).toUpperCase();
    const report = auditYear(input);
    const itemHasId = item => item.id === id || item.row?.id === id || item.rows?.some(row => row.id === id);
    return {
      ...report,
      missing: report.missing.filter(itemHasId),
      exactDuplicates: report.exactDuplicates.filter(itemHasId),
      multiplePeriods: report.multiplePeriods.filter(itemHasId),
      mismatches: report.mismatches.filter(itemHasId),
      nonBillable: report.nonBillable.filter(itemHasId),
      endedIncluded: report.endedIncluded.filter(itemHasId),
      unschedulable: report.unschedulable.filter(itemHasId),
      pendingRows: report.pendingRows.filter(itemHasId),
    };
  }

  function dayDifference(fromValue, toValue) {
    const from = parseDate(fromValue);
    const to = parseDate(toValue);
    if (!from || !to) return null;
    const fromTime = Date.UTC(from.year, from.month - 1, from.day);
    const toTime = Date.UTC(to.year, to.month - 1, to.day);
    return Math.floor((toTime - fromTime) / 86400000);
  }

  function actionableFindings(report, options = {}) {
    const today = options.today || new Date().toISOString().slice(0, 10);
    const followUpDays = Number(options.notificationFollowUpDays ?? 6);
    return (report?.pendingRows || []).filter(item => {
      if (!item.notifiedAt) return false;
      const elapsed = dayDifference(item.notifiedAt, today);
      return elapsed !== null && elapsed >= followUpDays;
    });
  }

  const lastReports = new Map();

  function reportKey(venue, year) {
    return `${normalizedVenue(venue)}|${Number(year)}`;
  }

  function runAudit(input = {}) {
    const trigger = text(input.trigger) || "manual";
    const report = auditYear(input);
    const envelope = { trigger, report };
    lastReports.set(reportKey(report.venue, report.year), clone(envelope));

    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new global.CustomEvent("hj:payment-audit", { detail: clone(envelope) }));
    }
    return clone(envelope);
  }

  function crmRowsFromPlatform(venue, requestedYear) {
    const venueData = global.HJ_CRM_SOURCE_DATA?.venues?.[venue];
    const years = venueData?.years || {};
    const requestedRows = years[String(requestedYear)] || years[requestedYear];
    const activeRows = years[String(venueData?.activeYear)] || years[venueData?.activeYear];
    const latestRows = Object.keys(years)
      .sort((left, right) => Number(right) - Number(left))
      .map(year => years[year])
      .find(rows => Array.isArray(rows) && rows.length);
    const rows = Array.isArray(requestedRows) && requestedRows.length
      ? requestedRows
      : (Array.isArray(activeRows) && activeRows.length ? activeRows : latestRows || []);
    return clone(rows).map(row => ({ ...row, branch_code: branchOf(row) || venue }));
  }

  function paymentRowsFromPlatform(venue, year) {
    const rowsByMonth = global.hjImportedPaymentDataByYear?.[venue]?.[String(year)]
      || global.hjImportedPaymentDataByYear?.[venue]?.[year]
      || {};
    const decorated = {};
    Object.entries(rowsByMonth).forEach(([monthKey, monthRows]) => {
      const month = Number(text(monthKey).replace(/月$/u, ""));
      decorated[monthKey] = (Array.isArray(monthRows) ? monthRows : []).map(row => ({
        ...clone(row),
        branch_code: branchOf(row) || venue,
        year: rowYear(row) || Number(year),
        month: rowMonth(row) || month,
      }));
    });
    return decorated;
  }

  function runFromPlatformGlobals(input = {}) {
    const venue = normalizedVenue(input.venue);
    const year = Number(input.year);
    const crmRows = Array.isArray(input.crmRowsOverride)
      ? clone(input.crmRowsOverride).map(row => ({ ...row, branch_code: branchOf(row) || venue }))
      : crmRowsFromPlatform(venue, year);
    const paymentRowsByMonth = input.paymentRowsByMonthOverride
      ? clone(input.paymentRowsByMonthOverride)
      : paymentRowsFromPlatform(venue, year);
    const previousRowsByMonth = input.previousRowsByMonthOverride
      ? clone(input.previousRowsByMonthOverride)
      : paymentRowsFromPlatform(venue, year - 1);

    return runAudit({
      trigger: input.trigger,
      venue,
      year,
      crmRows,
      paymentRowsByMonth,
      previousRowsByMonth,
    });
  }

  function getLastReport(input = {}) {
    const envelope = lastReports.get(reportKey(input.venue, input.year));
    return envelope ? clone(envelope) : null;
  }

  global.HJPaymentAudit = Object.freeze({
    auditYear,
    auditCustomer,
    actionableFindings,
    runAudit,
    runFromPlatformGlobals,
    getLastReport,
  });
})(typeof window !== "undefined" ? window : globalThis);
