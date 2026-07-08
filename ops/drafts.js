const manualDraftItems = [];

manualDraftItems.push(...(window.hjFutureDraftItems || []));

let draftItems = [];

const statusLabels = {
  today: "今日該貼",
  follow: "已貼待追",
  upcoming: "本月預備",
  "needs-check": "待確認",
};

const draftTestMode = document.body?.dataset.draftTest === "1" || document.documentElement?.dataset.draftTest === "1";
if (draftTestMode) statusLabels["needs-check"] = "需確認";

const venueLabels = {
  taichung: "台中館",
  huanrui: "環瑞館",
};

const venueKeys = Object.keys(venueLabels);
const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const initialPaymentYear = 2026;
const draftProjectionYears = 10;
const paymentYearStateKey = "hjPaymentYearStateV1";
const suppressedPaymentRowsKey = "hjPaymentSuppressedRowsV1";
const FOLLOW_UP_DAYS = 6;
const NOTICE_STORAGE_KEY = "hjDraftNoticeLogV1";
const DRAFT_EDIT_STORAGE_KEY = "hjDraftMessageEditsV1";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const contractConfirmationNote = "合約到期，先確認續約";

let activeVenue = "taichung";
let activeYear = currentDraftYear();
let activeMonth = currentDraftMonthLabel();
let activeStatus = targetIsFuture(activeYear, activeMonth) ? "upcoming" : "today";
let selectedDraftId = null;
let noticeLog = loadNoticeLog();
let draftMessageEdits = loadDraftMessageEdits();
let paymentRowsCache = new Map();

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? String(year) : String(initialPaymentYear);
}

function currentTaipeiDateParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function currentDraftYear() {
  return Number(normalizeYear(currentTaipeiDateParts().year));
}

function currentDraftMonthLabel() {
  const month = Number(currentTaipeiDateParts().month);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? `${month}月` : "6月";
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
  return Array.from(years);
}

function readPaymentYearState() {
  const fallback = {
    activeYear: String(initialPaymentYear),
    years: {
      taichung: [String(initialPaymentYear)],
      huanrui: [String(initialPaymentYear)],
    },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(paymentYearStateKey) || "null") || {};
    const years = {};
    venueKeys.forEach((venue) => {
      years[venue] = Array.from(
        new Set([
          String(initialPaymentYear),
          ...(Array.isArray(saved.years?.[venue]) ? saved.years[venue].map(normalizeYear) : []),
          ...scanStoredPaymentYears(venue),
        ]),
      ).sort((a, b) => Number(a) - Number(b));
    });
    const globalYears = Array.from(new Set(Object.values(years).flat()));
    const activeYear = normalizeYear(saved.activeYear || saved.activeYears?.taichung || initialPaymentYear);
    return {
      activeYear: globalYears.includes(activeYear) ? activeYear : String(initialPaymentYear),
      years,
    };
  } catch {
    return fallback;
  }
}

function availableDraftYears() {
  const state = readPaymentYearState();
  const projectedYears = Array.from({ length: draftProjectionYears + 1 }, (_, index) => String(initialPaymentYear + index));
  return Array.from(
    new Set([
      ...projectedYears,
      ...venueKeys.flatMap((venue) => state.years?.[venue] || [String(initialPaymentYear)]),
    ]),
  ).sort((a, b) => Number(a) - Number(b));
}

function activeDraftYear() {
  const state = readPaymentYearState();
  return Number(state.activeYear || initialPaymentYear);
}

function currentMonthAbsoluteIndex() {
  const now = new Date();
  return now.getFullYear() * 12 + now.getMonth();
}

function monthAbsoluteIndexFor(year, monthLabel) {
  const monthIndex = monthLabels.indexOf(monthLabel);
  if (monthIndex === -1) return null;
  return Number(year) * 12 + monthIndex;
}

function targetIsFuture(year, monthLabel) {
  const targetIndex = monthAbsoluteIndexFor(year, monthLabel);
  return targetIndex !== null && targetIndex > currentMonthAbsoluteIndex();
}

function setDraftYear(year) {
  activeYear = Number(normalizeYear(year));
  if (targetIsFuture(activeYear, activeMonth)) {
    activeStatus = "upcoming";
  } else if (activeStatus === "upcoming") {
    activeStatus = "today";
  }
}

function todayKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

function parseDateKey(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSince(dateKey) {
  const start = parseDateKey(dateKey);
  const today = parseDateKey(todayKey());
  if (!start || !today) return null;
  return Math.max(0, Math.floor((today - start) / MS_PER_DAY));
}

function isSnoozed(item) {
  const snoozeUntil = parseDateKey(item?.snoozeUntil);
  const today = parseDateKey(todayKey());
  return Boolean(snoozeUntil && today && snoozeUntil > today);
}

function newerNoticeLog(saved, seededDate) {
  if (!saved?.lastNotifiedAt) {
    return seededDate ? { lastNotifiedAt: seededDate, count: 1 } : null;
  }
  if (!seededDate) return saved;
  const savedDate = parseDateKey(saved.lastNotifiedAt);
  const seeded = parseDateKey(seededDate);
  if (seeded && (!savedDate || seeded > savedDate)) {
    return { lastNotifiedAt: seededDate, count: Math.max(1, Number(saved.count || 0)) };
  }
  return saved;
}

function noticeRefKey(ref = {}, fallbackYear = activeYear) {
  const venue = ref.venue || activeVenue;
  const year = ref.year || fallbackYear || activeYear || initialPaymentYear;
  const month = ref.month || activeMonth;
  const id = normalizeCustomerId(ref.id);
  return ["payment-ref", venue, year, month, id].join("|");
}

function legacyNoticeRefKey(ref = {}) {
  const venue = ref.venue || activeVenue;
  const month = ref.month || activeMonth;
  const id = normalizeCustomerId(ref.id);
  return ["payment-ref", venue, "", month, id].join("|");
}

function pushUniqueNoticeKey(keys, key) {
  if (key && !keys.includes(key)) keys.push(key);
}

function noticeKeysForItem(item = {}) {
  const keys = [item.id].filter(Boolean);
  const fallbackYear = Number(item.year || activeYear || initialPaymentYear);
  (item.paymentRefs || []).forEach((ref) => {
    const normalizedRef = {
      ...ref,
      venue: ref.venue || item.venue || activeVenue,
      month: ref.month || item.month || activeMonth,
      year: Number(ref.year || fallbackYear) || fallbackYear,
    };
    pushUniqueNoticeKey(keys, noticeRefKey(normalizedRef, fallbackYear));
    pushUniqueNoticeKey(keys, legacyNoticeRefKey(normalizedRef));
  });
  return keys;
}

function loadNoticeLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTICE_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function saveNoticeLog() {
  localStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(noticeLog));
}

function loadDraftMessageEdits() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_EDIT_STORAGE_KEY) || "{}");
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, value]) => String(value || "").trim()),
    );
  } catch {
    return {};
  }
}

function saveDraftMessageEdits() {
  const cleaned = Object.fromEntries(
    Object.entries(draftMessageEdits).filter(([, value]) => String(value || "").trim()),
  );
  draftMessageEdits = cleaned;
  localStorage.setItem(DRAFT_EDIT_STORAGE_KEY, JSON.stringify(cleaned));
}

function draftMessageKey(id, index) {
  return `${id}::${index}`;
}

function originalDraftMessageBody(item, index) {
  return item.messages?.[index]?.body || "";
}

function draftMessageBody(item, index) {
  const key = draftMessageKey(item.id, index);
  return Object.prototype.hasOwnProperty.call(draftMessageEdits, key)
    ? draftMessageEdits[key]
    : originalDraftMessageBody(item, index);
}

function draftMessageIsEdited(item, index) {
  return Object.prototype.hasOwnProperty.call(draftMessageEdits, draftMessageKey(item.id, index));
}

function updateDraftMessage(id, index, value) {
  const item = draftItems.find((draft) => draft.id === id);
  if (!item) return;
  const numericIndex = Number(index);
  const key = draftMessageKey(id, numericIndex);
  const original = originalDraftMessageBody(item, numericIndex);
  if (!String(value || "").trim() || value === original) {
    delete draftMessageEdits[key];
  } else {
    draftMessageEdits[key] = value;
  }
  saveDraftMessageEdits();
}

