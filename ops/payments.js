const defaultPaymentRows = window.hjDefaultPaymentRows || [];

window.hjDefaultPaymentRows = defaultPaymentRows;

const venueLabels = {
  taichung: "台中館",
  huanrui: "環瑞館",
};

const venueKeys = Object.keys(venueLabels);

const monthEnglish = {
  "1月": "January",
  "2月": "February",
  "3月": "March",
  "4月": "April",
  "5月": "May",
  "6月": "June",
  "7月": "July",
  "8月": "August",
  "9月": "September",
  "10月": "October",
  "11月": "November",
  "12月": "December",
};

const initialPaymentYear = 2026;
const paymentYearStateKey = "hjPaymentYearStateV1";
const currentGregorianYear = String(new Date().getFullYear());
const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const contractConfirmationNote = "合約到期，先確認續約";
const yearGeneratingPaintDelayMs = 900;
const minimumYearGeneratingMs = 3000;

const paymentData = {
  taichung: {
    ...(window.hjImportedPaymentData?.taichung || {}),
    "6月": defaultPaymentRows,
  },
  huanrui: {
    ...(window.hjImportedPaymentData?.huanrui || {}),
  },
};

const sectionOrder = ["年繳 / 2Y", "辦公室", "營登", "自由座"];

const venueActiveMonths = {
  taichung: "6月",
  huanrui: "6月",
};

let paymentYearState = readPaymentYearState();
let activeVenue = "taichung";
let activeYear = Number(paymentYearState.activeYear || paymentYearState.activeYears[activeVenue] || initialPaymentYear);
let activeMonth = "6月";
let activeFilter = "all";
let searchTerm = "";
let selectedRowIndex = null;
let rowBasicsOpen = false;
let paymentPointerStart = null;
let lastPaymentPointerWasDrag = false;
let closingLookupMatches = [];
let crmCheckState = {
  key: "",
  status: "idle",
  match: null,
};
let crmAutoLookupTimer = null;
let yearActionLocked = false;
let yearActionTimer = null;
let yearBackfillTimer = null;
const crmCache = {};
const webCrmPaymentBridgeKey = "hj-crm-payment-bridge-v1";
const webCrmStorageKey = "hj-crm-clean-v5-data-repair";
const suppressedPaymentRowsKey = "hjPaymentSuppressedRowsV1";
const paymentBackfillStateKey = "hjPaymentBackfillStateV1";
const paymentBackfillVersion = "20260628-month-data-1";
const paymentRowsCache = new Map();
let suppressedPaymentRowsCache = null;

const yearPicker = document.querySelector("#yearPicker");
const yearSelect = document.querySelector("#yearSelect");
const prevYearButton = document.querySelector("#prevYearButton");
const nextYearButton = document.querySelector("#nextYearButton");
const createYearButton = document.querySelector("#createYearButton");
const yearActionState = document.querySelector("#yearActionState");

function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? String(year) : String(initialPaymentYear);
}

function scanStoredPaymentYears(venue) {
  const years = new Set([String(initialPaymentYear)]);
  const importedByYear = window.hjImportedPaymentDataByYear?.[venue] || {};
  Object.keys(importedByYear).forEach((year) => years.add(normalizeYear(year)));
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      const match = key.match(new RegExp(`^hjPaymentRows(\\d{4})_${venue}_`));
      if (match) years.add(match[1]);
    }
  } catch {
    // Keep the default year if localStorage cannot be scanned.
  }
  return Array.from(years).sort((a, b) => Number(a) - Number(b));
}

function readPaymentYearState() {
  const fallback = {
    activeYear: String(initialPaymentYear),
    activeYears: { taichung: String(initialPaymentYear), huanrui: String(initialPaymentYear) },
    years: {
      taichung: [String(initialPaymentYear)],
      huanrui: [String(initialPaymentYear)],
    },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(paymentYearStateKey) || "null") || {};
    const years = {};
    ["taichung", "huanrui"].forEach((venue) => {
      years[venue] = Array.from(
        new Set([
          ...fallback.years[venue],
          ...(Array.isArray(saved.years?.[venue]) ? saved.years[venue].map(normalizeYear) : []),
          ...scanStoredPaymentYears(venue),
        ]),
      ).sort((a, b) => Number(a) - Number(b));
    });
    const globalYears = Array.from(new Set(Object.values(years).flat()));
    const savedActiveYear = normalizeYear(saved.activeYear || saved.activeYears?.taichung || initialPaymentYear);
    const activeYear = globalYears.includes(savedActiveYear) ? savedActiveYear : String(initialPaymentYear);
    return {
      activeYear,
      activeYears: {
        taichung: activeYear,
        huanrui: activeYear,
      },
      years,
    };
  } catch {
    return fallback;
  }
}

function persistPaymentYearState() {
  localStorage.setItem(paymentYearStateKey, JSON.stringify(paymentYearState));
}

function getYears(venue = activeVenue) {
  return (paymentYearState.years[venue] || [String(initialPaymentYear)]).sort((a, b) => Number(a) - Number(b));
}

function getGlobalYears() {
  return Array.from(new Set(venueKeys.flatMap((venue) => getYears(venue)))).sort((a, b) => Number(a) - Number(b));
}

function ensurePaymentYearExists(venue = activeVenue, year = activeYear) {
  const normalized = normalizeYear(year);
  if (!paymentYearState.years[venue]) {
    paymentYearState.years[venue] = [String(initialPaymentYear)];
  }
  if (!paymentYearState.years[venue].includes(normalized)) {
    paymentYearState.years[venue].push(normalized);
    paymentYearState.years[venue].sort((a, b) => Number(a) - Number(b));
    persistPaymentYearState();
  }
  return normalized;
}

function ensurePaymentYearExistsForAll(year = activeYear) {
  return venueKeys.map((venue) => ensurePaymentYearExists(venue, year));
}

function activeYearForVenue(venue = activeVenue) {
  const normalized = normalizeYear(paymentYearState.activeYear || paymentYearState.activeYears?.[venue] || initialPaymentYear);
  return Number(normalized);
}

function setActiveYearForVenue(venue = activeVenue, year = activeYear) {
  const normalized = ensurePaymentYearExists(venue, year);
  paymentYearState.activeYears[venue] = normalized;
  paymentYearState.activeYear = normalized;
  if (venue === activeVenue) {
    activeYear = Number(normalized);
  }
  persistPaymentYearState();
  return Number(normalized);
}

function setActiveYearForAllVenues(year = activeYear) {
  const normalized = normalizeYear(year);
  ensurePaymentYearExistsForAll(normalized);
  paymentYearState.activeYear = normalized;
  venueKeys.forEach((venue) => {
    paymentYearState.activeYears[venue] = normalized;
  });
  activeYear = Number(normalized);
  persistPaymentYearState();
  return activeYear;
}

function getAdjacentYears(_venue = activeVenue, year = activeYear) {
  const years = getGlobalYears();
  const current = String(year);
  const activeIndex = years.indexOf(current);
  return {
    previous: activeIndex > 0 ? years[activeIndex - 1] : "",
    next: activeIndex >= 0 && activeIndex < years.length - 1 ? years[activeIndex + 1] : "",
  };
}

function getNextCreatableYear() {
  const years = new Set(getGlobalYears());
  let candidate = Number(activeYear) + 1;
  while (years.has(String(candidate))) {
    candidate += 1;
  }
  return String(candidate);
}

function normalizeLoose(value) {
  return normalizeAscii(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[　（）()有限公司股份工作室企業社商行行號]/g, "");
}

function normalizeAscii(value) {
  return String(value || "")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replaceAll("　", " ");
}

function normalizeCustomerId(value) {
  const raw = normalizeAscii(value).trim();
  return /^v/i.test(raw) ? raw.toUpperCase() : raw;
}

function venueIdErrorMessage(id, venue = activeVenue) {
  const normalizedId = normalizeCustomerId(id);
  if (!normalizedId) return "";
  const isVId = /^V\d+$/i.test(normalizedId);
  if (venue === "taichung" && isVId) {
    return "V 開頭是環瑞館編號，不能新增到台中館。";
  }
  if (venue === "huanrui" && !isVId && normalizedId !== "211") {
    return "環瑞館只接受 V 開頭編號；211 是例外。";
  }
  return "";
}

function currentCrmCheckKey() {
  return [
    activeVenue,
    normalizeCustomerId(getValue("#newCustomerId")),
    getValue("#newCustomerName"),
    getValue("#newCustomerCompany"),
  ].join("|");
}

function setCrmCheckState(status, title, text, match = null) {
  crmCheckState = {
    key: status === "found" ? currentCrmCheckKey() : "",
    status,
    match,
  };

  const panel = document.querySelector("#crmCheckPanel");
  const titleNode = document.querySelector("#crmCheckTitle");
  const textNode = document.querySelector("#crmCheckText");
  if (!panel || !titleNode || !textNode) return;

  panel.classList.remove("found", "missing", "error");
  if (["found", "missing", "error"].includes(status)) panel.classList.add(status);
  titleNode.textContent = title;
  textNode.textContent = text;
}

function resetCrmCheckState() {
  setCrmCheckState(
    "idle",
    "尚未核對 CRM",
    "輸入編號後可智慧帶入。",
  );
}

function scheduleCrmAutoLookup(delay = 360) {
  window.clearTimeout(crmAutoLookupTimer);
  const id = getValue("#newCustomerId");
  if (!id) return;

  crmAutoLookupTimer = window.setTimeout(() => {
    if (getValue("#newCustomerId")) {
      checkNewCustomerAgainstCrm({ quietEmpty: true, auto: true });
    }
  }, delay);
}

function fetchCrmRows(venue = activeVenue) {
  const rows = readCrmRowsSync(venue);
  if (rows.length) return Promise.resolve(rows);
  return Promise.reject(new Error("目前沒有讀到 CRM 橋接資料，請先更新 CRM 來源"));
}

function readCrmRowsSync(venue = activeVenue) {
  const bridgeRows = readPaymentBridgeRows(venue);
  const webRows = readWebCrmRows(venue);
  const localRows = readBundledCrmRows(venue);
  return mergeCrmRows(bridgeRows, webRows, localRows).filter(hasUsefulCrmData);
}

function crmCompanyName(item) {
  return String(item?.公司名稱 || item?.公司 || "").trim();
}

function hasUsefulCrmData(row) {
  return Boolean(
    crmCompanyName(row) ||
      String(row?.姓名 || "").trim() ||
      String(row?.項目 || "").trim() ||
      String(row?.繳費方式 || "").trim() ||
      String(row?.起始日期 || "").trim() ||
      String(row?.合約到期日 || "").trim() ||
      String(row?.金額 || "").trim(),
  );
}

function readPaymentBridgeRows(venue = activeVenue) {
  try {
    const data = JSON.parse(localStorage.getItem(webCrmPaymentBridgeKey) || "null");
    const years = data?.venues?.[venue]?.years;
    if (!years || typeof years !== "object") return [];
    return Object.values(years)
      .flat()
      .map((row) => ({
        編號: String(row?.id || "").trim(),
        姓名: String(row?.name || "").trim(),
        公司名稱: String(row?.companyName || row?.company || "").trim(),
        項目: String(row?.item || "").trim(),
        繳費方式: String(row?.cycle || "").trim(),
        起始日期: String(row?.start || "").trim(),
        合約到期日: String(row?.end || "").trim(),
        金額: String(row?.amount || "").trim(),
        階段金額: String(row?.pricePlan || row?.stagedAmount || row?.階段金額 || "").trim(),
        _source: "web-crm-bridge",
      }))
      .filter((row) => row.編號 || row.公司名稱 || row.姓名);
  } catch {
    return [];
  }
}

function readWebCrmRows(venue = activeVenue) {
  try {
    const data = JSON.parse(localStorage.getItem(webCrmStorageKey) || "null");
    const years = data?.venues?.[venue]?.years;
    if (!years || typeof years !== "object") return [];
    return Object.values(years)
      .flat()
      .filter((row) => (row?.folder || "active") === "active")
      .map((row) => ({
        編號: String(row?.id || "").trim(),
        姓名: String(row?.name || "").trim(),
        公司名稱: String(row?.companyName || row?.company || "").trim(),
        項目: String(row?.item || "").trim(),
        繳費方式: String(row?.cycle || "").trim(),
        起始日期: String(row?.start || "").trim(),
        合約到期日: String(row?.end || "").trim(),
        金額: String(row?.amount || "").trim(),
        階段金額: String(
          row?.pricePlan ||
            row?.stagedAmount ||
            row?.階段金額 ||
            inferPricePlanFromText(row?.industry) ||
            inferPricePlanFromText(row?.notes)
        ).trim(),
        _source: "web-crm",
      }))
      .filter((row) => row.編號 || row.公司名稱 || row.姓名);
  } catch {
    return [];
  }
}

