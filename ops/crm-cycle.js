(function initCrmCycle(root, factory) {
  const api = factory(root.HJRocDate || (typeof module === "object" && module.exports ? require("./roc-date.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HJCrmCycle = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function crmCycleFactory(dateApi) {
  const states = Object.freeze({
    HISTORICAL: "historical",
    CONFIRMED: "confirmed",
    LEGACY_GENERATED: "legacy_generated",
    INVALIDATED: "invalidated",
    DRAFT: "draft",
  });
  const knownStates = new Set(Object.values(states));

  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function normalizeCustomerNo(value) {
    const raw = text(value).toUpperCase();
    return /^V\d+$/u.test(raw) ? `V${raw.slice(1)}` : raw;
  }

  function generatedYearFromUid(value) {
    const match = text(value).match(/-(20\d{2})$/u);
    return match ? Number(match[1]) : null;
  }

  function explicitState(row) {
    const state = text(row?.cycleState || row?.cycle_state).toLowerCase();
    return knownStates.has(state) ? state : "";
  }

  function inferState(row, year, currentYear = new Date().getFullYear()) {
    const explicit = explicitState(row);
    if (explicit) return explicit;
    const numericYear = Number(year);
    const generatedYear = generatedYearFromUid(row?.uid || row?.source_row_key);
    if (generatedYear && generatedYear === numericYear && numericYear > Number(currentYear)) return states.LEGACY_GENERATED;
    return numericYear <= Number(currentYear) ? states.HISTORICAL : states.LEGACY_GENERATED;
  }

  function contractPeriod(row) {
    const value = Number(row?.contractPeriod ?? row?.contract_period);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function isConfirmed(row, year, currentYear) {
    return [states.HISTORICAL, states.CONFIRMED].includes(inferState(row, year, currentYear));
  }

  function isPending(row, year, currentYear) {
    return inferState(row, year, currentYear) === states.LEGACY_GENERATED;
  }

  function isInvalidated(row, year, currentYear) {
    return inferState(row, year, currentYear) === states.INVALIDATED;
  }

  function isPaymentEligible(row, year, currentYear) {
    if ((row?.folder || "active") === "ended") return false;
    return isConfirmed(row, year, currentYear);
  }

  function parseDate(value) {
    if (dateApi?.parse) return dateApi.parse(value);
    const match = text(value).match(/^(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})$/u);
    if (!match) return null;
    const enteredYear = Number(match[1]);
    return {
      westernYear: enteredYear >= 1911 ? enteredYear : enteredYear + 1911,
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  function contractStartYear(row) {
    return parseDate(row?.start || row?.contractStart || row?.contract_start)?.westernYear || null;
  }

  function hasStarted(row, referenceDate = new Date()) {
    const start = parseDate(row?.start || row?.contractStart || row?.contract_start);
    const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (!start || Number.isNaN(now.getTime())) return false;
    const startDay = Date.UTC(start.westernYear, start.month - 1, start.day);
    const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return startDay <= todayDay;
  }

  function coveredYears(row) {
    const startYear = parseDate(row?.start || row?.contractStart || row?.contract_start)?.westernYear;
    const endYear = parseDate(row?.end || row?.contractEnd || row?.contract_end)?.westernYear;
    if (!startYear || !endYear || endYear < startYear) return [];
    return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  }

  function cycleKey(row) {
    const customerNo = normalizeCustomerNo(row?.id || row?.customerNo || row?.customer_no);
    const start = parseDate(row?.start || row?.contractStart || row?.contract_start);
    const end = parseDate(row?.end || row?.contractEnd || row?.contract_end);
    const period = contractPeriod(row) || 0;
    if (!customerNo || !start || !end) return "";
    return `${customerNo}|p${period}|${start.westernYear}-${start.month}-${start.day}|${end.westernYear}-${end.month}-${end.day}`;
  }

  function contractIdentityKey(row) {
    const customerNo = normalizeCustomerNo(row?.id || row?.customerNo || row?.customer_no);
    const start = parseDate(row?.start || row?.contractStart || row?.contract_start);
    const end = parseDate(row?.end || row?.contractEnd || row?.contract_end);
    if (!customerNo || !start || !end) return "";
    return `${customerNo}|${start.westernYear}-${start.month}-${start.day}|${end.westernYear}-${end.month}-${end.day}`;
  }

  function dateRank(value) {
    const parsed = parseDate(value);
    if (!parsed) return 0;
    return parsed.westernYear * 10000 + parsed.month * 100 + parsed.day;
  }

  function currentRowPriority(row) {
    const state = explicitState(row) || states.HISTORICAL;
    const stateRank = state === states.CONFIRMED ? 2 : state === states.HISTORICAL ? 1 : 0;
    const confirmedAt = Date.parse(text(row?.confirmedAt || row?.confirmed_at)) || 0;
    return [
      row?.isCurrentContract === true ? 1 : 0,
      stateRank,
      contractPeriod(row) || 0,
      dateRank(row?.start || row?.contractStart || row?.contract_start),
      dateRank(row?.end || row?.contractEnd || row?.contract_end),
      confirmedAt,
    ];
  }

  function hasHigherCurrentPriority(candidate, current) {
    const candidatePriority = currentRowPriority(candidate);
    const currentPriority = currentRowPriority(current);
    for (let index = 0; index < candidatePriority.length; index += 1) {
      if (candidatePriority[index] !== currentPriority[index]) {
        return candidatePriority[index] > currentPriority[index];
      }
    }
    return false;
  }

  function selectCurrentRows(rows) {
    if (!Array.isArray(rows)) return [];
    const selected = new Map();
    rows.forEach((row, index) => {
      const customerNo = normalizeCustomerNo(row?.id || row?.customerNo || row?.customer_no);
      const key = customerNo || `__unidentified_${index}`;
      const current = selected.get(key);
      if (!current) {
        selected.set(key, { row, index });
        return;
      }
      if (hasHigherCurrentPriority(row, current.row)) {
        selected.set(key, { row, index: current.index });
      }
    });
    return [...selected.values()]
      .sort((left, right) => left.index - right.index)
      .map(({ row }) => row);
  }

  function projectCyclesToYearShells(venueData, currentYear = new Date().getFullYear()) {
    if (!venueData?.years || typeof venueData.years !== "object") return venueData;
    const years = venueData.years;
    Object.keys(years).forEach((year) => {
      years[year] = (years[year] || []).filter((row) => row?.isProjection !== true);
    });
    const sources = [];
    const seen = new Set();
    const seenContractIdentities = new Set();
    Object.entries(years).forEach(([sourceYear, rows]) => {
      (rows || []).forEach((row) => {
        if ((row?.folder || "active") === "ended") return;
        if (![states.HISTORICAL, states.CONFIRMED].includes(inferState(row, sourceYear, currentYear))) return;
        const key = cycleKey(row);
        const identityKey = contractIdentityKey(row);
        if (!key || !identityKey || seen.has(key) || seenContractIdentities.has(identityKey)) return;
        seen.add(key);
        seenContractIdentities.add(identityKey);
        sources.push({ row, sourceYear, key, identityKey });
      });
    });
    sources.forEach(({ row }) => {
      if (row?.isCurrentContract === false) return;
      coveredYears(row).forEach((targetYear) => {
        years[String(targetYear)] ||= [];
      });
    });
    Object.keys(years).forEach((targetYear) => {
      const allTargetRows = years[targetYear] || [];
      const confirmedTargetRows = (years[targetYear] || []).filter((row) => (
        [states.HISTORICAL, states.CONFIRMED].includes(inferState(row, targetYear, currentYear))
      ));
      const allExistingKeys = new Set(allTargetRows.map(cycleKey).filter(Boolean));
      const allExistingContractIdentities = new Set(allTargetRows.map(contractIdentityKey).filter(Boolean));
      const confirmedExistingKeys = new Set(confirmedTargetRows.map(cycleKey).filter(Boolean));
      const confirmedExistingContractIdentities = new Set(confirmedTargetRows.map(contractIdentityKey).filter(Boolean));
      sources.forEach(({ row, sourceYear, key, identityKey }) => {
        const sourceState = inferState(row, sourceYear, currentYear);
        const mayReplaceFutureLegacy = sourceState === states.CONFIRMED && Number(targetYear) >= Number(currentYear);
        const existingKeys = mayReplaceFutureLegacy ? confirmedExistingKeys : allExistingKeys;
        const existingContractIdentities = mayReplaceFutureLegacy
          ? confirmedExistingContractIdentities
          : allExistingContractIdentities;
        if (
          String(sourceYear) === String(targetYear)
          || existingKeys.has(key)
          || existingContractIdentities.has(identityKey)
        ) return;
        if (row?.isCurrentContract === false) return;
        if (!coveredYears(row).includes(Number(targetYear))) return;
        years[targetYear].push({
          ...structuredClone(row),
          uid: `${text(row.uid) || key}-projection-${targetYear}`,
          isProjection: true,
          projectionSourceYear: String(sourceYear),
        });
        allExistingKeys.add(key);
        allExistingContractIdentities.add(identityKey);
        confirmedExistingKeys.add(key);
        confirmedExistingContractIdentities.add(identityKey);
      });
    });
    return venueData;
  }

  function sameContract(left, right) {
    if (!left || !right) return false;
    const sameDate = (a, b) => {
      if (dateApi?.same) return dateApi.same(a, b);
      return text(a) === text(b);
    };
    return normalizeCustomerNo(left.id || left.customerNo || left.customer_no) === normalizeCustomerNo(right.id || right.customerNo || right.customer_no)
      && sameDate(left.start || left.contractStart || left.contract_start, right.start || right.contractStart || right.contract_start)
      && sameDate(left.end || left.contractEnd || left.contract_end, right.end || right.contractEnd || right.contract_end);
  }

  function renewalDraftFrom(row) {
    const previousEnd = row?.end || row?.contractEnd || row?.contract_end || "";
    const nextStart = dateApi?.normalize?.(previousEnd) || text(previousEnd);
    return {
      ...structuredClone(row || {}),
      uid: "",
      start: nextStart,
      end: "",
      contractYears: "",
      contractTerm: "",
      amount: "",
      pricePlan: "",
      hasSecondStage: false,
      stage1Years: "",
      stage1Start: "",
      stage1End: "",
      stage2Years: "",
      stage2Start: "",
      stage2End: "",
      stage2Amount: "",
      stage2Kind: "",
      pricingStages: [],
      folder: "active",
      cycleState: states.DRAFT,
      contractPeriod: (contractPeriod(row) || 1) + 1,
      confirmedAt: "",
      isCurrentContract: false,
    };
  }

  return Object.freeze({
    states,
    inferState,
    contractPeriod,
    isConfirmed,
    isPending,
    isInvalidated,
    isPaymentEligible,
    contractStartYear,
    hasStarted,
    coveredYears,
    cycleKey,
    selectCurrentRows,
    projectCyclesToYearShells,
    sameContract,
    renewalDraftFrom,
    normalizeCustomerNo,
  });
});
