const crmStorageKey = "hj-crm-clean-v5-data-repair";
const paymentBridgeStorageKey = "hj-crm-payment-bridge-v1";
const legacyYearStorageKey = "hj-crm-clean-v2-year-data";
const initialYear = "2026";

const profileSections = [
  {
    side: "left",
    tone: "contract",
    title: "合約乙方資料",
    hint: "對應合約第 2 頁",
    fields: [
      ["company", "承租人公司名稱"],
      ["name", "負責人"],
      ["address", "地址"],
      ["idNumber", "身分證統一編號"],
      ["coNumber", "公司統一編號"],
      ["phone", "聯絡電話"],
      ["birthday", "出生"],
    ],
  },
  {
    side: "left",
    tone: "note",
    title: "內部備註",
    hint: "不混進合約乙方資料",
    fields: [
      ["industry", "行業備註"],
      ["notes", "備註"],
    ],
  },
  {
    side: "right",
    tone: "management",
    title: "合約管理",
    hint: "內部管理資料",
    fields: [
      ["id", "編號"],
      ["category", "類別"],
      ["item", "項目"],
      [
        "contractDates",
        "合約日期",
        [
          ["contractYears", "年數"],
          ["start", "合約起始日期"],
          ["end", "合約到期日"],
        ],
        "contract",
      ],
      ["signedAt", "簽約日期"],
    ],
  },
  {
    side: "right",
    tone: "payment",
    title: "收款資料",
    hint: "付款與押金",
    fields: [
      ["cycle", "繳費方式"],
      ["amount", "金額"],
      ["pricePlan", "階段金額"],
      ["deposit", "押金"],
      ["payDay", "約定繳費日期"],
    ],
  },
];

const cycleOptions = ["M", "3M", "6M", "Y", "2Y", "3Y"];
const categoryOptions = ["行號", "有限公司", "股份有限公司", "Ａ辦", "Ｂ辦", "Ｃ辦", "Ｄ辦", "Ｅ辦", "Ｆ辦"];
const itemOptions = ["營登", "辦公室", "自由座", "代收信件", "事務所"];
const crmDateFields = new Set(["birthday", "start", "end", "signedAt"]);

const appTitle = document.querySelector("#appTitle");
const venueKicker = document.querySelector("#venueKicker");
const recordList = document.querySelector("#recordList");
const overviewRows = document.querySelector("#overviewRows");
const overviewTitle = document.querySelector("#overviewTitle");
const overviewStatus = document.querySelector("#overviewStatus");
const overviewIssues = document.querySelector("#overviewIssues");
const searchInput = document.querySelector("#searchInput");
const detailCompany = document.querySelector("#detailCompany");
const metrics = document.querySelector("#metrics");
const profileForm = document.querySelector("#profileForm");
const contractFrame = document.querySelector("#contractFrame");
const panelHeading = document.querySelector("#panelHeading");
const recordCount = document.querySelector("#recordCount");
const saveButton = document.querySelector("#saveButton");
const saveState = document.querySelector("#saveState");
const newButton = document.querySelector("#newButton");
const addContractButton = document.querySelector("#addContractButton");
const addBlankContractButton = document.querySelector("#addBlankContractButton");
const contractPageLink = document.querySelector("#contractPageLink");
const editButton = document.querySelector("#editButton");
const cancelButton = document.querySelector("#cancelButton");
const yearPicker = document.querySelector("#yearPicker");
const yearSelect = document.querySelector("#yearSelect");
const prevYearButton = document.querySelector("#prevYearButton");
const nextYearButton = document.querySelector("#nextYearButton");
const createYearButton = document.querySelector("#createYearButton");
const yearActionState = document.querySelector("#yearActionState");
const moveFolderButton = document.querySelector("#moveFolderButton");
const deleteButton = document.querySelector("#deleteButton");
const folderButtons = document.querySelectorAll("[data-folder]");
const serviceButtons = document.querySelectorAll("[data-service]");
const venueButtons = document.querySelectorAll("[data-venue]");
const pageButtons = document.querySelectorAll("[data-page]");
const venueDialog = document.querySelector("#venueDialog");
const venueDialogText = document.querySelector("#venueDialogText");
const venueConfirmButton = document.querySelector("#venueConfirmButton");
const venueCancelButton = document.querySelector("#venueCancelButton");

let crmData = loadCrmData();
let activeVenue = crmData.activeVenue;
let activeYear = getVenueData().activeYear;
let crmRows = getVenueRows(activeVenue, activeYear);
let selectedKey = getRowKey(crmRows.find((row) => (row.folder || "active") === "active") || crmRows[0]);
let activeFolder = "active";
let draftRow = null;
let editMode = "view";
let activePage = "profile";
let activeService = "all";
let contractDraftOpen = false;
let contractDraftMode = "";
let yearActionLocked = false;
let yearActionTimer = null;
let yearCreateTimer = null;
let pendingVenue = "";
const currentGregorianYear = String(new Date().getFullYear());
applyInitialUrlState();
persistPaymentBridge();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCycleValue(value) {
  const normalized = String(value || "").trim().toUpperCase().replaceAll("Ｍ", "M").replaceAll("Ｙ", "Y");
  return cycleOptions.includes(normalized) ? normalized : value;
}

function normalizeContractTermValue(value) {
  const raw = String(value || "").trim();
  const text = raw.toLowerCase();
  if (!text) return "";
  if (/^(三|3|3y|3\s*年)/.test(text)) return "三年約";
  if (/^(兩|二|2|2y|2\s*年)/.test(text)) return "兩年約";
  if (/^(一|1|1y|1\s*年)/.test(text)) return "一年約";
  return raw;
}

function allowedServiceFilters(venue = activeVenue) {
  return venue === "huanrui" ? ["registration", "office", "all"] : ["registration", "office", "seat", "all"];
}

function normalizeServiceFilter(service, venue = activeVenue) {
  const cleanService = String(service || "").trim();
  return allowedServiceFilters(venue).includes(cleanService) ? cleanService : "all";
}

function serviceType(row) {
  const item = String(row?.item || "").trim();
  const category = String(row?.category || "").trim();
  const fallbackText = [category, row?.notes].filter(Boolean).join(" ");
  const serviceText = item || fallbackText;

  if (/自由座|共享座位|共享辦公室|固定座|固定坐/.test(serviceText)) return "seat";
  if (/辦公室|[Ａ-ＺA-Z]辦/.test(serviceText) && !/營登|營業登記/.test(serviceText)) return "office";
  if (/營登|營業登記|代辦|代收信件|收信/.test(serviceText)) return "registration";
  return "registration";
}

function serviceFilterAllowed(service, venue = activeVenue) {
  return allowedServiceFilters(venue).includes(service);
}