function readBundledCrmRows(venue = activeVenue) {
  const legacyRows = Array.isArray(window.hjCrmSourceData?.rows?.[venue]) ? window.hjCrmSourceData.rows[venue] : [];
  const source = window.HJ_CRM_SOURCE_DATA || window.hjCrmSourceData;
  const years = source?.venues?.[venue]?.years;
  const bundledRows = years && typeof years === "object" ? Object.values(years).flat() : [];
  return [...legacyRows, ...bundledRows]
    .filter((row) => (row?.folder || "active") === "active")
    .map((row) => ({
      編號: String(row?.編號 || row?.id || "").trim(),
      姓名: String(row?.姓名 || row?.name || "").trim(),
      公司名稱: String(row?.公司名稱 || row?.公司 || row?.companyName || row?.company || "").trim(),
      項目: String(row?.項目 || row?.item || "").trim(),
      繳費方式: String(row?.繳費方式 || row?.cycle || "").trim(),
      起始日期: String(row?.起始日期 || row?.start || "").trim(),
      合約到期日: String(row?.合約到期日 || row?.end || "").trim(),
      金額: String(row?.金額 || row?.amount || "").trim(),
      階段金額: String(row?.階段金額 || row?.pricePlan || row?.stagedAmount || "").trim(),
      _source: "bundled-crm",
    }))
    .filter((row) => row.編號 || row.公司名稱 || row.姓名);
}

