const crmStorageKey = "hj-crm-clean-v5-data-repair";
const contractDraftStorageKey = "hj-contract-drafts-v2";
const initialYear = "2026";

const venueKicker = document.querySelector("#venueKicker");
const profilePageLink = document.querySelector("#profilePageLink");
const venueButtons = document.querySelectorAll("[data-venue]");
const yearPicker = document.querySelector("#yearPicker");
const yearSelect = document.querySelector("#yearSelect");
const prevYearButton = document.querySelector("#prevYearButton");
const nextYearButton = document.querySelector("#nextYearButton");
const createYearButton = document.querySelector("#createYearButton");
const searchInput = document.querySelector("#searchInput");
const folderButtons = document.querySelectorAll("[data-folder]");
const serviceButtons = document.querySelectorAll("[data-service]");
const recordList = document.querySelector("#recordList");
const recordCount = document.querySelector("#recordCount");
const contractTitle = document.querySelector("#contractTitle");
const contractSummary = document.querySelector("#contractSummary");
const contractActionPanel = document.querySelector("#contractActionPanel");
const linkContractButton = document.querySelector("#linkContractButton");
const blankContractButton = document.querySelector("#blankContractButton");
const blankContractOpenButton = document.querySelector("#blankContractOpenButton");

const currentGregorianYear = String(new Date().getFullYear());
let crmData = loadCrmData();
let activeVenue = crmData.activeVenue || "taichung";
let activeYear = getVenueData(activeVenue).activeYear || initialYear;
let selectedId = "";
let actionMode = "";
let activeFolder = "active";
let activeService = "registration";
let blankVersion = "stamp";
let blankContractType = "registration";
let contractEditing = false;
let contractDrafts = loadContractDrafts();

const lesseeContractDisplayFields = [
  { key: "lesseeCompany", label: "承租人公司名稱", outputLabel: "承租人公司名稱" },
  { key: "lesseeName", label: "負責人", outputLabel: "負責人" },
  { key: "lesseeAddress", label: "地址", outputLabel: "地址" },
  { key: "identityNumber", label: "身分證統一編號", outputLabel: "身分證統一編號" },
  { key: "birthday", label: "出生年月日", outputLabel: "出生" },
  { key: "companyNumber", label: "公司統一編號", outputLabel: "公司統一編號" },
  { key: "phone", label: "聯絡電話", outputLabel: "聯絡電話" },
];

const lesseeContractDisplayFieldKeys = new Set(lesseeContractDisplayFields.map((field) => field.key));

applyInitialUrlState();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCycleValue(value) {
  return String(value || "").trim().toUpperCase().replaceAll("Ｍ", "M").replaceAll("Ｙ", "Y");
}

function makeFallbackData() {
  return {
    activeVenue: "taichung",
    sources: {
      taichung: { label: "台中館", idMode: "number" },
      huanrui: { label: "環瑞館", idMode: "v" },
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
  return {
    id: String(row?.id || "").trim(),
    name: String(row?.name || "").trim(),
    company: String(row?.company || row?.companyName || "").trim(),
    category: String(row?.category || "").trim(),
    item: String(row?.item || "").trim(),
    cycle: normalizeCycleValue(row?.cycle || ""),
    start: String(row?.start || "").trim(),
    end: String(row?.end || "").trim(),
    amount: String(row?.amount || "").trim(),
    pricePlan: String(row?.pricePlan || row?.stagedAmount || row?.stageAmount || "").trim(),
    deposit: String(row?.deposit || "").trim(),
    coNumber: String(row?.coNumber || "").trim(),
    signedAt: String(row?.signedAt || "").trim(),
    birthday: String(row?.birthday || row?.birthDate || "").trim(),
    address: String(row?.address || row?.add || "").trim(),
    phone: String(row?.phone || row?.tel || "").trim(),
    idNumber: String(row?.idNumber || row?.identityNumber || "").trim(),
    folder: row?.folder || fallbackFolder,
    venue,
    uid: row?.uid || `${venue}-${fallbackFolder}-${String(index + 1).padStart(3, "0")}-${row?.id || "no-id"}`,
  };
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
      years[year] = cloneRows(rows, venue);
    });
    if (!Object.keys(years).length) years[initialYear] = [];
    const sortedYears = Object.keys(years).sort((a, b) => Number(a) - Number(b));
    venues[venue] = {
      activeYear: years[venueData.activeYear] ? venueData.activeYear : sortedYears[0],
      years,
    };
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

  const active = venues[data.activeVenue] ? data.activeVenue : sourceData.activeVenue || Object.keys(venues)[0] || "taichung";
  return {
    activeVenue: venues[active] ? active : "taichung",
    sources: sourceConfig,
    venues,
  };
}

function loadCrmData() {
  try {
    const saved = normalizeCrmData(JSON.parse(localStorage.getItem(crmStorageKey)));
    if (saved) return saved;
  } catch {}
  return normalizeCrmData(getSourceData()) || makeFallbackData();
}

function loadContractDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(contractDraftStorageKey));
    return drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
  } catch {
    return {};
  }
}

function saveContractDrafts() {
  try {
    localStorage.setItem(contractDraftStorageKey, JSON.stringify(contractDrafts));
  } catch {}
}

function getVenueConfig(venue = activeVenue) {
  return crmData.sources[venue] || { label: venue, idMode: "number" };
}

function getVenueData(venue = activeVenue) {
  return crmData.venues[venue] || { activeYear: initialYear, years: { [initialYear]: [] } };
}

function getRows(venue = activeVenue, year = activeYear) {
  return getVenueData(venue).years[year] || [];
}

function getFolderRows(folder = activeFolder) {
  return getRows().filter((row) => (row.folder || "active") === folder);
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

const contractTypeLabels = {
  registration: "營業登記",
  office: "辦公室",
  seat: "共享座位",
};

const officeContractModeLabels = {
  new: "新約",
  renewal: "續約",
};

function allowedContractTypes(venue = activeVenue) {
  return venue === "huanrui" ? ["registration", "office"] : ["registration", "office", "seat"];
}

function normalizeContractType(type, venue = activeVenue) {
  const cleanType = String(type || "").trim();
  return allowedContractTypes(venue).includes(cleanType) ? cleanType : "registration";
}

function contractTypeLabel(type) {
  return contractTypeLabels[type] || contractTypeLabels.registration;
}

function contractType(row) {
  return normalizeContractType(row?.contractType || serviceType(row), row?.venue || activeVenue);
}

function officeContractModeLabel(mode) {
  return officeContractModeLabels[mode] || officeContractModeLabels.new;
}

function normalizeOfficeContractMode(mode) {
  return mode === "renewal" ? "renewal" : "new";
}

function supportsContractMode(row) {
  return ["registration", "office"].includes(contractType(row));
}

function sourceSystemOf(row) {
  return String(row?.sourceSystem || row?.source_system || row?.sourceSnapshot?.source_system || "").trim();
}

function defaultOfficeContractMode(row) {
  if (!supportsContractMode(row)) return "";
  if (row?.isBlank) return "new";
  return "renewal";
}

function contractDraftForRow(row, draft = contractDrafts[contractDraftKey(row)] || {}) {
  const cleanDraft = { ...draft };
  if (!row?.isBlank && supportsContractMode(row)) {
    cleanDraft.officeContractMode = "renewal";
  }
  return cleanDraft;
}

function shouldCollectDepositByValues(type, mode) {
  const normalizedType = normalizeContractType(type);
  return ["registration", "office"].includes(normalizedType) && normalizeOfficeContractMode(mode) === "new";
}

function shouldCollectDeposit(row) {
  return shouldCollectDepositByValues(contractType(row), defaultOfficeContractMode(row));
}

function serviceAllowed(service, venue = activeVenue) {
  return service === "all" || allowedContractTypes(venue).includes(service);
}

function getVisibleRows(folder = activeFolder) {
  const rows = getFolderRows(folder);
  if (activeService === "all") return rows;
  return rows.filter((row) => serviceType(row) === activeService);
}

function displayId(row) {
  return String(row?.id || "").trim() || "未編號";
}

function normalizeId(value) {
  return String(value || "").trim().toUpperCase();
}

function getVenueDefaults(venue = activeVenue) {
  if (venue === "huanrui") {
    return {
      lessor: "樞紐前沿股份有限公司",
      coNumber: "60710368",
      owner: "戴豪廷",
      address: "台中市西區台灣大道2段181號4F-1",
      court: "台中地方法院",
      bankName: "台北富邦銀行(國美分行)",
      bankCode: "012",
      bankAccount: "8212-0000-205049",
    };
  }
  return {
    lessor: "你的空間有限公司",
    coNumber: "83772050",
    owner: "戴豪廷",
    address: "台中市西區大忠南街55號7F-5",
    court: "台中地方法院",
    bankName: "永豐商業銀行(南台中分行)",
    bankCode: "807",
    bankAccount: "038018-001833-99",
  };
}

function contractValue(value, fallback = "待填") {
  const text = String(value || "").trim();
  return text || fallback;
}

function contractVersionLabel(version = blankVersion) {
  return version === "plain" ? "不用印版" : "用印版";
}

function safeContractFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function contractPrintTitle(row) {
  const venue = getVenueConfig(row?.venue || activeVenue).label || "未指定館別";
  const version = contractVersionLabel();
  const typeLabel = contractTypeLabel(contractType(row));
  const id = row?.isBlank ? "空白" : displayId(row);
  const target = row?.isBlank
    ? `${typeLabel}空白合約`
    : row?.company || row?.name || "未命名客戶";

  return safeContractFileName(`HJ ${venue} 客戶合約 ${version} - ${id} ${target}`);
}

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!amount) return "待確認";
  return amount.toLocaleString("zh-TW");
}

function monthlyAmount(row) {
  const amountText = String(row?.amount || "");
  const explicit = amountText.match(/\d[\d,]*/);
  return explicit ? Number(explicit[0].replaceAll(",", "")) : 0;
}

function monthsPerPayment(row) {
  const cycle = normalizeCycleValue(row?.cycle);
  if (cycle === "M") return 1;
  if (cycle === "3M") return 3;
  if (cycle === "6M") return 6;
  return 12;
}

function contractDurationMonths(row) {
  return contractDurationMonthsFromValues(row?.start, row?.end);
}

function contractTermCount(row) {
  const paymentMonths = monthsPerPayment(row);
  const duration = contractDurationMonths(row);
  if (duration && paymentMonths) return Math.max(1, Math.ceil(duration / paymentMonths));
  const cycle = normalizeCycleValue(row?.cycle);
  if (cycle === "2Y") return 2;
  if (cycle === "3Y") return 3;
  return 1;
}

