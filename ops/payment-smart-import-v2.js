(function initPaymentSmartImportV2(root, factory) {
  const pricingApi = root.HJContractPricing || (typeof module === "object" && module.exports ? require("./contract-pricing.js") : null);
  const dateApi = root.HJRocDate || (typeof module === "object" && module.exports ? require("./roc-date.js") : null);
  const api = factory(root.HJCustomerId, pricingApi, dateApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HJPaymentSmartImportV2 = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function paymentSmartImportFactory(customerIdApi, pricingApi, dateApi) {
  const annualCycles = new Set(["Y", "2Y", "3Y"]);

  function normalizeAscii(value) {
    return String(value ?? "").replace(/[\uff01-\uff5e]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  }

  function text(value) {
    return normalizeAscii(value).trim();
  }

  function cycle(value) {
    return text(value).toUpperCase();
  }

  function customerNo(value) {
    if (customerIdApi?.normalize) return customerIdApi.normalize(value);
    return text(value).toUpperCase();
  }

  function cycleMonths(value) {
    const normalized = cycle(value);
    if (normalized === "M") return 1;
    if (normalized === "3M") return 3;
    if (normalized === "6M") return 6;
    if (annualCycles.has(normalized)) return 12;
    return 0;
  }

  function parseRocDate(value) {
    if (dateApi?.parse) return dateApi.parse(value);
    const parts = text(value).replace(/[.-]/g, "/").split("/").map(Number);
    if (parts.length < 2 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) return null;
    const westernYear = parts[0] < 1911 ? parts[0] + 1911 : parts[0];
    const month = parts[1];
    const day = Number.isInteger(parts[2]) && parts[2] > 0 ? parts[2] : 1;
    if (westernYear < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const calendarDate = new Date(Date.UTC(westernYear, month - 1, day));
    if (calendarDate.getUTCFullYear() !== westernYear || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
    return { westernYear, rocYear: westernYear - 1911, month, day, monthIndex: westernYear * 12 + month - 1 };
  }

  function normalizeRocDate(value) {
    if (dateApi?.normalize) return dateApi.normalize(value);
    const parsed = parseRocDate(value);
    return parsed ? `${parsed.rocYear}/${String(parsed.month).padStart(2, "0")}/${String(parsed.day).padStart(2, "0")}` : text(value);
  }

  function monthFromIndex(monthIndex, day = 1) {
    const westernYear = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return {
      westernYear,
      rocYear: westernYear - 1911,
      month,
      day,
      monthIndex,
      key: `${westernYear}/${String(month).padStart(2, "0")}`,
      rocDate: `${westernYear - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
    };
  }

  function serviceKind(value) {
    const normalized = text(value).toLowerCase().replace(/\s+/g, "");
    if (/虛擬辦公室/.test(normalized)) return "registration";
    if (/office|辦公室/.test(normalized)) return "office";
    if (/freeseat|自由座/.test(normalized)) return "free-seat";
    if (/registration|營登|營業登記|代收信件/.test(normalized)) return "registration";
    return "";
  }

  function displaySection(service, paymentCycle) {
    const kind = serviceKind(service);
    if (kind === "office") return "辦公室";
    if (kind === "free-seat") return "自由座";
    if (kind === "registration") return annualCycles.has(cycle(paymentCycle)) ? "年繳 / 2Y" : "營登";
    return "";
  }

  function field(source, ...keys) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && text(value) !== "") return value;
    }
    return "";
  }

  function normalizeCrmRecord(source) {
    const pricingStages = Array.isArray(source?.pricingStages)
      ? structuredClone(source.pricingStages)
      : Array.isArray(source?.priceStages)
        ? structuredClone(source.priceStages)
        : [];
    pricingStages.forEach((stage) => {
      if (!stage || typeof stage !== "object") return;
      if (stage.start) stage.start = normalizeRocDate(stage.start);
      if (stage.end) stage.end = normalizeRocDate(stage.end);
    });
    return {
      venue: text(field(source, "venue", "branch_code", "館別")),
      customerNo: text(field(source, "customerNo", "customer_no", "編號", "id")),
      name: text(field(source, "name", "customer_name", "姓名")),
      company: text(field(source, "company", "company_name", "公司名稱", "公司")),
      service: text(field(source, "service", "service_type", "項目", "服務項目", "item")),
      paymentCycle: cycle(field(source, "paymentCycle", "payment_cycle", "繳費方式", "cycle")),
      contractStart: normalizeRocDate(field(source, "contractStart", "contract_start", "起始日期", "start")),
      contractEnd: normalizeRocDate(field(source, "contractEnd", "contract_end", "合約到期日", "end")),
      amount: text(field(source, "amount", "monthly_amount", "金額", "price")),
      pricePlan: text(field(source, "pricePlan", "stagedAmount", "階段金額", "price_plan")),
      hasSecondStage: source?.hasSecondStage === true || text(source?.hasSecondStage).toLowerCase() === "true",
      stage1Years: text(field(source, "stage1Years")),
      stage1Start: normalizeRocDate(field(source, "stage1Start")),
      stage1End: normalizeRocDate(field(source, "stage1End")),
      stage2Years: text(field(source, "stage2Years")),
      stage2Start: normalizeRocDate(field(source, "stage2Start")),
      stage2End: normalizeRocDate(field(source, "stage2End")),
      stage2Amount: text(field(source, "stage2Amount")),
      stage2Kind: text(field(source, "stage2Kind")),
      pricingStages,
      status: text(field(source, "status", "crm_status", "folder")) || "active",
    };
  }

  function parseMoney(value) {
    const match = text(value).replaceAll(",", "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parseExplicitPricePlan(value) {
    const normalized = text(value).replaceAll(",", "");
    const match = normalized.match(/前\s*(\d+)\s*年\s*(\d+(?:\.\d+)?).*?後\s*(\d+)\s*年\s*(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    return {
      firstYears: Number(match[1]),
      firstMonthly: Number(match[2]),
      secondYears: Number(match[3]),
      secondMonthly: Number(match[4]),
    };
  }

  function parseConfirmedTwoYearPrices(amount, paymentCycle) {
    const normalized = text(amount);
    if (cycle(paymentCycle) !== "2Y") return null;
    if (/實際|實收|報價|客戶|佣金/.test(normalized)) return null;
    const values = [...normalized.replaceAll(",", "").matchAll(/\d+(?:\.\d+)?\s*(?:\/\s*m)?/gi)]
      .map((match) => Number(match[0].match(/\d+(?:\.\d+)?/)[0]));
    if (values.length !== 2) return null;
    return { firstYears: 1, firstMonthly: values[0], secondYears: 1, secondMonthly: values[1] };
  }

  function monthlyPriceAt(crm, dueMonthIndex) {
    if (pricingApi?.monthlyPriceAt) return pricingApi.monthlyPriceAt(crm, dueMonthIndex);
    const start = parseRocDate(crm.contractStart);
    if (!start) return { error: "CRM 合約起始日期無法判讀" };
    const plan = parseExplicitPricePlan(crm.pricePlan) || parseExplicitPricePlan(crm.amount) || parseConfirmedTwoYearPrices(crm.amount, crm.paymentCycle);
    if (!plan) {
      const normalizedAmount = text(crm.amount).replaceAll(",", "");
      const operationalMatch = normalizedAmount.match(/(?:實際收|實收)\s*(\d+(?:\.\d+)?)/);
      if (operationalMatch) return { monthly: Number(operationalMatch[1]), stage: "operational" };
      const amount = parseMoney(crm.amount);
      if (amount === null) return { error: "CRM 金額無法判讀" };
      if ((normalizedAmount.match(/\d+(?:\.\d+)?/g) || []).length > 1) {
        return { error: "CRM 金額包含多種語意，需人工確認" };
      }
      return { monthly: amount, stage: "single" };
    }
    const secondStageIndex = start.monthIndex + plan.firstYears * 12;
    return dueMonthIndex >= secondStageIndex
      ? { monthly: plan.secondMonthly, stage: "second" }
      : { monthly: plan.firstMonthly, stage: "first" };
  }

  function historyField(row, ...keys) {
    const direct = field(row, ...keys);
    return text(direct) !== "" ? direct : field(row?.source_snapshot || {}, ...keys);
  }

  function historyCustomerNo(row) {
    return text(field(row, "customerNo", "customer_no", "id") || row?.source_snapshot?.id);
  }

  function historyVenue(row) {
    return text(field(row, "venue", "branch_code") || row?.source_snapshot?.venue);
  }

  function historyMonthIndex(row) {
    const year = Number(field(row, "year"));
    const month = Number(field(row, "month"));
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) return year * 12 + month - 1;
    return parseRocDate(historyField(row, "dueDate", "due_date"))?.monthIndex ?? null;
  }

  function explicitNextMonth(row) {
    return parseRocDate(historyField(row, "nextDate", "next_payment_date"));
  }

  function identityHistory(crm, rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        if (customerNo(historyCustomerNo(row)) !== customerNo(crm.customerNo)) return false;
        const venue = historyVenue(row);
        if (crm.venue && venue && venue !== crm.venue) return false;
        return true;
      });
  }

  function relevantHistory(crm, rows) {
    return identityHistory(crm, rows)
      .filter((row) => {
        const rowStart = text(historyField(row, "start", "contractStart", "contract_start"));
        const rowEnd = text(historyField(row, "end", "contractEnd", "contract_end"));
        const parsedRowStart = parseRocDate(rowStart);
        const parsedRowEnd = parseRocDate(rowEnd);
        const parsedCrmStart = parseRocDate(crm.contractStart);
        const parsedCrmEnd = parseRocDate(crm.contractEnd);
        if (parsedRowStart && parsedCrmStart && parsedRowStart.monthIndex !== parsedCrmStart.monthIndex) return false;
        if (!parsedRowStart && !parsedCrmStart && parsedRowEnd && parsedCrmEnd && parsedRowEnd.monthIndex !== parsedCrmEnd.monthIndex) return false;
        return true;
      })
      .sort((a, b) => (historyMonthIndex(a) ?? -Infinity) - (historyMonthIndex(b) ?? -Infinity));
  }

  function latestExplicitNext(crm, rows) {
    const start = parseRocDate(crm.contractStart);
    const end = parseRocDate(crm.contractEnd);
    if (!start || !end) return null;
    return identityHistory(crm, rows)
      .map((row) => ({ row, next: explicitNextMonth(row), monthIndex: historyMonthIndex(row) }))
      .filter((item) => item.next && item.next.monthIndex >= start.monthIndex && item.next.monthIndex <= end.monthIndex)
      .sort((a, b) => (b.monthIndex ?? -Infinity) - (a.monthIndex ?? -Infinity))[0] || null;
  }

  function existingMonthKeys(crm, rows) {
    return new Set(relevantHistory(crm, rows)
      .map(historyMonthIndex)
      .filter((value) => value !== null));
  }

  function buildPreview(input) {
    const crm = normalizeCrmRecord(input?.crm || {});
    const mode = input?.mode === "renewal" ? "renewal" : "new";
    const history = Array.isArray(input?.history) ? input.history : [];
    const errors = [];
    const warnings = [];
    if (!crm.customerNo) errors.push("CRM 編號缺漏");
    if (!crm.company && !crm.name) errors.push("CRM 姓名／公司缺漏");
    if (["ended", "已結束"].includes(crm.status.toLowerCase())) errors.push("CRM 客戶已結束");
    const service = serviceKind(crm.service);
    if (!service) errors.push("CRM 服務項目無法判讀");
    const interval = cycleMonths(crm.paymentCycle);
    if (!interval) errors.push("CRM 繳費方式無法判讀");
    const start = parseRocDate(crm.contractStart);
    const end = parseRocDate(crm.contractEnd);
    const openEndedFreeSeat = service === "free-seat" && !end;
    if (!start) errors.push("CRM 合約起始日期無法判讀");
    if (!end && !openEndedFreeSeat) errors.push("CRM 合約到期日期無法判讀");
    const targetYear = Number(input?.targetYear);
    const targetMonth = Number(input?.targetMonth);
    const targetMonthIndex = Number.isInteger(targetYear) && targetYear >= 2000 && Number.isInteger(targetMonth) && targetMonth >= 1 && targetMonth <= 12
      ? targetYear * 12 + targetMonth - 1
      : null;
    if (openEndedFreeSeat && targetMonthIndex === null) errors.push("自由座持續月繳需指定帶入月份");
    if (mode === "new" && service !== "free-seat" && start && targetMonthIndex !== null && targetMonthIndex !== start.monthIndex) {
      errors.push("新增客戶只能從 CRM 合約起始月份帶入");
    }
    if (start && end && end.monthIndex <= start.monthIndex) errors.push("CRM 合約到期日期不晚於起始日期");
    if (start) {
      const initialPrice = monthlyPriceAt(crm, start.monthIndex);
      if (initialPrice.error) errors.push(initialPrice.error);
    }
    if (errors.length) return { ok: false, crm, mode, errors, warnings, payments: [], reminder: null };

    const explicit = latestExplicitNext(crm, history);
    let firstMonthIndex = start.monthIndex;
    if (explicit) {
      firstMonthIndex = explicit.next.monthIndex;
      warnings.push(`依繳費表明確下次繳費日 ${explicit.next.rocYear}/${String(explicit.next.month).padStart(2, "0")} 排程`);
    } else if (mode === "renewal") {
      firstMonthIndex = start.monthIndex;
      warnings.push("新循環依 CRM 合約起始月份開始新增");
    }

    const existing = existingMonthKeys(crm, history);
    const payments = [];
    const scheduleEnd = openEndedFreeSeat ? targetMonthIndex + 1 : end.monthIndex;
    if (openEndedFreeSeat) firstMonthIndex = Math.max(targetMonthIndex, start.monthIndex);
    for (let monthIndex = firstMonthIndex; monthIndex < scheduleEnd; monthIndex += interval) {
      if (existing.has(monthIndex)) continue;
      const due = monthFromIndex(monthIndex, start.day);
      const price = monthlyPriceAt(crm, monthIndex);
      if (price.error) {
        errors.push(price.error);
        break;
      }
      payments.push({
        type: "payment",
        venue: crm.venue,
        customerNo: crm.customerNo,
        name: crm.name,
        company: crm.company,
        service: crm.service,
        section: displaySection(crm.service, crm.paymentCycle),
        paymentCycle: crm.paymentCycle,
        contractStart: crm.contractStart,
        contractEnd: crm.contractEnd,
        dueYear: due.westernYear,
        dueMonth: due.month,
        dueKey: due.key,
        monthlyPrice: price.monthly,
        amountDue: price.monthly * interval,
        priceStage: price.stage,
        paidDate: "",
        paidAmount: "",
        invoice: "",
        note: "測試版智慧帶入",
      });
    }

    return {
      ok: errors.length === 0,
      crm,
      mode,
      errors,
      warnings,
      payments: errors.length ? [] : payments,
      reminder: errors.length || openEndedFreeSeat ? null : {
        type: "renewal-reminder",
        venue: crm.venue,
        customerNo: crm.customerNo,
        name: crm.name,
        company: crm.company,
        service: crm.service,
        paymentCycle: crm.paymentCycle,
        contractStart: crm.contractStart,
        contractEnd: crm.contractEnd,
        dueYear: end.westernYear,
        dueMonth: end.month,
        dueKey: `${end.westernYear}/${String(end.month).padStart(2, "0")}`,
        section: displaySection(crm.service, crm.paymentCycle),
      },
    };
  }

  function previewIdentity(row) {
    return [row.venue, customerNo(row.customerNo), normalizeRocDate(row.contractStart), normalizeRocDate(row.contractEnd), row.dueYear, row.dueMonth, row.type].join("|");
  }

  function insertPreview(existingRows, preview) {
    if (!preview?.ok) return { rows: [...(existingRows || [])], inserted: [], error: "預覽未通過" };
    const rows = [...(existingRows || [])];
    const identities = new Set(rows.map(previewIdentity));
    const inserted = [];
    for (const row of [...preview.payments, preview.reminder].filter(Boolean)) {
      const identity = previewIdentity(row);
      if (identities.has(identity)) continue;
      rows.push({ ...row });
      inserted.push({ ...row });
      identities.add(identity);
    }
    return { rows, inserted, error: "" };
  }

  return {
    normalizeCrmRecord,
    normalizeCustomerNo: customerNo,
    cycleMonths,
    parseRocDate,
    normalizeRocDate,
    serviceKind,
    displaySection,
    monthlyPriceAt,
    buildPreview,
    insertPreview,
    previewIdentity,
  };
});