function mergeCrmRows(...rowGroups) {
  const seen = new Set();
  return rowGroups.flat().filter((row) => {
    const id = String(row?.編號 || "").trim().toUpperCase();
    const start = normalizeComparableDate(row?.起始日期);
    const end = normalizeComparableDate(row?.合約到期日);
    const key = id && (start || end) ? `${id}|${start}|${end}` : id || `${normalizeLoose(crmCompanyName(row))}|${normalizeLoose(row?.姓名)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serviceSectionFromCrm(item) {
  const service = String(item?.項目 || item?.服務項目 || "").trim();
  if (service.includes("辦公室")) return "辦公室";
  if (service.includes("自由座")) return "自由座";
  if (service.includes("代收信件")) return "營登";
  if (service.includes("營")) return "營登";
  return "";
}

function crmMatchesInput(item, id, name, company) {
  const inputId = normalizeCustomerId(id).toUpperCase();
  const inputName = normalizeLoose(name);
  const inputCompany = normalizeLoose(company);
  const crmId = normalizeCustomerId(item?.編號).toUpperCase();
  const crmName = normalizeLoose(item?.姓名);
  const crmCompany = normalizeLoose(crmCompanyName(item));
  if (inputId && crmId && inputId === crmId) return true;
  if (inputCompany && crmCompany && inputCompany === crmCompany) return true;
  if (inputName && crmName && inputName === crmName) return true;
  return false;
}

function crmMatchScore(item, id, name, company) {
  let score = 0;
  if (normalizeCustomerId(item?.編號).toUpperCase() === normalizeCustomerId(id).toUpperCase()) score += 10;
  if (normalizeLoose(crmCompanyName(item)) === normalizeLoose(company)) score += 6;
  if (normalizeLoose(item?.姓名) === normalizeLoose(name)) score += 3;
  return score;
}

function findCrmMatch(rows, id, name, company) {
  return rows
    .filter((item) => crmMatchesInput(item, id, name, company))
    .sort((a, b) => {
      const scoreDiff = crmMatchScore(b, id, name, company) - crmMatchScore(a, id, name, company);
      if (scoreDiff !== 0) return scoreDiff;
      return crmPeriodIndex(b, "起始日期") - crmPeriodIndex(a, "起始日期");
    })[0];
}

function fillNewCustomerFromCrm(item) {
  if (!item) return;
  const setIfValue = (selector, value) => {
    const input = document.querySelector(selector);
    if (input && value) input.value = value;
  };
  setIfValue("#newCustomerId", normalizeCustomerId(item.編號));
  setIfValue("#newCustomerName", item.姓名);
  setIfValue("#newCustomerCompany", crmCompanyName(item) || (serviceSectionFromCrm(item) === "自由座" ? "自由座" : ""));
  setIfValue("#newCustomerStart", item.起始日期);
  setIfValue("#newCustomerEnd", item.合約到期日);
  setIfValue("#newCustomerPrice", item.金額);

  const cycle = document.querySelector("#newCustomerCycle");
  if (cycle && item.繳費方式) cycle.value = normalizeCycleForSelect(item.繳費方式);

  const section = document.querySelector("#newCustomerSection");
  const crmSection = serviceSectionFromCrm(item);
  if (section && crmSection) section.value = crmSection;
}

function crmSourceLabel(item) {
  if (item?._source === "web-crm-bridge") return "新 CRM 本機橋接";
  if (item?._source === "web-crm") return "新 CRM 本機資料";
  if (item?._source === "bundled-crm") return "新 CRM 內建資料";
  return "人工 CRM 橋接";
}

function crmCheckSummary(item) {
  const sectionValue = document.querySelector("#newCustomerSection")?.value || "";
  const section = sectionValue === "auto" ? serviceSectionFromCrm(item) : sectionValue;
  return [
    section || item?.項目 || "項目未填",
    getValue("#newCustomerCycle") || item?.繳費方式 || "方式未填",
    `${getValue("#newCustomerStart") || item?.起始日期 || "起始未填"}～${getValue("#newCustomerEnd") || item?.合約到期日 || "到期未填"}`,
    getValue("#newCustomerPrice") || item?.金額 || "金額未填",
    item?.階段金額 ? `階段金額 ${item.階段金額}` : "",
  ].filter(Boolean).join(" / ");
}

function crmPeriodIndex(item, field) {
  return parseMinguoMonthIndex(item?.[field]) ?? -Infinity;
}

function isNewerCrmPeriod(item, row) {
  const crmStart = crmPeriodIndex(item, "起始日期");
  const crmEnd = crmPeriodIndex(item, "合約到期日");
  const rowStart = parseMinguoMonthIndex(row?.start) ?? -Infinity;
  const rowEnd = parseMinguoMonthIndex(row?.end) ?? -Infinity;
  return crmStart > rowStart || crmEnd > rowEnd;
}

function findRenewalCrmMatch(rows, row) {
  return rows
    .filter((item) => crmMatchesInput(item, row.id, row.name, row.company))
    .filter((item) => isNewerCrmPeriod(item, row))
    .sort((a, b) => {
      const sourceDiff = (b?._source === "web-crm-bridge" ? 1 : 0) - (a?._source === "web-crm-bridge" ? 1 : 0);
      if (sourceDiff !== 0) return sourceDiff;
      return crmPeriodIndex(b, "起始日期") - crmPeriodIndex(a, "起始日期");
    })[0];
}

function rowFromRenewalCrm(item, previousRow) {
  const cycle = normalizeCycleForSelect(item?.繳費方式 || previousRow.cycle);
  const company = crmCompanyName(item) || previousRow.company;
  return {
    ...previousRow,
    section: serviceSectionFromCrm(item) || sectionForNewCustomer(cycle, company) || previousRow.section,
    name: String(item?.姓名 || previousRow.name || "").trim(),
    company,
    cycle,
    start: String(item?.起始日期 || previousRow.start || "").trim(),
    end: String(item?.合約到期日 || previousRow.end || "").trim(),
    price: normalizeMonthlyPrice(item?.金額 || previousRow.price || ""),
    pricePlan: String(item?.階段金額 || previousRow.pricePlan || "").trim(),
    paidDate: "",
    paidAmount: "",
    nextDate: "",
    invoice: "",
    manualStatus: "",
    note: "新循環",
  };
}

async function checkNewCustomerAgainstCrm(options = {}) {
  const id = normalizeCustomerId(getValue("#newCustomerId"));
  const idInput = document.querySelector("#newCustomerId");
  if (idInput && idInput.value !== id) idInput.value = id;
  const name = getValue("#newCustomerName");
  const company = getValue("#newCustomerCompany");
  if (!id && !company && !name) {
    if (options.quietEmpty) return;
    setCrmCheckState("missing", "請先輸入資料", "至少輸入編號、公司名稱或姓名，再檢查 CRM。");
    return;
  }

  const venueError = venueIdErrorMessage(id);
  if (venueError) {
    setCrmCheckState("missing", "館別不符合", venueError);
    if (!options.auto) showToast(venueError);
    return;
  }

  setCrmCheckState("idle", "正在智慧帶入", "正在讀取 CRM。");
  try {
    const rows = await fetchCrmRows(activeVenue);
    const match = findCrmMatch(rows, id, name, company);
    if (!match) {
      setCrmCheckState(
        "missing",
        "CRM 找不到",
        `${venueLabels[activeVenue]} CRM 沒找到這筆。請先確認新 CRM 是否已建立並儲存，再新增到繳費表。`,
      );
      return;
    }

    const matchedVenueError = venueIdErrorMessage(match.編號);
    if (matchedVenueError) {
      setCrmCheckState("missing", "館別不符合", matchedVenueError);
      if (!options.auto) showToast(matchedVenueError);
      return;
    }

    fillNewCustomerFromCrm(match);
    setCrmCheckState(
      "found",
      `CRM 已找到：${match.編號 || ""} ${crmCompanyName(match) || match.姓名 || ""}`,
      `${crmSourceLabel(match)}：${crmCheckSummary(match)}。請確認後再新增。`,
      match,
    );
  } catch (error) {
    setCrmCheckState("error", "CRM 讀取失敗", `${error.message || "無法讀取 CRM"}。先不要新增正式資料。`);
  }
}

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function makeRowKey(row, index, venue = activeVenue, month = activeMonth, year = activeYear) {
  return [
    venue,
    year,
    month,
    row.id || "",
    row.company || "",
    row.start || "",
    row.end || "",
    row.cycle || "",
    index,
  ].join("|");
}

function makeManualRowKey(venue = activeVenue, month = activeMonth, year = activeYear) {
  return `${venue}|${year}|${month}|manual|${Date.now()}|${Math.random().toString(36).slice(2)}`;
}

function normalizeMonthlyPrice(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/\/\s*m$/i.test(raw)) return raw.replace(/\s*\/\s*m$/i, "/m");
  if (/^\d[\d,]*$/.test(raw)) return `${raw}/m`;
  return raw;
}

function inferPricePlanFromText(value) {
  const text = String(value || "").trim();
  const match = text.match(/前\s*\d+\s*年\s*[\d,]+(?:\s*\/\s*m)?\s*[，,、/ ]+\s*後\s*\d+\s*年\s*[\d,]+(?:\s*\/\s*m)?/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function normalizeCycleForSelect(value) {
  return normalizeCycleValue(value);
}

function normalizeCycleValue(value) {
  return normalizeAscii(value).trim().toUpperCase();
}

function ensureRowKeys(rows, venue = activeVenue, month = activeMonth, year = activeYear) {
  return rows.map((row, index) => {
    if (!row._rowKey) {
      row._rowKey = makeRowKey(row, index, venue, month, year);
    }
    return row;
  });
}

function sectionSortWeight(section) {
  if (isClosingSection(section)) return 90;
  const index = sectionOrder.indexOf(section);
  return index === -1 ? 50 : index;
}

function normalizeSectionGroups(rows) {
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const sectionDiff = sectionSortWeight(a.row.section) - sectionSortWeight(b.row.section);
      if (sectionDiff !== 0) return sectionDiff;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ row }) => row);
}

function serviceSectionOverride(row, venue = activeVenue) {
  return "";
}

function sameContractForPricePlan(a, b) {
  const sameId = normalizeCustomerId(a?.id) && normalizeCustomerId(a?.id) === normalizeCustomerId(b?.id);
  const sameStart = normalizeComparableValue("start", a?.start) === normalizeComparableValue("start", b?.start);
  const sameEnd = normalizeComparableValue("end", a?.end) === normalizeComparableValue("end", b?.end);
  return Boolean(sameId && sameStart && sameEnd);
}

function knownPricePlanFor(row) {
  if (row?.pricePlan) return row.pricePlan;
  const knownRow = defaultPaymentRows.find((item) => item.pricePlan && sameContractForPricePlan(item, row));
  return knownRow?.pricePlan || inferPricePlanFromText(row?.industry) || inferPricePlanFromText(row?.note) || "";
}

function normalizeRowSemantics(row, venue = activeVenue) {
  if (row.section === "辦公室月繳") {
    row.section = "辦公室";
  }
  if (row.section === "6M") {
    row.section = "營登";
  }
  if (row.section === "代收信件") {
    row.section = "營登";
  }
  if (row.previousSection === "辦公室月繳") {
    row.previousSection = "辦公室";
  }
  if (row.previousSection === "6M") {
    row.previousSection = "營登";
  }
  if (row.previousSection === "代收信件") {
    row.previousSection = "營登";
  }
  const overrideSection = serviceSectionOverride(row, venue);
  if (overrideSection) {
    row.section = overrideSection;
  }
  const pricePlan = knownPricePlanFor(row);
  if (pricePlan) {
    row.pricePlan = pricePlan;
  }
  return row;
}

function isFreeSeatMonthlyRow(row) {
  return (row?.section === "自由座" || row?.company === "自由座") && normalizeCycleValue(row?.cycle) === "M";
}

function shouldAutofillNextDate(row, month = activeMonth, year = activeYear) {
  if (!isFreeSeatMonthlyRow(row) || row?.nextDate || isClosingSection(row?.section) || isNonBillableRow(row)) return false;
  return Boolean(nextDateForRowAt(row, month, year));
}

function normalizeRowForMonth(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  normalizeRowSemantics(row, venue);
  if (shouldAutofillNextDate(row, month, year)) {
    row.nextDate = nextDateForRowAt(row, month, year);
  }
  if (isContractConfirmationRow(row, month, year) && !hasContractConfirmationNote(row)) {
    row.note = prioritizeContractConfirmationNote(
      `${contractConfirmationNote}${row.note ? `；${row.note}` : ""}`,
    );
  }
  return row;
}

function baseRowsFor(venue = activeVenue, month = activeMonth, year = activeYear) {
  const importedByYearRows = window.hjImportedPaymentDataByYear?.[venue]?.[String(year)]?.[month];
  if (Array.isArray(importedByYearRows)) {
    return ensureRowKeys(
      normalizeSectionGroups(cloneRows(importedByYearRows).map((row) => normalizeRowForMonth(row, venue, month, year))),
      venue,
      month,
      year,
    );
  }
  if (Number(year) !== initialPaymentYear) return [];
  return ensureRowKeys(
    normalizeSectionGroups(cloneRows(paymentData[venue]?.[month] || []).map((row) => normalizeRowForMonth(row, venue, month, year))),
    venue,
    month,
    year,
  );
}

function paymentStorageKeyFor(venue = activeVenue, month = activeMonth, year = activeYear) {
  if (Number(year) === initialPaymentYear && venue === "taichung" && month === "6月") {
    return "hjPaymentRows202606TaichungV1";
  }
  return `hjPaymentRows${year}_${venue}_${month}_v1`;
}

function saveRowsFor(venue, month, rows, year = activeYear) {
  ensurePaymentYearExists(venue, year);
  const cleanedRows = removeSupersededGeneratedContractRows(rows, venue);
  const normalizedRows = ensureRowKeys(normalizeSectionGroups(cleanedRows), venue, month, year);
  localStorage.setItem(
    paymentStorageKeyFor(venue, month, year),
    JSON.stringify(normalizedRows),
  );
  paymentRowsCache.set(paymentRowsCacheKey(venue, month, year), cloneRows(normalizedRows));
}

function paymentRowsCacheKey(venue = activeVenue, month = activeMonth, year = activeYear) {
  return `${venue}|${normalizeYear(year)}|${month}`;
}

function clearPaymentRowsCache() {
  paymentRowsCache.clear();
}

function suppressedRowKeyFor(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  return [
    venue,
    year,
    month,
    normalizeCustomerId(row?.id),
    normalizeComparableDate(row?.start),
    normalizeComparableDate(row?.end),
    normalizeCycleForSelect(row?.cycle),
  ].join("|");
}

function readSuppressedPaymentRows() {
  if (suppressedPaymentRowsCache) return new Set(suppressedPaymentRowsCache);
  try {
    const rows = JSON.parse(localStorage.getItem(suppressedPaymentRowsKey) || "[]");
    suppressedPaymentRowsCache = Array.isArray(rows) ? new Set(rows) : new Set();
    return new Set(suppressedPaymentRowsCache);
  } catch {
    return new Set();
  }
}

function saveSuppressedPaymentRows(keys) {
  suppressedPaymentRowsCache = new Set(keys);
  clearPaymentRowsCache();
  localStorage.setItem(suppressedPaymentRowsKey, JSON.stringify(Array.from(keys)));
}

function removeSuppressedPaymentRow(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  const suppressed = readSuppressedPaymentRows();
  const deleted = suppressed.delete(suppressedRowKeyFor(row, venue, month, year));
  if (deleted) saveSuppressedPaymentRows(suppressed);
  return deleted;
}

function isSuppressedPaymentRow(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  return readSuppressedPaymentRows().has(suppressedRowKeyFor(row, venue, month, year));
}

function closingSectionForMonth(month = activeMonth) {
  return `待遷出 / ${month}辦理`;
}

function isClosingSection(section) {
  return String(section || "").startsWith("待遷出");
}

function loadPaymentRows(venue = activeVenue, month = activeMonth, year = activeYear) {
  const cacheKey = paymentRowsCacheKey(venue, month, year);
  if (paymentRowsCache.has(cacheKey)) return cloneRows(paymentRowsCache.get(cacheKey));
  ensurePaymentYearExists(venue, year);
  const baseRows = baseRowsFor(venue, month, year);
  const storageKey = paymentStorageKeyFor(venue, month, year);
  try {
    const savedText = localStorage.getItem(storageKey);
    const saved = JSON.parse(savedText || "null");
    if (Array.isArray(saved)) {
      const repaired = ensureRowKeys(normalizeSectionGroups(repairSavedRows(saved, baseRows, venue, month, year)), venue, month, year);
      const repairedText = JSON.stringify(repaired);
      if (repairedText !== savedText) localStorage.setItem(storageKey, repairedText);
      const merged = [...repaired];
      baseRows.forEach((baseRow) => {
        if (!isSuppressedPaymentRow(baseRow, venue, month, year) && !merged.some((row) => sameCustomerPeriod(row, baseRow))) {
          merged.push(baseRow);
        }
      });
      const rows = ensureRowKeys(normalizeSectionGroups(merged), venue, month, year);
      paymentRowsCache.set(cacheKey, cloneRows(rows));
      return rows;
    }
  } catch {
    // Ignore broken local data and fall back to the sheet snapshot.
  }
  const rows = baseRows.filter((row) => !isSuppressedPaymentRow(row, venue, month, year));
  paymentRowsCache.set(cacheKey, cloneRows(rows));
  return rows;
}

function loadBackfillSourceRows(venue = activeVenue, month = activeMonth, year = activeYear) {
  const baseRows = baseRowsFor(venue, month, year);
  const storageKey = paymentStorageKeyFor(venue, month, year);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (Array.isArray(saved)) {
      const savedRows = ensureRowKeys(
        normalizeSectionGroups(saved.map((row) => normalizeRowSemantics(row, venue))),
        venue,
        month,
        year,
      );
      baseRows.forEach((baseRow) => {
        if (!isSuppressedPaymentRow(baseRow, venue, month, year) && !savedRows.some((row) => sameCustomerPeriod(row, baseRow))) {
          savedRows.push(baseRow);
        }
      });
      return ensureRowKeys(normalizeSectionGroups(savedRows), venue, month, year);
    }
  } catch {
    // Fall back to the built-in rows below.
  }
  return baseRows;
}

function sameCustomerLoose(row, id, company) {
  const normalizedId = normalizeCustomerId(id);
  const normalizedCompany = String(company || "").trim();
  const sameId = normalizedId && normalizeCustomerId(row?.id) === normalizedId;
  const sameCompany = normalizedCompany && String(row?.company || "").trim() === normalizedCompany;
  return Boolean(sameId || sameCompany);
}

function isAutoGeneratedPaymentRow(row) {
  const key = String(row?._rowKey || "");
  const note = String(row?.note || "");
  return key.includes("|auto-next|") || /由.+?(新增|新循環|續約|既有資料)自動帶入/.test(note);
}

function crmContractSupersedesRow(item, row) {
  const crmId = normalizeCustomerId(item?.編號).toUpperCase();
  const rowId = normalizeCustomerId(row?.id).toUpperCase();
  if (!crmId || !rowId || crmId !== rowId) return false;

  const crmStart = normalizeComparableDate(item?.起始日期);
  const rowStart = normalizeComparableDate(row?.start);
  if (!crmStart || !rowStart || crmStart !== rowStart) return false;

  const crmCycle = normalizeCycleForSelect(item?.繳費方式);
  const rowCycle = normalizeCycleForSelect(row?.cycle);
  if (crmCycle && rowCycle && crmCycle !== rowCycle) return false;

  const crmEnd = parseMinguoMonthIndex(item?.合約到期日);
  const rowEnd = parseMinguoMonthIndex(row?.end);
  return crmEnd !== null && rowEnd !== null && crmEnd > rowEnd;
}

function isSupersededGeneratedContractRow(row, venue = activeVenue) {
  if (!isAutoGeneratedPaymentRow(row)) return false;
  return readCrmRowsSync(venue).some((item) => crmContractSupersedesRow(item, row));
}

function removeSupersededGeneratedContractRows(rows, venue = activeVenue) {
  return rows.filter((row) => !isSupersededGeneratedContractRow(row, venue));
}

function customerExistsOutsideStorage(row, venue = activeVenue, currentMonth = activeMonth, currentYear = activeYear) {
  return getYears(venue).some((year) =>
    monthLabels.some((month) => {
      if (Number(year) === Number(currentYear) && month === currentMonth) return false;
      const baseMatch = baseRowsFor(venue, month, year).some((item) => sameCustomerLoose(item, row.id, row.company));
      if (baseMatch) return true;

      try {
        const saved = JSON.parse(localStorage.getItem(paymentStorageKeyFor(venue, month, year)) || "null");
        return Array.isArray(saved) && saved.some((item) => !isAutoGeneratedPaymentRow(item) && sameCustomerLoose(item, row.id, row.company));
      } catch {
        return false;
      }
    }),
  );
}

function repairSavedRows(rows, baseRows = baseRowsFor(), venue = activeVenue, month = activeMonth, year = activeYear) {
  return rows.reduce((repairedRows, row) => {
    normalizeRowForMonth(row, venue, month, year);
    if (isSupersededGeneratedContractRow(row, venue)) {
      return repairedRows;
    }
    const defaultRow = baseRows.find((item) => item.id === row.id);
    const pricePlan = row.pricePlan || defaultRow?.pricePlan || knownPricePlanFor(row);
    if (pricePlan && !row.pricePlan) {
      row.pricePlan = pricePlan;
    }
    if (isAutoGeneratedPaymentRow(row)) {
      const stagedPrice = priceForRowAt(row, targetMonthFor(month, year));
      if (stagedPrice) row.price = stagedPrice;
    }
    if (row.id === "259") {
      row.invoice = "✔️";
    }
    const noteText = String(row.note || "").trim();
    const needsExistingCustomerCheck =
      noteText === "新辦" || (noteText === "新循環" && String(row._rowKey || "").includes("|manual|"));
    if (needsExistingCustomerCheck) {
      const isExistingCustomer = customerExistsOutsideStorage(row, venue, month, year);
      if (noteText === "新辦" && isExistingCustomer) {
        row.note = "新循環";
      }
      if (noteText === "新循環" && !isExistingCustomer && String(row._rowKey || "").includes("|manual|")) {
        row.note = "新辦";
      }
    }
    if (
      defaultRow &&
      isClosingSection(row.section) &&
      !isClosingSection(defaultRow.section) &&
      !row.previousSection
    ) {
      repairedRows.push({ ...row, previousSection: defaultRow.section });
      return repairedRows;
    }
    repairedRows.push(row);
    return repairedRows;
  }, []);
}

function savePaymentRows() {
  saveRowsFor(activeVenue, activeMonth, paymentRows, activeYear);
}

let paymentRows = loadPaymentRows();

function getTaipeiTodayParts() {
  const today = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(today);
  const parts = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const weekday = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    weekday: "short",
  }).format(today);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    weekday,
  };
}

function setupCalendarLink() {
  const link = document.querySelector("#calendarMonthLink");
  const label = document.querySelector("#todayLabel");
  if (!link || !label) return;

  const today = getTaipeiTodayParts();
  const calendarMonth = Number(today.month);
  label.textContent = `${today.year}-${today.month}-${today.day} ${today.weekday}`;
  link.href = `https://calendar.google.com/calendar/u/0/r/month/${today.year}/${calendarMonth}/1`;
  link.title = `開啟 Google Calendar ${today.year} 年 ${calendarMonth} 月`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isNonBillableRow(row) {
  if (row.paidDate || row.paidAmount || isClosingSection(row.section)) return false;
  if (row.manualStatus === "normal") return false;
  if (row.manualStatus === "nonbillable") return true;
  const note = String(row.note || "");
  return ["不需收款", "不用收款", "不收款", "不需繳費", "不用繳費"].some((keyword) =>
    note.includes(keyword),
  );
}

function manualStatusForRow(row) {
  return isNonBillableRow(row) ? "nonbillable" : "normal";
}

function getStatus(row) {
  if (isClosingSection(row.section) || row.paidDate.includes("歇業") || row.paidAmount.includes("退款")) {
    return { key: "closing", label: "收尾" };
  }
  if (isNonBillableRow(row)) {
    return { key: "nonbillable", label: "不收款" };
  }
  if (isContractConfirmationRow(row)) {
    return { key: "renewal", label: "確認續約" };
  }
  if (row.paidDate && row.paidAmount && row.invoice) {
    return { key: "done", label: "完成" };
  }
  if (row.paidDate && row.paidAmount && !row.invoice) {
    return { key: "invoice", label: "待開發票" };
  }
  if (!row.paidDate && !row.paidAmount) {
    return { key: "unpaid", label: "待收款" };
  }
  return { key: "check", label: "確認" };
}

function countRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.all += 1;
      const key = getStatus(row).key;
      if (key === "unpaid") acc.unpaid += 1;
      if (key === "invoice") acc.invoice += 1;
      if (key === "closing") acc.closing += 1;
      return acc;
    },
    { all: 0, unpaid: 0, invoice: 0, closing: 0 },
  );
}