function parseRocDate(value) {
  const text = String(value || "").trim();
  const complete = parseCompleteRocDate(text);
  if (complete) return complete;
  const parts = text.match(/(\d{2,3})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
  if (!parts) return null;
  return {
    year: parts[1],
    month: parts[2].padStart(2, "0"),
    day: (parts[3] || "01").padStart(2, "0"),
  };
}

function parseCompleteRocDate(value) {
  const text = String(value || "").trim();
  const buildDate = (year, month, day) => {
    if (!year || !month || !day) return null;
    const date = {
      year,
      month: month.padStart(2, "0"),
      day: day.padStart(2, "0"),
    };
    const monthNumber = Number(date.month);
    const dayNumber = Number(date.day);
    if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
    return date;
  };
  const compact = /^\d+$/.test(text) ? text : "";
  if (compact.length === 7) {
    return buildDate(compact.slice(0, 3), compact.slice(3, 5), compact.slice(5, 7));
  }
  if (compact.length === 6) {
    const firstThreeYear = Number(compact.slice(0, 3));
    if (firstThreeYear >= 100 && firstThreeYear <= 150) {
      return buildDate(compact.slice(0, 3), compact.slice(3, 4), compact.slice(4, 6));
    }
    return buildDate(compact.slice(0, 2), compact.slice(2, 4), compact.slice(4, 6));
  }
  if (compact.length === 5) return buildDate(compact.slice(0, 2), compact.slice(2, 3), compact.slice(3, 5));
  const parts = text.match(/^(\d{2,4})\D+(\d{1,4})(?:\D+(\d{1,2}))?\D*$/);
  if (!parts) return null;
  const compactMonthDay = !parts[3] && parts[2].length >= 3 ? parts[2].padStart(4, "0") : "";
  return buildDate(
    parts[1],
    compactMonthDay ? compactMonthDay.slice(0, -2) : parts[2],
    compactMonthDay ? compactMonthDay.slice(-2) : parts[3],
  );
}

function formatRocDate(value) {
  const date = parseRocDate(value);
  if (!date) return "待確認";
  return formatRocDateParts(date);
}

function formatRocDateOrEmpty(value) {
  const date = parseRocDate(value);
  return date ? formatRocDateParts(date) : "";
}

function formatRocDateParts(date) {
  return `${date.year}年${date.month}月${date.day}日`;
}

function isCompleteRocDateValue(value) {
  return Boolean(parseCompleteRocDate(value));
}

function contractDurationMonthsFromValues(startValue, endValue) {
  const start = parseRocDate(startValue);
  const end = parseRocDate(endValue);
  if (!start || !end) return 0;
  const startTotal = Number(start.year) * 12 + Number(start.month);
  const endTotal = Number(end.year) * 12 + Number(end.month);
  const duration = endTotal - startTotal;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function contractYearsFromValues(startValue, endValue) {
  const months = contractDurationMonthsFromValues(startValue, endValue);
  if (!months) return "";
  const years = months / 12;
  return Number.isInteger(years) ? String(years) : String(Number(years.toFixed(2)));
}

function numberFromText(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function addYearsToRocDate(value, yearsValue) {
  const date = parseRocDate(value);
  const years = numberFromText(yearsValue);
  if (!date || !years || !Number.isInteger(years)) return "";
  return formatRocDateParts({
    ...date,
    year: String(Number(date.year) + years),
  });
}

function addMonthsToRocDate(value, monthsToAdd) {
  const date = parseRocDate(value);
  const months = Number(monthsToAdd);
  if (!date || !Number.isFinite(months)) return null;
  const startMonthIndex = Number(date.year) * 12 + Number(date.month) - 1;
  const targetMonthIndex = startMonthIndex + months;
  return {
    year: String(Math.floor(targetMonthIndex / 12)),
    month: String((targetMonthIndex % 12) + 1).padStart(2, "0"),
    day: date.day,
  };
}

function formatRocSlashDate(date) {
  return `${date.year}/${date.month}/${date.day}`;
}

function dueDay(row) {
  return parseRocDate(row?.start)?.day || "";
}

function signedDate(row) {
  const signed = parseRocDate(row?.signedAt);
  if (signed) return `${signed.year}年${signed.month}月${signed.day}日`;
  const start = parseRocDate(row?.start);
  const signedText = String(row?.signedAt || "").trim();
  const monthDay = signedText.match(/(\d{1,2})\D+(\d{1,2})/);
  if (start && monthDay) return `${start.year}年${monthDay[1].padStart(2, "0")}月${monthDay[2].padStart(2, "0")}日`;
  return start ? `${start.year}年${start.month}月${start.day}日` : "";
}

function paymentTotal(row) {
  const rentTotal = monthlyAmount(row) * monthsPerPayment(row);
  if (shouldCollectDeposit(row)) {
    return rentTotal + Number(digitsOnly(row.deposit) || 0);
  }
  return rentTotal;
}

function contractServiceText(row) {
  const type = contractType(row);
  const item = String(row?.item || "").trim();
  if (type === "seat") return "共享座位";
  if (type === "office" && (!item || item === "辦公室")) return "辦公室";
  if (!item || item === "營登") return "營業登記";
  return item;
}

function checkStatus(value) {
  return String(value || "").trim() ? "ok" : "warn";
}

function renderCheck(label, value, hint = "") {
  const status = checkStatus(value);
  return `
    <article class="preflight-item ${status}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(contractValue(value))}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </article>
  `;
}

function contractDraftKey(row) {
  if (row?.isBlank) return `${row?.venue || activeVenue}:blank:${contractType(row)}`;
  return `${row?.venue || activeVenue}:${activeYear}:${displayId(row)}`;
}

function clearBlankContractDraft(venue = activeVenue, type = "") {
  const normalizedType = type ? normalizeContractType(type, venue) : "";
  Object.keys(contractDrafts).forEach((key) => {
    const prefix = `${venue}:blank:`;
    if (!key.startsWith(prefix)) return;
    if (normalizedType && key !== `${venue}:blank:${normalizedType}`) return;
    delete contractDrafts[key];
  });
  saveContractDrafts();
}

function contractSupportsLesseeDisplayControl(rowOrValues) {
  return !rowOrValues?.isBlank && !rowOrValues?.isBlankContract;
}

function lesseeDisplayFieldsFromDraft(row, draft = contractDrafts[contractDraftKey(row)] || {}) {
  if (!contractSupportsLesseeDisplayControl(row)) return lesseeContractDisplayFields.map((field) => field.key);
  if (!Object.prototype.hasOwnProperty.call(draft, "lesseeVisibleFields")) {
    return lesseeContractDisplayFields.map((field) => field.key);
  }
  if (!Array.isArray(draft.lesseeVisibleFields)) return lesseeContractDisplayFields.map((field) => field.key);
  const raw = draft.lesseeVisibleFields;
  const clean = raw.filter((key) => lesseeContractDisplayFieldKeys.has(key));
  return clean;
}

function lesseeDisplayFieldSet(values) {
  if (!contractSupportsLesseeDisplayControl(values)) {
    return new Set(lesseeContractDisplayFields.map((field) => field.key));
  }
  if (!Object.prototype.hasOwnProperty.call(values, "lesseeVisibleFields")) {
    return new Set(lesseeContractDisplayFields.map((field) => field.key));
  }
  if (!Array.isArray(values.lesseeVisibleFields)) {
    return new Set(lesseeContractDisplayFields.map((field) => field.key));
  }
  const raw = values.lesseeVisibleFields;
  const clean = raw.filter((key) => lesseeContractDisplayFieldKeys.has(key));
  return new Set(clean);
}

function isLesseeDisplayFieldVisible(values, key) {
  return lesseeDisplayFieldSet(values).has(key);
}

function contractBaseFields(row) {
  const venue = getVenueConfig(row.venue || activeVenue);
  const defaults = getVenueDefaults(row.venue || activeVenue);
  const type = contractType(row);
  const officeMode = defaultOfficeContractMode(row);
  const monthly = monthlyAmount(row);
  const total = paymentTotal(row);
  const periodMonths = row?.isBlank ? "" : monthsPerPayment(row);
  const termCount = row?.isBlank ? "" : contractTermCount(row);
  const contractYears = row?.isBlank ? "" : contractYearsFromValues(row.start, row.end);
  const fixedPrice = type === "registration" ? 3000 : monthly || "";
  const lesseeCompany = row.company || row.name;
  const lesseeName = row.name;
  const companyNumber = row.coNumber;
  const identityNumber = row.idNumber;
  const phone = row.phone;
  const lesseeAddress = row.address;
  const serviceText = contractServiceText(row);
  const version = contractVersionLabel();

  return {
    venue: venue.label,
    version,
    lessor: defaults.lessor,
    lessorCoNumber: defaults.coNumber,
    lessorOwner: defaults.owner,
    venueAddress: defaults.address,
    court: defaults.court,
    bankName: defaults.bankName,
    bankCode: defaults.bankCode,
    bankAccount: defaults.bankAccount,
    isBlankContract: Boolean(row?.isBlank),
    lesseeVisibleFields: lesseeDisplayFieldsFromDraft(row),
    contractType: type,
    contractTypeLabel: contractTypeLabel(type),
    officeContractMode: officeMode,
    officeContractModeLabel: officeContractModeLabel(officeMode),
    lesseeCompany: contractValue(lesseeCompany, ""),
    lesseeName: contractValue(lesseeName, ""),
    lesseeAddress: contractValue(lesseeAddress, ""),
    identityNumber: contractValue(identityNumber, ""),
    companyNumber: contractValue(companyNumber, ""),
    phone: contractValue(phone, ""),
    birthday: row?.isBlank ? "" : contractValue(formatRocDateOrEmpty(row.birthday), ""),
    serviceText,
    startDate: row?.isBlank ? "" : formatRocDateOrEmpty(row.start),
    endDate: row?.isBlank ? "" : formatRocDateOrEmpty(row.end),
    contractYears,
    fixedPrice: formatCurrency(fixedPrice),
    monthly: monthly ? formatCurrency(monthly) : "",
    periodMonths: String(periodMonths),
    termCount: String(termCount),
    dueDay: row?.isBlank ? "" : dueDay(row),
    deposit: contractValue(digitsOnly(row.deposit), ""),
    paymentTotal: total ? formatCurrency(total) : "",
    signedDate: row?.isBlank ? "" : signedDate(row),
  };
}

function contractFields(row) {
  const key = contractDraftKey(row);
  const values = contractValuesWithDerivedTotals({ ...contractBaseFields(row), ...contractDraftForRow(row, contractDrafts[key] || {}) });
  return [
    {
      title: "甲方與館別",
      accent: "teal",
      fields: [
        ["館別", "venue", values.venue, "Pages：範本館別 / 防呆"],
        ["合約版本", "version", values.version, "Pages：用印版 / 不用印版"],
        ["合約類型", "contractType", values.contractType, "內部：決定套用哪一份合約模板"],
        ["服務分類", "contractTypeLabel", values.contractTypeLabel, "內部：合約類型顯示名稱"],
        ["出租人", "lessor", values.lessor, "Pages：出租人"],
        ["出租人統編", "lessorCoNumber", values.lessorCoNumber, "Pages：出租人統一編號"],
        ["負責人", "lessorOwner", values.lessorOwner, "Pages：甲方負責人"],
        ["所在地及使用範圍", "venueAddress", values.venueAddress, "Pages：第一條"],
      ],
    },
    {
      title: "乙方資料",
      accent: "purple",
      fields: [
        ["承租人公司名稱", "lesseeCompany", values.lesseeCompany, "合約位置：立契約人乙方"],
        ["負責人", "lesseeName", values.lesseeName, "合約位置：乙方簽約資料"],
        ["地址", "lesseeAddress", values.lesseeAddress, "合約位置：乙方簽約資料"],
        ["身分證統一編號", "identityNumber", values.identityNumber, "合約位置：乙方簽約資料"],
        ["公司統一編號", "companyNumber", values.companyNumber, "合約位置：乙方簽約資料"],
        ["聯絡電話", "phone", values.phone, "合約位置：乙方簽約資料"],
        ["出生", "birthday", values.birthday, "合約位置：乙方簽約資料"],
      ],
    },
    {
      title: "租期與金額",
      accent: "orange",
      fields: [
        ["服務項目", "serviceText", values.serviceText, "合約位置：契約開頭事件說明"],
        ["合約年數", "contractYears", values.contractYears, "防呆：起始日 + 年數自動算到期日"],
        ["合約起始日", "startDate", values.startDate, "合約位置：第二條"],
        ["合約到期日", "endDate", values.endDate, "合約位置：第二條"],
        ["定價每月", "fixedPrice", values.fixedPrice, "Pages：第三條"],
        ["折扣後月租", "monthly", values.monthly, "合約位置：第三條"],
        ["每期繳費月數", "periodMonths", values.periodMonths, "合約位置：第三條"],
        ["總期數", "termCount", values.termCount, "合約位置：第三條"],
        ["每期繳費日前", "dueDay", values.dueDay, "合約位置：第三條第二項"],
        ["押金", "deposit", values.deposit, "合約位置：第九條"],
        ["本期匯款金額", "paymentTotal", values.paymentTotal, "Pages：匯款區"],
        ["簽約日期", "signedDate", values.signedDate, "合約位置：頁尾日期"],
        ["管轄法院", "court", values.court, "Pages：第十一條"],
      ],
    },
    {
      title: "匯款帳戶",
      accent: "blue",
      fields: [
        ["帳戶名稱", "lessor", values.lessor, "Pages：匯款帳戶"],
        ["銀行名稱", "bankName", values.bankName, "Pages：銀行名稱"],
        ["行庫代號", "bankCode", values.bankCode, "Pages：行庫代號"],
        ["帳號", "bankAccount", values.bankAccount, "Pages：帳號"],
      ],
    },
  ];
}

function hasContractDraft(row) {
  const key = contractDraftKey(row);
  return Boolean(contractDrafts[key] && Object.keys(contractDrafts[key]).length);
}

function contractFlatValues(row) {
  const key = contractDraftKey(row);
  return contractValuesWithDerivedTotals({ ...contractBaseFields(row), ...contractDraftForRow(row, contractDrafts[key] || {}) });
}

function plainMoney(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function calculatedPaymentTotalFromDraft(row, draft = {}) {
  return calculatedPaymentTotalFromValues({ ...contractBaseFields(row), ...contractDraftForRow(row, draft) });
}

function calculatedPaymentTotalFromValues(values) {
  const monthly = Number(plainMoney(values.monthly));
  const periodMonths = Number(String(values.periodMonths || "").replace(/[^\d]/g, ""));
  const deposit = Number(plainMoney(values.deposit));
  if (!monthly || !periodMonths) return "";
  const baseTotal = monthly * periodMonths;
  const total = shouldCollectDepositByValues(values.contractType, values.officeContractMode) ? baseTotal + deposit : baseTotal;
  return formatCurrency(total);
}

function contractValuesWithDerivedTotals(values) {
  values.officeContractMode = normalizeOfficeContractMode(values.officeContractMode);
  if (!values.isBlankContract && ["registration", "office"].includes(normalizeContractType(values.contractType))) {
    values.officeContractMode = "renewal";
  }
  values.officeContractModeLabel = officeContractModeLabel(values.officeContractMode);
  const autoTotal = calculatedPaymentTotalFromValues(values);
  if (autoTotal) values.paymentTotal = autoTotal;
  return values;
}

function calculatedTermCountFromDraft(row, draft = {}) {
  const base = contractBaseFields(row);
  const cleanDraft = contractDraftForRow(row, draft);
  const startDate = draftValueOrBase(cleanDraft.startDate, base.startDate);
  const endDate = draftValueOrBase(cleanDraft.endDate, base.endDate);
  const periodMonths = numberFromText(draftValueOrBase(cleanDraft.periodMonths, base.periodMonths));
  const duration = contractDurationMonthsFromValues(startDate, endDate);
  if (!duration || !periodMonths) return "";
  return String(Math.max(1, Math.ceil(duration / periodMonths)));
}

function calculatedEndDateFromDraft(row, draft = {}) {
  const base = contractBaseFields(row);
  const cleanDraft = contractDraftForRow(row, draft);
  return addYearsToRocDate(
    draftValueOrBase(cleanDraft.startDate, base.startDate),
    draftValueOrBase(cleanDraft.contractYears, base.contractYears),
  );
}

function draftValueOrBase(value, baseValue = "") {
  return String(value ?? "").trim() ? value : baseValue;
}

function normalizedContractInputValue(fieldKey, value) {
  if (["contractYears", "periodMonths", "termCount"].includes(fieldKey)) {
    const number = numberFromText(value);
    return number ? String(number) : value;
  }
  if (["startDate", "endDate", "signedDate"].includes(fieldKey)) {
    const date = parseCompleteRocDate(value);
    return date ? formatRocDateParts(date) : value;
  }
  return value;
}

function paymentMoneyText(value) {
  const amount = Number(plainMoney(value));
  return amount ? formatCurrency(amount) : escapeHtml(value);
}

function inlineMoneyText(value) {
  return escapeHtml(paymentMoneyText(value));
}

function contractPaymentTotalValue(values) {
  const explicitTotal = plainMoney(values.paymentTotal);
  if (explicitTotal) return explicitTotal;
  const monthly = Number(plainMoney(values.monthly));
  const periodMonths = Number(String(values.periodMonths || "").replace(/[^\d]/g, ""));
  const deposit = Number(plainMoney(values.deposit));
  if (!monthly || !periodMonths) return "";
  const rentTotal = monthly * periodMonths;
  return shouldCollectDepositByValues(values.contractType, values.officeContractMode) ? String(rentTotal + deposit) : String(rentTotal);
}

function paymentScheduleDates(values) {
  const periodMonths = numberFromText(values.periodMonths);
  const termCount = numberFromText(values.termCount);
  if (!periodMonths || termCount <= 1) return [];
  return Array.from({ length: termCount }, (_, index) => addMonthsToRocDate(values.startDate, periodMonths * index))
    .filter(Boolean)
    .map(formatRocSlashDate);
}

function renderPaymentScheduleNotice(values, total) {
  const periodMonths = numberFromText(values.periodMonths);
  const termCount = numberFromText(values.termCount);
  if (!periodMonths || termCount <= 1 || !total) return "";
  const dates = paymentScheduleDates(values);
  const dateText = dates.length && dates.length <= 6
    ? `繳款時間為 ${escapeHtml(dates.join("、"))} 前。`
    : `後續每期請依合約起始日每 ${escapeHtml(periodMonths)} 個月繳納一次。`;
  return `<p class="payment-schedule-notice"><span>繳款期數提醒：本合約共 ${escapeHtml(termCount)} 期，每 ${escapeHtml(periodMonths)} 個月為一期，每期匯款金額 ${escapeHtml(paymentMoneyText(total))} 元；</span><span>${dateText}</span></p>`;
}

function overlayText(value, fallback = "") {
  return escapeHtml(contractValue(value, fallback));
}

function previewSpan(key, value, fallback = "") {
  return `<span data-preview-key="${escapeHtml(key)}">${overlayText(value, fallback)}</span>`;
}

function renderLesseeContractLines(values) {
  const visible = lesseeDisplayFieldSet(values);
  return lesseeContractDisplayFields
    .filter((field) => visible.has(field.key))
    .map(
      (field) => `
        <p>${escapeHtml(field.outputLabel)}：${previewSpan(field.key, values[field.key])}</p>
      `
    )
    .join("");
}

function renderLesseeContractBlock(values) {
  const lines = renderLesseeContractLines(values);
  return lines ? `<section class="lessee-block">${lines}</section>` : "";
}

function officialStampAsset(values) {
  const venueCode = String(values.venue || "").includes("環瑞") ? "huanrui" : "taichung";
  const asset = window.HJ_STAMP_ASSETS?.[venueCode];
  if (!asset?.src) return null;
  return {
    src: asset.src,
    width: Number(asset.width) || (venueCode === "huanrui" ? 518 : 402),
    height: Number(asset.height) || (venueCode === "huanrui" ? 388 : 244),
    className: asset.className || `${venueCode}-stamp`,
  };
}

function renderOfficialStamp(values) {
  const asset = officialStampAsset(values);
  if (!asset) {
    return `
      <div class="official-stamp-area stamp-missing" aria-label="正式大小章未提供">
        <span>尚未提供正式大小章，請勿輸出用印版</span>
      </div>
    `;
  }
  return `
    <div class="official-stamp-area ${escapeHtml(asset.className)}" aria-label="正式大小章">
      <img src="${escapeHtml(asset.src)}" width="${asset.width}" height="${asset.height}" alt="正式大小章" />
    </div>
  `;
}

function renderFillBox({ key, value, x, y, w, h, size = "normal", align = "left" }) {
  return `
    <span
      class="contract-fill-value ${escapeHtml(size)} ${escapeHtml(align)}"
      data-fill-key="${escapeHtml(key)}"
      style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"
    >${overlayText(value)}</span>
  `;
}

function renderContractOverlayPage(page, values) {
  const startDate = values.startDate;
  const endDate = values.endDate;
  const monthly = plainMoney(values.monthly);
  const deposit = plainMoney(values.deposit);
  const pageOneFields = [
    { key: "lesseeCompany", value: values.lesseeCompany, x: 16.5, y: 22.25, w: 26.0, h: 1.55 },
    { key: "startDate", value: startDate, x: 25.1, y: 27.35, w: 17.5, h: 1.65 },
    { key: "endDate", value: endDate, x: 44.0, y: 27.35, w: 17.5, h: 1.65 },
    { key: "monthly", value: monthly, x: 47.8, y: 31.18, w: 6.6, h: 1.55, align: "center" },
    { key: "periodMonths", value: values.periodMonths, x: 62.7, y: 31.18, w: 3.6, h: 1.55, align: "center" },
    { key: "termCount", value: values.termCount, x: 70.4, y: 31.18, w: 2.7, h: 1.55, align: "center" },
    { key: "dueDay", value: values.dueDay, x: 20.4, y: 34.15, w: 4.1, h: 1.55, align: "center" },
    { key: "deposit", value: deposit, x: 39.8, y: 94.1, w: 6.8, h: 1.7, align: "center" },
  ];
  const pageTwoFields = [
    ...[
      { key: "lesseeCompany", value: values.lesseeCompany, x: 24.0, w: 30.0, h: 2.0 },
      { key: "lesseeName", value: values.lesseeName, x: 15.0, w: 22.0, h: 2.0 },
      { key: "lesseeAddress", value: values.lesseeAddress, x: 14.0, w: 58.0, h: 2.0, size: "small" },
      { key: "identityNumber", value: values.identityNumber, x: 24.0, w: 22.0, h: 2.0 },
      { key: "birthday", value: values.birthday, x: 13.8, w: 22.0, h: 2.0 },
      { key: "companyNumber", value: values.companyNumber, x: 24.0, w: 20.0, h: 2.0 },
      { key: "phone", value: values.phone, x: 15.4, w: 22.0, h: 2.0 },
    ]
      .filter((field) => isLesseeDisplayFieldVisible(values, field.key))
      .map((field, index) => ({ ...field, y: 64.4 + index * 3.85 })),
    { key: "signedDate", value: values.signedDate, x: 70.5, y: 90.4, w: 18.0, h: 2.0, align: "center" },
  ];
  const fields = page === 1 ? pageOneFields : pageTwoFields;

  return `
    <div class="contract-page-preview">
      <div class="contract-template-missing">公開部署版不包含用印合約底圖</div>
      <div class="contract-fill-layer" aria-label="套入欄位測試預覽">
        ${fields.map((field) => renderFillBox(field)).join("")}
      </div>
    </div>
  `;
}

function renderContractField(label, key, value, mapping) {
  const missing = !String(value || "").trim();
  const humanCheckFields = new Set([
    "contractYears",
    "startDate",
    "endDate",
    "monthly",
    "periodMonths",
    "termCount",
    "dueDay",
    "deposit",
    "paymentTotal",
    "signedDate",
  ]);
  const longTextFields = new Set(["lesseeAddress"]);
  const fieldClass = humanCheckFields.has(key) ? " is-human-check" : "";
  const longFieldClass = longTextFields.has(key) ? " is-long-field" : "";
  const inputHtml = contractEditing
    ? longTextFields.has(key)
      ? `<textarea data-contract-field="${escapeHtml(key)}" placeholder="待填">${escapeHtml(value)}</textarea>`
      : `<input data-contract-field="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="待填" />`
    : `<div class="contract-field-value ${missing ? "is-missing" : ""}">${escapeHtml(contractValue(value))}</div>`;
  return `
    <div class="contract-field-row${fieldClass}${longFieldClass}">
      <div class="contract-field-label">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(mapping)}</small>
      </div>
      ${inputHtml}
    </div>
  `;
}

function contractVisibleFieldGroups(fields, values = {}) {
  const visibleKeys = new Set([
    "lesseeCompany",
    "lesseeName",
    "lesseeAddress",
    "identityNumber",
    "companyNumber",
    "phone",
    "birthday",
    "serviceText",
    "startDate",
    "endDate",
    "contractYears",
    "monthly",
    "periodMonths",
    "termCount",
    "dueDay",
    "deposit",
    "paymentTotal",
    "signedDate",
  ]);
  const visibleLesseeFields = lesseeDisplayFieldSet(values);

  return fields
    .map((group) => ({
      ...group,
      fields: group.fields.filter(([, key]) => {
        if (!visibleKeys.has(key)) return false;
        if (lesseeContractDisplayFieldKeys.has(key)) return visibleLesseeFields.has(key);
        return true;
      }),
    }))
    .filter((group) => group.fields.length);
}

function renderLesseeDisplayControls(row, values) {
  if (!contractEditing || !contractSupportsLesseeDisplayControl(row)) return "";
  const visible = lesseeDisplayFieldSet(values);
  return `
    <section class="lessee-display-controls" aria-label="承租人資料顯示控制">
      <div>
        <strong>承租人資料顯示</strong>
        <span>只影響續約合約輸出；取消後整行移除，不留空白。</span>
      </div>
      <div class="lessee-display-options">
        ${lesseeContractDisplayFields
          .map(
            (field) => `
              <label>
                <input
                  type="checkbox"
                  data-lessee-display-field="${escapeHtml(field.key)}"
                  ${visible.has(field.key) ? "checked" : ""}
                />
                <span>${escapeHtml(field.label)}</span>
              </label>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderBlankContractTypeSwitch(row) {
  if (!row?.isBlank) return "";
  const type = contractType(row);
  return `
    <div class="blank-contract-type-switch" aria-label="空白合約類型">
      ${allowedContractTypes(activeVenue)
        .map(
          (item) => `
            <button type="button" data-blank-contract-type="${escapeHtml(item)}" class="${item === type ? "active" : ""}">
              ${escapeHtml(contractTypeLabel(item))}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function stackedLabel(top, bottom) {
  return `<span class="stacked-label"><span>${escapeHtml(top)}</span><span>${escapeHtml(bottom)}</span></span>`;
}

function draftNoticeLabel(row) {
  return hasContractDraft(row) ? stackedLabel("已有", "暫存") : stackedLabel("尚未", "暫存");
}

function fieldStatusLabel(missingCount) {
  return missingCount ? stackedLabel(`缺 ${missingCount}`, "欄") : stackedLabel("欄位", "完整");
}

function renderContractMapping(row) {
  const fields = contractFields(row);
  const values = contractFlatValues(row);
  const visibleFields = contractVisibleFieldGroups(fields, values);
  const missingCount = visibleFields.flatMap((group) => group.fields).filter(([, , value]) => !String(value || "").trim()).length;
  const titleText = row.isBlank ? `${getVenueConfig(row.venue || activeVenue).label} 空白${contractTypeLabel(contractType(row))}合約` : `${displayId(row)} ${row.company || row.name || "未命名"}`;

  return `
    <section class="contract-mapping-page${contractEditing ? " is-editing" : ""}">
      <div class="contract-mapping-head">
        <div>
          <div class="contract-mapping-title-line">
            <span>合約檢查</span>
            ${contractEditing ? `<strong class="contract-edit-state">編輯中</strong>` : ""}
          </div>
          <h3>${escapeHtml(titleText)}</h3>
        </div>
        <div class="contract-mapping-actions">
          <span class="contract-warning compact neutral">${draftNoticeLabel(row)}</span>
          <span class="contract-warning compact ${missingCount ? "warn" : "ok"}">${fieldStatusLabel(missingCount)}</span>
          ${hasContractDraft(row) ? `<button class="ghost compact" type="button" data-contract-draft-reset>${stackedLabel("清除", "暫存")}</button>` : ""}
          <button class="compact ${contractEditing ? "is-editing" : ""}" type="button" data-contract-edit-toggle>${contractEditing ? stackedLabel("完成", "修改") : stackedLabel("修改", "欄位")}</button>
          <button class="compact" type="button" data-contract-preview-open>${stackedLabel("合約", "預覽")}</button>
          <button type="button" data-contract-print>存成 PDF</button>
        </div>
      </div>
      ${renderBlankContractTypeSwitch(row)}
      ${renderLesseeDisplayControls(row, values)}
      <div class="contract-field-groups">
        ${visibleFields
          .map(
            (group) => `
              <section class="contract-field-group ${escapeHtml(group.accent)}">
                <h4>${escapeHtml(group.title)}</h4>
                ${group.fields.map(([label, key, value, mapping]) => renderContractField(label, key, value, mapping)).join("")}
              </section>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function contractBookHtml(row) {
  const values = contractFlatValues(row);
  const type = normalizeContractType(values.contractType || contractType(row), row?.venue || activeVenue);
  if (type === "office") return renderOfficeContractDraft(values);
  if (type === "seat") return renderSeatContractDraft(values);
  return renderRegistrationContractDraft(values);
}

function contractBookNode(row) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = contractBookHtml(row).trim();
  return wrapper.firstElementChild;
}

function closeContractPreviewModal() {
  document.querySelector(".contract-preview-modal")?.remove();
  document.body.classList.remove("has-contract-preview-modal");
}

function openContractPreviewModal() {
  closeContractPreviewModal();
  const row = currentContractRow();
  if (!row) return;
  const modal = document.createElement("div");
  modal.className = "contract-preview-modal";
  modal.innerHTML = `
    <div class="contract-preview-dialog" role="dialog" aria-modal="true" aria-label="合約預覽">
      <div class="contract-preview-head">
        <div>
          <span>${escapeHtml(contractVersionLabel())}</span>
          <strong>${escapeHtml(displayId(row))} ${escapeHtml(row.company || row.name || "未命名")}</strong>
        </div>
        <div class="contract-preview-actions">
          <button type="button" data-contract-print>存成 PDF</button>
          <button type="button" data-contract-preview-close>關閉</button>
        </div>
      </div>
      <div class="contract-preview-body"></div>
    </div>
  `;
  modal.querySelector(".contract-preview-body").appendChild(contractBookNode(row));
  document.body.appendChild(modal);
  document.body.classList.add("has-contract-preview-modal");
}

function contractLogoSrc() {
  return window.HOUR_JUNGLE_LOGO_DATA || "./assets/hour-jungle-logo.png";
}

function renderContractLogo(extraClass = "") {
  const className = `html-contract-logo${extraClass ? ` ${extraClass}` : ""}`;
  return `
    <header class="${escapeHtml(className)}">
      <img src="${escapeHtml(contractLogoSrc())}" alt="HOUR JUNGLE" />
    </header>
  `;
}

function renderRegistrationContractDraft(values) {
  const monthly = plainMoney(values.monthly);
  const deposit = plainMoney(values.deposit);
  const monthlyText = inlineMoneyText(monthly);
  const depositText = inlineMoneyText(deposit);
  const total = contractPaymentTotalValue(values);
  const totalText = paymentMoneyText(total);
  const isRenewal = normalizeOfficeContractMode(values.officeContractMode) === "renewal";
  const depositLine = isRenewal
    ? `<p class="indent-1">三、乙方前已交付履約保證金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元，於本續約期間續作為本契約義務之擔保，本次續約無須另行給付履約保證金。</p>`
    : `<p class="indent-1">三、履約保證金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元，租賃期滿並遷出營業登記後無息返還</p>`;
  const depositArticle = isRenewal
    ? `<p>乙方前已交付履約保證金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元整，於本續約期間續作為乙方履行本契約義務之擔保，乙方本次續約無須另行給付履約保證金。</p>`
    : `<p>乙方應於本租約履行時同時給付甲方新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元整之保證金，以作為其履行本契約義務之擔保。</p>`;
  const depositContinuation = isRenewal
    ? `<p>租賃終止或屆滿並完成營業登記遷出、費用結清後，由甲方無息返還。乙方不得主張以履約保證金抵充租金之用。</p>`
    : `<p>金於乙方在租約終止或屆滿前遷移5日內向主管機關辦理將其登記地址遷離甲方標的或解散（所有以該地址營業登記均遷移，且不含歇業）後交還房屋並扣除其所積欠之租金等費用及債務後，由甲方無息返還之。就押租金乙方不得主張抵充租金之用。</p>`;
  const versionClass = /不用印版/.test(String(values.version || "")) ? "plain-version" : "stamp-version";
  const modeClass = isRenewal ? "renewal-contract" : "new-contract";
  const blankClass = values.isBlankContract ? "blank-template-contract" : "";
  return `
    <div class="html-contract-book registration-contract ${modeClass} ${versionClass} ${blankClass}">
      <article class="html-contract-page registration-page-one">
        ${renderContractLogo()}
        <h2>共同工作室租賃契約</h2>
        <p>立契約人</p>
        <p>出租人：${previewSpan("lessor", values.lessor)}（以下簡稱甲方），</p>
        <p>承租人：${previewSpan("lesseeCompany", values.lesseeCompany)}（以下簡稱乙方）</p>
        <p>因工作室營業登記事件，訂立本契約，雙方同意之條件如左：</p>
        <p class="contract-section registration-major-section">第一條：所在地及使用範圍：${previewSpan("venueAddress", values.venueAddress)}</p>

        <p class="contract-section registration-major-section">第二條：租賃期限：自 <span class="contract-fill-inline fill-date" data-preview-key="startDate">${escapeHtml(values.startDate)}</span> 起，至 <span class="contract-fill-inline fill-date" data-preview-key="endDate">${escapeHtml(values.endDate)}</span> 止。</p>

        <p class="contract-section registration-major-section">第三條：租金：</p>
        <p class="indent-1 registration-rent-line">一、定價每月 <span class="contract-static-money">3,000</span> 元；折扣後每月租金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="monthly">${monthlyText}</span> 元。（每 <span class="contract-token-inline" data-preview-key="periodMonths">${escapeHtml(values.periodMonths)}</span> 個月為一期，共 <span class="contract-token-inline" data-preview-key="termCount">${escapeHtml(values.termCount)}</span> 期，匯款手續費由乙方自行負責）</p>
        <p class="indent-1">二、租金於每期 <span class="contract-token-inline" data-preview-key="dueDay">${escapeHtml(values.dueDay)}</span> 前繳納</p>
        ${depositLine}

        <p class="contract-section registration-major-section">第四條：使用租物之限制：</p>
        <p class="indent-1">一、乙方不得將使用權限之全部或一部分轉租、出租、頂讓，或以其他變相方法使用工作室。</p>
        <p class="indent-1">二、每一承租戶僅能申請一家公司執照。</p>
        <p class="indent-1">三、乙方於租賃期滿應立即將工作空間遷讓交還，不得向甲方請求遷移費或任何費用。</p>
        <p class="indent-1">四、工作室不得供非法使用，或經營非法之行業，或存放危險物品影響公共安全，若發現之，甲方有全權無條件終止合約，已支付租金不退還。</p>
        <p class="indent-1">五、工作空間若有改裝設施之必要，乙方得甲方同意後得自行裝設，但不得損害原有建築，乙方於交還房屋時並應負責回復原狀。</p>
        <p class="indent-1">六、乙方若欲退租或轉約，需於一個月前通知甲方，自乙方通知日後起算一個月為甲乙雙方合約終止日。</p>

        <p class="contract-section">第五條：危險負擔：乙方應以善良管理人之注意使用房屋，除因天災地變等不可抗拒之情形外，因乙方之過失致房屋毀損，應負損害賠償之責。</p>

        <p class="contract-section">第六條：違約處罰：</p>
        <p class="indent-1">一、乙方違反約定方法使用工作室，或拖欠房租，超過七日甲方得終止租約，押金不得抵算租金。</p>
        <p class="indent-1">二、乙方於終止租約或租賃期滿不交還工作室，自終止租約或租賃期滿之翌日起，乙方應支付案房租五倍計算之違約金，所遺留設備不搬者，視同乙方同意交由甲方處理。</p>

        <p class="contract-section registration-major-section">第七條：其他特約事項：</p>
        <p class="indent-1">一、乙方除水電費（含公共電費）、管理費、網路費外，營業上必須繳納之稅捐需自行負擔。</p>
        <p class="indent-1">二、乙方以甲方地址申請公司執照者，於合約終止時，需將公司登記遷出，甲方並依稅務等單位要求每月呈報遷出名單公文，否則甲方得將通報乙方營業登記遷出。</p>
        <p class="indent-1">三、甲乙雙方僅有契約履行之責，乙方如與其他人有債務糾紛與法律責任，由乙方自行負責與甲方無關。</p>
        <p class="indent-1">四、乙方如有寄放任何物品於甲方之處，甲方不負任何保管及法律責任，其責任問題均由乙方負全責。但若營業登記事項因甲方因素未能核准則雙方無條件解約退回押金及已繳納租金，並且不得收受任何違約金。</p>
        <p class="indent-1">五、本契約租賃期限未滿，乙方擬解約時，以一個月租金（以原價 <span class="contract-static-money">3,000</span> 元計，且當月份已付租金除外）作為違約金。</p>
        <p class="indent-1">六、租金應於約定日前繳納，不得任何理由拖延或拒絕，若遲繳每日得向承租人收取總額3%滯納金。</p>
        <p class="indent-1">七、甲方為使租賃標的物出租順利，並減輕乙方之租金負擔，特提供乙方之租賃優惠選擇方案，若乙方違反合約限制或提前辦理退租，乙方無條件同意甲方將當初協議之優惠款項從押金中扣除。以原價 <span class="contract-static-money">3,000</span> 元/月計算。</p>

        <footer>第1頁（共2頁）</footer>
      </article>

      <article class="html-contract-page">
        ${renderContractLogo("second")}
        ${renderOfficialStamp(values)}
        <p class="contract-section">第八條：應受強制執行之事項：</p>
        <p class="indent-1">一、租約到期或欠繳房租或終止租約生效時。</p>
        <p class="indent-1">二、乙方如有違反稅法、稅捐稽徵法、社秩法及虛設行號等不法之事，並影響甲方權益，甲方得立即中止甲乙雙方租約，並應官方要求通報相關單位。甲乙方若無任何違法情事或虛設行號、虛開發票等行為，而無法設籍此地，乙方得終止租約，不以違約論。</p>

        <p class="contract-section">第九條：保證金：</p>
        ${depositArticle}
        ${depositContinuation}

        <p class="contract-section">第十條：連帶保證金</p>
        <p class="indent-1">乙方之負責人就本契約之相關責任（含營登租金及違約金）負連帶保證責任。</p>

        <p class="contract-section">第十一條：雙方確認事項</p>
        <p class="indent-1">甲乙雙方同意，因本契約事項所生之一切爭議，雙方同意以台中地方法院為第一審管轄法院</p>

        <section class="signature-block">
          <div>
            <p>出租人：${previewSpan("lessor", values.lessor)}</p>
            <p>統一編號：${previewSpan("lessorCoNumber", values.lessorCoNumber)}</p>
            <p>負責人：${previewSpan("lessorOwner", values.lessorOwner)}</p>
            <p class="bank-lines">匯款帳號：<br>帳戶名稱：${previewSpan("lessor", values.lessor)}<br>銀行名稱：${previewSpan("bankName", values.bankName)}<br>行庫代號：${previewSpan("bankCode", values.bankCode)}<br>帳號：${previewSpan("bankAccount", values.bankAccount)}</p>
            <p class="payment-total-line">本期匯款金額：<span data-preview-key="paymentTotal">${escapeHtml(totalText)}</span> 元</p>
            ${renderPaymentScheduleNotice(values, total)}
          </div>
        </section>

        ${renderLesseeContractBlock(values)}

        <p class="contract-date">${previewSpan("signedDate", values.signedDate)}</p>
        <footer>第2頁（共2頁）</footer>
      </article>
    </div>
  `;
}

function hasDepositAmount(values) {
  return Number(plainMoney(values.deposit)) > 0;
}

function renderWorkplaceDepositLine(values, type) {
  const deposit = plainMoney(values.deposit);
  const depositText = inlineMoneyText(deposit);
  const officeMode = normalizeOfficeContractMode(values.officeContractMode);
  if (type === "office" && officeMode === "renewal") {
    if (deposit) {
      return `<p class="indent-1">三、乙方前已交付履約保證金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元，於本續約期間續作為本契約義務之擔保，本次續約無須另行給付履約保證金。</p>`;
    }
    return `<p class="indent-1">三、乙方前已交付之履約保證金，於本續約期間續作為本契約義務之擔保，本次續約無須另行給付履約保證金。</p>`;
  }
  if (hasDepositAmount(values)) {
    return `<p class="indent-1">三、履約保證金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元，租賃期滿並完成點交後無息返還。</p>`;
  }
  if (type === "seat") return `<p class="indent-1">三、本共享座位服務免收押金。</p>`;
  return `<p class="indent-1">三、履約保證金依雙方約定辦理，未收押金者免填。</p>`;
}

function renderWorkplaceDepositArticle(values, type) {
  const deposit = plainMoney(values.deposit);
  const depositText = inlineMoneyText(deposit);
  const officeMode = normalizeOfficeContractMode(values.officeContractMode);
  if (type === "office" && officeMode === "renewal") {
    if (deposit) {
      return `
        <p class="contract-section">第九條：保證金：</p>
        <p>乙方前已交付履約保證金新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元整，於本續約期間續作為乙方履行本契約義務之擔保，乙方本次續約無須另行給付履約保證金。租賃終止或屆滿並完成點交、費用結清後，由甲方無息返還。</p>
      `;
    }
    return `
      <p class="contract-section">第九條：保證金：</p>
      <p>乙方前已交付之履約保證金，於本續約期間續作為乙方履行本契約義務之擔保，乙方本次續約無須另行給付履約保證金。租賃終止或屆滿並完成點交、費用結清後，由甲方無息返還。</p>
    `;
  }
  if (hasDepositAmount(values)) {
    return `
      <p class="contract-section">第九條：保證金：</p>
      <p>乙方應於本租約履行時同時給付甲方新台幣 <span class="contract-fill-inline fill-money" data-preview-key="deposit">${depositText}</span> 元整之保證金，以作為其履行本契約義務之擔保。租賃終止或屆滿並完成點交後，扣除積欠租金、費用或損害賠償後，由甲方無息返還之。</p>
    `;
  }
  if (type === "seat") {
    return `
      <p class="contract-section">第九條：保證金：</p>
      <p>本共享座位服務免收押金，乙方仍應依約繳納當期費用並妥善使用場域設備。</p>
    `;
  }
  return `
    <p class="contract-section">第九條：保證金：</p>
    <p>保證金如經雙方另行約定，應以本合約欄位或補充約定記載之金額為準。</p>
  `;
}

function renderWorkplaceContractDraft(values, type) {
  const monthly = plainMoney(values.monthly);
  const monthlyText = inlineMoneyText(monthly);
  const originalRent = plainMoney(values.fixedPrice) || monthly;
  const originalRentText = inlineMoneyText(originalRent);
  const total = contractPaymentTotalValue(values);
  const totalText = paymentMoneyText(total);
  const versionClass = /不用印版/.test(String(values.version || "")) ? "plain-version" : "stamp-version";
  const isSeat = type === "seat";
  const officeMode = normalizeOfficeContractMode(values.officeContractMode);
  const modeClass = officeMode === "renewal" ? "renewal-contract" : "new-contract";
  const title = isSeat ? "共享座位使用契約" : officeMode === "renewal" ? "共同工作室租賃契約" : "辦公室租賃契約";
  const eventText = isSeat ? "共享座位使用事件" : "辦公室租賃事件";
  const subjectText = isSeat ? "共享座位及公共區域" : "辦公室及公共區域";
  const priceLabel = isSeat ? "每月使用費" : "每月租金";
  const durationClause = isSeat
    ? `<p class="contract-section">第二條：租賃期限：自 <span class="contract-fill-inline fill-date" data-preview-key="startDate">${escapeHtml(values.startDate)}</span> 起，如雙方無異議則自動續約一個月。</p>`
    : `<p class="contract-section office-major-section">第二條：租賃期限：自 <span class="contract-fill-inline fill-date" data-preview-key="startDate">${escapeHtml(values.startDate)}</span> 起，至 <span class="contract-fill-inline fill-date" data-preview-key="endDate">${escapeHtml(values.endDate)}</span> 止。</p>`;
  const useLimitClauses = isSeat
    ? [
        "乙方使用範圍限共享座位及甲方開放之公共區域，不得占用固定座位、會議室或其他未約定空間。",
        "乙方不得將使用權限之全部或一部分轉租、轉讓、出借或以其他變相方法提供第三人使用。",
        "乙方應維持場域整潔，不得存放危險物品、違禁品或影響公共安全及其他使用者權益之物品。",
        "本服務採月繳制，乙方如次月不續用，應於當期使用期限屆滿前通知甲方；停止繳費後即暫停使用權限。",
        "乙方如需使用會議室、收信、登記地址或其他加值服務，應另行向甲方申請並依甲方報價或規範辦理。",
      ]
    : [
        "乙方不得將使用權限之全部或一部分轉租、出租、頂讓，或以其他變相方法使用辦公室。",
        "乙方應依約定用途使用辦公室及公共區域，不得供非法使用或經營非法行業。",
        "乙方不得存放危險物品或影響公共安全之物品；若造成損害，乙方應負損害賠償責任。",
        "辦公室若有改裝、增設設備或調整格局之必要，須事前取得甲方書面同意，且不得損害原有建築及設備。",
        "乙方若欲退租、轉約或停止使用，需於一個月前通知甲方，自通知日後起算一個月為甲乙雙方合約終止日。",
      ];
  const otherClauses = isSeat
    ? [
        "乙方應自行保管個人物品，甲方不負任何保管及法律責任。",
        "乙方不得以共享座位服務作為公司登記地址；如需營業登記服務，應另行簽訂營業登記合約。",
        "甲乙雙方僅有契約履行之責，乙方如與第三人有債務糾紛或法律責任，由乙方自行負責，與甲方無關。",
        "費用應於約定日前繳納，不得以任何理由拖延或拒絕，若遲繳每日得向承租人收取總額3%滯納金。",
        "乙方如有寄放任何物品於甲方之處，甲方不負任何保管及法律責任，其責任問題均由乙方負全責。",
      ]
    : [
        "乙方除水電費、管理費、網路費及雙方另行約定費用外，營業上必須繳納之稅捐需自行負擔。",
        "乙方如需以甲方地址辦理營業登記，應另行確認登記服務條件並依相關約定辦理。",
        "甲乙雙方僅有契約履行之責，乙方如與第三人有債務糾紛或法律責任，由乙方自行負責，與甲方無關。",
        "乙方如有寄放任何物品於甲方之處，甲方不負任何保管及法律責任，其責任問題均由乙方負全責。",
        "本契約租賃期限未滿，乙方擬提前解約時，依雙方約定或一個月租金作為違約金。",
        "租金應於約定日前繳納，不得以任何理由拖延或拒絕，若遲繳每日得向承租人收取總額3%滯納金。",
        `甲方為使租賃標地物出租順利，並減輕乙方之租金負擔，特提供乙方之租賃優惠選擇方案（此優惠方案為自由選擇），若乙方違反合約限制或提前辦理退租，乙方無條件同意甲方將當初協議之優惠款項從押金中扣除。以原價 ${originalRentText || "_____"} 元/月計算。`,
      ];

  return `
    <div class="html-contract-book workplace-contract ${type}-contract ${modeClass} ${versionClass}">
      <article class="html-contract-page">
        ${renderContractLogo()}
        <h2>${title}</h2>
        <p>立契約人</p>
        <p>出租人：${previewSpan("lessor", values.lessor)}（以下簡稱甲方），</p>
        <p>承租人：${previewSpan("lesseeCompany", values.lesseeCompany)}（以下簡稱乙方）</p>
        <p>因${eventText}，訂立本契約，雙方同意之條件如左：</p>
        <p class="contract-section office-major-section">第一條：租賃標的及使用範圍：${previewSpan("venueAddress", values.venueAddress)} ${subjectText}</p>

        ${durationClause}

        <p class="contract-section office-major-section">第三條：費用：</p>
        <p class="indent-1">一、${priceLabel}新台幣 <span class="contract-fill-inline fill-money" data-preview-key="monthly">${monthlyText}</span> 元，（每 <span class="contract-token-inline" data-preview-key="periodMonths">${escapeHtml(values.periodMonths)}</span> 個月為一期，共 <span class="contract-token-inline" data-preview-key="termCount">${escapeHtml(values.termCount)}</span> 期，匯款手續費由乙方自行負責）</p>
        <p class="indent-1">二、費用於每期 <span class="contract-token-inline" data-preview-key="dueDay">${escapeHtml(values.dueDay)}</span> 前繳納</p>
        ${renderWorkplaceDepositLine(values, type)}

        <p class="contract-section office-major-section">第四條：使用限制：</p>
        ${useLimitClauses.map((clause, index) => `<p class="indent-1">${"一二三四五六七八九十"[index]}、${escapeHtml(clause)}</p>`).join("")}

        <p class="contract-section">第五條：危險負擔：乙方應以善良管理人之注意使用租賃標的及公共區域，除因天災地變等不可抗拒之情形外，因乙方之故意或過失致場域、設備或第三人權益受損，乙方應負損害賠償之責。</p>

        <p class="contract-section">第六條：違約處罰：</p>
        <p class="indent-1">一、乙方違反約定方法使用租賃標的，或拖欠費用超過七日，甲方得終止租約，押金不得抵算租金或費用。</p>
        <p class="indent-1">二、乙方於終止租約或租賃期滿不交還租賃標的或未完成點交，自終止租約或租賃期滿之翌日起，乙方應支付按日計算之違約金；所遺留設備或物品不搬者，視同乙方同意交由甲方處理。</p>

        <p class="contract-section office-major-section">第七條：其他特約事項：</p>
        ${otherClauses.map((clause, index) => `<p class="indent-1">${index + 1}、${escapeHtml(clause)}</p>`).join("")}

        <footer>第1頁（共2頁）</footer>
      </article>

      <article class="html-contract-page">
        ${renderContractLogo("second")}
        ${renderOfficialStamp(values)}
        <p class="contract-section">第八條：應受強制執行之事項：</p>
        <p class="indent-1">1、租約到期、欠繳租金或費用、或終止租約生效時。</p>
        <p class="indent-1">2、乙方如有違反法令、公共秩序或其他影響甲方權益之情事，甲方得立即中止甲乙雙方租約，並得依法通報相關單位。</p>

        ${renderWorkplaceDepositArticle(values, type)}
        <p>甲乙雙方應於租約終止或屆滿時完成費用結清、場域點交及物品清空。乙方如有積欠租金、費用、違約金或損害賠償，甲方得自應返還款項中扣除；不足部分乙方仍應補足。</p>

        <p class="contract-section">第十條：連帶保證責任</p>
        <p class="indent-1">乙方之負責人就本契約之相關責任（含租金、費用及違約金）負連帶保證責任。</p>

        <p class="contract-section">第十一條：雙方確認事項</p>
        <p class="indent-1">甲乙雙方同意，因本契約事項所生之一切爭議，雙方同意以${previewSpan("court", values.court)}為第一審管轄法院。</p>

        <section class="signature-block">
          <div>
            <p>出租人：${previewSpan("lessor", values.lessor)}</p>
            <p>統一編號：${previewSpan("lessorCoNumber", values.lessorCoNumber)}</p>
            <p>負責人：${previewSpan("lessorOwner", values.lessorOwner)}</p>
            <p class="bank-lines">匯款帳號：<br>帳戶名稱：${previewSpan("lessor", values.lessor)}<br>銀行名稱：${previewSpan("bankName", values.bankName)}<br>行庫代號：${previewSpan("bankCode", values.bankCode)}<br>帳號：${previewSpan("bankAccount", values.bankAccount)}</p>
            <p class="payment-total-line">本期匯款金額：<span data-preview-key="paymentTotal">${escapeHtml(totalText)}</span> 元</p>
            ${renderPaymentScheduleNotice(values, total)}
          </div>
        </section>

        ${renderLesseeContractBlock(values)}

        <p class="contract-date">${previewSpan("signedDate", values.signedDate)}</p>
        <footer>第2頁（共2頁）</footer>
      </article>
    </div>
  `;
}

function renderOfficeContractDraft(values) {
  return renderWorkplaceContractDraft({ ...values, contractType: "office", contractTypeLabel: "辦公室" }, "office");
}

function renderSeatContractDraft(values) {
  return renderWorkplaceContractDraft({ ...values, contractType: "seat", contractTypeLabel: "共享座位", serviceText: "共享座位" }, "seat");
}

function renderBlankContractDraft(row) {
  const venue = getVenueConfig(row?.venue || activeVenue);
  const defaults = getVenueDefaults(row?.venue || activeVenue);
  const versionHint =
    blankVersion === "plain"
      ? "不用印版：先作為客戶確認或內部整理用，暫不放用印提醒。"
      : "用印版：後續會接 Pages 原始檔與列印用印流程。";

  return `
    <section class="blank-contract-draft">
      <div class="blank-contract-head">
        <div>
          <span>空白新合約</span>
          <h3>${escapeHtml(venue.label)} ${escapeHtml(contractVersionLabel())}</h3>
        </div>
        <div class="blank-version-switch" aria-label="合約版本">
          <button type="button" data-contract-version="stamp" class="${blankVersion === "stamp" ? "active" : ""}">用印版</button>
          <button type="button" data-contract-version="plain" class="${blankVersion === "plain" ? "active" : ""}">不用印版</button>
        </div>
      </div>
      <p class="blank-contract-note">${escapeHtml(versionHint)}目前只做填空底稿，不儲存、不覆蓋 CRM。</p>
      <div class="blank-contract-grid">
        <label><span>館別</span><input value="${escapeHtml(venue.label)}" /></label>
        <label><span>合約版本</span><input value="${escapeHtml(contractVersionLabel())}" /></label>
        <label><span>出租方</span><input value="${escapeHtml(defaults.lessor)}" /></label>
        <label class="wide"><span>合約地址</span><input value="${escapeHtml(defaults.address)}" /></label>
        <label><span>客戶名稱 / 承租人</span><input placeholder="例：王小明" /></label>
        <label><span>公司名稱 / 行號</span><input placeholder="例：○○有限公司" /></label>
        <label><span>統編 / 身分證</span><input placeholder="例：12345678" /></label>
        <label><span>負責人</span><input placeholder="例：王小明" /></label>
        <label><span>聯絡電話</span><input placeholder="例：0912..." /></label>
        <label><span>服務項目</span><input placeholder="營登 / 辦公室 / 自由座" /></label>
        <label><span>繳費方式</span><input placeholder="M / 3M / 6M / Y / 2Y / 3Y" /></label>
        <label><span>月租</span><input placeholder="例：1800/m" /></label>
        <label><span>合約起始日</span><input placeholder="例：115/07/01" /></label>
        <label><span>合約到期日</span><input placeholder="例：116/07/01" /></label>
        <label><span>押金</span><input placeholder="例：6000" /></label>
        <label><span>簽約日期</span><input placeholder="例：115/06/27" /></label>
        <label class="wide"><span>租金方案文字</span><input placeholder="例：一年約，月租 1800，年繳 21600" /></label>
        <label class="wide"><span>備註</span><input placeholder="換負責人、特惠、合作記帳士、用印提醒..." /></label>
      </div>
    </section>
  `;
}

function getYears() {
  return Object.keys(getVenueData().years).sort((a, b) => Number(a) - Number(b));
}

function getAdjacentYears() {
  const years = getYears();
  const index = years.indexOf(activeYear);
  return {
    previous: index > 0 ? years[index - 1] : "",
    next: index >= 0 && index < years.length - 1 ? years[index + 1] : "",
  };
}

function applyInitialUrlState() {
  const params = new URLSearchParams(window.location.search);
  const venue = params.get("venue");
  const year = params.get("year");
  const id = params.get("id");

  if (venue && crmData.venues[venue]) activeVenue = venue;
  if (year && getVenueData(activeVenue).years[year]) activeYear = year;
  else activeYear = getVenueData(activeVenue).activeYear || activeYear;

  const activeRows = getFolderRows("active");
  const endedRows = getFolderRows("ended");
  const allRows = [...activeRows, ...endedRows];
  const match = id ? allRows.find((row) => normalizeId(row.id) === normalizeId(id)) : null;
  activeFolder = match ? match.folder || "active" : "active";
  if (match) activeService = serviceType(match);
  selectedId = displayId(match || getVisibleRows(activeFolder)[0] || activeRows[0] || endedRows[0]);
}

function makeBlankContractRow() {
  const type = normalizeContractType(blankContractType, activeVenue);
  blankContractType = type;
  const defaultCycle = type === "registration" ? "Y" : "M";
  return {
    id: `空白${contractTypeLabel(type)}`,
    name: "",
    company: "",
    category: contractTypeLabel(type),
    item: contractTypeLabel(type),
    cycle: defaultCycle,
    start: "",
    end: "",
    amount: "",
    pricePlan: "",
    deposit: "",
    coNumber: "",
    signedAt: "",
    birthday: "",
    address: "",
    phone: "",
    idNumber: "",
    folder: "active",
    venue: activeVenue,
    uid: `${activeVenue}-blank-${type}`,
    contractType: type,
    isBlank: true,
  };
}

function selectedRow() {
  const rows = getVisibleRows();
  return rows.find((row) => normalizeId(row.id) === normalizeId(selectedId)) || rows[0] || null;
}

function currentContractRow() {
  return actionMode === "blank" ? makeBlankContractRow() : selectedRow();
}

function updateProfileLink() {
  const row = selectedRow();
  const params = new URLSearchParams({ venue: activeVenue, year: activeYear });
  if (row?.id) params.set("id", row.id);
  profilePageLink.href = `./crm.html?${params.toString()}`;
}

function renderShell() {
  if (!serviceAllowed(activeService)) activeService = "registration";
  blankContractType = normalizeContractType(blankContractType, activeVenue);
  const config = getVenueConfig();
  document.body.dataset.venue = activeVenue;
  venueKicker.textContent = `${config.label} CRM`;
  yearSelect.innerHTML = getYears().map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");
  yearSelect.value = activeYear;
  yearPicker.classList.toggle("is-current-year", activeYear === currentGregorianYear);

  const { previous, next } = getAdjacentYears();
  prevYearButton.disabled = !previous;
  nextYearButton.disabled = !next;
  createYearButton.textContent = `建立 ${Number(getYears().at(-1) || activeYear) + 1}`;
  venueButtons.forEach((button) => button.classList.toggle("active", button.dataset.venue === activeVenue));
  folderButtons.forEach((button) => button.classList.toggle("active", button.dataset.folder === activeFolder));
  serviceButtons.forEach((button) => {
    const allowed = serviceAllowed(button.dataset.service);
    button.hidden = !allowed;
    button.disabled = !allowed;
    button.classList.toggle("active", button.dataset.service === activeService);
  });
  linkContractButton.classList.toggle("is-selected", blankVersion === "stamp");
  blankContractButton.classList.toggle("is-selected", blankVersion === "plain");
  blankContractOpenButton.classList.toggle("is-selected", actionMode === "blank");
  updateProfileLink();
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const rows = getVisibleRows().filter((row) => {
    if (!query) return true;
    return [row.id, row.name, row.company, row.item, row.cycle].some((value) => String(value).toLowerCase().includes(query));
  });

  recordCount.textContent = `${rows.length} 筆`;
  if (!rows.length) {
    recordList.innerHTML = `<div class="empty-list">${activeFolder === "ended" ? "已結束目前沒有客戶" : "沒有符合的客戶"}</div>`;
    return;
  }

  recordList.innerHTML = rows
    .map((row) => `
      <button class="contract-record-card${normalizeId(row.id) === normalizeId(selectedId) ? " active" : ""}" type="button" data-id="${escapeHtml(row.id)}">
        <span class="contract-record-id">${escapeHtml(displayId(row))}</span>
        <span>
          <span class="contract-record-title">${escapeHtml(row.company || row.name || "未命名")}</span>
          <span class="contract-record-meta">${escapeHtml([row.name, row.item, row.cycle].filter(Boolean).join(" · "))}</span>
        </span>
      </button>
    `)
    .join("");

  recordList.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.id;
      actionMode = "";
      render();
    });
  });
}

function summaryCard(title, rows) {
  return `
    <article class="contract-summary-card">
      <h3>${escapeHtml(title)}</h3>
      <dl>
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(contractValue(value))}</dd></div>`).join("")}
      </dl>
    </article>
  `;
}

function renderDetail() {
  const row = currentContractRow();
  if (!row) {
    contractTitle.textContent = "沒有客戶資料";
    contractSummary.innerHTML = "";
    contractActionPanel.hidden = true;
    return;
  }

  const venue = getVenueConfig(row.venue || activeVenue);
  const defaults = getVenueDefaults(row.venue || activeVenue);
  contractTitle.textContent = row.isBlank
    ? `${venue.label} 空白${contractTypeLabel(contractType(row))}合約`
    : `${displayId(row)} ${row.company || row.name || "未命名客戶"}`;

  contractActionPanel.hidden = true;
  contractActionPanel.innerHTML = "";
  contractSummary.innerHTML = renderContractMapping(row);
  resizeContractTextareas(contractSummary);
}

function resizeContractTextareas(root = document) {
  root.querySelectorAll("textarea[data-contract-field]").forEach((textarea) => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 94)}px`;
  });
}