function inferPricePlanFromText(value) {
  const text = String(value || "").trim();
  const match = text.match(/前\s*\d+\s*年\s*[\d,]+(?:\s*\/\s*m)?\s*[，,、/ ]+\s*後\s*\d+\s*年\s*[\d,]+(?:\s*\/\s*m)?/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function makeFallbackData() {
  return {
    activeVenue: "taichung",
    sources: {
      taichung: {
        label: "台中館",
        sourceLabel: "人工 CRM / 總表 + 已結束",
        sourceLink: "https://docs.google.com/spreadsheets/d/1-aNFPeM7nyTMTRJUQez0Vu2meuN4SH_SkODzVFnC-ro/edit?gid=1624136738#gid=1624136738",
        idMode: "number",
      },
      huanrui: {
        label: "環瑞館",
        sourceLabel: "環瑞館 CRM / 總表 + 已結束",
        sourceLink: "https://docs.google.com/spreadsheets/d/1VfDeRx-eFMcjfNCRSqi-3zvyolwmS6yLiMzy_fYMlHU/edit?gid=0#gid=0",
        idMode: "v",
      },
    },
    venues: {
      taichung: { activeYear: initialYear, years: { [initialYear]: [] } },
      huanrui: { activeYear: initialYear, years: { [initialYear]: [] } },
    },
  };
}

function getSourceData() {
  const source = window.HJ_CRM_SOURCE_DATA;
  if (source && typeof source === "object" && source.venues && source.sources) return source;
  return makeFallbackData();
}

function normalizeRow(row, venue, fallbackFolder = "active", index = 0) {
  const rawIndustry = String(row?.industry || "").trim();
  const pricePlan = String(
    row?.pricePlan ||
      row?.stagedAmount ||
      row?.stageAmount ||
      row?.階段金額 ||
      inferPricePlanFromText(rawIndustry) ||
      inferPricePlanFromText(row?.notes)
  ).trim();
  const normalized = {
    id: String(row?.id || "").trim(),
    name: String(row?.name || "").trim(),
    company: String(row?.company || row?.companyName || "").trim(),
    category: String(row?.category || "").trim(),
    item: String(row?.item || "").trim(),
    cycle: normalizeCycleValue(row?.cycle || ""),
    start: String(row?.start || "").trim(),
    end: String(row?.end || "").trim(),
    contractYears: "",
    contractTerm: "",
    payDay: String(row?.payDay || "").trim(),
    amount: String(row?.amount || "").trim(),
    pricePlan,
    deposit: String(row?.deposit || "").trim(),
    phone: String(row?.phone || "").trim(),
    signedAt: String(row?.signedAt || "").trim(),
    birthday: String(row?.birthday || "").trim(),
    address: String(row?.address || "").trim(),
    industry: rawIndustry === pricePlan ? "" : rawIndustry,
    notes: String(row?.notes || "").trim(),
    mark: String(row?.mark || "").trim(),
    coNumber: String(row?.coNumber || "").trim(),
    idNumber: String(row?.idNumber || "").trim(),
    locker: String(row?.locker || "").trim(),
    mail: String(row?.mail || "").trim(),
    sourceFormat: row?.sourceFormat || "",
    folder: row?.folder || fallbackFolder,
    venue,
  };
  normalized.contractYears = normalizeContractYears(row?.contractYears) || String(getContractYearDiff(normalized.start, normalized.end) || getYearsFromContractTerm(row?.contractTerm) || "");
  normalized.contractTerm = inferContractTermFromDates(normalized.start, normalized.end) || normalizeContractTermValue(row?.contractTerm);
  normalized.uid = row?.uid || `${venue}-${normalized.folder}-${String(index + 1).padStart(3, "0")}-${normalized.id || "no-id"}`;
  return normalized;
}

function cloneRows(rows, venue, fallbackFolder = "active") {
  return Array.isArray(rows) ? rows.map((row, index) => normalizeRow(row, venue, fallbackFolder, index)) : [];
}

function rowMergeKeys(row) {
  const folder = row?.folder || "active";
  const id = String(row?.id || "").trim();
  const item = String(row?.item || "").trim();
  const start = String(row?.start || "").trim();
  const end = String(row?.end || "").trim();
  return [
    row?.uid,
    id ? `${folder}:${id}:${item}:${start}:${end}` : "",
    id ? `${folder}:${id}:${item}` : "",
    id ? `${folder}:${id}` : "",
  ].filter(Boolean);
}

function mergeSourceRows(sourceRows, currentRows) {
  const currentByKey = new Map();
  currentRows.forEach((row) => {
    rowMergeKeys(row).forEach((key) => {
      if (!currentByKey.has(key)) currentByKey.set(key, row);
    });
  });

  const usedCurrentRows = new Set();
  const mergedRows = sourceRows.map((sourceRow) => {
    const currentRow = rowMergeKeys(sourceRow).map((key) => currentByKey.get(key)).find(Boolean);
    if (currentRow) usedCurrentRows.add(currentRow);
    if (!currentRow) return sourceRow;
    return {
      ...sourceRow,
      ...currentRow,
      uid: currentRow.uid || sourceRow.uid,
      venue: currentRow.venue || sourceRow.venue,
      sourceFormat: sourceRow.sourceFormat || currentRow.sourceFormat,
    };
  });

  currentRows.forEach((row) => {
    if (!usedCurrentRows.has(row)) mergedRows.push(row);
  });
  return mergedRows;
}

function normalizeCrmData(data) {
  if (!data || typeof data !== "object" || !data.venues || typeof data.venues !== "object") return null;
  const sourceData = getSourceData();
  const fallback = makeFallbackData();
  const sourceConfig = data.sources || sourceData.sources || fallback.sources;
  const venues = {};

  Object.keys(sourceConfig).forEach((venue) => {
    const venueData = data.venues?.[venue] || sourceData.venues?.[venue] || fallback.venues[venue] || { years: {} };
    const years = {};
    Object.entries(venueData.years || {}).forEach(([year, rows]) => {
      const normalizedRows = cloneRows(rows, venue);
      if (normalizedRows.length || year === initialYear) years[year] = normalizedRows;
    });
    if (!Object.keys(years).length) years[initialYear] = [];
    const sortedYears = Object.keys(years).sort((a, b) => Number(a) - Number(b));
    const active = years[venueData.activeYear] ? venueData.activeYear : sortedYears[0];
    venues[venue] = { activeYear: active, years };
  });

  Object.keys(sourceConfig).forEach((venue) => {
    const sourceVenue = sourceData.venues?.[venue];
    if (!sourceVenue || !venues[venue]) return;
    Object.entries(sourceVenue.years || {}).forEach(([year, rows]) => {
      const sourceRows = cloneRows(rows, venue);
      if (!sourceRows.length) return;
      const currentRows = cloneRows(venues[venue].years?.[year] || [], venue);
      venues[venue].years[year] = mergeSourceRows(sourceRows, currentRows);
    });
    if (sourceVenue.activeYear && venues[venue].years[sourceVenue.activeYear]) {
      venues[venue].activeYear = sourceVenue.activeYear;
    }
  });

  const sourceActiveVenue = sourceData.activeVenue || Object.keys(sourceConfig)[0] || "taichung";
  const active = venues[data.activeVenue] ? data.activeVenue : sourceActiveVenue;
  return {
    generatedAt: data.generatedAt || sourceData.generatedAt || "",
    activeVenue: venues[active] ? active : Object.keys(venues)[0],
    sources: sourceConfig,
    venues,
  };
}

function migrateLegacyData() {
  try {
    const legacy = JSON.parse(localStorage.getItem(legacyYearStorageKey));
    if (!legacy || !legacy.years) return null;
    const sourceData = normalizeCrmData(getSourceData());
    if (!sourceData?.venues?.taichung) return null;
    sourceData.venues.taichung = {
      activeYear: legacy.activeYear || initialYear,
      years: Object.fromEntries(Object.entries(legacy.years).map(([year, rows]) => [year, cloneRows(rows, "taichung")])),
    };
    sourceData.activeVenue = "taichung";
    return normalizeCrmData(sourceData);
  } catch {
    return null;
  }
}

function loadCrmData() {
  try {
    const saved = normalizeCrmData(JSON.parse(localStorage.getItem(crmStorageKey)));
    if (saved) return saved;
  } catch {}

  return normalizeCrmData(getSourceData()) || makeFallbackData();
}

function getVenueConfig(venue = activeVenue) {
  return crmData.sources[venue] || { label: venue, sourceLabel: "人工 CRM", sourceLink: "#", idMode: "number" };
}

function getVenueData(venue = activeVenue) {
  return crmData.venues[venue] || { activeYear: initialYear, years: { [initialYear]: [] } };
}

function getVenueRows(venue = activeVenue, year = activeYear) {
  return getVenueData(venue).years[year] || [];
}

function getRowKey(row) {
  if (!row) return "";
  return row.uid || `${row.venue || activeVenue}:${row.folder || "active"}:${row.id || row.name || row.company || ""}`;
}

function displayId(row) {
  return String(row?.id || "").trim() || "未編號";
}

function normalizeCustomerIdForLookup(value) {
  return String(value || "").trim().toUpperCase();
}

function resetContractDraft() {
  contractDraftOpen = false;
  contractDraftMode = "";
}

function applyInitialUrlState() {
  const params = new URLSearchParams(window.location.search);
  const requestedVenue = params.get("venue");
  const requestedYear = params.get("year");
  const requestedPage = params.get("page");
  const requestedId = params.get("id");

  if (requestedPage === "contracts") {
    const contractParams = new URLSearchParams();
    if (requestedVenue) contractParams.set("venue", requestedVenue);
    if (requestedYear) contractParams.set("year", requestedYear);
    if (requestedId) contractParams.set("id", requestedId);
    window.location.replace(`./contracts.html?${contractParams.toString()}`);
    return;
  }

  if (requestedVenue && crmData.venues[requestedVenue]) {
    activeVenue = requestedVenue;
  }

  const venueData = getVenueData(activeVenue);
  if (requestedYear && venueData.years?.[requestedYear]) {
    activeYear = requestedYear;
  } else {
    activeYear = venueData.activeYear || activeYear;
  }

  crmRows = getVenueRows(activeVenue, activeYear);
  activeFolder = "active";

  if (requestedId) {
    const match = crmRows.find((row) => normalizeCustomerIdForLookup(row.id) === normalizeCustomerIdForLookup(requestedId));
    if (match) selectedKey = getRowKey(match);
  }

  crmData.activeVenue = activeVenue;
  getVenueData(activeVenue).activeYear = activeYear;
}

function createBlankRow() {
  const createdAt = Date.now();
  return {
    uid: `${activeVenue}-${activeYear}-created-${createdAt}`,
    id: getNextCustomerId(),
    name: "",
    company: "",
    category: "",
    item: "",
    cycle: "",
    start: "",
    end: "",
    contractYears: "",
    contractTerm: "",
    payDay: "",
    amount: "",
    pricePlan: "",
    deposit: "",
    coNumber: "",
    idNumber: "",
    phone: "",
    signedAt: "",
    birthday: "",
    address: "",
    industry: "",
    notes: "",
    folder: "active",
    venue: activeVenue,
  };
}

function getNextCustomerId() {
  const { idMode } = getVenueConfig();
  const allRows = Object.values(getVenueData().years).flat();
  if (idMode === "v") {
    const vNumbers = allRows
      .map((row) => String(row.id || "").trim().match(/^V\s*0*(\d+)$/i))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .filter((id) => Number.isInteger(id) && id > 0);
    const latestV = vNumbers.length ? Math.max(...vNumbers) : 0;
    return `V${String(latestV + 1).padStart(2, "0")}`;
  }
  const numericIds = allRows
    .map((row) => String(row.id || "").trim())
    .filter((id) => /^\d+$/.test(id))
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  const latestId = numericIds.length ? Math.max(...numericIds) : 0;
  return String(latestId + 1);
}

function persistCrmData() {
  crmData.activeVenue = activeVenue;
  crmData.venues[activeVenue].activeYear = activeYear;
  crmData.venues[activeVenue].years[activeYear] = cloneRows(crmRows, activeVenue);
  localStorage.setItem(crmStorageKey, JSON.stringify(crmData));
  persistPaymentBridge();
}

function buildPaymentBridgeData() {
  const venues = {};
  Object.entries(crmData.venues || {}).forEach(([venue, venueData]) => {
    const years = {};
    Object.entries(venueData.years || {}).forEach(([year, rows]) => {
      years[year] = cloneRows(rows, venue)
        .filter((row) => (row.folder || "active") === "active")
        .map((row) => ({
          id: row.id,
          name: row.name,
          companyName: row.company,
          item: row.item,
          cycle: row.cycle,
          start: row.start,
          end: row.end,
          amount: row.amount,
          pricePlan: row.pricePlan,
          coNumber: row.coNumber,
          idNumber: row.idNumber,
        }));
    });
    venues[venue] = { activeYear: venueData.activeYear, years };
  });

  return {
    generatedAt: new Date().toISOString(),
    source: "new-crm-clean-v2",
    venues,
  };
}

function persistPaymentBridge() {
  try {
    localStorage.setItem(paymentBridgeStorageKey, JSON.stringify(buildPaymentBridgeData()));
  } catch {
    // Bridge is best-effort; the CRM source itself remains saved separately.
  }
}

function getYears(venue = activeVenue) {
  return Object.keys(getVenueData(venue).years).sort((a, b) => Number(a) - Number(b));
}

function crmYearExistsForAllVenues(year) {
  return Object.keys(crmData.venues || {}).every((venue) => Boolean(getVenueData(venue).years[year]));
}

function getAdjacentYears() {
  const years = getYears();
  const activeIndex = years.indexOf(activeYear);
  return {
    previous: activeIndex > 0 ? years[activeIndex - 1] : "",
    next: activeIndex >= 0 && activeIndex < years.length - 1 ? years[activeIndex + 1] : "",
  };
}

function getNextCreatableYear() {
  let candidate = Number(activeYear) + 1;
  while (crmYearExistsForAllVenues(String(candidate))) {
    candidate += 1;
  }
  return String(candidate);
}

function parseRocDate(value) {
  const text = String(value || "").trim();
  const buildDate = (rocYear, month, day) => {
    const normalized = {
      rocYear: Number(rocYear),
      month: String(month).padStart(2, "0"),
      day: String(day).padStart(2, "0"),
    };
    const monthNumber = Number(normalized.month);
    const dayNumber = Number(normalized.day);
    if (!normalized.rocYear || monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
    return normalized;
  };
  const digitOnly = text.replace(/\s/g, "");
  if (/^\d+$/.test(digitOnly)) {
    if (digitOnly.length === 7) return buildDate(digitOnly.slice(0, 3), digitOnly.slice(3, 5), digitOnly.slice(5, 7));
    if (digitOnly.length === 6) {
      const firstThreeYear = Number(digitOnly.slice(0, 3));
      if (firstThreeYear >= 100 && firstThreeYear <= 150) {
        return buildDate(digitOnly.slice(0, 3), digitOnly.slice(3, 4), digitOnly.slice(4, 6));
      }
      return buildDate(digitOnly.slice(0, 2), digitOnly.slice(2, 4), digitOnly.slice(4, 6));
    }
    if (digitOnly.length === 5) return buildDate(digitOnly.slice(0, 2), digitOnly.slice(2, 3), digitOnly.slice(3, 5));
  }
  const match = text.match(/^(\d{2,4})\D+(\d{1,4})(?:\D+(\d{1,2}))?$/);
  if (!match) return null;
  const compactMonthDay = !match[3] && match[2].length >= 3 ? match[2].padStart(4, "0") : "";
  return buildDate(
    match[1],
    compactMonthDay ? compactMonthDay.slice(0, -2) : match[2],
    compactMonthDay ? compactMonthDay.slice(-2) : match[3] || 1,
  );
}

function formatRocDate(date) {
  return `${date.rocYear}/${date.month}/${date.day}`;
}

function normalizeSlashRocDate(value) {
  const parsed = parseRocDate(value);
  return parsed ? formatRocDate(parsed) : String(value || "").trim();
}

function shiftRocDate(value, yearDelta) {
  const parsed = parseRocDate(value);
  if (!parsed) return value;
  return formatRocDate({ ...parsed, rocYear: parsed.rocYear + yearDelta });
}

function rocToGregorianYear(value) {
  const parsed = parseRocDate(value);
  return parsed ? parsed.rocYear + 1911 : null;
}

function getContractYears(row) {
  const explicitYears = contractYearsNumber(row.contractYears);
  if (explicitYears) return explicitYears;
  const inferredYears = getContractYearDiff(row.start, row.end);
  if (inferredYears) return inferredYears;
  const text = `${row.contractTerm || ""} ${row.cycle || ""}`.toLowerCase();
  if (text.includes("三") || text.includes("3y") || text.includes("3年")) return 3;
  if (text.includes("兩") || text.includes("二") || text.includes("2y") || text.includes("2年")) return 2;
  const termYears = getYearsFromContractTerm(row.contractTerm);
  if (termYears) return termYears;
  return 1;
}

function normalizeContractYears(value) {
  const match = String(value || "").trim().match(/\d+(?:\.\d+)?/);
  if (!match) return "";
  const number = Number(match[0]);
  if (!Number.isFinite(number) || number <= 0) return "";
  return Number.isInteger(number) ? String(number) : String(number);
}

function contractYearsNumber(value) {
  const normalized = normalizeContractYears(value);
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function getYearsFromContractTerm(term) {
  const normalized = normalizeContractTermValue(term);
  if (normalized === "三年約") return 3;
  if (normalized === "兩年約") return 2;
  if (normalized === "一年約") return 1;
  const numberMatch = String(term || "").match(/(\d+)\s*年/);
  if (numberMatch) return Number(numberMatch[1]);
  const chineseYearMap = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const chineseMatch = String(term || "").match(/([一二兩三四五六七八九十])年/);
  if (chineseMatch) return chineseYearMap[chineseMatch[1]] || 0;
  return 0;
}

function getContractYearDiff(start, end) {
  const startDate = parseRocDate(start);
  const endDate = parseRocDate(end);
  if (!startDate || !endDate) return 0;
  if (startDate.month !== endDate.month || startDate.day !== endDate.day) return 0;
  const yearDiff = endDate.rocYear - startDate.rocYear;
  return yearDiff > 0 ? yearDiff : 0;
}

function formatContractTermYears(years) {
  if (years === 1) return "一年約";
  if (years === 2) return "兩年約";
  if (years === 3) return "三年約";
  return `${years}年約`;
}

function inferContractTermFromDates(start, end) {
  const yearDiff = getContractYearDiff(start, end);
  return yearDiff ? formatContractTermYears(yearDiff) : "";
}

function getDisplayContractTerm(row) {
  const explicitYears = contractYearsNumber(row.contractYears);
  if (explicitYears && Number.isInteger(explicitYears)) return formatContractTermYears(explicitYears);
  if (row.start && row.end) return inferContractTermFromDates(row.start, row.end) || "自訂期間";
  return normalizeContractTermValue(row.contractTerm) || row.contractTerm || "";
}

function calculateEndDateFromStartAndYears(start, yearsValue) {
  const parsed = parseRocDate(start);
  const years = contractYearsNumber(yearsValue);
  if (!parsed || !Number.isInteger(years)) return "";
  return formatRocDate({ ...parsed, rocYear: parsed.rocYear + years });
}

function getComparableRocDate(value) {
  const parsed = parseRocDate(value);
  return parsed ? parsed.rocYear * 10000 + Number(parsed.month) * 100 + Number(parsed.day) : 0;
}

function getContractDateIssue(row) {
  if (!row?.start || !row.end) return "";
  const startDate = getComparableRocDate(row.start);
  const endDate = getComparableRocDate(row.end);
  if (!startDate || !endDate) return "";
  return endDate > startDate ? "" : "合約到期日必須晚於起始日期";
}

function syncContractFields(changedName) {
  if (!draftRow) return;
  if (changedName === "contractYears") {
    draftRow.contractYears = normalizeContractYears(draftRow.contractYears);
  }
  if (changedName === "start" || changedName === "contractYears") {
    const autoEnd = calculateEndDateFromStartAndYears(draftRow.start, draftRow.contractYears);
    if (autoEnd) draftRow.end = autoEnd;
  }
  if (changedName === "end") {
    const inferredYears = getContractYearDiff(draftRow.start, draftRow.end);
    if (inferredYears) draftRow.contractYears = String(inferredYears);
  }
  if (["start", "end", "contractYears"].includes(changedName)) {
    draftRow.contractTerm = getDisplayContractTerm(draftRow);
  }
}

function syncVisibleContractControls() {
  ["contractYears", "contractTerm", "start", "end"].forEach((name) => {
    const control = profileForm.querySelector(`[name="${name}"]`);
    if (!control) return;
    control.value = name === "contractTerm" ? getDisplayContractTerm(draftRow || {}) : draftRow?.[name] || "";
  });
}

function setDraftStatus() {
  const issue = getContractDateIssue(draftRow);
  if (issue) {
    setSaveState(issue, "error");
  } else {
    markDirty();
  }
}

function buildNextYearRow(row, targetYear, venue = activeVenue) {
  const years = getContractYears(row);
  const endYear = rocToGregorianYear(row.end);
  const copied = { ...row, uid: `${row.uid || getRowKey(row)}-${targetYear}`, venue };
  if (!endYear || Number(targetYear) < endYear) return copied;
  return {
    ...copied,
    start: shiftRocDate(row.start, years),
    end: shiftRocDate(row.end, years),
  };
}

function setSaveState(text, tone = "") {
  saveState.textContent = text;
  saveState.dataset.tone = tone;
}

function isEditing() {
  return editMode !== "view";
}

function markDirty() {
  setSaveState(`${activeYear} 有未儲存變更`, "dirty");
}

function setYearActionState(text, tone = "", options = {}) {
  yearActionState.textContent = text;
  yearActionState.dataset.tone = tone;
  if (yearActionTimer) window.clearTimeout(yearActionTimer);
  if (text && !options.persist) {
    yearActionTimer = window.setTimeout(() => {
      yearActionState.textContent = "";
      yearActionState.dataset.tone = "";
    }, 3500);
  }
}

function setYearControlsLocked(locked) {
  yearActionLocked = locked;
  [prevYearButton, nextYearButton, createYearButton].forEach((button) => {
    button.disabled = locked;
    button.dataset.busy = locked ? "true" : "";
  });
  if (!locked) renderActionButtons();
}

function lockYearAction(duration = 280) {
  setYearControlsLocked(true);
  window.setTimeout(() => {
    setYearControlsLocked(false);
  }, duration);
}

function renderShell() {
  activeService = normalizeServiceFilter(activeService);
  const config = getVenueConfig();
  document.body.dataset.venue = activeVenue;
  venueKicker.textContent = `${config.label} CRM`;
  appTitle.textContent = activePage === "contracts" ? "連結合約" : "客戶資料";
  updateContractPageLink();
  pageButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.page === activePage);
    button.disabled = isEditing();
  });
}

function updateContractPageLink() {
  if (!contractPageLink) return;
  const selected = crmRows.find((row) => getRowKey(row) === selectedKey) || crmRows.find((row) => (row.folder || "active") === activeFolder) || crmRows[0];
  const params = new URLSearchParams({
    venue: activeVenue,
    year: activeYear,
  });
  if (selected?.id) params.set("id", selected.id);
  contractPageLink.href = `./contracts.html?${params.toString()}`;
}

function renderVenueTabs() {
  venueButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.venue === activeVenue);
    button.disabled = isEditing();
  });
}