function getVisibleRows() {
  return paymentRows.map((row, index) => ({ row, index })).filter(({ row }) => {
    const status = getStatus(row).key;
    const filterOk = activeFilter === "all" || status === activeFilter;
    const haystack = `${row.section} ${row.id} ${row.name} ${row.company} ${row.cycle} ${row.note} ${status}`.toLowerCase();
    const searchOk = !searchTerm || haystack.includes(searchTerm.toLowerCase());
    return filterOk && searchOk;
  });
}

function clearPaymentSearch() {
  searchTerm = "";
  const search = document.querySelector("#paymentSearch");
  if (search) search.value = "";
}

function renderMetrics() {
  document.querySelectorAll("[data-venue-summary]").forEach((summary) => {
    const venue = summary.dataset.venueSummary;
    const month = venueActiveMonths[venue] || "6月";
    const year = activeYearForVenue(venue);
    const rows = venue === activeVenue && month === activeMonth && year === activeYear ? paymentRows : loadPaymentRows(venue, month, year);
    const counts = countRows(rows);
    summary.querySelector('[data-summary-label="total"]').textContent = `${month}總筆數`;
    summary.querySelector('[data-summary-count="all"]').textContent = counts.all;
    summary.querySelector('[data-summary-count="unpaid"]').textContent = counts.unpaid;
    summary.querySelector('[data-summary-count="invoice"]').textContent = counts.invoice;
    summary.querySelector('[data-summary-count="closing"]').textContent = counts.closing;
  });
  document.querySelectorAll("[data-payment-filter]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.venue === activeVenue && button.dataset.paymentFilter === activeFilter,
    );
  });
}

function renderRows() {
  const container = document.querySelector("#paymentRows");
  const visible = getVisibleRows();
  container.innerHTML = "";

  let currentSection = "";
  let hasClosingLookup = false;
  visible.forEach(({ row, index }) => {
    if (row.section !== currentSection) {
      currentSection = row.section;
      const section = document.createElement("div");
      section.className = "payment-section";
      section.textContent = currentSection;
      container.appendChild(section);
      if (isClosingSection(currentSection)) {
        container.appendChild(createClosingLookup());
        hasClosingLookup = true;
      }
    }

    const status = getStatus(row);
    const item = document.createElement("article");
    item.className = `payment-row ${status.key}`;
    item.classList.toggle("selected", index === selectedRowIndex);
    item.dataset.rowIndex = index;
    item.innerHTML = `
      <span>${escapeHtml(row.id)}</span>
      <span>${escapeHtml(row.name)}</span>
      <strong title="${escapeHtml(row.company)}">${escapeHtml(row.company)}</strong>
      <span>${escapeHtml(row.cycle)}</span>
      <span>${escapeHtml(row.start)}</span>
      <span>${escapeHtml(row.end)}</span>
      <span>${escapeHtml(row.price)}</span>
      <span>${escapeHtml(row.paidDate)}</span>
      <span>${escapeHtml(row.paidAmount)}</span>
      <span>${escapeHtml(row.nextDate)}</span>
      <span>${row.invoice ? "✔️" : ""}</span>
      <span class="status-note-cell">
        <b class="sheet-status ${status.key}">${status.label}</b>
        <em>${escapeHtml(displayNote(row))}</em>
      </span>
    `;
    container.appendChild(item);
  });

  if (!hasClosingLookup && (activeFilter === "all" || activeFilter === "closing") && !searchTerm) {
    const section = document.createElement("div");
    section.className = "payment-section";
    section.textContent = closingSectionForMonth();
    container.appendChild(section);
    container.appendChild(createClosingLookup());
  }

}

function createClosingLookup() {
  const lookup = document.createElement("section");
  lookup.className = "closing-lookup";
  lookup.innerHTML = `
    <div class="closing-lookup-title">
      <strong>遷出客戶</strong>
      <span>輸入編號、公司名稱或姓名</span>
    </div>
    <label class="closing-search">
      <input id="closingLookupInput" type="search" placeholder="輸入編號 / 公司名稱 / 姓名" autocomplete="off" />
      <button id="closingLookupButton" type="button">帶入</button>
    </label>
    <div class="closing-suggestions" id="closingSuggestions" aria-live="polite"></div>
  `;
  return lookup;
}

function renderEditor() {
  const editor = document.querySelector("#rowEditor");
  if (!editor) return;

  if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) {
    editor.hidden = true;
    rowBasicsOpen = false;
    renderContractReminder();
    renderRowBasics();
    return;
  }

  const row = paymentRows[selectedRowIndex];
  const isClosingRow = isClosingSection(row.section);
  const isContractRow = isContractConfirmationRow(row);
  editor.hidden = false;
  if (isClosingRow) rowBasicsOpen = false;
  document.querySelector("#editorTitle").textContent = `${row.id} ${row.company}`;
  document.querySelector("#paidDateLabel").textContent = isClosingRow ? "退款/收尾日" : "繳費日";
  document.querySelector("#paidAmountLabel").textContent = isClosingRow ? "退款金額" : "繳費金額";
  document.querySelector("#invoiceLabel").textContent = isClosingRow ? "折讓發票" : "發票已開";
  document.querySelector("#nextDateField").hidden = isClosingRow;
  document.querySelector("#manualStatusField").hidden = isClosingRow;
  document.querySelector("#toggleRowBasics").hidden = isClosingRow || isContractRow;
  document.querySelector("#editPaidDate").value = row.paidDate;
  document.querySelector("#editPaidAmount").value = row.paidAmount;
  document.querySelector("#editNextDate").value = row.nextDate;
  document.querySelector("#editInvoice").checked = Boolean(row.invoice);
  document.querySelector("#editManualStatus").value = manualStatusForRow(row);
  document.querySelector("#editNote").value = row.note;
  document.querySelector("#restoreFromClosing").hidden = !(isClosingSection(row.section) && originalSectionForRow(row));
  renderContractReminder();
  renderRowBasics();
}

function hasContractConfirmationNote(row) {
  return String(row?.note || "").includes(contractConfirmationNote);
}

function hasFutureNextPayment(row, month = activeMonth, year = activeYear) {
  const target = targetMonthFor(month, year);
  const nextIndex = parseMinguoMonthIndex(row?.nextDate);
  return Boolean(target && nextIndex !== null && nextIndex > target.absoluteIndex);
}

function isContractConfirmationRow(row, month = activeMonth, year = activeYear) {
  if (!row || isClosingSection(row.section) || isNonBillableRow(row)) return false;
  if (hasContractConfirmationNote(row)) return true;
  const target = targetMonthFor(month, year);
  if (!target || !reachesOrPassesContractEnd(row, target)) return false;
  return !hasFutureNextPayment(row, month, year);
}

function contractReminderMessage(row) {
  if (!isContractConfirmationRow(row)) return "";
  return `${row.id} ${row.company || row.name}：先在新 CRM 建好下一期資料，再智慧帶入續約資料。手動修改只改繳費表，不會更新 CRM。`;
}

function renderContractReminder() {
  const reminder = document.querySelector("#contractReminder");
  if (!reminder) return;

  const row = selectedRowIndex === null ? null : paymentRows[selectedRowIndex];
  const message = row ? contractReminderMessage(row) : "";
  reminder.hidden = !message;
  if (message) {
    document.querySelector("#contractReminderText").textContent = message;
  }
}

function prioritizeContractConfirmationNote(note) {
  const parts = String(note || "")
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.includes(contractConfirmationNote)) return String(note || "");
  return [contractConfirmationNote, ...parts.filter((part) => part !== contractConfirmationNote)].join("；");
}

function displayNote(row) {
  return prioritizeContractConfirmationNote(row?.note);
}

function renderRowBasics() {
  const panel = document.querySelector("#rowBasics");
  if (!panel) return;

  if (!rowBasicsOpen || selectedRowIndex === null || !paymentRows[selectedRowIndex]) {
    panel.hidden = true;
    document.querySelector(".sheet-shell")?.classList.remove("has-row-basics");
    return;
  }

  const row = paymentRows[selectedRowIndex];
  panel.hidden = false;
  document.querySelector(".sheet-shell")?.classList.add("has-row-basics");
  document.querySelector("#rowBasicsContext").textContent = `${row.id} ${row.company || row.name}`;
  document.querySelector("#editSection").value = isClosingSection(row.section) ? closingSectionForMonth() : row.section;
  document.querySelector("#editName").value = row.name;
  document.querySelector("#editCompany").value = row.company;
  document.querySelector("#editCycle").value = normalizeCycleForSelect(row.cycle);
  document.querySelector("#editStart").value = row.start;
  document.querySelector("#editEnd").value = row.end;
  document.querySelector("#editPrice").value = row.price;
}

async function smartFillRenewalFromCrm() {
  if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) return;
  const currentRow = paymentRows[selectedRowIndex];
  if (!isContractConfirmationRow(currentRow)) {
    showToast("這筆不是合約到期確認列");
    return;
  }

  showToast("正在讀取 CRM 續約資料");
  try {
    const rows = await fetchCrmRows(activeVenue);
    const match = findRenewalCrmMatch(rows, currentRow);
    if (!match) {
      showToast("CRM 尚未找到下一期資料，請先在新 CRM 建好續約資料");
      return;
    }

    const nextRow = rowFromRenewalCrm(match, currentRow);
    const venueError = venueIdErrorMessage(nextRow.id);
    if (venueError) {
      showToast(venueError);
      return;
    }

    if (!nextRow.id || !nextRow.company || !nextRow.start || !nextRow.end || !nextRow.price) {
      showToast("CRM 續約資料未填完整，請先回 CRM 補齊");
      return;
    }

    const duplicateIndex = paymentRows.findIndex((row, index) => index !== selectedRowIndex && sameCustomerPeriod(row, nextRow));
    if (duplicateIndex >= 0) {
      showToast(`${nextRow.id} 這個續約期間已在本月`);
      return;
    }

    nextRow._rowKey = currentRow._rowKey || makeManualRowKey();
    paymentRows[selectedRowIndex] = nextRow;
    const generation = generateFuturePaymentsForAddedCustomer(nextRow, activeVenue, activeMonth, activeYear, { sourceKind: "manual" });
    paymentRows = normalizeSectionGroups(paymentRows);
    selectedRowIndex = paymentRows.findIndex((row) => row._rowKey === nextRow._rowKey);
    rowBasicsOpen = false;
    savePaymentRows();
    renderAll();

    let toast = `${nextRow.id} 已依 CRM 帶入續約資料`;
    if (generation.created) toast += `，已自動帶入 ${generation.created} 個後續月份`;
    if (generation.stoppedForContract) toast += "，到期前會再提醒續約";
    showToast(toast);
  } catch (error) {
    showToast(`${error.message || "CRM 讀取失敗"}，先不要續約寫入`);
  }
}

function closeAddCustomerPanel() {
  const panel = document.querySelector("#addCustomerPanel");
  const toggle = document.querySelector("#toggleAddCustomer");
  if (!panel || panel.hidden) return false;
  panel.hidden = true;
  toggle?.classList.remove("active");
  return true;
}

function closeSelectedRowEditor() {
  if (selectedRowIndex === null) return false;
  selectedRowIndex = null;
  rowBasicsOpen = false;
  renderRows();
  renderEditor();
  return true;
}

function isWorkspaceToolClick(target) {
  return Boolean(
    target.closest(
      [
        "#rowEditor",
        "#rowBasics",
        "#addCustomerPanel",
        "#toggleAddCustomer",
        ".payment-row[data-row-index]",
        ".closing-lookup",
        "#contractReminder",
        ".sheet-heading-actions",
        ".month-tab",
        ".metric",
        ".topbar-actions",
        ".sheet-year-context",
      ].join(", "),
    ),
  );
}

function updateSelectedRow(field, value) {
  if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) return;
  paymentRows[selectedRowIndex][field] = value;
  savePaymentRows();
  renderMetrics();
  renderRows();
  renderEditor();
}

function updateSelectedRowBasic(field, value) {
  if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) return;
  const selectedKey = paymentRows[selectedRowIndex]._rowKey;
  paymentRows[selectedRowIndex][field] = value;
  if (field === "section") {
    paymentRows = normalizeSectionGroups(paymentRows);
    selectedRowIndex = paymentRows.findIndex((row) => row._rowKey === selectedKey);
  }
  savePaymentRows();
  renderMetrics();
  renderRows();
  renderEditor();
}