let contractPrintPreviousTitle = "";
let pendingPrintedBlankDraftKey = "";

function cleanupPrintRoot({ clearPrintedBlank = false } = {}) {
  document.querySelector(".contract-print-root")?.remove();
  document.body.classList.remove("is-printing-contract");
  if (contractPrintPreviousTitle) {
    document.title = contractPrintPreviousTitle;
    contractPrintPreviousTitle = "";
  }
  if (clearPrintedBlank && pendingPrintedBlankDraftKey) {
    delete contractDrafts[pendingPrintedBlankDraftKey];
    pendingPrintedBlankDraftKey = "";
    saveContractDrafts();
    if (actionMode === "blank") render();
  }
}

function waitForImages(root) {
  const images = Array.from(root.querySelectorAll("img"));
  if (!images.length) return Promise.resolve();
  return Promise.all(
    images.map((image) => {
      if (image.complete && image.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    }),
  );
}

async function printContractPdf() {
  cleanupPrintRoot();
  const row = currentContractRow();
  const book = row ? contractBookNode(row) : null;
  if (!book) {
    alert("目前沒有可輸出的合約內容。");
    return;
  }
  const printRoot = document.createElement("div");
  printRoot.className = "contract-print-root";
  printRoot.appendChild(book.cloneNode(true));
  document.body.appendChild(printRoot);
  document.body.classList.add("is-printing-contract");
  contractPrintPreviousTitle = document.title || "HJ 客戶合約";
  document.title = contractPrintTitle(row);
  pendingPrintedBlankDraftKey = row?.isBlank ? contractDraftKey(row) : "";
  await waitForImages(printRoot);
  window.print();
}

function render() {
  renderShell();
  renderList();
  renderDetail();
}

function switchVenue(venue) {
  if (!crmData.venues[venue]) return;
  activeVenue = venue;
  activeYear = getVenueData(venue).activeYear || initialYear;
  activeFolder = "active";
  activeService = "registration";
  blankContractType = normalizeContractType(blankContractType, venue);
  selectedId = displayId(getVisibleRows()[0]);
  actionMode = "";
  searchInput.value = "";
  render();
}

function switchYear(year) {
  if (!getVenueData().years[year]) return;
  activeYear = year;
  selectedId = displayId(getVisibleRows()[0]);
  actionMode = "";
  searchInput.value = "";
  render();
}

venueButtons.forEach((button) => button.addEventListener("click", () => switchVenue(button.dataset.venue)));
folderButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFolder = button.dataset.folder;
    selectedId = displayId(getVisibleRows()[0]);
    actionMode = "";
    searchInput.value = "";
    render();
  });
});
serviceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!serviceAllowed(button.dataset.service)) return;
    activeService = button.dataset.service;
    selectedId = displayId(getVisibleRows()[0]);
    actionMode = "";
    searchInput.value = "";
    render();
  });
});
yearSelect.addEventListener("change", () => switchYear(yearSelect.value));
prevYearButton.addEventListener("click", () => {
  const { previous } = getAdjacentYears();
  if (previous) switchYear(previous);
});
nextYearButton.addEventListener("click", () => {
  const { next } = getAdjacentYears();
  if (next) switchYear(next);
});
createYearButton.addEventListener("click", () => {
  alert("建立年度會影響合約與 CRM 資料，這個動作之後會做確認流程；目前先不直接建立。");
});
searchInput.addEventListener("input", render);
linkContractButton.addEventListener("click", () => {
  blankVersion = "stamp";
  render();
});
blankContractButton.addEventListener("click", () => {
  blankVersion = "plain";
  render();
});
blankContractOpenButton.addEventListener("click", () => {
  const nextActionMode = actionMode === "blank" ? "" : "blank";
  if (nextActionMode === "blank") clearBlankContractDraft(activeVenue);
  actionMode = nextActionMode;
  blankContractType = normalizeContractType(blankContractType, activeVenue);
  if (actionMode === "blank") contractEditing = true;
  render();
});
contractActionPanel.addEventListener("click", (event) => {
  const versionButton = event.target.closest("[data-contract-version]");
  if (!versionButton) return;
  blankVersion = versionButton.dataset.contractVersion;
  render();
});
contractSummary.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-contract-edit-toggle]");
  const resetButton = event.target.closest("[data-contract-draft-reset]");
  const printButton = event.target.closest("[data-contract-print]");
  const previewButton = event.target.closest("[data-contract-preview-open]");
  const blankTypeButton = event.target.closest("[data-blank-contract-type]");
  const row = currentContractRow();
  if (blankTypeButton) {
    blankContractType = normalizeContractType(blankTypeButton.dataset.blankContractType, activeVenue);
    if (row?.isBlank) clearBlankContractDraft(activeVenue, blankContractType);
    contractEditing = true;
    render();
    return;
  }
  if (previewButton) {
    openContractPreviewModal();
    return;
  }
  if (printButton) {
    printContractPdf();
    return;
  }
  if (resetButton && row) {
    delete contractDrafts[contractDraftKey(row)];
    saveContractDrafts();
    contractEditing = false;
    render();
    return;
  }
  if (editButton) {
    contractEditing = !contractEditing;
    render();
  }
});