function resetDraftMessage(id, index) {
  delete draftMessageEdits[draftMessageKey(id, Number(index))];
  saveDraftMessageEdits();
}

function paymentStorageKeyFor(venue, month, year = activeYear) {
  if (Number(year) === initialPaymentYear && venue === "taichung" && month === "6月") {
    return "hjPaymentRows202606TaichungV1";
  }
  return `hjPaymentRows${year}_${venue}_${month}_v1`;
}

function normalizeAscii(value) {
  return String(value || "")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replaceAll("　", " ");
}

function normalizePaymentValue(value) {
  return normalizeAscii(value).trim();
}

function normalizeCycleValue(value) {
  return normalizePaymentValue(value).toUpperCase();
}

function normalizeCustomerId(value) {
  const raw = normalizePaymentValue(value);
  return /^v/i.test(raw) ? raw.toUpperCase() : raw;
}

function comparableDate(value) {
  return String(value || "")
    .trim()
    .replaceAll("-", "/")
    .replace(/[／.]/g, "/")
    .split("/")
    .map((part) => (/^\d+$/.test(part.trim()) ? String(Number(part.trim())) : part.trim()))
    .join("/");
}

function normalizeComparableValue(field, value) {
  if (field === "cycle") return normalizeCycleValue(value);
  if (field === "start" || field === "end") return comparableDate(value);
  return normalizePaymentValue(value);
}

function samePaymentPeriod(a, b) {
  const leftId = normalizeCustomerId(a?.id);
  const rightId = normalizeCustomerId(b?.id);
  const leftCompany = normalizePaymentValue(a?.company);
  const rightCompany = normalizePaymentValue(b?.company);
  const sameIdentity = leftId && rightId
    ? leftId === rightId
    : Boolean(leftCompany && rightCompany && leftCompany === rightCompany);
  if (!sameIdentity) return false;
  return ["cycle", "start", "end"].every((field) => normalizeComparableValue(field, a?.[field]) === normalizeComparableValue(field, b?.[field]));
}

function sameGeneratedPaymentSlot(existing, generated) {
  if (!isAutoGeneratedPaymentRow(generated)) return false;
  const existingId = normalizeCustomerId(existing?.id);
  const generatedId = normalizeCustomerId(generated?.id);
  if (!existingId || !generatedId || existingId !== generatedId) return false;
  if (normalizeCycleValue(existing?.cycle) !== normalizeCycleValue(generated?.cycle)) return false;
  const existingService = serviceKindFor(existing);
  const generatedService = serviceKindFor(generated);
  if (existingService === "待確認" || generatedService === "待確認") return false;
  return existingService === generatedService;
}

function samePaymentForDraftMonth(existing, candidate) {
  return samePaymentPeriod(existing, candidate) || sameGeneratedPaymentSlot(existing, candidate);
}

function normalizeMonthlyPrice(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/\/\s*m$/i.test(raw)) return raw.replace(/\s*\/\s*m$/i, "/m");
  if (/^\d[\d,]*$/.test(raw)) return `${raw}/m`;
  return raw;
}

function lastNumberFromText(value) {
  const matches = String(value || "").match(/\d[\d,]*/g) || [];
  if (!matches.length) return 0;
  return Number(matches[matches.length - 1].replaceAll(",", ""));
}

function lastMonthlyPriceFromText(value) {
  const matches = String(value || "").match(/\d[\d,]*\s*(?:\/\s*m)?/gi) || [];
  if (matches.length < 2) return "";
  return normalizeMonthlyPrice(matches[matches.length - 1].replace(/\s+/g, "").replaceAll(",", ""));
}

function parseTwoStagePricePlan(value) {
  const match = String(value || "")
    .trim()
    .match(/前\s*(\d+)\s*年\s*([\d,]+)(?:\s*\/\s*m)?\s*[，,、/ ]+\s*後\s*(\d+)\s*年\s*([\d,]+)(?:\s*\/\s*m)?/);
  if (!match) return null;
  return {
    firstYears: Number(match[1]),
    firstPrice: normalizeMonthlyPrice(match[2].replaceAll(",", "")),
    secondYears: Number(match[3]),
    secondPrice: normalizeMonthlyPrice(match[4].replaceAll(",", "")),
  };
}

function knownCanonicalContractFor(row) {
  const id = normalizeCustomerId(row?.id);
  if (!id) return null;
  const start = comparableDate(row?.start);
  const company = String(row?.company || "").trim();
  return (window.hjDefaultPaymentRows || []).find((item) => {
    if (!item?.pricePlan) return false;
    if (normalizeCustomerId(item.id) !== id) return false;
    if (start && comparableDate(item.start) !== start) return false;
    return !company || !item.company || item.company === company;
  }) || null;
}

function normalizeRowSemantics(row, venue = activeVenue) {
  const normalized = { ...row };
  if (normalized.section === "辦公室月繳") normalized.section = "辦公室";
  if (normalized.section === "6M") normalized.section = "營登";
  if (normalized.section === "代收信件") normalized.section = "營登";
  if (normalized.previousSection === "辦公室月繳") normalized.previousSection = "辦公室";
  if (normalized.previousSection === "6M") normalized.previousSection = "營登";
  if (normalized.previousSection === "代收信件") normalized.previousSection = "營登";
  const id = normalizeCustomerId(normalized.id);
  const company = String(normalized.company || "").trim();
  normalized.id = id;
  normalized.cycle = normalizeCycleValue(normalized.cycle);
  normalized.price = normalizeMonthlyPrice(normalized.price);
  const canonical = knownCanonicalContractFor(normalized);
  if (canonical) {
    const canonicalEnd = minguoMonthIndexForRocDate(canonical.end);
    const rowEnd = minguoMonthIndexForRocDate(normalized.end);
    if (canonicalEnd !== null && (rowEnd === null || canonicalEnd > rowEnd)) {
      normalized.end = canonical.end;
    }
    if (canonical.pricePlan) normalized.pricePlan = canonical.pricePlan;
  }
  return normalized;
}

function normalizeNoteWithoutContractConfirmation(note) {
  return String(note || "")
    .split("；")
    .map((part) => part.trim())
    .filter((part) => part && part !== contractConfirmationNote)
    .join("；");
}

function stagedContractIsStillActive(row, year, month) {
  if (!parseTwoStagePricePlan(row?.pricePlan || row?.階段金額)) return false;
  const targetIndex = monthAbsoluteIndexFor(year, month);
  const endIndex = minguoMonthIndexForRocDate(row?.end);
  return targetIndex !== null && endIndex !== null && targetIndex < endIndex;
}

function normalizeDraftRowForMonth(row, venue, month, year) {
  const normalized = normalizeRowSemantics(row, venue);
  const targetIndex = monthAbsoluteIndexFor(year, month);
  const target = targetIndex === null ? null : monthInfoForAbsoluteIndex(targetIndex);
  const stagedPrice = priceForRowAt(normalized, target);
  if (stagedPrice && parseTwoStagePricePlan(normalized.pricePlan || normalized.階段金額)) {
    normalized.price = stagedPrice;
  }
  if (String(normalized.note || "").includes(contractConfirmationNote) && stagedContractIsStillActive(normalized, year, month)) {
    normalized.note = normalizeNoteWithoutContractConfirmation(normalized.note);
  }
  return normalized;
}

function suppressedRowKeyFor(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  return [
    venue,
    year,
    month,
    normalizeCustomerId(row?.id),
    comparableDate(row?.start),
    comparableDate(row?.end),
    normalizeCycleValue(row?.cycle),
  ].join("|");
}

function readSuppressedPaymentRows() {
  try {
    const rows = JSON.parse(localStorage.getItem(suppressedPaymentRowsKey) || "[]");
    return Array.isArray(rows) ? new Set(rows) : new Set();
  } catch {
    return new Set();
  }
}

function isSuppressedPaymentRow(row, venue = activeVenue, month = activeMonth, year = activeYear) {
  return readSuppressedPaymentRows().has(suppressedRowKeyFor(row, venue, month, year));
}

function basePaymentRowsFor(venue, month, year = activeYear) {
  const importedByYearRows = window.hjImportedPaymentDataByYear?.[venue]?.[String(year)]?.[month];
  if (Array.isArray(importedByYearRows)) {
    return importedByYearRows.map((row) => normalizeDraftRowForMonth(row, venue, month, year));
  }
  if (Number(year) !== initialPaymentYear) return [];
  const sharedCurrentRows = venue === "taichung" && month === "6月" ? window.hjDefaultPaymentRows : null;
  return [...(sharedCurrentRows || window.hjImportedPaymentData?.[venue]?.[month] || [])].map((row) =>
    normalizeDraftRowForMonth(row, venue, month, year),
  );
}