function renderActionButtons() {
  const editing = isEditing();
  const contractPage = activePage === "contracts";
  newButton.hidden = editing;
  addContractButton.hidden = !contractPage || editing;
  addBlankContractButton.hidden = !contractPage || editing;
  addContractButton.textContent = contractDraftMode === "existing" ? "收合合約連結" : "連結既有合約";
  addBlankContractButton.textContent = contractDraftMode === "blank" ? "收合空白合約" : "新增空白合約";
  editButton.hidden = editing || contractPage;
  moveFolderButton.hidden = editing || contractPage;
  deleteButton.hidden = editing || contractPage;
  cancelButton.hidden = !editing;
  saveButton.hidden = !editing;

  newButton.disabled = editing;
  addContractButton.disabled = editing || !draftRow;
  addBlankContractButton.disabled = editing;
  editButton.disabled = editing || !draftRow;
  moveFolderButton.disabled = editing || !draftRow;
  deleteButton.disabled = editing || !draftRow;
  cancelButton.disabled = !editing;
  saveButton.disabled = !editing || !draftRow;

  searchInput.disabled = editing;
  yearSelect.disabled = editing;
  const { previous, next } = getAdjacentYears();
  prevYearButton.disabled = editing || yearActionLocked || !previous;
  nextYearButton.disabled = editing || yearActionLocked || !next;
  createYearButton.disabled = editing || yearActionLocked;
  folderButtons.forEach((button) => {
    button.disabled = editing;
  });
  serviceButtons.forEach((button) => {
    button.disabled = editing || !serviceFilterAllowed(button.dataset.service);
  });
  venueButtons.forEach((button) => {
    button.disabled = editing;
  });
}

