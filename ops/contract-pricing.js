(function initContractPricing(root, factory) {
  const dateApi = root.HJRocDate || (typeof module === "object" && module.exports ? require("./roc-date.js") : null);
  const api = factory(dateApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HJContractPricing = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function contractPricingFactory(dateApi) {
  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function field(source, ...keys) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && text(value) !== "") return value;
    }
    return "";
  }

  function parseRocDate(value) {
    if (dateApi?.parse) return dateApi.parse(value);
    const parts = text(value).replace(/[.-]/g, "/").split("/").map(Number);
    if (parts.length < 2 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) return null;
    const westernYear = parts[0] < 1911 ? parts[0] + 1911 : parts[0];
    const month = parts[1];
    const day = Number.isInteger(parts[2]) && parts[2] > 0 ? parts[2] : 1;
    if (westernYear < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(westernYear, month - 1, day));
    if (date.getUTCFullYear() !== westernYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return {
      westernYear,
      rocYear: westernYear - 1911,
      month,
      day,
      monthIndex: westernYear * 12 + month - 1,
      dayIndex: Math.floor(date.getTime() / 86400000),
    };
  }

  function parseMoney(value) {
    const normalized = text(value).replaceAll(",", "");
    const matches = normalized.match(/\d+(?:\.\d+)?/g) || [];
    if (matches.length !== 1) return null;
    const amount = Number(matches[0]);
    return Number.isFinite(amount) ? amount : null;
  }

  function displayMoney(amount) {
    return Number.isInteger(amount) ? `${amount}/m` : `${amount}/m`;
  }

  function targetMonthIndex(target) {
    if (Number.isFinite(target)) return Number(target);
    if (Number.isFinite(target?.monthIndex)) return Number(target.monthIndex);
    if (Number.isFinite(target?.absoluteIndex)) return Number(target.absoluteIndex);
    return parseRocDate(target)?.monthIndex ?? null;
  }

  function structuredStages(source) {
    const stored = Array.isArray(source?.pricingStages)
      ? source.pricingStages
      : Array.isArray(source?.priceStages)
        ? source.priceStages
        : [];
    const storedFirst = stored[0] && typeof stored[0] === "object" ? stored[0] : {};
    const storedSecond = stored[1] && typeof stored[1] === "object" ? stored[1] : {};
    const declared =
      source?.hasSecondStage === true ||
      text(source?.hasSecondStage).toLowerCase() === "true" ||
      stored.length > 0 ||
      [
        source?.stage1Years, source?.stage1Start, source?.stage1End,
        source?.stage2Years, source?.stage2Start, source?.stage2End,
        source?.stage2Amount, source?.stage2Kind,
      ].some((value) => text(value) !== "");
    if (!declared) return null;

    return {
      first: {
        years: text(field(source, "stage1Years") || storedFirst.years),
        start: text(field(source, "stage1Start") || storedFirst.start || field(source, "contractStart", "contract_start", "起始日期", "start")),
        end: text(field(source, "stage1End") || storedFirst.end),
        amount: text(storedFirst.amount || field(source, "amount", "monthly_amount", "金額", "price")),
      },
      second: {
        years: text(field(source, "stage2Years") || storedSecond.years),
        start: text(field(source, "stage2Start") || storedSecond.start),
        end: text(field(source, "stage2End") || storedSecond.end || field(source, "contractEnd", "contract_end", "合約到期日", "end")),
        amount: text(field(source, "stage2Amount") || storedSecond.amount),
        kind: text(field(source, "stage2Kind") || storedSecond.kind || "price_change"),
      },
    };
  }

  function validateStructuredStages(source) {
    const stages = structuredStages(source);
    if (!stages) return { declared: false, stages: null, error: "" };
    const firstStart = parseRocDate(stages.first.start);
    const firstEnd = parseRocDate(stages.first.end);
    const secondStart = parseRocDate(stages.second.start);
    const secondEnd = parseRocDate(stages.second.end);
    const firstAmount = parseMoney(stages.first.amount);
    const secondAmount = parseMoney(stages.second.amount);
    const kind = stages.second.kind.toLowerCase();

    if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
      return { declared: true, stages, error: "CRM 兩段合約日期不完整，需人工確認" };
    }
    if (firstAmount === null || secondAmount === null) {
      return { declared: true, stages, error: "CRM 兩段金額不完整，需人工確認" };
    }
    if (kind && kind !== "price_change") {
      return { declared: true, stages, error: "CRM 第2段不是換價資料，需人工確認" };
    }
    if (secondStart.dayIndex !== firstEnd.dayIndex + 1) {
      return { declared: true, stages, error: "CRM 兩段日期重疊或中斷，需人工確認" };
    }
    if (firstStart.dayIndex > firstEnd.dayIndex || secondStart.dayIndex > secondEnd.dayIndex) {
      return { declared: true, stages, error: "CRM 兩段合約日期不正確，需人工確認" };
    }
    return {
      declared: true,
      stages,
      error: "",
      firstStart,
      firstEnd,
      secondStart,
      secondEnd,
      firstAmount,
      secondAmount,
    };
  }

  function parseLegacyPlan(value) {
    const normalized = text(value).replaceAll(",", "");
    const match = normalized.match(/前\s*(\d+)\s*年\s*(\d+(?:\.\d+)?).*?後\s*(\d+)\s*年\s*(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    return {
      firstYears: Number(match[1]),
      firstAmount: Number(match[2]),
      secondYears: Number(match[3]),
      secondAmount: Number(match[4]),
    };
  }

  function parseLegacyTwoYearAmounts(amount, paymentCycle) {
    if (text(paymentCycle).toUpperCase() !== "2Y") return null;
    const normalized = text(amount);
    if (/實際|實收|報價|客戶|佣金/.test(normalized)) return null;
    const values = [...normalized.replaceAll(",", "").matchAll(/\d+(?:\.\d+)?\s*(?:\/\s*m)?/gi)]
      .map((match) => Number(match[0].match(/\d+(?:\.\d+)?/)[0]));
    return values.length === 2
      ? { firstYears: 1, firstAmount: values[0], secondYears: 1, secondAmount: values[1] }
      : null;
  }

  function monthlyPriceAt(source, target) {
    const monthIndex = targetMonthIndex(target);
    if (monthIndex === null) return { error: "應繳月份無法判讀" };

    const structured = validateStructuredStages(source);
    if (structured.declared) {
      if (structured.error) return { error: structured.error, structured: true };
      const useSecond = monthIndex >= structured.secondStart.monthIndex;
      const monthly = useSecond ? structured.secondAmount : structured.firstAmount;
      return {
        monthly,
        display: displayMoney(monthly),
        stage: useSecond ? "second" : "first",
        structured: true,
        secondStageStartMonthIndex: structured.secondStart.monthIndex,
      };
    }

    const start = parseRocDate(field(source, "contractStart", "contract_start", "起始日期", "start"));
    if (!start) return { error: "CRM 合約起始日期無法判讀" };
    const plan =
      parseLegacyPlan(field(source, "pricePlan", "stagedAmount", "階段金額", "price_plan")) ||
      parseLegacyPlan(field(source, "amount", "monthly_amount", "金額", "price")) ||
      parseLegacyTwoYearAmounts(field(source, "amount", "monthly_amount", "金額", "price"), field(source, "paymentCycle", "payment_cycle", "繳費方式", "cycle"));
    if (plan) {
      const useSecond = monthIndex >= start.monthIndex + plan.firstYears * 12;
      const monthly = useSecond ? plan.secondAmount : plan.firstAmount;
      return { monthly, display: displayMoney(monthly), stage: useSecond ? "legacy-second" : "legacy-first", structured: false };
    }

    const amountText = text(field(source, "amount", "monthly_amount", "金額", "price"));
    const operationalMatch = amountText.replaceAll(",", "").match(/(?:實際收|實收)\s*(\d+(?:\.\d+)?)/);
    if (operationalMatch) {
      const monthly = Number(operationalMatch[1]);
      return { monthly, display: displayMoney(monthly), stage: "operational", structured: false };
    }
    const monthly = parseMoney(amountText);
    if (monthly === null) {
      const count = (amountText.replaceAll(",", "").match(/\d+(?:\.\d+)?/g) || []).length;
      return { error: count > 1 ? "CRM 金額包含多種語意，需人工確認" : "CRM 金額無法判讀" };
    }
    return { monthly, display: displayMoney(monthly), stage: "single", structured: false };
  }

  return {
    parseRocDate,
    structuredStages,
    validateStructuredStages,
    monthlyPriceAt,
  };
});