function storedPaymentRowsFor(venue, month, year = activeYear) {
  const baseRows = basePaymentRowsFor(venue, month, year);
  try {
    const saved = JSON.parse(localStorage.getItem(paymentStorageKeyFor(venue, month, year)) || "null");
    if (Array.isArray(saved)) {
      const merged = saved.map((row) => normalizeDraftRowForMonth(row, venue, month, year));
      baseRows.forEach((baseRow) => {
        if (!isSuppressedPaymentRow(baseRow, venue, month, year) && !merged.some((row) => samePaymentPeriod(row, baseRow))) {
          merged.push(baseRow);
        }
      });
      return merged;
    }
  } catch {
      // If saved data is broken, fall back to the sheet snapshot.
  }
  return baseRows.filter((row) => !isSuppressedPaymentRow(row, venue, month, year));
}

function monthInfoForAbsoluteIndex(absoluteIndex) {
  const westernYear = Math.floor(absoluteIndex / 12);
  const monthNumber = (absoluteIndex % 12) + 1;
  return {
    year: westernYear,
    monthNumber,
    monthLabel: `${monthNumber}月`,
    nextDate: `${westernYear - 1911}/${String(monthNumber).padStart(2, "0")}`,
    absoluteIndex,
  };
}

function minguoMonthIndexForRocDate(value) {
  const match = normalizePaymentValue(value).match(/(\d{2,4})\s*[\\/.-]\s*(\d{1,4})/);
  if (!match) return null;
  const rocYear = Number(match[1]);
  const compactMonthDay = match[2].length >= 3 ? match[2].padStart(4, "0") : "";
  const monthNumber = Number(compactMonthDay ? compactMonthDay.slice(0, -2) : match[2]);
  if (!rocYear || monthNumber < 1 || monthNumber > 12) return null;
  return (rocYear + 1911) * 12 + (monthNumber - 1);
}

function addYearsToRocDateIndex(value, years) {
  const match = normalizePaymentValue(value).match(/(\d{2,4})\s*[\\/.-]\s*(\d{1,4})/);
  if (!match || !Number.isInteger(years)) return null;
  const rocYear = Number(match[1]);
  const compactMonthDay = match[2].length >= 3 ? match[2].padStart(4, "0") : "";
  const monthNumber = Number(compactMonthDay ? compactMonthDay.slice(0, -2) : match[2]);
  if (!rocYear || monthNumber < 1 || monthNumber > 12) return null;
  return (rocYear + 1911 + years) * 12 + (monthNumber - 1);
}

function priceForRowAt(row, target) {
  const plan = parseTwoStagePricePlan(row?.pricePlan || row?.階段金額);
  const fallbackPrice = lastMonthlyPriceFromText(row?.price) || row?.price || "";
  if (!plan || !target || !row?.start) return fallbackPrice;
  const secondStageStartIndex = addYearsToRocDateIndex(row.start, plan.firstYears);
  if (secondStageStartIndex === null) return fallbackPrice;
  return target.absoluteIndex >= secondStageStartIndex ? plan.secondPrice : plan.firstPrice;
}

function isAutoGeneratedPaymentRow(row) {
  const key = String(row?._rowKey || "");
  const note = String(row?.note || "");
  return key.includes("|auto-next|") || /由.+?(新增|新循環|續約|既有資料)自動帶入/.test(note) || note.includes("自動帶入");
}

function isBackfillSourceRow(row) {
  if (!row || isAutoGeneratedPaymentRow(row) || isClosingSection(row.section)) return false;
  if (row.manualStatus === "nonbillable") return false;
  if (!cycleMonthsFor(row)) return false;
  const note = String(row.note || "");
  if (note.includes(contractConfirmationNote)) return false;
  if (/不收款|不需收款|不用收款|已歇業|已退款/.test(note)) return false;
  return Boolean(normalizeCustomerId(row.id) || row.company || row.name);
}

function hasSuppressionBetween(row, venue, fromIndex, toIndex) {
  const suppressed = readSuppressedPaymentRows();
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const target = monthInfoForAbsoluteIndex(index);
    if (suppressed.has(suppressedRowKeyFor(row, venue, target.monthLabel, target.year))) return true;
  }
  return false;
}

function generatedRowForTarget(sourceRow, venue, sourceMonth, sourceYear, targetMonth, targetYear) {
  const cycleMonths = cycleMonthsFor(sourceRow);
  const sourceIndex = monthAbsoluteIndexFor(sourceYear, sourceMonth);
  const targetIndex = monthAbsoluteIndexFor(targetYear, targetMonth);
  if (!cycleMonths || sourceIndex === null || targetIndex === null || targetIndex <= sourceIndex) return null;
  if ((targetIndex - sourceIndex) % cycleMonths !== 0) return null;
  if (hasSuppressionBetween(sourceRow, venue, sourceIndex + 1, targetIndex)) return null;

  const endIndex = minguoMonthIndexForRocDate(sourceRow?.end);
  if (endIndex !== null && targetIndex > endIndex) return null;

  const target = monthInfoForAbsoluteIndex(targetIndex);
  const nextIndex = targetIndex + cycleMonths;
  const isContractStop = endIndex !== null && targetIndex > endIndex;
  return normalizeRowSemantics(
    {
      ...sourceRow,
      _rowKey: `${venue}|${targetYear}|${targetMonth}|auto-next|draft-virtual|${normalizeCustomerId(sourceRow.id)}|${sourceIndex}`,
      price: priceForRowAt(sourceRow, target),
      paidDate: "",
      paidAmount: "",
      nextDate: isContractStop ? "" : monthInfoForAbsoluteIndex(nextIndex).nextDate,
      invoice: "",
      manualStatus: "",
      note: isContractStop
        ? `${contractConfirmationNote}；由${sourceYear}年${sourceMonth}既有資料自動帶入`
        : `由${sourceYear}年${sourceMonth}既有資料自動帶入`,
    },
    venue,
  );
}

function paymentSourceYearsFor(venue, targetYear) {
  const years = new Set([String(initialPaymentYear)]);
  readPaymentYearState().years?.[venue]?.forEach((year) => years.add(normalizeYear(year)));
  scanStoredPaymentYears(venue).forEach((year) => years.add(normalizeYear(year)));
  return Array.from(years)
    .map(Number)
    .filter((year) => year >= initialPaymentYear && year <= Number(targetYear))
    .sort((a, b) => a - b);
}

function generatedPaymentRowsFor(venue, targetMonth, targetYear) {
  const generated = [];
  const targetIndex = monthAbsoluteIndexFor(targetYear, targetMonth);
  if (targetIndex === null) return generated;
  paymentSourceYearsFor(venue, targetYear).forEach((sourceYear) => {
    monthLabels.forEach((sourceMonth) => {
      const sourceIndex = monthAbsoluteIndexFor(sourceYear, sourceMonth);
      if (sourceIndex === null || sourceIndex >= targetIndex) return;
      storedPaymentRowsFor(venue, sourceMonth, sourceYear).forEach((sourceRow) => {
        if (!isBackfillSourceRow(sourceRow)) return;
        const generatedRow = generatedRowForTarget(sourceRow, venue, sourceMonth, sourceYear, targetMonth, targetYear);
        if (generatedRow) generated.push(generatedRow);
      });
    });
  });
  return generated;
}

function paymentRowsFor(venue, month, year = activeYear) {
  const cacheKey = [venue, year, month].join("|");
  if (paymentRowsCache.has(cacheKey)) return paymentRowsCache.get(cacheKey);
  const rows = [...storedPaymentRowsFor(venue, month, year)];
  generatedPaymentRowsFor(venue, month, Number(year)).forEach((generatedRow) => {
    if (isSuppressedPaymentRow(generatedRow, venue, month, year)) return;
    if (rows.some((row) => samePaymentForDraftMonth(row, generatedRow))) return;
    rows.push(generatedRow);
  });
  paymentRowsCache.set(cacheKey, rows);
  return rows;
}

function isClosingSection(section) {
  return String(section || "").startsWith("待遷出");
}