function moveRowToClosing(rowIndex) {
  if (rowIndex === null || !paymentRows[rowIndex]) return;

  const [row] = paymentRows.splice(rowIndex, 1);
  const removedFutureRows = removeGeneratedFutureRowsFor(row);
  const suppressedFutureRows = suppressFutureBaseRowsFor(row);
  const suppressedGeneratedRows = suppressFutureGeneratedRowsFor(row);
  if (!isClosingSection(row.section) && !row.previousSection) {
    row.previousSection = row.section;
  }
  row.previousVenue = row.previousVenue || activeVenue;
  row.previousYear = row.previousYear || activeYear;
  row.previousMonth = row.previousMonth || activeMonth;
  row.section = closingSectionForMonth();
  paymentRows.push(row);
  selectedRowIndex = paymentRows.length - 1;
  activeFilter = "all";
  clearPaymentSearch();
  savePaymentRows();
  renderMetrics();
  renderRows();
  renderEditor();
  const futureCount = removedFutureRows + suppressedFutureRows + suppressedGeneratedRows;
  showToast(futureCount ? `${row.id} 已移到遷出，並清掉 ${futureCount} 筆後續月份` : `${row.id} 已移到遷出區塊`);
  window.requestAnimationFrame(() => {
    document.querySelector(".payment-row.selected")?.scrollIntoView({ block: "center" });
  });
}

function restoreSelectedFromClosing() {
  if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) return;
  const row = paymentRows[selectedRowIndex];
  const targetSection = originalSectionForRow(row);
  if (!isClosingSection(row.section) || !targetSection) return;

  const [movingRow] = paymentRows.splice(selectedRowIndex, 1);
  const restored = restoreClosingRowToSource(movingRow, targetSection);

  if (restored.external) {
    savePaymentRows();
    ensurePaymentYearExistsForAll(restored.sourceYear);
    setActiveYearForAllVenues(restored.sourceYear);
    activeVenue = restored.sourceVenue;
    activeMonth = restored.sourceMonth;
    venueActiveMonths[restored.sourceVenue] = restored.sourceMonth;
    paymentRows = loadPaymentRows(restored.sourceVenue, restored.sourceMonth, restored.sourceYear);
    selectedRowIndex = paymentRows.findIndex(
      (sourceRow) => sameCustomerPeriod(sourceRow, restored.row) && sourceRow.section === targetSection,
    );
    if (selectedRowIndex < 0) {
      selectedRowIndex = paymentRows.findIndex((sourceRow) => sameCustomerPeriod(sourceRow, restored.row));
    }
    activeFilter = "all";
    clearPaymentSearch();
    closeAddCustomerPanel();
    resetCrmCheckState();
    rowBasicsOpen = false;
    renderAll();
    showToast(`${restored.row.id} 已移回 ${restored.sourceYear} ${restored.sourceMonth} ${targetSection}`);
    window.requestAnimationFrame(() => {
      document.querySelector(".payment-row.selected")?.scrollIntoView({ block: "center" });
    });
    return;
  }

  const insertIndex = findInsertIndexForSection(targetSection);
  paymentRows.splice(insertIndex, 0, restored.row);
  selectedRowIndex = insertIndex;
  activeFilter = "all";
  clearPaymentSearch();
  savePaymentRows();
  renderMetrics();
  renderRows();
  renderEditor();
  showToast(`${movingRow.id} 已移回 ${targetSection}`);
  window.requestAnimationFrame(() => {
    document.querySelector(".payment-row.selected")?.scrollIntoView({ block: "center" });
  });
}

function originalSectionForRow(row) {
  if (row.previousSection) return row.previousSection;
  const defaultRow = baseRowsFor(activeVenue, activeMonth, activeYear).find((item) => item.id === row.id);
  if (defaultRow && !isClosingSection(defaultRow.section)) return defaultRow.section;
  return "";
}

function restoreClosingRowToSource(row, targetSection = originalSectionForRow(row)) {
  if (!row || !targetSection) return { external: false, row: null };
  const sourceVenue = row.previousVenue || activeVenue;
  const sourceYear = Number(row.previousYear || activeYear);
  const sourceMonth = row.previousMonth || activeMonth;
  const isExternalSource = sourceVenue !== activeVenue || sourceYear !== Number(activeYear) || sourceMonth !== activeMonth;
  const restoredRow = { ...row };

  if (Object.prototype.hasOwnProperty.call(restoredRow, "previousNote")) {
    restoredRow.note = restoredRow.previousNote || "";
  }

  delete restoredRow.previousSection;
  delete restoredRow.previousVenue;
  delete restoredRow.previousYear;
  delete restoredRow.previousMonth;
  delete restoredRow.previousNote;
  restoredRow.section = targetSection;
  removeSuppressedPaymentRow(restoredRow, sourceVenue, sourceMonth, sourceYear);
  removeFutureGeneratedSuppressionsFor(restoredRow, sourceVenue, sourceMonth, sourceYear);

  if (!isExternalSource) {
    return { external: false, row: restoredRow, targetSection };
  }

  const sourceRows = loadPaymentRows(sourceVenue, sourceMonth, sourceYear);
  if (!sourceRows.some((sourceRow) => sameCustomerPeriod(sourceRow, restoredRow))) {
    sourceRows.push({ ...restoredRow, _rowKey: makeManualRowKey(sourceVenue, sourceMonth, sourceYear) });
    saveRowsFor(sourceVenue, sourceMonth, sourceRows, sourceYear);
  }

  return {
    external: true,
    row: restoredRow,
    sourceVenue,
    sourceYear,
    sourceMonth,
    targetSection,
  };
}

function findInsertIndexForSection(sectionName) {
  const closingIndex = paymentRows.findIndex((row) => isClosingSection(row.section));
  const sameSectionLast = paymentRows.reduce((last, row, index) => (row.section === sectionName ? index : last), -1);
  if (sameSectionLast >= 0) return sameSectionLast + 1;
  if (closingIndex >= 0) return closingIndex;
  return paymentRows.length;
}

function selectClosingRow(rowIndex) {
  if (rowIndex === null || !paymentRows[rowIndex]) return;
  selectedRowIndex = rowIndex;
  activeFilter = "all";
  clearPaymentSearch();
  renderMetrics();
  renderRows();
  renderEditor();
  showToast(`${paymentRows[rowIndex].id} 已在遷出區塊`);
  window.requestAnimationFrame(() => {
    document.querySelector(".payment-row.selected")?.scrollIntoView({ block: "center" });
  });
}

function moveOrSelectClosingRow(rowIndex) {
  if (rowIndex === null || !paymentRows[rowIndex]) return;
  if (isClosingSection(paymentRows[rowIndex].section)) {
    selectClosingRow(rowIndex);
    return;
  }
  moveRowToClosing(rowIndex);
}

function addExternalRowToClosing(match) {
  if (!match?.row) return;
  const existsIndex = paymentRows.findIndex((row) => sameCustomerPeriod(row, match.row));
  if (existsIndex >= 0) {
    moveOrSelectClosingRow(existsIndex);
    return;
  }

  const row = {
    ...match.row,
    _rowKey: makeManualRowKey(),
    previousSection: isClosingSection(match.row.section) ? originalSectionForRow(match.row) || "" : match.row.section,
    previousVenue: match.venue || activeVenue,
    previousYear: Number(match.year || activeYear),
    previousMonth: match.month || activeMonth,
    previousNote: match.row.note || "",
    section: closingSectionForMonth(),
    paidDate: "",
    paidAmount: "",
    nextDate: "",
    invoice: "",
    manualStatus: "",
    note: match.row.note || `由${match.year}年${match.month}帶入`,
  };
  const removedFutureRows = removeGeneratedFutureRowsFor(row);
  const suppressedFutureRows = suppressFutureBaseRowsFor(row);
  paymentRows.push(row);
  selectedRowIndex = paymentRows.length - 1;
  activeFilter = "all";
  clearPaymentSearch();
  savePaymentRows();
  renderMetrics();
  renderRows();
  renderEditor();
  const futureCount = removedFutureRows + suppressedFutureRows;
  showToast(futureCount ? `${row.id} 已帶入遷出，並清掉 ${futureCount} 筆後續月份` : `${row.id} 已帶入遷出區塊`);
  window.requestAnimationFrame(() => {
    document.querySelector(".payment-row.selected")?.scrollIntoView({ block: "center" });
  });
}