function renderYearSelect() {
  yearSelect.innerHTML = getYears().map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");
  yearSelect.value = activeYear;
  yearPicker.classList.toggle("is-current-year", activeYear === currentGregorianYear);
  const { previous, next } = getAdjacentYears();
  prevYearButton.textContent = "← 上一年";
  prevYearButton.title = previous ? `切到 ${previous}` : "沒有上一個年度";
  prevYearButton.setAttribute("aria-label", prevYearButton.title);
  nextYearButton.textContent = "下一年 →";
  nextYearButton.title = next ? `切到 ${next}` : "沒有下一個年度，請用建立年度";
  nextYearButton.setAttribute("aria-label", nextYearButton.title);
  createYearButton.textContent = `建立 ${getNextCreatableYear()}`;
}

function renderFolderTabs() {
  folderButtons.forEach((button) => button.classList.toggle("active", button.dataset.folder === activeFolder));
}

function renderServiceTabs() {
  serviceButtons.forEach((button) => {
    const allowed = serviceFilterAllowed(button.dataset.service);
    button.hidden = !allowed;
    button.disabled = isEditing() || !allowed;
    button.classList.toggle("active", button.dataset.service === activeService);
  });
}

function renderList(rows) {
  recordList.innerHTML = "";
  recordCount.textContent = `${rows.length} 筆`;
  if (!rows.length) {
    recordList.innerHTML = `<div class="empty-list">${activeFolder === "ended" ? "結束夾目前是空的" : "總表目前沒有客戶"}</div>`;
    return;
  }
  rows.forEach((row) => {
    const key = getRowKey(row);
    const button = document.createElement("button");
    button.className = `record-card${key === selectedKey ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="record-id">${escapeHtml(displayId(row))}</span>
      <span>
        <span class="record-title">${escapeHtml(row.company || row.name || "未命名")}</span>
        <span class="record-meta">${escapeHtml([row.name, row.item, row.cycle].filter(Boolean).join(" · "))}</span>
      </span>
    `;
    button.disabled = isEditing();
    button.addEventListener("click", () => {
      if (isEditing()) return;
      selectedKey = key;
      resetContractDraft();
      render();
    });
    recordList.append(button);
  });
}