function isNonBillableRow(row) {
  if (row.paidDate || row.paidAmount || isClosingSection(row.section)) return false;
  if (row.manualStatus === "normal") return false;
  if (row.manualStatus === "nonbillable") return true;
  const note = String(row.note || "");
  return ["不需收款", "不用收款", "不收款", "不需繳費", "不用繳費"].some((keyword) => note.includes(keyword));
}

function hasFutureNextPayment(row, year = activeYear, monthLabel = activeMonth) {
  const targetIndex = monthAbsoluteIndexFor(year, monthLabel);
  const nextIndex = parseRocMonthIndex(row?.nextDate);
  return Boolean(targetIndex !== null && nextIndex !== null && nextIndex > targetIndex);
}

function isContractConfirmationRow(row, year = activeYear, monthLabel = activeMonth) {
  if (!row || isClosingSection(row.section) || isNonBillableRow(row)) return false;
  return String(row?.note || "").includes(contractConfirmationNote);
}

function rowHasPaidAmount(row) {
  return Boolean(normalizePaymentValue(row.paidAmount));
}

function rowResolvedForDraft(row) {
  return Boolean(rowHasPaidAmount(row) || isClosingSection(row?.section) || isNonBillableRow(row));
}

function rowNeedsCustomerDraft(row) {
  if (!row) return false;
  if (rowResolvedForDraft(row)) return false;
  if (isClosingSection(row.section)) return false;
  if (isNonBillableRow(row)) return false;
  return Boolean(normalizeCustomerId(row.id) || row.company || row.name);
}

function cycleMonthsFor(row) {
  const normalized = normalizePaymentValue(row?.cycle).toUpperCase();
  if (normalized === "M") return 1;
  if (normalized === "3M") return 3;
  if (normalized === "6M") return 6;
  if (normalized === "Y" || /^\d+Y$/.test(normalized)) return 12;
  return 0;
}

function payableMonthsFor(row) {
  const cycle = normalizePaymentValue(row?.cycle).toUpperCase();
  if (cycle === "M") return 1;
  if (cycle === "3M") return 3;
  if (cycle === "6M") return 6;
  if (cycle === "Y" || /^\d+Y$/.test(cycle)) return 12;
  return 0;
}

function rowAmount(row) {
  const monthly = lastNumberFromText(row?.price);
  const months = payableMonthsFor(row);
  if (!monthly || !months) return "";
  return String(monthly * months);
}

function formatMoney(value) {
  const number = Number(String(value || "").replace(/[^\d]/g, ""));
  return number ? number.toLocaleString("en-US") : String(value || "");
}