function moveOrSelectClosingMatch(match) {
  if (!match) return;
  if (match.current) {
    moveOrSelectClosingRow(match.index);
    return;
  }
  addExternalRowToClosing(match);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function findPaymentRows(query) {
  const keyword = normalizeText(query);
  if (!keyword) return [];
  const seen = new Set();
  const matchesRow = (row) => {
      const haystack = normalizeText(`${row.id} ${row.name} ${row.company} ${row.note}`);
      return haystack.includes(keyword);
  };
  const result = paymentRows
    .map((row, index) => ({ row, index, current: true, venue: activeVenue, month: activeMonth, year: activeYear }))
    .filter(({ row }) => matchesRow(row));

  result.forEach(({ row }) => seen.add(`${normalizeCustomerId(row.id)}|${normalizeComparableDate(row.start)}|${normalizeComparableDate(row.end)}`));

  getYears(activeVenue).forEach((year) => {
    monthLabels.forEach((month) => {
      if (Number(year) === Number(activeYear) && month === activeMonth) return;
      loadPaymentRows(activeVenue, month, year).forEach((row, index) => {
        if (!matchesRow(row)) return;
        const key = `${normalizeCustomerId(row.id)}|${normalizeComparableDate(row.start)}|${normalizeComparableDate(row.end)}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push({ row, index, current: false, venue: activeVenue, month, year: Number(year) });
      });
    });
  });

  return result;
}

function renderClosingSuggestions(query) {
  const target = document.querySelector("#closingSuggestions");
  if (!target) return;
  const matches = findPaymentRows(query).slice(0, 5);
  closingLookupMatches = matches;
  if (!query.trim()) {
    target.innerHTML = "";
    return;
  }
  if (matches.length === 0) {
    target.innerHTML = `<p class="closing-empty">找不到符合「${escapeHtml(query)}」的客戶。</p>`;
    return;
  }
  target.innerHTML = matches
    .map(({ row, current, month, year }, index) => {
      const alreadyClosing = isClosingSection(row.section);
      const sourceLabel = current ? "當月" : `${year} ${month}`;
      return `
        <button class="closing-suggestion" type="button" data-closing-match-index="${index}">
          <strong>${escapeHtml(row.id)} ${escapeHtml(row.company || row.name)}</strong>
          <span>${escapeHtml(sourceLabel)} / ${escapeHtml(row.section)} / ${escapeHtml(row.cycle)} / ${escapeHtml(row.price)}${alreadyClosing ? " / 已在遷出區塊" : ""}</span>
        </button>
      `;
    })
    .join("");
}

function selectClosingMatch(query) {
  const matches = findPaymentRows(query);
  if (matches.length === 0) {
    showToast("找不到符合的客戶");
    renderClosingSuggestions(query);
    return;
  }

  const normalizedQuery = normalizeCustomerId(query.trim()).toUpperCase();
  const exact = matches.find(({ row }) => normalizeCustomerId(row.id).toUpperCase() === normalizedQuery) || matches[0];
  moveOrSelectClosingMatch(exact);
}

function sectionForNewCustomer(cycle, company) {
  const normalizedCycle = normalizeCycleValue(cycle);
  if (company === "自由座") return "自由座";
  if (normalizedCycle.includes("6M")) return "營登";
  if (normalizedCycle === "M" || normalizedCycle === "3M") return "辦公室";
  return "年繳 / 2Y";
}

function selectedSectionForNewCustomer(cycle, company) {
  const manualSection = document.querySelector("#newCustomerSection")?.value || "auto";
  return manualSection === "auto" ? sectionForNewCustomer(cycle, company) : manualSection;
}

function monthAbsoluteIndexFor(year, monthNumber) {
  return year * 12 + monthNumber - 1;
}

function sheetMonthAbsoluteIndex(month = activeMonth, year = activeYear) {
  const monthIndex = monthLabels.indexOf(month);
  if (monthIndex === -1) return null;
  return monthAbsoluteIndexFor(Number(year), monthIndex + 1);
}

function cycleMonthsFor(row) {
  const normalized = normalizeCycleValue(row?.cycle);
  if (normalized === "M") return 1;
  if (normalized === "3M") return 3;
  if (normalized === "6M") return 6;
  if (normalized === "Y" || /^\d+Y$/.test(normalized)) return 12;
  return 0;
}

function minguoMonthFor(targetIndex) {
  const westernYear = Math.floor(targetIndex / 12);
  const monthNumber = (targetIndex % 12) + 1;
  return {
    year: westernYear,
    monthNumber,
    monthLabel: `${monthNumber}月`,
    nextDate: `${westernYear - 1911}/${String(monthNumber).padStart(2, "0")}`,
    absoluteIndex: monthAbsoluteIndexFor(westernYear, monthNumber),
  };
}

function targetMonthFor(monthLabel, year) {
  const monthIndex = monthLabels.indexOf(monthLabel);
  if (monthIndex === -1) return null;
  return minguoMonthFor(monthAbsoluteIndexFor(Number(year), monthIndex + 1));
}

function normalizeRocDateParts(value) {
  const match = normalizeAscii(value).trim().match(/(\d{2,4})\s*[\\/.-]\s*(\d{1,2})(?:\s*[\\/.-]\s*(\d{1,2}))?/);
  if (!match) return null;
  const rocYear = Number(match[1]);
  const monthNumber = Number(match[2]);
  const day = Number(match[3] || 1);
  if (!rocYear || monthNumber < 1 || monthNumber > 12 || day < 1 || day > 31) return null;
  return { rocYear, monthNumber, day };
}

function addYearsToRocDateIndex(value, years) {
  const parts = normalizeRocDateParts(value);
  if (!parts || !Number.isInteger(years)) return null;
  return monthAbsoluteIndexFor(parts.rocYear + 1911 + years, parts.monthNumber);
}

function parseTwoStagePricePlan(value) {
  const match = String(value || "").trim().match(/前\s*(\d+)\s*年\s*([\d,]+)(?:\s*\/\s*m)?\s*[，,、/ ]+\s*後\s*(\d+)\s*年\s*([\d,]+)(?:\s*\/\s*m)?/);
  if (!match) return null;
  return {
    firstYears: Number(match[1]),
    firstPrice: normalizeMonthlyPrice(match[2].replaceAll(",", "")),
    secondYears: Number(match[3]),
    secondPrice: normalizeMonthlyPrice(match[4].replaceAll(",", "")),
  };
}

function lastMonthlyPriceFromText(value) {
  const matches = String(value || "").match(/\d[\d,]*\s*(?:\/\s*m)?/gi) || [];
  if (matches.length < 2) return "";
  return normalizeMonthlyPrice(matches[matches.length - 1].replace(/\s+/g, "").replaceAll(",", ""));
}

function priceForRowAt(row, target) {
  const plan = parseTwoStagePricePlan(row?.pricePlan || row?.階段金額);
  const fallbackPrice = lastMonthlyPriceFromText(row?.price) || row?.price || "";
  if (!plan || !target || !row?.start) return fallbackPrice;
  const secondStageStartIndex = addYearsToRocDateIndex(row.start, plan.firstYears);
  if (secondStageStartIndex === null) return fallbackPrice;
  return target.absoluteIndex >= secondStageStartIndex ? plan.secondPrice : plan.firstPrice;
}

function parseMinguoMonthIndex(value) {
  const match = normalizeAscii(value).match(/(\d{2,3})\s*[\\/.-]\s*(\d{1,2})/);
  if (!match) return null;
  const minguoYear = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!minguoYear || monthNumber < 1 || monthNumber > 12) return null;
  return monthAbsoluteIndexFor(minguoYear + 1911, monthNumber);
}

function reachesOrPassesContractEnd(row, target) {
  const endIndex = parseMinguoMonthIndex(row?.end);
  if (endIndex === null) return false;
  return target.absoluteIndex >= endIndex;
}

function nextDateForRowAt(row, month = activeMonth, year = activeYear) {
  const cycleMonths = cycleMonthsFor(row);
  const currentMonthIndex = sheetMonthAbsoluteIndex(month, year);
  if (!cycleMonths || currentMonthIndex === null || isClosingSection(row?.section)) return "";
  const endIndex = parseMinguoMonthIndex(row?.end);
  if (endIndex !== null && currentMonthIndex >= endIndex) return "";
  return minguoMonthFor(currentMonthIndex + cycleMonths).nextDate;
}

function autoNextRowKey(venue, monthLabel, year) {
  return `${venue}|${year}|${monthLabel}|auto-next|${Date.now()}|${Math.random().toString(36).slice(2)}`;
}

function generatedSourceLabel(year = activeYear, month = activeMonth) {
  return `${year}年${month}`;
}

function generatedNoteAction(row, sourceKind = "manual") {
  if (sourceKind === "existing") return "既有資料";
  const note = String(row?.note || "");
  if (note.includes("新循環")) return "新循環";
  if (note.includes("續約")) return "續約";
  return "新增";
}

function makeNextPaymentRow(
  row,
  monthLabel,
  sourceMonth = activeMonth,
  venue = activeVenue,
  targetYear = activeYear,
  sourceYear = activeYear,
  sourceKind = "manual",
) {
  const target = targetMonthFor(monthLabel, targetYear);
  return {
    ...row,
    _rowKey: autoNextRowKey(venue, monthLabel, targetYear),
    price: priceForRowAt(row, target),
    paidDate: "",
    paidAmount: "",
    nextDate: nextDateForRowAt(row, monthLabel, targetYear),
    invoice: "",
    manualStatus: "",
    note: `由${generatedSourceLabel(sourceYear, sourceMonth)}${generatedNoteAction(row, sourceKind)}自動帶入`,
  };
}

function addGeneratedRowToMonth(venue, monthLabel, row, year) {
  if (isSuppressedPaymentRow(row, venue, monthLabel, year)) {
    return false;
  }
  const targetRows = loadPaymentRows(venue, monthLabel, year);
  if (targetRows.some((targetRow) => sameCustomerPeriod(targetRow, row))) {
    return false;
  }
  targetRows.push(row);
  saveRowsFor(venue, monthLabel, targetRows, year);
  return true;
}

function generateFuturePaymentsForAddedCustomer(
  row,
  venue = activeVenue,
  sourceMonth = activeMonth,
  sourceYear = activeYear,
  options = {},
) {
  const cycleMonths = cycleMonthsFor(row);
  const currentMonthIndex = sheetMonthAbsoluteIndex(sourceMonth, sourceYear);
  if (!cycleMonths || currentMonthIndex === null || isClosingSection(row.section)) {
    return { created: 0, nextDate: "", stoppedForContract: false };
  }

  let targetIndex = currentMonthIndex + cycleMonths;
  let created = 0;
  let firstNextDate = "";
  let stoppedForContract = false;
  let guard = 0;
  const endIndex = parseMinguoMonthIndex(row?.end);
  const optionLimit = Number.isFinite(options.limitIndex) ? options.limitIndex : null;
  const generationLimitIndex = endIndex ?? optionLimit ?? targetIndex;

  while (targetIndex <= generationLimitIndex && guard < 600) {
    guard += 1;
    const target = minguoMonthFor(targetIndex);
    if (!firstNextDate) firstNextDate = target.nextDate;
    const isContractStop = reachesOrPassesContractEnd(row, target);

    ensurePaymentYearExists(venue, target.year);
    const nextRow = makeNextPaymentRow(row, target.monthLabel, sourceMonth, venue, target.year, sourceYear, options.sourceKind);
    if (isContractStop) {
      nextRow.nextDate = "";
      nextRow.note = prioritizeContractConfirmationNote(`${contractConfirmationNote}；${nextRow.note}`);
      stoppedForContract = true;
    }

    if (addGeneratedRowToMonth(venue, target.monthLabel, nextRow, target.year)) {
      created += 1;
    }

    if (stoppedForContract) break;
    targetIndex += cycleMonths;
  }

  if (firstNextDate && !row.nextDate) {
    row.nextDate = firstNextDate;
  }

  return { created, nextDate: firstNextDate, stoppedForContract };
}

function normalizeComparableDate(value) {
  return normalizeAscii(value)
    .trim()
    .replaceAll("-", "/")
    .replace(/[／.]/g, "/")
    .split("/")
    .map((part) => {
      const trimmed = part.trim();
      return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
    })
    .join("/");
}

function normalizeComparableValue(field, value) {
  if (field === "cycle") return normalizeCycleValue(value);
  if (field === "start" || field === "end") return normalizeComparableDate(value);
  return String(value || "").trim();
}

function sameCustomerPeriod(a, b) {
  return ["id", "company", "cycle", "start", "end"].every(
    (field) => normalizeComparableValue(field, a[field]) === normalizeComparableValue(field, b[field]),
  );
}

function clearNewCustomerForm() {
  [
    "#newCustomerId",
    "#newCustomerName",
    "#newCustomerCompany",
    "#newCustomerStart",
    "#newCustomerEnd",
    "#newCustomerPrice",
    "#newCustomerNote",
  ].forEach((selector) => {
    const input = document.querySelector(selector);
    if (input) input.value = "";
  });
  const cycle = document.querySelector("#newCustomerCycle");
  if (cycle) cycle.value = "Y";
  const section = document.querySelector("#newCustomerSection");
  if (section) section.value = "auto";
  resetCrmCheckState();
}

function addCustomerToCurrentMonth() {
  const id = normalizeCustomerId(getValue("#newCustomerId"));
  const idInput = document.querySelector("#newCustomerId");
  if (idInput) idInput.value = id;
  const name = getValue("#newCustomerName");
  const company = getValue("#newCustomerCompany");
  const cycle = getValue("#newCustomerCycle");
  const price = normalizeMonthlyPrice(getValue("#newCustomerPrice"));
  const priceInput = document.querySelector("#newCustomerPrice");
  if (priceInput) priceInput.value = price;

  if (!id && !company && !name) {
    showToast("請先填編號、公司名稱或姓名");
    return;
  }

  const venueError = venueIdErrorMessage(id);
  if (venueError) {
    setCrmCheckState("missing", "館別不符合", venueError);
    showToast(venueError);
    return;
  }

  if (crmCheckState.status !== "found" || crmCheckState.key !== currentCrmCheckKey()) {
    setCrmCheckState(
      "missing",
      "請先核對 CRM",
      "新增到月表前，必須先按「智慧帶入」並確認 CRM 有這筆資料。",
    );
    showToast("請先智慧帶入，確認有這筆客戶");
    return;
  }

  const section = selectedSectionForNewCustomer(cycle, company);
  if (!id || !company) {
    showToast("CRM 資料未帶齊編號或公司名稱，請先確認");
    return;
  }

  if (!section) {
    showToast("CRM 未帶出分類，請先確認項目");
    return;
  }

  const isExistingCustomer = customerExistsInAnyMonth(id, company);

  const newRow = {
    _rowKey: makeManualRowKey(),
    section,
    id,
    name,
    company,
    cycle,
    start: getValue("#newCustomerStart"),
    end: getValue("#newCustomerEnd"),
    price,
    pricePlan: String(crmCheckState.match?.階段金額 || "").trim(),
    paidDate: "",
    paidAmount: "",
    nextDate: "",
    invoice: "",
    manualStatus: "",
    note: getValue("#newCustomerNote") || (isExistingCustomer ? "新循環" : "新辦"),
  };

  if (paymentRows.some((row) => sameCustomerPeriod(row, newRow))) {
    showToast(`${id} 這個期間已在 ${activeMonth}`);
    return;
  }

  const generation = generateFuturePaymentsForAddedCustomer(newRow);
  const hasSameId = paymentRows.some((row) => row.id === id);
  paymentRows.push(newRow);
  paymentRows = normalizeSectionGroups(paymentRows);
  selectedRowIndex = paymentRows.findIndex((row) => row._rowKey === newRow._rowKey);
  savePaymentRows();
  clearNewCustomerForm();
  closeAddCustomerPanel();
  renderAll();
  let toast = hasSameId ? `${id} 已新增不同期間到 ${activeMonth}` : `${id} 已新增到 ${activeMonth}`;
  if (generation.created) {
    toast += `，已自動帶入 ${generation.created} 個後續月份`;
  } else if (generation.nextDate) {
    toast += `，已填下次繳費 ${generation.nextDate}`;
  }
  if (generation.stoppedForContract) {
    toast += "，到期前先確認續約";
  }
  showToast(toast);
  window.requestAnimationFrame(() => {
    document.querySelector(".payment-row.selected")?.scrollIntoView({ block: "center" });
  });
}

function customerExistsInAnyMonth(id, company, venue = activeVenue) {
  const normalizedId = normalizeCustomerId(id);
  const normalizedCompany = String(company || "").trim();
  return getYears(venue).some((year) =>
    monthLabels.some((month) =>
      loadPaymentRows(venue, month, year).some((row) => {
        if (isAutoGeneratedPaymentRow(row)) return false;
        const sameId = normalizedId && normalizeCustomerId(row.id) === normalizedId;
        const sameCompany = normalizedCompany && String(row.company || "").trim() === normalizedCompany;
        return sameId || sameCompany;
      }),
    ),
  );
}

function isBackfillSourceRow(row) {
  if (!row || isAutoGeneratedPaymentRow(row) || isClosingSection(row.section)) return false;
  if (row.manualStatus === "nonbillable") return false;
  if (!cycleMonthsFor(row)) return false;
  const note = String(row.note || "");
  if (/不收款|不需收款|已歇業|已退款/.test(note)) return false;
  return true;
}

function backfillFuturePaymentsFromMonth(venue, month, year, limitIndex = null) {
  const sourceRows = loadBackfillSourceRows(venue, month, year);
  let created = 0;
  let touched = false;

  sourceRows.forEach((row) => {
    if (!isBackfillSourceRow(row)) return;
    const beforeNextDate = row.nextDate;
    const generation = generateFuturePaymentsForAddedCustomer(row, venue, month, year, { sourceKind: "existing", limitIndex });
    created += generation.created;
    if (row.nextDate !== beforeNextDate) touched = true;
  });

  if (touched) {
    saveRowsFor(venue, month, sourceRows, year);
  }

  return { created, touched };
}

function backfillFuturePaymentsForVenue(venue = activeVenue, year = activeYear, targetYear = year) {
  const limitIndex = monthAbsoluteIndexFor(Number(targetYear), 12);
  return monthLabels.reduce(
    (summary, month) => {
      const result = backfillFuturePaymentsFromMonth(venue, month, year, limitIndex);
      summary.created += result.created;
      if (result.touched) summary.touchedMonths += 1;
      return summary;
    },
    { created: 0, touchedMonths: 0 },
  );
}

function backfillGeneratedRowsThroughYear(targetYear = activeYear) {
  const normalizedTarget = Number(normalizeYear(targetYear));
  if (normalizedTarget <= initialPaymentYear) return { created: 0, labels: [] };
  const sourceYears = getGlobalYears()
    .map(Number)
    .filter((year) => year >= initialPaymentYear && year < normalizedTarget)
    .sort((a, b) => a - b);
  if (!sourceYears.length) return { created: 0, labels: [] };

  return venueKeys
    .map((venue) => {
      const created = sourceYears.reduce(
        (count, sourceYear) => count + backfillFuturePaymentsForVenue(venue, sourceYear, normalizedTarget).created,
        0,
      );
      return { venue, created };
    })
    .reduce(
      (summary, result) => ({
        created: summary.created + result.created,
        labels: result.created ? [...summary.labels, `${venueLabels[result.venue]} ${result.created} 筆`] : summary.labels,
      }),
      { created: 0, labels: [] },
    );
}

function mergeBackfillSummaries(...summaries) {
  return summaries.reduce(
    (merged, summary) => ({
      created: merged.created + (summary?.created || 0),
      labels: [...merged.labels, ...(summary?.labels || [])],
    }),
    { created: 0, labels: [] },
  );
}

function readPaymentBackfillState() {
  try {
    const state = JSON.parse(localStorage.getItem(paymentBackfillStateKey) || "{}");
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
}

function markPaymentBackfillDone(year = activeYear) {
  const state = readPaymentBackfillState();
  state[`${paymentBackfillVersion}:${normalizeYear(year)}`] = true;
  localStorage.setItem(paymentBackfillStateKey, JSON.stringify(state));
}

function paymentBackfillDone(year = activeYear) {
  return Boolean(readPaymentBackfillState()[`${paymentBackfillVersion}:${normalizeYear(year)}`]);
}

function scheduleInitialBackfill(year = activeYear) {
  if (paymentBackfillDone(year)) return;
  const run = () => {
    const summary = mergeBackfillSummaries(
      backfillGeneratedRowsThroughYear(year),
      backfillCurrentPaymentYear(year),
    );
    markPaymentBackfillDone(year);
    if (Number(year) === Number(activeYear)) {
      paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
      renderAll();
    }
    if (summary.created) {
      showToast(`已整理後續月份 ${summary.created} 筆`);
    }
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 900);
  }
}

function backfillCurrentPaymentYear(year = activeYear) {
  const normalizedYear = Number(normalizeYear(year));
  return venueKeys
    .map((venue) => ({ venue, ...backfillFuturePaymentsForVenue(venue, normalizedYear, normalizedYear) }))
    .reduce(
      (summary, result) => ({
        created: summary.created + result.created,
        labels: result.created ? [...summary.labels, `${venueLabels[result.venue]} ${result.created} 筆`] : summary.labels,
      }),
      { created: 0, labels: [] },
    );
}

function isManualOrGeneratedRow(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  if (!row) return false;
  const key = String(row._rowKey || "");
  if (key.includes("|manual|") || key.includes("|auto-next|")) return true;
  return !baseRowsFor(venue, month, year).some((baseRow) => sameCustomerPeriod(baseRow, row));
}

function removeGeneratedFutureRowsFor(row) {
  const sourceIndex = sheetMonthAbsoluteIndex(activeMonth, activeYear);
  if (sourceIndex === null) return 0;

  let removed = 0;
  getYears(activeVenue).forEach((year) => {
    monthLabels.forEach((month) => {
      const monthIndex = sheetMonthAbsoluteIndex(month, year);
      if (monthIndex === null || monthIndex <= sourceIndex) return;

      const rows = loadPaymentRows(activeVenue, month, year);
      const kept = rows.filter((futureRow) => {
        const isGeneratedFromThisRow = sameCustomerPeriod(futureRow, row) && isAutoGeneratedPaymentRow(futureRow);
        if (isGeneratedFromThisRow) removed += 1;
        return !isGeneratedFromThisRow;
      });

      if (kept.length !== rows.length) {
        saveRowsFor(activeVenue, month, kept, year);
      }
    });
  });

  return removed;
}

function suppressFutureBaseRowsFor(row, includeCurrent = false) {
  const sourceIndex = sheetMonthAbsoluteIndex(activeMonth, activeYear);
  if (sourceIndex === null) return 0;

  const suppressed = readSuppressedPaymentRows();
  let added = 0;
  getYears(activeVenue).forEach((year) => {
    monthLabels.forEach((month) => {
      const monthIndex = sheetMonthAbsoluteIndex(month, year);
      if (monthIndex === null || (includeCurrent ? monthIndex < sourceIndex : monthIndex <= sourceIndex)) return;
      baseRowsFor(activeVenue, month, year).forEach((baseRow) => {
        if (!sameCustomerPeriod(baseRow, row)) return;
        const key = suppressedRowKeyFor(baseRow, activeVenue, month, year);
        if (suppressed.has(key)) return;
        suppressed.add(key);
        added += 1;
      });
    });
  });
  if (added) saveSuppressedPaymentRows(suppressed);
  return added;
}

function generatedSuppressionRange(row, venue = activeVenue, month = activeMonth, year = activeYear, includeCurrent = false) {
  const sourceIndex = sheetMonthAbsoluteIndex(month, year);
  if (sourceIndex === null || !cycleMonthsFor(row)) return [];

  const endIndex = parseMinguoMonthIndex(row?.end);
  const latestYear = Math.max(...getGlobalYears().map(Number), Number(year));
  const limitIndex = endIndex ?? monthAbsoluteIndexFor(latestYear, 12);
  const startIndex = includeCurrent ? sourceIndex : sourceIndex + 1;
  const targets = [];
  for (let index = startIndex; index <= limitIndex; index += 1) {
    targets.push(minguoMonthFor(index));
  }
  return targets;
}

function suppressFutureGeneratedRowsFor(row, includeCurrent = false, venue = activeVenue, month = activeMonth, year = activeYear) {
  const suppressed = readSuppressedPaymentRows();
  let added = 0;
  generatedSuppressionRange(row, venue, month, year, includeCurrent).forEach((target) => {
    const key = suppressedRowKeyFor(row, venue, target.monthLabel, target.year);
    if (suppressed.has(key)) return;
    suppressed.add(key);
    added += 1;
  });
  if (added) saveSuppressedPaymentRows(suppressed);
  return added;
}

function removeFutureGeneratedSuppressionsFor(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  const suppressed = readSuppressedPaymentRows();
  let removed = 0;
  generatedSuppressionRange(row, venue, month, year, false).forEach((target) => {
    const key = suppressedRowKeyFor(row, venue, target.monthLabel, target.year);
    if (!suppressed.delete(key)) return;
    removed += 1;
  });
  if (removed) saveSuppressedPaymentRows(suppressed);
  return removed;
}

function deleteSelectedPaymentRow() {
  if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) return;
  const row = paymentRows[selectedRowIndex];

  const confirmed = window.confirm(`確定刪除 ${row.id} ${row.company || row.name} 這一列？`);
  if (!confirmed) return;

  if (isClosingSection(row.section) && originalSectionForRow(row)) {
    const restored = restoreClosingRowToSource(row);
    if (restored.external) {
      paymentRows.splice(selectedRowIndex, 1);
      selectedRowIndex = null;
      rowBasicsOpen = false;
      savePaymentRows();
      renderMetrics();
      renderRows();
      renderEditor();
      showToast(`${row.id} 已取消遷出，原資料保留在 ${restored.sourceYear} ${restored.sourceMonth}`);
      return;
    }
  }

  const removedFutureRows = removeGeneratedFutureRowsFor(row);
  const suppressedFutureRows = suppressFutureBaseRowsFor(row, true);
  const suppressedGeneratedRows = suppressFutureGeneratedRowsFor(row, true);
  paymentRows.splice(selectedRowIndex, 1);
  selectedRowIndex = null;
  rowBasicsOpen = false;
  savePaymentRows();
  renderMetrics();
  renderRows();
  renderEditor();
  const futureCount = removedFutureRows + suppressedFutureRows + suppressedGeneratedRows;
  showToast(futureCount ? `已刪除這列，並清掉 ${futureCount} 筆後續月份` : "已刪除這列");
}

function resetSelectionState() {
  activeFilter = "all";
  clearPaymentSearch();
  selectedRowIndex = null;
  rowBasicsOpen = false;
}

function setYearActionState(text, options = {}) {
  if (!yearActionState) return;
  yearActionState.textContent = text;
  yearActionState.dataset.mode = options.mode || "";
  if (yearActionTimer) window.clearTimeout(yearActionTimer);
  if (text && !options.persist) {
    yearActionTimer = window.setTimeout(() => {
      yearActionState.textContent = "";
      yearActionState.dataset.mode = "";
    }, 2600);
  }
}

function setYearControlsLocked(locked) {
  yearActionLocked = locked;
  [prevYearButton, nextYearButton, createYearButton].forEach((button) => {
    if (!button) return;
    button.disabled = locked;
    button.dataset.busy = locked ? "true" : "";
  });
  if (!locked) renderYearSelect();
}

function lockYearAction(duration = 280) {
  setYearControlsLocked(true);
  window.setTimeout(() => {
    setYearControlsLocked(false);
  }, duration);
}

function finishYearAction(message) {
  setYearControlsLocked(false);
  setYearActionState(message);
  showToast(message);
}

function finishYearActionAfterMinimum(startedAt, callback, message) {
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, minimumYearGeneratingMs - elapsed);
  window.setTimeout(() => {
    callback();
    finishYearAction(message);
  }, remaining);
}

function renderYearSelect() {
  if (!yearSelect) return;
  const years = getGlobalYears();
  yearSelect.innerHTML = years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");
  yearSelect.value = String(activeYear);
  yearPicker?.classList.toggle("is-current-year", String(activeYear) === currentGregorianYear);

  const { previous, next } = getAdjacentYears(activeVenue, activeYear);
  if (prevYearButton) {
    prevYearButton.textContent = "← 上一年";
    prevYearButton.title = previous ? `切到 ${previous}` : "沒有上一個年度";
    prevYearButton.setAttribute("aria-label", prevYearButton.title);
    prevYearButton.disabled = yearActionLocked || !previous;
  }
  if (nextYearButton) {
    nextYearButton.textContent = "切到下一年 →";
    nextYearButton.title = next ? `切到 ${next}` : "沒有下一個年度，請用建立年度";
    nextYearButton.setAttribute("aria-label", nextYearButton.title);
    nextYearButton.disabled = yearActionLocked;
  }
  if (createYearButton) {
    createYearButton.textContent = `建立 ${getNextCreatableYear()}`;
    createYearButton.disabled = yearActionLocked;
  }
}

function switchYear(year, announce = false) {
  const normalized = normalizeYear(year);
  if (!getGlobalYears().includes(normalized)) return;
  setActiveYearForAllVenues(normalized);
  mergeBackfillSummaries(
    backfillGeneratedRowsThroughYear(activeYear),
    backfillCurrentPaymentYear(activeYear),
  );
  paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
  closeAddCustomerPanel();
  resetCrmCheckState();
  resetSelectionState();
  renderAll();
  if (announce) {
    lockYearAction();
    setYearActionState(`已轉到 ${activeYear}`);
    showToast(`已轉到 ${activeYear}`);
  }
}

function createNextYear() {
  if (yearActionLocked) return;
  const nextYear = getNextCreatableYear();
  const sourceYear = activeYear;
  const confirmed = window.confirm(
    `確定建立兩館 ${nextYear} 繳費年度？\n台中館與環瑞館會一起切到 ${nextYear}。自動生成的後續月份會保留；新客戶仍請用「新增客戶到本月」與「智慧帶入」。`,
  );
  if (!confirmed) return;
  const startedAt = Date.now();
  setYearControlsLocked(true);
  if (createYearButton) createYearButton.textContent = `${nextYear} 準備中...`;
  setYearActionState(`${nextYear} 準備中\n請稍候`, { persist: true, mode: "busy" });
  showToast(`${nextYear} 準備中，請稍候`);
  if (yearBackfillTimer) window.clearTimeout(yearBackfillTimer);
  yearBackfillTimer = window.setTimeout(() => {
    ensurePaymentYearExistsForAll(nextYear);
    venueKeys
      .map((venue) => ({ venue, ...backfillFuturePaymentsForVenue(venue, sourceYear, Number(nextYear)) }))
      .reduce(
        (summary, result) => ({
          created: summary.created + result.created,
          labels: result.created ? [...summary.labels, `${venueLabels[result.venue]} ${result.created} 筆`] : summary.labels,
        }),
        { created: 0, labels: [] },
      );
    finishYearActionAfterMinimum(startedAt, () => {
      switchYear(nextYear, false);
    }, `已轉入 ${nextYear}`);
  }, yearGeneratingPaintDelayMs);
}

function goToPreviousYear() {
  const { previous } = getAdjacentYears(activeVenue, activeYear);
  if (previous) switchYear(previous, true);
}

function goToNextYear() {
  const { next } = getAdjacentYears(activeVenue, activeYear);
  if (next) {
    switchYear(next, true);
    return;
  }
  const creatableYear = getNextCreatableYear();
  setYearActionState(`尚未建立下一年度\n請按「建立 ${creatableYear}」`);
  showToast(`尚未建立下一年度，請按「建立 ${creatableYear}」`);
}

function renderMonthTabs() {
  document.querySelectorAll("[data-month][data-venue]").forEach((button) => {
    const venue = button.dataset.venue;
    const month = button.dataset.month;
    const year = activeYearForVenue(venue);
    const isVenueMonth = venueActiveMonths[venue] === month;
    const isCurrentTable = venue === activeVenue && month === activeMonth;
    const hasData = loadPaymentRows(venue, month, year).length > 0;
    button.classList.toggle("active", isVenueMonth);
    button.classList.toggle("current-table", isCurrentTable);
    button.classList.toggle("has-data", hasData);
  });
  document.querySelectorAll("[data-venue-toolbar]").forEach((toolbar) => {
    const venue = toolbar.dataset.venueToolbar;
    const year = activeYearForVenue(venue);
    const isSelected = venue === activeVenue;
    const heading = toolbar.querySelector("h2");
    if (heading) heading.textContent = `${year} 年客戶繳費`;
    toolbar.classList.toggle("selected-venue", isSelected);
    toolbar.classList.toggle("collapsed-venue", !isSelected);
    toolbar.dataset.activeMonth = venueActiveMonths[venue] || "6月";
    toolbar.setAttribute("aria-expanded", String(isSelected));
    toolbar.tabIndex = isSelected ? -1 : 0;
    toolbar.title = isSelected ? "" : `切換到${venueLabels[venue] || ""}`;
  });
  document.querySelectorAll("[data-venue-summary]").forEach((summary) => {
    const isSelected = summary.dataset.venueSummary === activeVenue;
    summary.classList.toggle("selected-venue", isSelected);
    summary.classList.toggle("collapsed-venue", !isSelected);
  });
}

function renderSheetHeading() {
  const venueName = venueLabels[activeVenue] || "";
  const shell = document.querySelector(".sheet-shell");
  const heading = document.querySelector("#sheetHeading");
  const eyebrow = document.querySelector(".sheet-heading .eyebrow");
  const table = document.querySelector(".payment-table");
  const addContext = document.querySelector("#addCustomerContext");
  if (shell) shell.dataset.activeVenue = activeVenue;
  if (eyebrow) eyebrow.textContent = `${activeYear} ${venueName} / ${monthEnglish[activeMonth] || activeMonth}`;
  if (heading) {
    heading.innerHTML = `
      <span class="heading-month">${escapeHtml(activeMonth)}</span><span class="heading-venue">${escapeHtml(venueName)}</span><span class="heading-suffix">繳費表</span>
    `;
  }
  if (table) table.setAttribute("aria-label", `${activeYear}${activeMonth}${venueName}繳費表`);
  if (addContext) addContext.textContent = `${venueName} ${activeMonth}`;
}

function renderAll() {
  renderYearSelect();
  renderSheetHeading();
  renderMonthTabs();
  renderMetrics();
  renderRows();
  renderEditor();
}

function switchSheet(venue, month) {
  activeVenue = venue;
  activeYear = activeYearForVenue(venue);
  activeMonth = month;
  venueActiveMonths[venue] = month;
  paymentRows = loadPaymentRows(venue, month, activeYear);
  closeAddCustomerPanel();
  resetCrmCheckState();
  resetSelectionState();
  renderAll();
  showToast(`${venueLabels[venue]} ${month}`);
}

function bindEvents() {
  yearSelect?.addEventListener("change", () => switchYear(yearSelect.value, true));
  prevYearButton?.addEventListener("click", goToPreviousYear);
  nextYearButton?.addEventListener("click", goToNextYear);
  createYearButton?.addEventListener("click", createNextYear);

  document.querySelectorAll("[data-month][data-venue]").forEach((button) => {
    button.addEventListener("click", () => {
      switchSheet(button.dataset.venue, button.dataset.month);
    });
  });

  document.querySelectorAll("[data-venue-toolbar]").forEach((toolbar) => {
    const switchVenue = () => {
      const venue = toolbar.dataset.venueToolbar;
      if (!venue || venue === activeVenue) return;
      switchSheet(venue, venueActiveMonths[venue] || "6月");
    };
    toolbar.addEventListener("click", (event) => {
      if (event.target.closest(".month-tab")) return;
      switchVenue();
    });
    toolbar.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      switchVenue();
    });
  });

  document.querySelectorAll("[data-payment-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const venue = button.dataset.venue || activeVenue;
      activeVenue = venue;
      activeYear = activeYearForVenue(venue);
      activeMonth = venueActiveMonths[venue] || activeMonth;
      paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
      activeFilter = button.dataset.paymentFilter;
      clearPaymentSearch();
      selectedRowIndex = null;
      renderAll();
    });
  });

  document.querySelector("#paymentSearch")?.addEventListener("input", (event) => {
    searchTerm = event.target.value.trim();
    renderRows();
  });

  const todayReset = document.querySelector("#todayReset");
  if (todayReset) {
    todayReset.addEventListener("click", () => {
      activeFilter = "all";
      clearPaymentSearch();
      selectedRowIndex = null;
      renderAll();
      showToast(`已回到 ${activeMonth} 全部資料`);
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".payment-table")) {
      paymentPointerStart = null;
      lastPaymentPointerWasDrag = false;
      return;
    }
    paymentPointerStart = { x: event.clientX, y: event.clientY };
    lastPaymentPointerWasDrag = false;
  });

  document.addEventListener("pointerup", (event) => {
    if (!paymentPointerStart || !event.target.closest(".payment-table")) return;
    const movedX = Math.abs(event.clientX - paymentPointerStart.x);
    const movedY = Math.abs(event.clientY - paymentPointerStart.y);
    lastPaymentPointerWasDrag = movedX > 5 || movedY > 5;
    paymentPointerStart = null;
  });

  document.addEventListener("click", (event) => {
    const suggestion = event.target.closest("[data-closing-match-index]");
    if (suggestion) {
      moveOrSelectClosingMatch(closingLookupMatches[Number(suggestion.dataset.closingMatchIndex)]);
      return;
    }

    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText && event.target.closest(".payment-table") && lastPaymentPointerWasDrag) return;

    const row = event.target.closest(".payment-row[data-row-index]");
    if (!row) {
      if (!isWorkspaceToolClick(event.target)) {
        closeSelectedRowEditor();
        closeAddCustomerPanel();
      }
      return;
    }
    rowBasicsOpen = false;
    selectedRowIndex = Number(row.dataset.rowIndex);
    renderRows();
    renderEditor();
  });

  [
    ["#editPaidDate", "paidDate"],
    ["#editPaidAmount", "paidAmount"],
    ["#editNextDate", "nextDate"],
    ["#editNote", "note"],
  ].forEach(([selector, field]) => {
    document.querySelector(selector).addEventListener("input", (event) => {
      updateSelectedRow(field, event.target.value.trim());
    });
  });

  document.querySelector("#editInvoice").addEventListener("change", (event) => {
    updateSelectedRow("invoice", event.target.checked ? "✔️" : "");
  });

  document.querySelector("#editManualStatus").addEventListener("change", (event) => {
    updateSelectedRow("manualStatus", event.target.value);
  });

  document.querySelector("#restoreFromClosing").addEventListener("click", restoreSelectedFromClosing);
  document.querySelector("#deleteSelectedRow").addEventListener("click", deleteSelectedPaymentRow);
  document.querySelector("#smartFillRenewal")?.addEventListener("click", smartFillRenewalFromCrm);

  document.querySelector("#toggleRowBasics").addEventListener("click", () => {
    rowBasicsOpen = !rowBasicsOpen;
    renderRowBasics();
  });

  document.querySelector("#openRenewalBasics")?.addEventListener("click", () => {
    if (selectedRowIndex === null || !paymentRows[selectedRowIndex]) return;
    const confirmed = window.confirm("手動修改只會修改繳費表，不會更新 CRM。正式續約建議先在新 CRM 建好資料，再智慧帶入。確定要手動修改嗎？");
    if (!confirmed) return;
    rowBasicsOpen = true;
    renderRowBasics();
    document.querySelector("#rowBasics")?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  [
    ["#editName", "name"],
    ["#editCompany", "company"],
    ["#editStart", "start"],
    ["#editEnd", "end"],
    ["#editPrice", "price"],
  ].forEach(([selector, field]) => {
    document.querySelector(selector).addEventListener("input", (event) => {
      updateSelectedRowBasic(field, event.target.value.trim());
    });
  });

  document.querySelector("#editCycle").addEventListener("change", (event) => {
    updateSelectedRowBasic("cycle", event.target.value);
  });

  document.querySelector("#editPrice").addEventListener("blur", (event) => {
    const price = normalizeMonthlyPrice(event.target.value);
    event.target.value = price;
    updateSelectedRowBasic("price", price);
  });

  document.querySelector("#newCustomerPrice").addEventListener("blur", (event) => {
    event.target.value = normalizeMonthlyPrice(event.target.value);
  });

  document.querySelector("#editSection").addEventListener("change", (event) => {
    updateSelectedRowBasic("section", event.target.value);
  });

  document.querySelector("#checkCrmButton")?.addEventListener("click", () => {
    checkNewCustomerAgainstCrm();
  });

  document.querySelector("#toggleAddCustomer").addEventListener("click", () => {
    const panel = document.querySelector("#addCustomerPanel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    document.querySelector("#toggleAddCustomer").classList.toggle("active", !panel.hidden);
    if (!panel.hidden) {
      document.querySelector("#newCustomerId")?.focus();
    }
  });

  document.querySelector("#closeAddCustomerPanel")?.addEventListener("click", () => {
    closeAddCustomerPanel();
  });

  document.querySelector("#addCustomerPanel")?.addEventListener(
    "wheel",
    (event) => {
      const table = document.querySelector(".payment-table");
      if (!table) return;
      table.scrollTop += event.deltaY;
      table.scrollLeft += event.deltaX;
      event.preventDefault();
    },
    { passive: false },
  );

  document.querySelector("#newCustomerId")?.addEventListener("input", () => {
    resetCrmCheckState();
    scheduleCrmAutoLookup();
  });

  document.querySelector("#newCustomerId")?.addEventListener("change", () => {
    if (crmCheckState.status === "found" && crmCheckState.key === currentCrmCheckKey()) return;
    resetCrmCheckState();
    scheduleCrmAutoLookup(0);
  });

  [
    "#newCustomerName",
    "#newCustomerCompany",
  ].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("input", resetCrmCheckState);
    document.querySelector(selector)?.addEventListener("change", resetCrmCheckState);
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "closingLookupInput") return;
    renderClosingSuggestions(event.target.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.id !== "closingLookupInput" || event.key !== "Enter") return;
    event.preventDefault();
    selectClosingMatch(event.target.value);
  });

  document.addEventListener("click", (event) => {
    if (event.target.id !== "closingLookupButton") return;
    selectClosingMatch(document.querySelector("#closingLookupInput")?.value || "");
  });

  document.addEventListener("click", (event) => {
    if (event.target.id !== "addCustomerButton") return;
    addCustomerToCurrentMonth();
  });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

if (document.querySelector("#paymentRows")) {
  setupCalendarLink();
  paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
  renderAll();
  bindEvents();
  initIcons();
  scheduleInitialBackfill(activeYear);
}