function renderOverview() {
  const rows = getFilteredRows();
  const { label } = getVenueConfig();
  const audit = getOverviewAudit(rows);
  overviewTitle.textContent = `${activeYear} ${label} ${activeFolder === "ended" ? "結束" : "總表"}`;
  overviewStatus.textContent = `${rows.length} 筆 · ${audit.label}`;
  overviewStatus.dataset.tone = audit.issues.length ? "warn" : "ok";
  overviewIssues.hidden = !audit.issues.length;
  overviewIssues.innerHTML = audit.issues.map((issue) => `<span>${escapeHtml(issue)}</span>`).join("");
  overviewRows.innerHTML = rows
    .map((row, index) => `
      <tr class="${getRowKey(row) === selectedKey ? "selected" : ""}" data-overview-index="${index}" tabindex="0">
        <td>${escapeHtml(displayId(row))}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.company)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.item)}</td>
        <td>${escapeHtml(row.cycle)}</td>
        <td>${escapeHtml(row.start)}</td>
        <td>${escapeHtml(displayOverviewEnd(row))}</td>
        <td>${escapeHtml(row.amount)}</td>
        <td>${escapeHtml(row.deposit)}</td>
      </tr>
    `)
    .join("");
  overviewRows.querySelectorAll("[data-overview-index]").forEach((rowElement) => {
    rowElement.addEventListener("click", () => selectOverviewRow(rows, rowElement));
    rowElement.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectOverviewRow(rows, rowElement);
    });
  });
}

function getOverviewAudit(rows) {
  if (!rows.length) return { label: "沒有資料", issues: [] };
  const requiredFields = [
    { key: "id", label: "編號" },
    { key: "name", label: "姓名" },
    { key: "company", label: "公司名稱（營登）", required: requiresCompanyName },
    { key: "item", label: "項目" },
    { key: "cycle", label: "繳費方式" },
    { key: "start", label: "合約起始日期" },
    { key: "end", label: "合約到期日", required: requiresContractEnd },
    { key: "amount", label: "金額" },
  ];
  const rowIndexes = new Set();
  const issues = requiredFields
    .map(({ key, label, required }) => {
      const missing = rows.filter((row, index) => {
        if (required && !required(row)) return false;
        const isMissing = !String(row[key] || "").trim();
        if (isMissing) rowIndexes.add(index);
        return isMissing;
      }).length;
      return missing ? `${label}空白 ${missing} 筆` : "";
    })
    .filter(Boolean);
  return {
    label: rowIndexes.size ? `${rowIndexes.size} 筆待補欄位` : "欄位完整",
    issues,
  };
}

function isOpenEndedSeat(row) {
  const item = String(row?.item || "").trim();
  const cycle = normalizeCycleValue(row?.cycle || "");
  return (item === "自由座" || item === "共享座位") && cycle === "M";
}

function requiresContractEnd(row) {
  return !isOpenEndedSeat(row);
}

function displayOverviewEnd(row) {
  const end = String(row?.end || "").trim();
  if (end) return end;
  return isOpenEndedSeat(row) ? "-" : "";
}

function requiresCompanyName(row) {
  const item = String(row.item || "").trim();
  if (!item.includes("營登")) return false;
  return !isPendingCompanyName(row);
}

function isPendingCompanyName(row) {
  const venue = row.venue || activeVenue;
  const id = displayId(row).toUpperCase();
  return venue === "huanrui" && id === "V15" && row.name === "劉思辰";
}