function numericMoney(value) {
  const number = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function planAnnualLabel(monthly) {
  const number = numericMoney(monthly);
  return number ? `$${formatMoney(number * 12)} / 年繳` : "輸入月租後自動換算";
}

function planLine(label, monthly) {
  const number = numericMoney(monthly);
  if (!number) return "";
  const annual = formatMoney(number * 12);
  if (label === "two") {
    return `✅ 兩年合約：$${formatMoney(number)}/每月，年繳 $${annual}。（一年繳一次，共分兩年繳。）`;
  }
  return `✅ 一年合約：$${formatMoney(number)}/每月，年繳 $${annual}。`;
}

function renewalPlanFromBody(body) {
  const text = String(body || "");
  const oneMatch = text.match(/一年合約：\$?([\d,]+)\/每月，年繳\s*\$?([\d,]+)/);
  const twoMatch = text.match(/兩年合約：\$?([\d,]+)\/每月，年繳\s*\$?([\d,]+)/);
  return {
    one: {
      enabled: Boolean(oneMatch),
      monthly: oneMatch ? oneMatch[1].replaceAll(",", "") : "",
    },
    two: {
      enabled: Boolean(twoMatch),
      monthly: twoMatch ? twoMatch[1].replaceAll(",", "") : "",
    },
  };
}

function renewalPlanLines(plan) {
  const lines = [];
  if (plan?.one?.enabled) {
    const line = planLine("one", plan.one.monthly);
    if (line) lines.push(line);
  }
  if (plan?.two?.enabled) {
    const line = planLine("two", plan.two.monthly);
    if (line) lines.push(line);
  }
  return lines.length ? lines.join("\n") : "✅ 續約方案請依 CRM / 合約確認。";
}

function replaceRenewalPlanSection(body, plan) {
  const text = String(body || "");
  const nextBlock = "💡 請回覆您的續約方式：";
  const replacement = `📌 續約方案：\n${renewalPlanLines(plan)}\n\n${nextBlock}`;
  if (!text.includes("📌 續約方案：") || !text.includes(nextBlock)) return text;
  return text.replace(/📌 續約方案：[\s\S]*?💡 請回覆您的續約方式：/, replacement);
}

function isRenewalDraftMessage(item, message) {
  return String(item?.kind || "").includes("續約") || /續約/.test(`${message?.label || ""}\n${message?.body || ""}`);
}

function draftActionForItem(item, status = effectiveStatus(item)) {
  if (status === "needs-check" || String(item?.kind || "").includes("待確認")) {
    return {
      label: "需確認",
      detail: "資料不夠直接貼，先確認公司、金額、日期或服務項目。",
    };
  }
  if (String(item?.kind || "").includes("續約") && status === "follow") {
    return {
      label: "續約待回覆",
      detail: "已貼續約通知，等客戶回覆或下一步合約。",
    };
  }
  if (String(item?.kind || "").includes("續約")) {
    return {
      label: "續約詢問",
      detail: "合約快到期，先問客戶是否續約與選哪個方案。",
    };
  }
  if (status === "follow") {
    return {
      label: "催款追蹤",
      detail: "已貼過通知但繳費表還沒完成，時間到再追。",
    };
  }
  return {
    label: "繳費通知",
    detail: "本期費用要貼給客戶，金額與期間要能直接複製。",
  };
}

function serviceKindFor(row) {
  const text = [row?.section, row?.item, row?.company].map((value) => String(value || "")).join(" ");
  if (text.includes("辦公室")) return "辦公室";
  if (text.includes("自由座") || text.includes("共享座位")) return "自由座";
  if (text.includes("代收信件") || text.includes("營登") || text.includes("營業登記") || text.includes("年繳") || text.includes("2Y")) {
    return "營登";
  }
  return "待確認";
}

function displayNameFor(row) {
  return row.company && row.company !== "自由座" ? row.company : row.name || row.company || row.id;
}

function bankTextFor(venue) {
  if (venue === "huanrui") {
    return `匯款帳號:
帳戶名稱：樞紐前沿股份有限公司
銀行名稱：台北富邦銀行(國美分行)
行庫代號：012
帳號：8212000-0205049`;
  }
  return `匯款帳號:
帳戶名稱：你的空間有限公司
銀行名稱：永豐商業銀行(南台中分行)
行庫代號：807
帳號：03801800183399`;
}

function parseRocDateParts(value) {
  const match = String(value || "").trim().match(/(\d{2,4})\s*[\\/.-]\s*(\d{1,4})(?:\s*[\\/.-]\s*(\d{1,2}))?/);
  if (!match) return null;
  const compactMonthDay = !match[3] && match[2].length >= 3 ? match[2].padStart(4, "0") : "";
  const month = Number(compactMonthDay ? compactMonthDay.slice(0, -2) : match[2]);
  const day = Number(compactMonthDay ? compactMonthDay.slice(-2) : match[3] || 1);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function parseFullRocDateParts(value) {
  const match = normalizePaymentValue(value).match(/(\d{2,4})\s*[\\/.-]\s*(\d{1,4})(?:\s*[\\/.-]\s*(\d{1,2}))?/);
  if (!match) return null;
  const rawYear = Number(match[1]);
  const compactMonthDay = !match[3] && match[2].length >= 3 ? match[2].padStart(4, "0") : "";
  const monthNumber = Number(compactMonthDay ? compactMonthDay.slice(0, -2) : match[2]);
  const day = Number(compactMonthDay ? compactMonthDay.slice(-2) : match[3] || 1);
  if (!rawYear || monthNumber < 1 || monthNumber > 12 || day < 1 || day > 31) return null;
  const westernYear = rawYear > 1911 ? rawYear : rawYear + 1911;
  const safeDay = Math.min(day, daysInMonth(westernYear, monthNumber));
  return {
    rocYear: westernYear - 1911,
    westernYear,
    monthNumber,
    day: safeDay,
  };
}

function parseRocMonthIndex(value) {
  const match = String(value || "").trim().match(/(\d{2,4})\s*[\\/.-]\s*(\d{1,4})/);
  if (!match) return null;
  const rocYear = Number(match[1]);
  const compactMonthDay = match[2].length >= 3 ? match[2].padStart(4, "0") : "";
  const monthNumber = Number(compactMonthDay ? compactMonthDay.slice(0, -2) : match[2]);
  if (!rocYear || monthNumber < 1 || monthNumber > 12) return null;
  return (rocYear + 1911) * 12 + (monthNumber - 1);
}

function reachesOrPassesContractEnd(row, year, monthLabel) {
  const targetIndex = monthAbsoluteIndexFor(year, monthLabel);
  const endIndex = parseRocMonthIndex(row?.end);
  if (targetIndex === null || endIndex === null) return false;
  return targetIndex >= endIndex;
}

function formatWesternDate(year, monthNumber, day) {
  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatMonthDay(monthNumber, day) {
  return `${String(monthNumber).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, monthNumber) {
  return new Date(year, monthNumber, 0).getDate();
}

function addMonths(year, monthNumber, months) {
  const absolute = year * 12 + (monthNumber - 1) + months;
  return {
    year: Math.floor(absolute / 12),
    monthNumber: (absolute % 12) + 1,
  };
}

function addCalendarMonthsClamped(year, monthNumber, day, months) {
  const target = addMonths(year, monthNumber, months);
  return {
    ...target,
    day: Math.min(day, daysInMonth(target.year, target.monthNumber)),
  };
}

function shiftDateParts(year, monthNumber, day, days) {
  const date = new Date(Date.UTC(year, monthNumber - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    monthNumber: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function previousWorkdayIfWeekend(dateParts) {
  const dayOfWeek = new Date(Date.UTC(dateParts.year, dateParts.monthNumber - 1, dateParts.day)).getUTCDay();
  if (dayOfWeek === 6) return shiftDateParts(dateParts.year, dateParts.monthNumber, dateParts.day, -1);
  if (dayOfWeek === 0) return shiftDateParts(dateParts.year, dateParts.monthNumber, dateParts.day, -2);
  return dateParts;
}

function billingPeriodFor(row, monthLabel, year) {
  const monthNumber = monthLabels.indexOf(monthLabel) + 1;
  const startParts = parseRocDateParts(row?.start);
  const day = startParts?.day || 1;
  const cycleMonths = cycleMonthsFor(row) || 1;
  const end = addMonths(Number(year), monthNumber, cycleMonths);
  return {
    start: formatWesternDate(Number(year), monthNumber, day),
    end: formatWesternDate(end.year, end.monthNumber, day),
    due: `${String(monthNumber).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
  };
}

function renewalDueFor(row) {
  const parts = parseRocDateParts(row?.end);
  if (!parts) return "";
  return formatMonthDay(parts.month, parts.day);
}

function renewalNoticeFor(row) {
  const end = parseFullRocDateParts(row?.end);
  if (!end) return null;
  const rawNotice = addCalendarMonthsClamped(end.westernYear, end.monthNumber, end.day, -1);
  const notice = previousWorkdayIfWeekend(rawNotice);
  return {
    year: notice.year,
    month: `${notice.monthNumber}月`,
    monthNumber: notice.monthNumber,
    day: notice.day,
    dateKey: formatWesternDate(notice.year, notice.monthNumber, notice.day),
    due: formatMonthDay(notice.monthNumber, notice.day),
    contractDue: formatMonthDay(end.monthNumber, end.day),
    contractDateKey: formatWesternDate(end.westernYear, end.monthNumber, end.day),
  };
}

function draftStatusForRow(row, year, month) {
  if (targetIsFuture(year, month)) return "upcoming";
  const note = String(row?.note || "");
  if (["已通知", "已貼", "提醒"].some((keyword) => note.includes(keyword))) return "follow";
  return "today";
}

function draftStatusForDate(dateKey) {
  const date = parseDateKey(dateKey);
  const today = parseDateKey(todayKey());
  if (!date || !today) return "today";
  return date > today ? "upcoming" : "today";
}

function stableAutoDraftId(row, venue, month, year) {
  const key = [year, venue, month, normalizeCustomerId(row.id), row.section, row.cycle, row.start, row.end].join("|");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return `auto-${year}-${venue}-${monthLabels.indexOf(month) + 1}-${normalizeCustomerId(row.id) || "noid"}-${hash.toString(36)}`;
}

function stableRenewalLeadDraftId(row, venue, notice) {
  const key = [
    "renewal-lead",
    notice.year,
    venue,
    notice.month,
    notice.dateKey,
    normalizeCustomerId(row.id),
    row.company,
    row.name,
    row.cycle,
    row.start,
    row.end,
  ].join("|");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return `renewal-${notice.year}-${venue}-${notice.monthNumber}-${normalizeCustomerId(row.id) || "noid"}-${hash.toString(36)}`;
}

function paymentMessageFor(row, venue, month, year) {
  const service = serviceKindFor(row);
  const period = billingPeriodFor(row, month, year);
  const amount = rowAmount(row);
  const name = displayNameFor(row);
  const venueName = venueLabels[venue];
  if (service === "自由座") {
    return `您好，${name} 您的自由座本期繳費日為 ${period.due}，如需繼續使用請繳納費用 ${formatMoney(amount)} 元，謝謝您！

可以使用以下方式付款，麻煩匯款備註您的姓名以利查帳用，若完成匯款，再麻煩提供帳戶後五碼供查詢。

如欲付現金請聯繫告知，謝謝。

${bankTextFor(venue)}`;
  }
  if (service === "辦公室") {
    return `🌟Hour Jungle 辦公室繳費通知🌟

${name} 您好，辦公室本期：${period.start}～${period.end}
繳納金額：${formatMoney(amount)} 元，繳費截止日為 ${period.due} 前，謝謝！

可以使用以下方式付款，麻煩匯款備註您的公司名以利查帳用，
若完成匯款；再麻煩提供帳戶後五碼供查詢，謝謝您。

${bankTextFor(venue)}`;
  }
  return `🌟營業登記繳費通知🌟

${name} 您好，營業登記本期：${period.start}～${period.end}
繳納金額：${formatMoney(amount)} 元，繳費截止日為 ${period.due} 前，謝謝！

可以使用以下方式付款，麻煩匯款備註您的公司名以利查帳用，
若完成匯款；再麻煩提供帳戶後五碼供查詢，謝謝您。

${bankTextFor(venue)}

Hour Jungle ${venueName} 敬上`;
}

function renewalMessageFor(row, venue) {
  const service = serviceKindFor(row);
  const name = displayNameFor(row);
  const due = renewalDueFor(row) || "合約到期日";
  const venueName = venueLabels[venue];
  const monthly = lastNumberFromText(row?.price);
  const annual = monthly ? monthly * 12 : "";
  const priceLine = annual ? `✅ 一年合約：$${formatMoney(monthly)}/每月，年繳 $${formatMoney(annual)}。` : "✅ 續約方案請依 CRM / 合約確認。";
  const moveOutLine =
    service === "自由座"
      ? ""
      : `
📌 若不續約，請您務必於合約到期日前開始辦理遷出或終止相關作業，以免影響押金退還。`;
  return `🔔 Hour Jungle 合約續約通知 🔔

親愛的客戶，${name} 您好！

感謝您一直以來對 Hour Jungle${venueName} 的支持與信賴！您的合約即將於 ${due} 到期，敬請確認是否續約，以確保服務不中斷。

📌 續約方案：
${priceLine}

💡 請回覆您的續約方式：
🔹 線上續約：我們將提供 PDF 合約，請您列印簽名後回傳
🔹 臨櫃續約：可至 Hour Jungle ${venueName} 簽署合約${moveOutLine}

如有任何問題，請隨時與我們聯繫。

Hour Jungle ${venueName} 敬上`;
}

function autoDraftForRow(row, venue, month, year) {
  if (!rowNeedsCustomerDraft(row)) return null;
  const service = serviceKindFor(row);
  if (service === "待確認") return null;
  const isRenewal = isContractConfirmationRow(row, year, month);
  const amount = isRenewal ? "方案選擇" : rowAmount(row);
  if (!isRenewal && !amount) return null;
  const period = billingPeriodFor(row, month, year);
  const titleName = displayNameFor(row);
  return {
    id: stableAutoDraftId(row, venue, month, year),
    year: Number(year),
    venue,
    month,
    status: draftStatusForRow(row, year, month),
    paymentRefs: [{ venue, month, year: Number(year), id: row.id }],
    kind: isRenewal ? "續約" : service,
    title: `${row.id ? `${row.id} ` : ""}${titleName}`,
    subtitle: isRenewal ? `${renewalDueFor(row) || month} 到期，需確認續約` : `${service} ${row.cycle || ""} / ${period.due}`,
    due: isRenewal ? renewalDueFor(row) || month : period.due,
    amount: isRenewal ? amount : formatMoney(amount),
    messages: [
      {
        label: isRenewal ? "續約確認" : `${service}繳費`,
        body: isRenewal ? renewalMessageFor(row, venue) : paymentMessageFor(row, venue, month, year),
      },
    ],
    autoGenerated: true,
  };
}

function rowNeedsRenewalLeadDraft(row) {
  if (!row || isClosingSection(row.section) || isNonBillableRow(row)) return false;
  const note = String(row.note || "");
  if (/不續約|不續|已遷出|已結束|已退款|已歇業|收尾/.test(note)) return false;
  if (!normalizeCustomerId(row.id) && !row.company && !row.name) return false;
  return Boolean(parseFullRocDateParts(row.end));
}

function renewalLeadDraftForRow(row, venue, sourceMonth, sourceYear) {
  if (!rowNeedsRenewalLeadDraft(row)) return null;
  const service = serviceKindFor(row);
  if (service === "待確認") return null;
  const notice = renewalNoticeFor(row);
  if (!notice) return null;
  const titleName = displayNameFor(row);
  return {
    id: stableRenewalLeadDraftId(row, venue, notice),
    year: Number(notice.year),
    venue,
    month: notice.month,
    status: draftStatusForDate(notice.dateKey),
    paymentRefs: sourceMonth && sourceYear ? [{ venue, month: sourceMonth, year: Number(sourceYear), id: row.id }] : [],
    kind: "續約",
    title: `${row.id ? `${row.id} ` : ""}${titleName}`,
    subtitle: `${notice.contractDue} 到期，提前一個月通知`,
    due: notice.due,
    amount: "續約確認",
    messages: [
      {
        label: "續約確認",
        body: renewalMessageFor(row, venue),
      },
    ],
    autoGenerated: true,
    renewalLead: true,
  };
}

function paymentRefExists(ref, fallback = {}) {
  const rows = paymentRowsFor(ref.venue || fallback.venue || activeVenue, ref.month || fallback.month || activeMonth, ref.year || fallback.year || activeYear);
  const refId = normalizeCustomerId(ref.id);
  if (!refId) return rows.length > 0;
  return rows.some((row) => normalizeCustomerId(row.id) === refId);
}

function paymentRowForRef(ref, fallback = {}) {
  const rows = paymentRowsFor(ref.venue || fallback.venue || activeVenue, ref.month || fallback.month || activeMonth, ref.year || fallback.year || activeYear);
  const refId = normalizeCustomerId(ref.id);
  if (!refId) return rows[0] || null;
  return rows.find((row) => normalizeCustomerId(row.id) === refId) || null;
}

function manualDraftIsLive(item) {
  if (!item.paymentRefs?.length) return !manualDraftHasBlankBody(item);
  return item.paymentRefs.some((ref) => paymentRefExists(ref, item));
}

function manualDraftLooksLikePayment(item) {
  const kind = String(item?.kind || "");
  if (kind.includes("續約")) return false;
  return (item?.messages || []).some((message) => {
    const text = `${message?.label || ""}\n${message?.body || ""}`;
    return /繳費|待收款|付款|匯款/.test(text);
  });
}

function manualDraftHasBlankBody(item) {
  const messages = item?.messages || [];
  return !messages.length || messages.some((message) => !String(message?.body || "").trim());
}

function normalizeManualDraftItem(item) {
  const normalizedRefs = (item.paymentRefs || []).map((ref) => ({ ...ref, year: Number(ref.year || item.year || initialPaymentYear) }));
  const normalized = {
    ...item,
    year: Number(item.year || initialPaymentYear),
    paymentRefs: normalizedRefs,
  };
  const ref = normalizedRefs[0];
  if (!ref) return normalized;
  const row = paymentRowForRef(ref, normalized);
  if (!row) return normalized;
  const rowIsRenewal = isContractConfirmationRow(row, ref.year, ref.month);
  const normalizedIsRenewal = String(normalized.kind || "").includes("續約");
  const normalizedHasBlankBody = manualDraftHasBlankBody(normalized);
  if (!rowIsRenewal && !normalizedIsRenewal && !normalizedHasBlankBody && !manualDraftLooksLikePayment(normalized)) return normalized;
  if (!rowIsRenewal && (normalizedIsRenewal || normalizedHasBlankBody)) {
    const paymentDraft = autoDraftForRow(row, ref.venue || normalized.venue, ref.month || normalized.month, ref.year || normalized.year);
    return paymentDraft
      ? {
          ...paymentDraft,
          id: normalized.id,
          status: normalized.status || paymentDraft.status,
          autoGenerated: normalized.autoGenerated,
        }
      : null;
  }
  if (!rowIsRenewal) return normalized;
  const renewalDraft = autoDraftForRow(row, ref.venue || normalized.venue, ref.month || normalized.month, ref.year || normalized.year);
  if (!renewalDraft) return normalized;
  return {
    ...renewalDraft,
    id: normalized.id,
    status: normalized.status || renewalDraft.status,
    autoGenerated: normalized.autoGenerated,
  };
}

function manualDraftKey(item) {
  return (item.paymentRefs || [])
    .map((ref) => [Number(ref.year || item.year || initialPaymentYear), ref.venue || item.venue, ref.month || item.month, normalizeCustomerId(ref.id)].join("|"))
    .join(";");
}

function autoDraftKey(item) {
  const ref = item.paymentRefs?.[0] || {};
  return [Number(ref.year || item.year || initialPaymentYear), ref.venue || item.venue, ref.month || item.month, normalizeCustomerId(ref.id)].join("|");
}

function dedupeManualDraftItems(items) {
  const seen = new Map();
  const looseItems = [];
  items.forEach((item) => {
    const key = manualDraftKey(item);
    if (!key) {
      looseItems.push(item);
      return;
    }
    key
      .split(";")
      .filter(Boolean)
      .forEach((singleKey) => {
        if (!seen.has(singleKey)) seen.set(singleKey, item);
      });
  });
  return [...looseItems, ...Array.from(new Set(seen.values()))];
}

function buildAutoDraftItems(year = activeYear) {
  const manualKeys = new Set(
    manualDraftItems
      .filter(manualDraftIsLive)
      .map(manualDraftKey)
      .flatMap((key) => key.split(";"))
      .filter(Boolean),
  );
  const generated = [];
  const generatedKeys = new Set();
  const sourceYears = Array.from(new Set([Number(year), Number(year) + 1]));
  venueKeys.forEach((venue) => {
    sourceYears.forEach((sourceYear) => {
      monthLabels.forEach((month) => {
        paymentRowsFor(venue, month, sourceYear).forEach((row) => {
          if (Number(sourceYear) === Number(year)) {
            const item = autoDraftForRow(row, venue, month, year);
            if (item) {
              const key = autoDraftKey(item);
              if (!manualKeys.has(key) && !generatedKeys.has(key)) {
                generatedKeys.add(key);
                generated.push(item);
              }
            }
          }
          const renewalLead = renewalLeadDraftForRow(row, venue, month, sourceYear);
          if (!renewalLead || Number(renewalLead.year) !== Number(year)) return;
          if (generatedKeys.has(renewalLead.id)) return;
          generatedKeys.add(renewalLead.id);
          generated.push(renewalLead);
        });
      });
    });
  });
  return generated;
}

function refreshDraftItems() {
  paymentRowsCache = new Map();
  const normalizedManual = dedupeManualDraftItems(
    manualDraftItems
      .filter(manualDraftIsLive)
      .map(normalizeManualDraftItem)
      .filter(Boolean),
  );
  draftItems = [...normalizedManual, ...buildAutoDraftItems(activeYear)];
}

function rowHasPaidAmount(row) {
  return Boolean(normalizePaymentValue(row.paidAmount));
}

function paymentRefComplete(ref) {
  const rows = paymentRowsFor(ref.venue || activeVenue, ref.month || activeMonth, ref.year || activeYear);
  const matches = rows.filter((row) => normalizePaymentValue(row.id) === normalizePaymentValue(ref.id));
  if (matches.length === 0) return false;
  return matches.some(rowResolvedForDraft);
}

function draftIsPaymentComplete(item) {
  if (!item.paymentRefs?.length) return false;
  return item.paymentRefs.every(paymentRefComplete);
}

function noticeForItem(item) {
  return noticeKeysForItem(item)
    .map((key) => newerNoticeLog(noticeLog[key], item.lastNotifiedAt))
    .filter(Boolean)
    .sort((a, b) => String(b.lastNotifiedAt || "").localeCompare(String(a.lastNotifiedAt || "")))[0] || null;
}

function effectiveStatus(item) {
  if (draftIsPaymentComplete(item)) return "done";
  if (isSnoozed(item)) return "follow";
  const notice = noticeForItem(item);
  if (!notice?.lastNotifiedAt) return item.status;
  const age = daysSince(notice.lastNotifiedAt);
  if (age !== null && age >= FOLLOW_UP_DAYS) return "today";
  return "follow";
}

function visibleStatusItems(status = activeStatus) {
  return draftItems.filter((item) => Number(item.year || initialPaymentYear) === Number(activeYear) && effectiveStatus(item) === status);
}

function noticeSummary(item) {
  if (draftIsPaymentComplete(item)) return "繳費表已有繳費金額，這則草稿不用再追";
  if (isSnoozed(item)) {
    const note = item.followNote ? `；${item.followNote}` : "";
    return `暫延到 ${item.snoozeUntil}${note}`;
  }
  const notice = noticeForItem(item);
  if (!notice?.lastNotifiedAt) return "尚未記錄已貼通知";
  if (item.followNote) return `${item.followNote}；上次已貼：${notice.lastNotifiedAt}`;
  const age = daysSince(notice.lastNotifiedAt);
  if (age === null) return `上次已貼：${notice.lastNotifiedAt}`;
  if (age >= FOLLOW_UP_DAYS) return `上次已貼：${notice.lastNotifiedAt}，已 ${age} 天，繳費表仍未完成`;
  return `上次已貼：${notice.lastNotifiedAt}，第 ${age + 1} 天，滿 ${FOLLOW_UP_DAYS} 天會再回今日該貼`;
}

function markDraftNotified(id) {
  const item = draftItems.find((draft) => draft.id === id) || { id };
  noticeKeysForItem(item).forEach((key) => {
    const previous = noticeLog[key] || {};
    noticeLog[key] = {
      lastNotifiedAt: todayKey(),
      count: Number(previous.count || 0) + 1,
    };
  });
  saveNoticeLog();
  window.HJ_DB?.markDraftItemNotified?.(item)?.catch((error) => {
    console.warn("同步已貼通知狀態失敗", error);
  });
}

function visibleDrafts() {
  return draftItems.filter(
    (item) =>
      Number(item.year || initialPaymentYear) === Number(activeYear) &&
      effectiveStatus(item) === activeStatus &&
      item.venue === activeVenue &&
      item.month === activeMonth,
  );
}

function countByStatus(status) {
  return draftItems.filter(
    (item) =>
      Number(item.year || initialPaymentYear) === Number(activeYear) &&
      effectiveStatus(item) === status &&
      item.venue === activeVenue &&
      item.month === activeMonth,
  ).length;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTestClassification(item, status) {
  if (!draftTestMode) return "";
  const action = draftActionForItem(item, status);
  return `
    <div class="draft-test-classification">
      <span>測試分類</span>
      <strong>${escapeHtml(action.label)}</strong>
      <small>${escapeHtml(action.detail)}</small>
    </div>
  `;
}

function renderRenewalPlanEditor(item, message, index, currentBody) {
  if (!draftTestMode || !isRenewalDraftMessage(item, message)) return "";
  const plan = renewalPlanFromBody(currentBody);
  const planRow = (key, label) => {
    const data = plan[key] || {};
    const enabled = Boolean(data.enabled);
    const monthly = data.monthly || "";
    return `
      <label class="renewal-plan-row">
        <input type="checkbox" data-plan-enable="${key}" ${enabled ? "checked" : ""} />
        <span>${label}</span>
        <input type="text" inputmode="numeric" data-plan-monthly="${key}" value="${escapeHtml(monthly)}" placeholder="月租" ${enabled ? "" : "disabled"} />
        <output data-plan-annual="${key}">${escapeHtml(planAnnualLabel(monthly))}</output>
      </label>
    `;
  };
  return `
    <div class="renewal-plan-editor" data-renewal-plan-editor data-draft-id="${escapeHtml(item.id)}" data-draft-index="${index}">
      <div class="renewal-plan-head">
        <strong>可選方案</strong>
        <span>勾選方案、輸入月租，年繳會自動換算並更新下方文字。</span>
      </div>
      <div class="renewal-plan-grid">
        ${planRow("one", "一年合約")}
        ${planRow("two", "兩年合約")}
      </div>
    </div>
  `;
}

function readRenewalPlanEditor(editor) {
  const readPlan = (key) => {
    const checkbox = editor.querySelector(`[data-plan-enable="${key}"]`);
    const input = editor.querySelector(`[data-plan-monthly="${key}"]`);
    return {
      enabled: Boolean(checkbox?.checked),
      monthly: input?.value || "",
    };
  };
  return {
    one: readPlan("one"),
    two: readPlan("two"),
  };
}

function syncRenewalPlanEditor(editor, plan = readRenewalPlanEditor(editor)) {
  ["one", "two"].forEach((key) => {
    const input = editor.querySelector(`[data-plan-monthly="${key}"]`);
    const output = editor.querySelector(`[data-plan-annual="${key}"]`);
    const enabled = Boolean(plan[key]?.enabled);
    if (input) input.disabled = !enabled;
    if (output) output.textContent = planAnnualLabel(plan[key]?.monthly);
  });
}

function syncDraftEditState(box, item, index) {
  const isEdited = item ? draftMessageIsEdited(item, Number(index)) : false;
  box?.querySelector(".draft-edit-state")?.classList.toggle("is-hidden", !isEdited);
  const resetButton = box?.querySelector("[data-reset-draft-message]");
  if (resetButton) resetButton.disabled = !isEdited;
}

function handleRenewalPlanEditorChange(editor) {
  const draftId = editor.dataset.draftId;
  const index = Number(editor.dataset.draftIndex);
  const textarea = document.querySelector(`[data-draft-text="${draftId}"][data-draft-index="${index}"]`);
  const item = draftItems.find((draft) => draft.id === draftId);
  if (!textarea || !item) return;
  const plan = readRenewalPlanEditor(editor);
  syncRenewalPlanEditor(editor, plan);
  textarea.value = replaceRenewalPlanSection(textarea.value, plan);
  updateDraftMessage(draftId, index, textarea.value);
  const box = textarea.closest(".draft-message-box");
  resizeDraftTextareas(box || document);
  syncDraftEditState(box, item, index);
}

function renderCounts() {
  Object.keys(statusLabels).forEach((status) => {
    const target = document.querySelector(`[data-draft-count="${status}"]`);
    if (target) target.textContent = countByStatus(status);
  });
}

function renderYearTools() {
  const select = document.querySelector("#draftYearSelect");
  if (!select) return;
  const years = availableDraftYears();
  if (!years.includes(String(activeYear))) years.push(String(activeYear));
  years.sort((a, b) => Number(a) - Number(b));
  select.innerHTML = years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");
  select.value = String(activeYear);
}

function renderTabs() {
  document.querySelector(".draft-schedule-page")?.setAttribute("data-active-venue", activeVenue);
  document.querySelector(".draft-schedule-page")?.setAttribute("data-active-year", String(activeYear));
  document.querySelector(".draft-schedule-page")?.setAttribute("data-draft-test", draftTestMode ? "1" : "0");
  document.querySelectorAll("[data-draft-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.draftFilter === activeStatus);
  });
  document.querySelectorAll("[data-draft-venue]").forEach((button) => {
    button.classList.toggle("active", button.dataset.draftVenue === activeVenue);
  });
  document.querySelectorAll("[data-draft-month]").forEach((button) => {
    button.classList.toggle("active", button.dataset.draftMonth === activeMonth);
  });
}

function renderList() {
  const list = document.querySelector("#draftList");
  const items = visibleDrafts();
  document.querySelector("#draftListEyebrow").textContent = `${activeYear} ${venueLabels[activeVenue]} / ${activeMonth}`;
  document.querySelector("#draftListTitle").textContent = statusLabels[activeStatus];
  document.querySelector("#draftListCount").textContent = `${items.length} 則`;

  if (items.length === 0) {
    list.innerHTML = `
      <div class="draft-list-empty">
        <i data-lucide="circle-check"></i>
        <strong>這一格目前沒有草稿</strong>
        <span>不代表客戶消失，只是這個分類現在沒有要貼的文字。</span>
      </div>
    `;
    selectedDraftId = null;
    renderReader();
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (!items.some((item) => item.id === selectedDraftId)) {
    selectedDraftId = items[0].id;
  }

  list.innerHTML = items
    .map(
      (item) => {
        const action = draftTestMode ? draftActionForItem(item, effectiveStatus(item)) : null;
        return `
        <button class="draft-list-item ${item.id === selectedDraftId ? "active" : ""}" type="button" data-select-draft="${item.id}">
          <span class="draft-kind">${escapeHtml(action?.label || item.kind)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.subtitle)}</small>
          <span class="draft-trace">${escapeHtml(noticeSummary(item))}</span>
          <span class="draft-meta">
            <b>${escapeHtml(item.due)}</b>
            <b>${escapeHtml(item.amount)}</b>
          </span>
        </button>
      `;
      },
    )
    .join("");
  renderReader();
}

function renderReader() {
  const reader = document.querySelector("#draftReader");
  const item = draftItems.find((draft) => draft.id === selectedDraftId);
  if (!item) {
    reader.innerHTML = `
      <div class="draft-empty-state">
        <i data-lucide="mouse-pointer-click"></i>
        <h2>點左邊草稿</h2>
        <p>右邊會出現可直接複製的訊息框。</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const currentStatus = effectiveStatus(item);
  const isComplete = currentStatus === "done";

  reader.innerHTML = `
    <div class="draft-reader-head">
      <div>
        <p class="eyebrow">${escapeHtml(item.year || initialPaymentYear)} ${escapeHtml(venueLabels[item.venue])} / ${escapeHtml(item.month)}</p>
        <h2>${escapeHtml(item.title)}</h2>
        <span>${escapeHtml(item.subtitle)}</span>
        <p class="draft-follow-note">${escapeHtml(noticeSummary(item))}</p>
        ${renderTestClassification(item, currentStatus)}
      </div>
      <div class="draft-reader-actions">
        <span class="mini-pill">${escapeHtml(statusLabels[currentStatus] || "已完成")}</span>
        <button class="notice-button" type="button" data-mark-notified="${item.id}" ${isComplete ? "disabled" : ""}>
          <i data-lucide="${isComplete ? "circle-check" : "send"}"></i>
          <span>${isComplete ? "繳費已完成" : "已貼通知"}</span>
        </button>
      </div>
    </div>
    ${item.messages
      .map(
        (message, index) => {
          const currentBody = draftMessageBody(item, index);
          const isEdited = draftMessageIsEdited(item, index);
          return `
          <section class="draft-message-box">
            <div class="draft-message-bar">
              <div class="draft-message-title">
                <strong>${escapeHtml(message.label)}</strong>
                <span class="draft-edit-state ${isEdited ? "" : "is-hidden"}">已手動修改</span>
              </div>
              <div class="draft-message-actions">
                <button class="draft-restore-button" type="button" data-reset-draft-message="${item.id}" data-reset-index="${index}" ${isEdited ? "" : "disabled"}>
                  <i data-lucide="rotate-ccw"></i>
                  <span>還原</span>
                </button>
                <button class="copy-button large" type="button" data-copy-scheduled="${item.id}" data-copy-index="${index}">
                  <i data-lucide="copy"></i>
                  <span>複製</span>
                </button>
              </div>
            </div>
            ${renderRenewalPlanEditor(item, message, index, currentBody)}
            <textarea data-draft-text="${item.id}" data-draft-index="${index}">${escapeHtml(currentBody)}</textarea>
          </section>
        `;
        },
      )
      .join("")}
  `;
  resizeDraftTextareas();
  if (window.lucide) window.lucide.createIcons();
}

function resizeDraftTextareas(scope = document) {
  scope.querySelectorAll(".draft-message-box textarea").forEach((textarea) => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 4}px`;
  });
}

function copyText(text) {
  const element = document.createElement("textarea");
  element.value = text;
  element.style.position = "fixed";
  element.style.left = "-999px";
  document.body.appendChild(element);
  element.focus();
  element.select();
  document.execCommand("copy");
  element.remove();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1600);
}

function renderAll() {
  refreshDraftItems();
  renderYearTools();
  renderCounts();
  renderTabs();
  renderList();
}

document.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-draft-filter]");
  if (filter) {
    activeStatus = filter.dataset.draftFilter;
    selectedDraftId = null;
    renderAll();
    return;
  }

  const venue = event.target.closest("[data-draft-venue]");
  if (venue) {
    activeVenue = venue.dataset.draftVenue;
    selectedDraftId = null;
    renderAll();
    return;
  }

  const month = event.target.closest("[data-draft-month]");
  if (month) {
    activeMonth = month.dataset.draftMonth;
    if (targetIsFuture(activeYear, activeMonth)) {
      activeStatus = "upcoming";
    } else if (activeStatus === "upcoming") {
      activeStatus = "today";
    }
    selectedDraftId = null;
    renderAll();
    return;
  }

  const refreshPaymentState = event.target.closest("[data-refresh-payment-state]");
  if (refreshPaymentState) {
    renderAll();
    showToast("已重新讀取繳費表與訊息");
    return;
  }

  const selectDraft = event.target.closest("[data-select-draft]");
  if (selectDraft) {
    selectedDraftId = selectDraft.dataset.selectDraft;
    renderList();
    return;
  }

  const markButton = event.target.closest("[data-mark-notified]");
  if (markButton) {
    markDraftNotified(markButton.dataset.markNotified);
    showToast("已記錄貼過通知，未收款會繼續追");
    renderAll();
    return;
  }

  const resetButton = event.target.closest("[data-reset-draft-message]");
  if (resetButton && !resetButton.disabled) {
    resetDraftMessage(resetButton.dataset.resetDraftMessage, resetButton.dataset.resetIndex);
    renderReader();
    showToast("已還原這則草稿");
    return;
  }

  const copyButton = event.target.closest("[data-copy-scheduled]");
  if (!copyButton) return;

  const textarea = document.querySelector(
    `[data-draft-text="${copyButton.dataset.copyScheduled}"][data-draft-index="${copyButton.dataset.copyIndex}"]`,
  );
  if (!textarea) return;
  copyText(textarea.value);
  showToast("已複製這則草稿");
});

document.addEventListener("input", (event) => {
  const renewalEditor = event.target.closest("[data-renewal-plan-editor]");
  if (renewalEditor) {
    handleRenewalPlanEditorChange(renewalEditor);
    return;
  }

  const textarea = event.target.closest("[data-draft-text]");
  if (!textarea) return;
  updateDraftMessage(textarea.dataset.draftText, textarea.dataset.draftIndex, textarea.value);
  resizeDraftTextareas(textarea.closest(".draft-message-box") || document);
  const item = draftItems.find((draft) => draft.id === textarea.dataset.draftText);
  const box = textarea.closest(".draft-message-box");
  syncDraftEditState(box, item, textarea.dataset.draftIndex);
});

document.addEventListener("change", (event) => {
  const renewalEditor = event.target.closest("[data-renewal-plan-editor]");
  if (renewalEditor) {
    handleRenewalPlanEditorChange(renewalEditor);
    return;
  }

  const yearSelect = event.target.closest("#draftYearSelect");
  if (!yearSelect) return;
  setDraftYear(yearSelect.value);
  selectedDraftId = null;
  renderAll();
  showToast(`已切到 ${activeYear} 訊息`);
});

renderAll();
if (window.lucide) window.lucide.createIcons();