contractSummary.addEventListener("change", (event) => {
  const toggle = event.target.closest("[data-lessee-display-field]");
  const row = currentContractRow();
  if (!toggle || !row || !contractSupportsLesseeDisplayControl(row)) return;
  const key = contractDraftKey(row);
  const current = new Set(lesseeDisplayFieldsFromDraft(row, contractDrafts[key] || {}));
  const fieldKey = toggle.dataset.lesseeDisplayField;
  if (!lesseeContractDisplayFieldKeys.has(fieldKey)) return;
  if (toggle.checked) {
    current.add(fieldKey);
  } else {
    current.delete(fieldKey);
  }
  contractDrafts[key] = contractDrafts[key] || {};
  contractDrafts[key].lesseeVisibleFields = lesseeContractDisplayFields
    .map((field) => field.key)
    .filter((item) => current.has(item));
  saveContractDrafts();
  render();
});

document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-contract-preview-close]");
  const printButton = event.target.closest(".contract-preview-modal [data-contract-print]");
  if (printButton) {
    printContractPdf();
    return;
  }
  if (closeButton || event.target.classList.contains("contract-preview-modal")) {
    closeContractPreviewModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeContractPreviewModal();
});

const contractDateFields = new Set(["startDate", "endDate", "signedDate"]);