function selectOverviewRow(rows, rowElement) {
  if (isEditing()) {
    setSaveState("請先儲存或取消目前修改");
    return;
  }
  const row = rows[Number(rowElement.dataset.overviewIndex)];
  if (!row) return;
  selectedKey = getRowKey(row);
  resetContractDraft();
  render();
  document.querySelector(".detail")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderMetrics(row) {
  const displayContractTerm = getDisplayContractTerm(row);
  const contractRange = row.start && row.end ? `${row.start} → ${row.end}` : "";
  metrics.innerHTML = [
    { label: "項目", value: row.item, className: "compact" },
    { label: "繳費方式", value: row.cycle, className: "compact" },
    { label: "合約期間", value: displayContractTerm, subvalue: contractRange, className: "period" },
    { label: "金額", value: row.amount, subvalue: row.pricePlan, className: "amount" },
  ]
    .map((metric) => `
      <article class="metric ${metric.className}">
        <span>${escapeHtml(metric.label)}</span>
        <strong>${escapeHtml(metric.value)}${metric.subvalue ? `<em>${escapeHtml(metric.subvalue)}</em>` : ""}</strong>
      </article>
    `)
    .join("");
}

function createTextControl(key, label, row) {
  const placeholder = placeholderForField(key);
  if (key === "address") {
    return `
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeHtml(key)}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""} autocomplete="off">${escapeHtml(row[key] || "")}</textarea>
    `;
  }
  return `
    <span>${escapeHtml(label)}</span>
    <input name="${escapeHtml(key)}" value="${escapeHtml(row[key] || "")}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""} autocomplete="off" />
  `;
}

function placeholderForField(key) {
  if (key === "contractYears") return "例：1";
  if (["start", "end"].includes(key)) return "115/05/05";
  if (key === "amount") return "1800/m";
  if (key === "deposit") return "6000/未退";
  if (key === "coNumber") return "例：12345678";
  if (key === "idNumber") return "例：A123456789";
  return "";
}

function createSelectControl(key, label, row, options) {
  const value = key === "cycle" ? normalizeCycleValue(row[key]) : row[key] || "";
  if (!isEditing()) {
    return createTextControl(key, label, { [key]: value });
  }
  const displayOptions = value && !options.includes(value) ? [value, ...options] : options;
  return `
    <span>${escapeHtml(label)}</span>
    <select name="${escapeHtml(key)}" autocomplete="off">
      <option value=""></option>
      ${displayOptions.map((option) => `<option value="${escapeHtml(option)}"${value === option ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
    </select>
  `;
}

function renderProfileForm(row) {
  profileForm.innerHTML = "";
  const editing = isEditing();
  profileForm.classList.toggle("editing", editing);
  profileForm.classList.toggle("readonly", !editing);
  const contractIdentityFields = new Set(["coNumber", "idNumber"]);
  const bindControl = (control) => {
    const isDerived = control.dataset.derived === "true";
    if (control.tagName === "SELECT") {
      control.disabled = false;
    } else {
      control.readOnly = !editing || isDerived;
    }
    control.tabIndex = editing && !isDerived ? 0 : -1;
    if (isDerived) return;
    const updateDraft = () => {
      if (!isEditing()) return;
      if (control.tagName === "TEXTAREA") resizeProfileTextarea(control);
      draftRow[control.name] = control.value;
      if (contractIdentityFields.has(control.name)) {
        control.classList.toggle("highlight-contract-id", Boolean(control.value.trim()));
      }
      syncContractFields(control.name);
      syncVisibleContractControls();
      if (control.name === "company") detailCompany.textContent = control.value || "新增客戶";
      if (["item", "cycle", "start", "end", "contractYears", "amount", "pricePlan"].includes(control.name)) renderMetrics(draftRow);
      setDraftStatus();
    };
    control.addEventListener("input", updateDraft);
    control.addEventListener("change", updateDraft);
    control.addEventListener("blur", () => {
      if (!isEditing() || !crmDateFields.has(control.name)) return;
      const formatted = normalizeSlashRocDate(control.value);
      if (!formatted || formatted === control.value) return;
      control.value = formatted;
      updateDraft();
    });
  };
  const resizeProfileTextarea = (textarea) => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 64)}px`;
  };
  const markSpecialValues = (field) => {
    field.querySelectorAll('input[name="coNumber"], input[name="idNumber"]').forEach((input) => {
      input.classList.toggle("highlight-contract-id", Boolean(input.value.trim()));
    });
  };

  const sectionsBySide = profileSections.reduce(
    (acc, section) => {
      acc[section.side].push(section);
      return acc;
    },
    { left: [], right: [] }
  );

  Object.entries(sectionsBySide).forEach(([side, sections]) => {
    const column = document.createElement("div");
    column.className = `profile-column ${side}`;
    sections.forEach((section) => {
      const sectionEl = document.createElement("section");
      sectionEl.className = `profile-section profile-section-${section.tone}`;
      sectionEl.innerHTML = `
        <div class="profile-section-head">
          <strong>${escapeHtml(section.title)}</strong>
          <small>${escapeHtml(section.hint)}</small>
        </div>
      `;
      section.fields.forEach((fieldConfig) => {
        const [key, label, nestedFields, groupMode] = fieldConfig;
        const field = document.createElement("label");
        field.className = [
          "profile-field",
          nestedFields ? (groupMode === "inline" ? "inline-field" : "date-field") : "",
          groupMode === "contract" ? "compact-date-field" : "",
        ].filter(Boolean).join(" ");
        if (nestedFields) {
          field.innerHTML = `
            <span>${escapeHtml(label)}</span>
            <div class="${[
              groupMode === "inline" ? "inline-inputs" : "date-inputs",
              groupMode === "contract" ? "contract-date-inputs" : "",
            ].filter(Boolean).join(" ")}">
              ${nestedFields
                .map(([nestedKey, nestedLabel]) => `
                  <label>
                    <small>${escapeHtml(nestedLabel)}</small>
                    <input name="${escapeHtml(nestedKey)}" value="${escapeHtml(row[nestedKey] || "")}"${placeholderForField(nestedKey) ? ` placeholder="${escapeHtml(placeholderForField(nestedKey))}"` : ""} autocomplete="off" />
                  </label>
                `)
                .join("")}
            </div>
          `;
        } else if (key === "cycle") {
          field.innerHTML = createSelectControl(key, label, row, cycleOptions);
        } else if (key === "category") {
          field.innerHTML = createSelectControl(key, label, row, categoryOptions);
        } else if (key === "item") {
          field.innerHTML = createSelectControl(key, label, row, itemOptions);
        } else if (key === "contractTerm") {
          field.innerHTML = `
            <span>${escapeHtml(label)}</span>
            <input name="${escapeHtml(key)}" value="${escapeHtml(getDisplayContractTerm(row))}" autocomplete="off" data-derived="true" />
          `;
        } else {
          field.innerHTML = createTextControl(key, label, row);
        }
        field.querySelectorAll("input, select, textarea").forEach((control) => {
          bindControl(control);
          if (control.tagName === "TEXTAREA") resizeProfileTextarea(control);
        });
        markSpecialValues(field);
        sectionEl.append(field);
      });
      column.append(sectionEl);
    });
    profileForm.append(column);
  });

}

function contractValue(value, fallback = "待填") {
  const text = String(value || "").trim();
  return text || fallback;
}

function getContractVenueDefaults(venue = activeVenue) {
  if (venue === "huanrui") {
    return {
      lessor: "樞紐前沿股份有限公司",
      address: "台中市西區台灣大道二段181號4F-1",
    };
  }
  return {
    lessor: "你的空間有限公司",
    address: "台中市西區大忠南街55號7F-5",
  };
}

function renderContractFrame(row) {
  const contractTerm = getDisplayContractTerm(row) || "待判斷";
  const dateRange = row.start && row.end ? `${row.start} → ${row.end}` : "起訖日待補";
  const currentTitle = row.company || row.name || "未命名客戶";
  const venueConfig = getVenueConfig(row.venue || activeVenue);
  const venueDefaults = getContractVenueDefaults(row.venue || activeVenue);
  const blankDraft = contractDraftMode === "blank";
  const draft = contractDraftMode
    ? `
      <section class="contract-draft">
        <div class="contract-section-head">
          <h4>${blankDraft ? "新增空白合約入口" : "連結既有合約入口"}</h4>
          <span>${blankDraft ? "給新客戶或沒有舊檔時使用" : "先把 CRM 客戶對到正確合約檔"}</span>
        </div>
        <div class="contract-empty-note">
          這裡先只放入口，不定稿合約填空欄位。等合約內容規則討論完，再把 Pages 欄位、列印版本與金額防呆接上。
        </div>
      </section>
    `
    : "";

  contractFrame.innerHTML = `
    <div class="contract-frame-grid">
      <section class="contract-main-card">
        <div class="contract-section-head">
          <div>
            <span>CRM 連結合約</span>
            <h4>${escapeHtml(currentTitle)}</h4>
          </div>
          <strong>框底</strong>
        </div>
        <div class="contract-hero-line">
          <span>目前期間</span>
          <b>${escapeHtml(dateRange)}</b>
        </div>
        <div class="contract-hero-line">
          <span>CRM 資訊</span>
          <b>${escapeHtml([displayId(row), row.item, row.cycle, contractTerm].filter(Boolean).join("｜"))}</b>
        </div>
      </section>

      <section class="contract-info-card">
        <h4>合約連結</h4>
        <dl>
          <div><dt>狀態</dt><dd>尚未連結 Pages 檔</dd></div>
          <div><dt>來源</dt><dd>Pages 原始檔</dd></div>
          <div><dt>適用</dt><dd>新客戶 / 續約 / 補新合約</dd></div>
          <div><dt>舊客戶</dt><dd>可空白，不列缺件</dd></div>
        </dl>
      </section>

      <section class="contract-info-card">
        <h4>館別資料</h4>
        <dl>
          <div><dt>館別</dt><dd>${escapeHtml(venueConfig.label)}</dd></div>
          <div><dt>出租方</dt><dd>${escapeHtml(venueDefaults.lessor)}</dd></div>
          <div><dt>地址</dt><dd>${escapeHtml(venueDefaults.address)}</dd></div>
          <div><dt>版本</dt><dd>用印版 / 不用印版待接</dd></div>
        </dl>
      </section>

      <section class="contract-info-card">
        <h4>目前 CRM 值</h4>
        <dl>
          <div><dt>編號</dt><dd>${escapeHtml(contractValue(displayId(row)))}</dd></div>
          <div><dt>服務</dt><dd>${escapeHtml(contractValue(row.item))}</dd></div>
          <div><dt>金額</dt><dd>${escapeHtml(contractValue(row.amount))}</dd></div>
          <div><dt>押金</dt><dd>${escapeHtml(contractValue(row.deposit))}</dd></div>
        </dl>
      </section>

      <section class="contract-timeline">
        <div class="contract-section-head">
          <h4>合約填空欄位</h4>
          <span>尚未討論，不先定稿</span>
        </div>
        <div class="contract-empty-note">目前只確認「CRM 要能連到合約」。合約內要自動填哪些欄位、哪些版本要印、哪些不用印，等你確認規則後再做。</div>
      </section>

      ${draft}
    </div>
  `;
}

function renderDetail(row) {
  draftRow = { ...row };
  moveFolderButton.textContent = activeFolder === "ended" ? "移回總表" : "移到結束";
  detailCompany.textContent = row.company || (editMode === "create" ? "新增客戶" : "未命名公司");
  renderMetrics(row);
  renderProfileForm(row);
  renderContractFrame(row);
  const contractPage = activePage === "contracts";
  panelHeading.textContent = contractPage ? "CRM 連結合約" : "客戶檔案";
  profileForm.hidden = contractPage;
  contractFrame.hidden = !contractPage;
  renderActionButtons();
  if (editMode === "create") {
    setSaveState(`${activeYear} 新增中`, "dirty");
  } else if (editMode === "edit") {
    setSaveState(`${activeYear} 修改中`, "dirty");
  } else if (contractPage) {
    setSaveState(`${activeYear} 合約底版`);
  } else {
    setSaveState(`${activeYear} 唯讀，按修改才可編輯`);
  }
}

function renderEmptyDetail() {
  editMode = "view";
  draftRow = null;
  detailCompany.textContent = activeFolder === "ended" ? "結束夾目前沒有客戶" : "總表目前沒有客戶";
  metrics.innerHTML = "";
  profileForm.innerHTML = "";
  contractFrame.innerHTML = "";
  panelHeading.textContent = activePage === "contracts" ? "CRM 連結合約" : "客戶檔案";
  profileForm.hidden = activePage === "contracts";
  contractFrame.hidden = activePage !== "contracts";
  moveFolderButton.textContent = activeFolder === "ended" ? "移回總表" : "移到結束";
  renderActionButtons();
  setSaveState("沒有可編輯資料");
}

function getFilteredRows() {
  const query = searchInput.value.trim().toLowerCase();
  const service = normalizeServiceFilter(activeService);
  const folderRows = crmRows.filter((row) => (row.folder || "active") === activeFolder);
  const serviceRows = service === "all" ? folderRows : folderRows.filter((row) => serviceType(row) === service);
  if (!query) return serviceRows;
  return serviceRows.filter((row) =>
    [row.id, row.name, row.company, row.category, row.item, row.cycle].some((value) => String(value).toLowerCase().includes(query))
  );
}

function validateCreatedId(nextId) {
  const { idMode } = getVenueConfig();
  if (idMode === "v" && !/^V\d+$/i.test(nextId)) return "環瑞館新增編號需為 V 開頭";
  if (idMode === "number" && !/^\d+$/.test(nextId)) return "台中館新增編號需為純數字";
  return "";
}

function saveDraft() {
  if (!draftRow || !isEditing()) return;
  const nextId = (draftRow.id || "").trim();
  const currentIndex = crmRows.findIndex((row) => getRowKey(row) === selectedKey);
  const duplicated = nextId && crmRows.some((row, index) => String(row.id || "").trim() === nextId && (editMode === "create" || index !== currentIndex));

  if (!nextId) {
    setSaveState("編號不可空白", "error");
    return;
  }

  if (editMode === "create") {
    const idIssue = validateCreatedId(nextId);
    if (idIssue) {
      setSaveState(idIssue, "error");
      return;
    }
  }

  if (duplicated) {
    setSaveState("編號重複", "error");
    return;
  }

  const contractIssue = getContractDateIssue(draftRow);
  if (contractIssue) {
    setSaveState(contractIssue, "error");
    return;
  }

  if (editMode === "edit" && currentIndex === -1) {
    setSaveState("找不到原本資料", "error");
    return;
  }

  const nextRow = normalizeRow({ ...draftRow, id: nextId, contractTerm: getDisplayContractTerm(draftRow), folder: activeFolder, venue: activeVenue }, activeVenue, activeFolder);
  if (editMode === "create") {
    nextRow.uid = draftRow.uid || `${activeVenue}-${activeYear}-created-${Date.now()}`;
    crmRows.push(nextRow);
  } else {
    nextRow.uid = draftRow.uid || selectedKey;
    crmRows[currentIndex] = nextRow;
  }
  selectedKey = getRowKey(nextRow);
  editMode = "view";
  persistCrmData();
  render();
  setSaveState(`${activeYear} 已儲存本機測試`, "saved");
}

function getRecordTitle(row) {
  return row.company || row.name || `編號 ${displayId(row)}`;
}

function moveCurrentFolder() {
  if (!draftRow || isEditing()) return;
  const currentIndex = crmRows.findIndex((row) => getRowKey(row) === selectedKey);
  if (currentIndex === -1) return;
  const targetFolder = activeFolder === "ended" ? "active" : "ended";
  const title = getRecordTitle(draftRow);
  const message =
    targetFolder === "ended"
      ? `確定把「${title}」（編號 ${displayId(draftRow)}）移到結束夾？\n這不是刪除資料，移錯可以從「結束」移回總表。`
      : `確定把「${title}」（編號 ${displayId(draftRow)}）移回總表？`;
  if (!window.confirm(message)) return;

  const nextRow = { ...draftRow, folder: targetFolder };
  crmRows[currentIndex] = nextRow;
  activeFolder = targetFolder;
  selectedKey = getRowKey(nextRow);
  searchInput.value = "";
  persistCrmData();
  render();
  setSaveState(targetFolder === "ended" ? "已移到結束" : "已移回總表", "saved");
}

function deleteCurrentRow() {
  if (!draftRow || isEditing()) return;
  const currentIndex = crmRows.findIndex((row) => getRowKey(row) === selectedKey);
  if (currentIndex === -1) return;
  const title = getRecordTitle(draftRow);
  const expected = String(draftRow.id || selectedKey).trim();
  const typedId = window.prompt(
    `刪除防呆：這會刪除 ${activeYear} 年度這一筆「${title}」。\n這只會刪除本機測試資料，不代表客戶結束。\n\n請輸入「${expected}」才會刪除。（不用輸入「編號」兩個字）`
  );
  if (typedId === null) return;
  const normalizedTypedId = typedId.trim().replace(/^編號\s*/u, "");
  if (normalizedTypedId !== expected) {
    setSaveState("刪除已取消：輸入的編號不一致", "error");
    return;
  }

  crmRows.splice(currentIndex, 1);
  const rows = crmRows.filter((row) => (row.folder || "active") === activeFolder);
  selectedKey = getRowKey(rows[0]);
  persistCrmData();
  render();
  setSaveState(`${activeYear} 已刪除本筆本機資料`, "saved");
}

function openVenueDialog(venue) {
  if (isEditing() || !crmData.venues[venue] || venue === activeVenue) return;
  pendingVenue = venue;
  const fromConfig = getVenueConfig(activeVenue);
  const toConfig = getVenueConfig(venue);
  const venueData = getVenueData(venue);
  const targetYear = venueData.activeYear || initialYear;
  const targetRows = getVenueRows(venue, targetYear);
  const activeCount = targetRows.filter((row) => (row.folder || "active") === "active").length;
  venueDialogText.textContent = `從 ${fromConfig.label} 切到 ${toConfig.label}。${targetYear} 目前總表 ${activeCount} 筆。`;
  venueConfirmButton.textContent = `切到 ${toConfig.label}`;
  if (typeof venueDialog.showModal === "function") {
    venueDialog.showModal();
  } else if (window.confirm(venueDialogText.textContent)) {
    confirmVenueSwitch();
  }
}

function closeVenueDialog() {
  pendingVenue = "";
  if (venueDialog.open) venueDialog.close();
}

function confirmVenueSwitch() {
  const venue = pendingVenue;
  pendingVenue = "";
  if (venueDialog.open) venueDialog.close();
  switchVenueNow(venue);
}

function switchVenueNow(venue) {
  if (isEditing() || !crmData.venues[venue]) return;
  activeVenue = venue;
  activeYear = getVenueData(venue).activeYear;
  crmRows = getVenueRows(venue, activeYear);
  activeFolder = "active";
  activeService = "all";
  resetContractDraft();
  searchInput.value = "";
  selectedKey = getRowKey(crmRows.find((row) => (row.folder || "active") === activeFolder) || crmRows[0]);
  persistCrmData();
  render();
}

function switchYear(year, announce = false) {
  if (isEditing() || !getVenueData().years[year]) return;
  activeYear = year;
  crmRows = getVenueRows(activeVenue, activeYear);
  const rows = getFilteredRows();
  selectedKey = getRowKey(rows[0]);
  resetContractDraft();
  searchInput.value = "";
  persistCrmData();
  render();
  if (announce) {
    lockYearAction();
    setYearActionState(`已切到 ${activeYear}`, "saved");
    setSaveState(`${activeYear} 已切換`, "saved");
  }
}

function createNextYear() {
  if (isEditing() || yearActionLocked) return;
  const nextYear = getNextCreatableYear();

  const confirmed = window.confirm(`確定建立兩館 ${nextYear} CRM 年度？\n台中館與環瑞館會各自用自己的上一個年度資料建立，並一起切到 ${nextYear}。`);
  if (!confirmed) return;

  setYearControlsLocked(true);
  setYearActionState(`${nextYear} 準備中`, "saved", { persist: true });
  setSaveState(`${nextYear} 準備中`, "saved");
  if (yearCreateTimer) window.clearTimeout(yearCreateTimer);
  yearCreateTimer = window.setTimeout(() => {
    Object.keys(crmData.venues || {}).forEach((venue) => {
      const venueData = getVenueData(venue);
      const sourceYear = getYears(venue)
        .filter((year) => Number(year) < Number(nextYear))
        .at(-1) || initialYear;
      if (!venueData.years[nextYear]) {
        venueData.years[nextYear] = (venueData.years[sourceYear] || []).map((row) => buildNextYearRow(row, nextYear, venue));
      }
      venueData.activeYear = nextYear;
    });
    activeYear = nextYear;
    crmRows = getVenueRows(activeVenue, activeYear);
    activeFolder = "active";
    resetContractDraft();
    selectedKey = getRowKey(crmRows.find((row) => (row.folder || "active") === activeFolder) || crmRows[0]);
    searchInput.value = "";
    persistCrmData();
    render();
    setYearControlsLocked(false);
    setYearActionState(`已轉入 ${activeYear}`, "saved");
    setSaveState(`${activeYear} 兩館已轉入`, "saved");
  }, 60);
}

function goToPreviousYear() {
  const { previous } = getAdjacentYears();
  if (previous) switchYear(previous, true);
}

function goToNextYear() {
  const { next } = getAdjacentYears();
  if (next) switchYear(next, true);
}

function render() {
  renderShell();
  renderVenueTabs();
  renderYearSelect();
  renderFolderTabs();
  renderServiceTabs();
  const rows = getFilteredRows();
  if (editMode === "create") {
    renderList(rows);
    renderOverview();
    renderDetail(draftRow || createBlankRow());
    return;
  }
  const selected = rows.find((row) => getRowKey(row) === selectedKey) || rows[0];
  renderList(rows);
  renderOverview();
  if (!rows.length) {
    renderEmptyDetail();
    return;
  }
  selectedKey = getRowKey(selected);
  renderDetail(selected);
}

function beginCreate() {
  activeFolder = "active";
  activePage = "profile";
  resetContractDraft();
  selectedKey = "";
  searchInput.value = "";
  editMode = "create";
  draftRow = createBlankRow();
  render();
}

function beginEdit() {
  if (!draftRow) return;
  editMode = "edit";
  render();
}

function cancelEdit() {
  editMode = "view";
  draftRow = null;
  render();
}

function switchPage(page) {
  if (isEditing() || !["profile", "contracts"].includes(page)) return;
  activePage = page;
  resetContractDraft();
  render();
}

function toggleContractDraft() {
  if (isEditing() || activePage !== "contracts" || !draftRow) return;
  contractDraftMode = contractDraftMode === "existing" ? "" : "existing";
  contractDraftOpen = Boolean(contractDraftMode);
  render();
}

function toggleBlankContractDraft() {
  if (isEditing() || activePage !== "contracts") return;
  contractDraftMode = contractDraftMode === "blank" ? "" : "blank";
  contractDraftOpen = Boolean(contractDraftMode);
  render();
}

saveButton.addEventListener("click", saveDraft);
moveFolderButton.addEventListener("click", moveCurrentFolder);
deleteButton.addEventListener("click", deleteCurrentRow);
newButton.addEventListener("click", beginCreate);
addContractButton.addEventListener("click", toggleContractDraft);
addBlankContractButton.addEventListener("click", toggleBlankContractDraft);
editButton.addEventListener("click", beginEdit);
cancelButton.addEventListener("click", cancelEdit);
searchInput.addEventListener("input", () => {
  if (!isEditing()) render();
});
yearSelect.addEventListener("change", () => switchYear(yearSelect.value, true));
prevYearButton.addEventListener("click", goToPreviousYear);
nextYearButton.addEventListener("click", goToNextYear);
createYearButton.addEventListener("click", createNextYear);
folderButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isEditing()) return;
    activeFolder = button.dataset.folder;
    activeService = "all";
    resetContractDraft();
    searchInput.value = "";
    const rows = getFilteredRows();
    selectedKey = getRowKey(rows[0]);
    render();
  });
});
serviceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isEditing() || !serviceFilterAllowed(button.dataset.service)) return;
    activeService = normalizeServiceFilter(button.dataset.service);
    resetContractDraft();
    searchInput.value = "";
    const rows = getFilteredRows();
    selectedKey = getRowKey(rows[0]);
    render();
  });
});
venueButtons.forEach((button) => {
  button.addEventListener("click", () => openVenueDialog(button.dataset.venue));
});
pageButtons.forEach((button) => {
  button.addEventListener("click", () => switchPage(button.dataset.page));
});
venueCancelButton.addEventListener("click", closeVenueDialog);
venueConfirmButton.addEventListener("click", confirmVenueSwitch);
venueDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeVenueDialog();
});
render();