function handleContractFieldEdit(input, { finalizeDate = false } = {}) {
  const row = currentContractRow();
  if (!input || !row) return;
  if (input.tagName === "TEXTAREA") resizeContractTextareas(contractSummary);
  const key = contractDraftKey(row);
  contractDrafts[key] = contractDrafts[key] || {};
  const changedField = input.dataset.contractField;
  const isDateField = contractDateFields.has(changedField);
  const syncPreviewField = (fieldKey, value) => {
    contractSummary.querySelectorAll(`[data-fill-key="${CSS.escape(fieldKey)}"]`).forEach((node) => {
      node.textContent = value.trim() || "待填";
    });
    contractSummary.querySelectorAll(`[data-preview-key="${CSS.escape(fieldKey)}"]`).forEach((node) => {
      const rawValue = value.trim() || "待填";
      if (fieldKey === "paymentTotal") {
        node.textContent = paymentMoneyText(rawValue) || "待填";
        return;
      }
      node.textContent = ["monthly", "deposit"].includes(fieldKey) ? paymentMoneyText(rawValue) || "待填" : rawValue;
    });
  };
  const setDraftField = (fieldKey, value) => {
    contractDrafts[key][fieldKey] = value;
    contractSummary.querySelectorAll(`[data-contract-field="${CSS.escape(fieldKey)}"]`).forEach((fieldInput) => {
      if (fieldInput.value !== value) fieldInput.value = value;
    });
    syncPreviewField(fieldKey, value);
  };

  const normalizedValue = isDateField && !finalizeDate
    ? input.value
    : normalizedContractInputValue(changedField, input.value);
  setDraftField(changedField, normalizedValue);
  if (isDateField && !finalizeDate) {
    saveContractDrafts();
    return;
  }

  if (changedField === "startDate") {
    const start = parseCompleteRocDate(normalizedValue);
    if (start) setDraftField("dueDay", start.day);
  }

  if (["startDate", "contractYears"].includes(changedField)) {
    const draft = contractDrafts[key];
    const base = contractBaseFields(row);
    const startValue = changedField === "startDate"
      ? normalizedValue
      : draftValueOrBase(draft.startDate, base.startDate);
    const yearsValue = changedField === "contractYears"
      ? normalizedValue
      : draftValueOrBase(draft.contractYears, base.contractYears);
    const autoEndDate = isCompleteRocDateValue(startValue) ? addYearsToRocDate(startValue, yearsValue) : "";
    if (autoEndDate) setDraftField("endDate", autoEndDate);
  }

  if (changedField === "endDate") {
    const draft = contractDrafts[key];
    const base = contractBaseFields(row);
    const startValue = draftValueOrBase(draft.startDate, base.startDate);
    const derivedYears = isCompleteRocDateValue(startValue) && isCompleteRocDateValue(normalizedValue)
      ? contractYearsFromValues(startValue, normalizedValue)
      : "";
    if (derivedYears) {
      setDraftField("contractYears", derivedYears);
    } else if (numberFromText(draftValueOrBase(draft.contractYears, base.contractYears)) && isCompleteRocDateValue(startValue)) {
      const autoEndDate = calculatedEndDateFromDraft(row, draft);
      if (autoEndDate) setDraftField("endDate", autoEndDate);
    }
  }

  if (["startDate", "endDate", "contractYears", "periodMonths"].includes(changedField)) {
    const draft = contractDrafts[key];
    const base = contractBaseFields(row);
    const startValue = draftValueOrBase(draft.startDate, base.startDate);
    const endValue = draftValueOrBase(draft.endDate, base.endDate);
    const autoTermCount = isCompleteRocDateValue(startValue) && isCompleteRocDateValue(endValue)
      ? calculatedTermCountFromDraft(row, draft)
      : "";
    if (autoTermCount) setDraftField("termCount", autoTermCount);
  }

  if (["monthly", "periodMonths", "deposit"].includes(changedField)) {
    const autoTotal = calculatedPaymentTotalFromDraft(row, contractDrafts[key]);
    if (autoTotal) setDraftField("paymentTotal", autoTotal);
  }

  saveContractDrafts();
}

contractSummary.addEventListener("input", (event) => {
  const input = event.target.closest("[data-contract-field]");
  if (!input) return;
  const isCompleteDate = contractDateFields.has(input.dataset.contractField) && isCompleteRocDateValue(input.value);
  handleContractFieldEdit(input, { finalizeDate: isCompleteDate });
});

contractSummary.addEventListener("blur", (event) => {
  const input = event.target.closest("[data-contract-field]");
  if (!input || !contractDateFields.has(input.dataset.contractField)) return;
  handleContractFieldEdit(input, { finalizeDate: true });
}, true);

window.addEventListener("afterprint", () => cleanupPrintRoot({ clearPrintedBlank: true }));

render();
