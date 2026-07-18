import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class MockElement {
  constructor(selector = "") {
    this.selector = selector;
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.innerHTML = "";
    this.textContent = "";
    this.dataset = {};
    this.children = [];
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    };
  }

  addEventListener() {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  querySelector() {
    return new MockElement();
  }
  querySelectorAll() {
    return [];
  }
  focus() {}
  scrollIntoView() {}
  remove() {}
}

function createContext() {
  const store = new Map();
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (selector === "#paymentRows") return null;
      if (!elements.has(selector)) elements.set(selector, new MockElement(selector));
      return elements.get(selector);
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return new MockElement(tag);
    },
    addEventListener() {},
  };

  const localStorage = {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] || null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    dump() {
      return Object.fromEntries([...store.entries()].sort(([a], [b]) => a.localeCompare(b)));
    },
  };

  const context = {
    console,
    Date,
    Intl,
    Math,
    JSON,
    RegExp,
    Set,
    Map,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    localStorage,
    document,
    window: {},
  };
  context.window = {
    hjDefaultPaymentRows: [],
    hjImportedPaymentData: { taichung: {}, huanrui: {} },
    hjImportedPaymentDataByYear: { taichung: {}, huanrui: {} },
    addEventListener() {},
    requestAnimationFrame(callback) {
      return callback();
    },
    setTimeout(callback) {
      return callback();
    },
    clearTimeout() {},
    localStorage,
    document,
    lucide: { createIcons() {} },
  };
  context.globalThis = context;
  return context;
}

function runPayments(context) {
  vm.createContext(context);
  const sourcePath = process.env.PAYMENTS_SOURCE || new URL("../ops/payments.js", import.meta.url);
  const source = fs.readFileSync(sourcePath, "utf8");
  vm.runInContext(source, context, { filename: "ops/payments.js" });
}

function setBaseRows(context, venue, year, month, rows) {
  context.window.hjImportedPaymentDataByYear[venue] ||= {};
  context.window.hjImportedPaymentDataByYear[venue][String(year)] ||= {};
  context.window.hjImportedPaymentDataByYear[venue][String(year)][month] = rows;
}

function loadRows(context, venue, month, year) {
  return vm.runInContext(`loadPaymentRows(${JSON.stringify(venue)}, ${JSON.stringify(month)}, ${year})`, context);
}

function rowsById(rows, id) {
  return rows.filter((row) => String(row.id) === String(id));
}

async function runSmartImport(context, { venue, month, year, id, crmRow }) {
  context.__crmRows = [crmRow];
  context.__smartImport = { venue, month, year, id };
  const result = await vm.runInContext(
    `(async () => {
      activeVenue = __smartImport.venue;
      activeMonth = __smartImport.month;
      activeYear = __smartImport.year;
      paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
      selectedRowIndex = paymentRows.findIndex((row) => String(row.id) === String(__smartImport.id));
      rowBasicsOpen = true;
      fetchCrmRows = () => Promise.resolve(__crmRows);
      renderAll = () => {};
      showToast = (message) => { globalThis.__lastToast = message; };
      await smartFillRenewalFromCrm();
      return paymentRows;
    })()`,
    context,
  );
  delete context.__crmRows;
  delete context.__smartImport;
  return result;
}

async function runRapidDoubleImport(context, { venue, month, year, id, crmRow }) {
  context.__crmRows = [crmRow];
  context.__smartImport = { venue, month, year, id };
  await vm.runInContext(
    `(async () => {
      activeVenue = __smartImport.venue;
      activeMonth = __smartImport.month;
      activeYear = __smartImport.year;
      paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
      selectedRowIndex = paymentRows.findIndex((row) => String(row.id) === String(__smartImport.id));
      renderAll = () => {};
      showToast = () => {};
      let release;
      fetchCrmRows = () => new Promise((resolve) => { release = () => resolve(__crmRows); });
      const first = smartFillRenewalFromCrm();
      const second = smartFillRenewalFromCrm();
      release();
      await Promise.all([first, second]);
    })()`,
    context,
  );
  delete context.__crmRows;
  delete context.__smartImport;
}

async function runDeferredSwitchImport(context, { source, destination, crmRow }) {
  context.__crmRows = [crmRow];
  context.__source = source;
  context.__destination = destination;
  await vm.runInContext(
    `(async () => {
      activeVenue = __source.venue;
      activeMonth = __source.month;
      activeYear = __source.year;
      paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
      selectedRowIndex = paymentRows.findIndex((row) => String(row.id) === String(__source.id));
      renderAll = () => {};
      showToast = (message) => { globalThis.__lastToast = message; };
      let release;
      fetchCrmRows = () => new Promise((resolve) => { release = () => resolve(__crmRows); });
      const pending = smartFillRenewalFromCrm();
      activeVenue = __destination.venue;
      activeMonth = __destination.month;
      activeYear = __destination.year;
      paymentRows = loadPaymentRows(activeVenue, activeMonth, activeYear);
      selectedRowIndex = null;
      release();
      await pending;
    })()`,
    context,
  );
  delete context.__crmRows;
  delete context.__source;
  delete context.__destination;
}

function minguoDate(year, month, day = 1) {
  return `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function addYears(date, years) {
  const [year, month, day] = date.split("/").map(Number);
  return `${year + years}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function sectionFor(service, cycle) {
  if (service === "辦公室") return "辦公室";
  if (service === "自由座") return "自由座";
  if (service === "營業登記" || service === "營登" || service === "代收信件") return "營登";
  return ["Y", "2Y", "3Y"].includes(cycle) ? "年繳 / 2Y" : "營登";
}

function cycleMonths(cycle) {
  return { M: 1, "3M": 3, "6M": 6, Y: 12, "2Y": 12, "3Y": 12 }[cycle];
}

function monthIndex(year, month) {
  return year * 12 + month - 1;
}

function monthFromIndex(index) {
  return {
    year: Math.floor(index / 12),
    month: (index % 12) + 1,
  };
}

function expectedSchedule(fixture) {
  const step = cycleMonths(fixture.cycle);
  const endIndex = monthIndex(fixture.newStartYear + fixture.contractYears, fixture.month);
  const expected = [];
  for (let index = monthIndex(fixture.newStartYear, fixture.month) + step; index <= endIndex; index += step) {
    const target = monthFromIndex(index);
    expected.push({ ...target, confirmation: index === endIndex });
  }
  return expected;
}

function buildFixture(venue, number, config) {
  const prefix = venue === "taichung" ? "TST-TC" : "V";
  const id = venue === "taichung" ? `${prefix}-${String(900 + number)}` : `V${9900 + number}`;
  const company = `匿名測試公司-${prefix}-${number}`;
  const name = `匿名測試人-${prefix}-${number}`;
  const oldStart = minguoDate(config.newStartYear - config.oldContractYears, config.month, config.day || 1);
  const newStart = minguoDate(config.newStartYear, config.month, config.day || 1);
  const newEnd = addYears(newStart, config.contractYears);
  const oldSection = sectionFor(config.service, config.oldCycle || config.cycle);
  const newSection = sectionFor(config.service, config.cycle);
  return {
    venue,
    id,
    company,
    name,
    newCompany: config.renameOnRenewal ? `${company}-續約更名` : company,
    newName: config.renameOnRenewal ? `${name}-新聯絡人` : name,
    service: config.service,
    cycle: config.cycle,
    oldCycle: config.oldCycle || config.cycle,
    oldSection,
    newSection,
    oldStart,
    oldEnd: newStart,
    newStart,
    newEnd,
    newStartYear: config.newStartYear,
    month: config.month,
    monthLabel: `${config.month}月`,
    contractYears: config.contractYears,
    oldPrice: `${config.oldPrice || 1500}/m`,
    newPrice: `${config.newPrice || 1800}/m`,
  };
}

const fixtureConfigs = {
  taichung: [
    { month: 1, service: "辦公室", cycle: "M", contractYears: 1, oldContractYears: 1, renameOnRenewal: true },
    { month: 2, service: "營業登記", cycle: "6M", contractYears: 2, oldContractYears: 2 },
    { month: 3, service: "辦公室", cycle: "3M", contractYears: 3, oldContractYears: 1 },
    { month: 4, service: "營業登記", cycle: "Y", contractYears: 1, oldContractYears: 1 },
    { month: 5, service: "營業登記", cycle: "2Y", contractYears: 2, oldContractYears: 2 },
    { month: 6, service: "辦公室", cycle: "6M", contractYears: 5, oldContractYears: 1, newPrice: 12000 },
    { month: 7, service: "營業登記", cycle: "3Y", contractYears: 3, oldContractYears: 1 },
    { month: 8, service: "辦公室", cycle: "M", contractYears: 5, oldContractYears: 1, newPrice: 9800 },
    { month: 9, service: "營業登記", cycle: "6M", contractYears: 5, oldContractYears: 2 },
    { month: 10, service: "辦公室", cycle: "Y", contractYears: 2, oldContractYears: 1, newPrice: 32000 },
  ],
  huanrui: [
    { month: 11, service: "辦公室", cycle: "3M", contractYears: 1, oldContractYears: 1, newPrice: 33000, renameOnRenewal: true },
    { month: 12, service: "營業登記", cycle: "Y", contractYears: 2, oldContractYears: 1 },
    { month: 1, service: "營業登記", cycle: "6M", contractYears: 3, oldContractYears: 2 },
    { month: 2, service: "辦公室", cycle: "M", contractYears: 2, oldContractYears: 1, newPrice: 11000 },
    { month: 3, service: "營業登記", cycle: "2Y", contractYears: 2, oldContractYears: 2 },
    { month: 4, service: "辦公室", cycle: "6M", contractYears: 5, oldContractYears: 1, newPrice: 30000 },
    { month: 5, service: "營業登記", cycle: "3Y", contractYears: 3, oldContractYears: 1 },
    { month: 6, service: "營業登記", cycle: "M", contractYears: 1, oldContractYears: 1 },
    { month: 7, service: "辦公室", cycle: "3M", contractYears: 5, oldContractYears: 2, newPrice: 28000 },
    { month: 8, service: "營業登記", cycle: "Y", contractYears: 5, oldContractYears: 1 },
  ],
};

const fixtures = Object.entries(fixtureConfigs).flatMap(([venue, configs]) =>
  configs.map((config, index) => buildFixture(venue, index + 1, { ...config, newStartYear: 2026 })),
);

function assertCurrentHistoryRow(rows, fixture) {
  const matches = rowsById(rows, fixture.id);
  assert.equal(matches.length, 1, `${fixture.id}: current month must contain one row`);
  const row = matches[0];
  assert.equal(row.section, fixture.oldSection, `${fixture.id}: old section must stay unchanged`);
  assert.equal(row.name, fixture.name, `${fixture.id}: old name must stay unchanged`);
  assert.equal(row.company, fixture.company, `${fixture.id}: old company must stay unchanged`);
  assert.equal(row.cycle, fixture.oldCycle, `${fixture.id}: old cycle must stay unchanged`);
  assert.equal(row.start, fixture.oldStart, `${fixture.id}: old start must stay unchanged`);
  assert.equal(row.end, fixture.oldEnd, `${fixture.id}: old end must stay unchanged`);
  assert.equal(row.price, fixture.oldPrice, `${fixture.id}: old price must stay unchanged`);
  assert.equal(row.paidDate, "TEST-PAID-DATE", `${fixture.id}: paid date must stay unchanged`);
  assert.equal(row.paidAmount, "TEST-PAID-AMOUNT", `${fixture.id}: paid amount must stay unchanged`);
  assert.equal(row.invoice, "TEST-INVOICE", `${fixture.id}: invoice must stay unchanged`);
  assert.equal(row.renewalProcessed, true, `${fixture.id}: history row must record that renewal was processed`);
  assert.equal(row.renewalImported, false, `${fixture.id}: history row must not contain a hidden renewal period`);
  assert.equal(row.renewalPeriod, null, `${fixture.id}: CRM renewal data must not be stored on the history row`);
  return row;
}

function assertFutureSchedule(context, fixture) {
  const expected = expectedSchedule(fixture);
  const expectedKeys = new Set(expected.map(({ year, month }) => `${year}-${month}`));
  const actual = [];

  for (let year = 2026; year <= 2032; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const rows = rowsById(loadRows(context, fixture.venue, `${month}月`, year), fixture.id);
      if (year === 2026 && month === fixture.month) continue;
      assert.ok(rows.length <= 1, `${fixture.id}: duplicate row in ${year}/${month}`);
      if (!rows.length) continue;
      actual.push({ year, month, row: rows[0] });
    }
  }

  assert.deepEqual(
    actual.map(({ year, month }) => `${year}-${month}`),
    expected.map(({ year, month }) => `${year}-${month}`),
    `${fixture.id}: generated months must match payment cadence through contract end`,
  );

  for (const { year, month, row } of actual) {
    const expectedItem = expected.find((item) => item.year === year && item.month === month);
    assert.ok(expectedKeys.has(`${year}-${month}`), `${fixture.id}: unexpected generated month ${year}/${month}`);
    assert.equal(row.section, fixture.newSection, `${fixture.id}: future section in ${year}/${month}`);
    assert.equal(row.name, fixture.newName, `${fixture.id}: future name in ${year}/${month}`);
    assert.equal(row.company, fixture.newCompany, `${fixture.id}: future company in ${year}/${month}`);
    assert.equal(row.cycle, fixture.cycle, `${fixture.id}: future cycle in ${year}/${month}`);
    assert.equal(row.start, fixture.newStart, `${fixture.id}: future start in ${year}/${month}`);
    assert.equal(row.end, fixture.newEnd, `${fixture.id}: future end in ${year}/${month}`);
    assert.equal(row.price, fixture.newPrice, `${fixture.id}: future price in ${year}/${month}`);
    context.__futureRow = row;
    context.__futureMonth = `${month}月`;
    context.__futureYear = year;
    const confirmation = vm.runInContext(
      `isContractConfirmationRow(__futureRow, __futureMonth, __futureYear)`,
      context,
    );
    assert.equal(confirmation, expectedItem.confirmation, `${fixture.id}: confirmation state in ${year}/${month}`);
  }
}

async function verifyFixture(fixture) {
  const context = createContext();
  setBaseRows(context, fixture.venue, 2026, fixture.monthLabel, [
    {
      section: fixture.oldSection,
      id: fixture.id,
      name: fixture.name,
      company: fixture.company,
      cycle: fixture.oldCycle,
      start: fixture.oldStart,
      end: fixture.oldEnd,
      price: fixture.oldPrice,
      paidDate: "TEST-PAID-DATE",
      paidAmount: "TEST-PAID-AMOUNT",
      nextDate: "",
      invoice: "TEST-INVOICE",
      manualStatus: "normal",
      note: "合約到期，先確認續約",
    },
  ]);
  runPayments(context);

  const crmRow = {
    編號: fixture.id,
    姓名: fixture.newName,
    公司名稱: fixture.newCompany,
    項目: fixture.service,
    繳費方式: fixture.cycle,
    起始日期: fixture.newStart,
    合約到期日: fixture.newEnd,
    金額: fixture.newPrice,
    _source: "anonymous-regression-test",
  };

  await runRapidDoubleImport(context, {
    venue: fixture.venue,
    month: fixture.monthLabel,
    year: 2026,
    id: fixture.id,
    crmRow,
  });
  const importedRows = loadRows(context, fixture.venue, fixture.monthLabel, 2026);
  assertCurrentHistoryRow(importedRows, fixture);
  assertFutureSchedule(context, fixture);

  const beforeRepeat = JSON.stringify(context.localStorage.dump());
  await runSmartImport(context, {
    venue: fixture.venue,
    month: fixture.monthLabel,
    year: 2026,
    id: fixture.id,
    crmRow,
  });
  assert.equal(JSON.stringify(context.localStorage.dump()), beforeRepeat, `${fixture.id}: repeated import must be idempotent`);

  assert.equal(JSON.stringify(context.localStorage.dump()), beforeRepeat, `${fixture.id}: rapid double click must be idempotent`);
}

for (const fixture of fixtures) {
  await verifyFixture(fixture);
}

async function verifyExplicitFirstDueCase({
  label,
  venue = "taichung",
  sourceYear = 2026,
  sourceMonth,
  id,
  oldRow,
  crmRow,
  expectedMonths,
}) {
  const context = createContext();
  setBaseRows(context, venue, sourceYear, `${sourceMonth}月`, [
    {
      ...oldRow,
      id,
      paidDate: "TEST-PAID-DATE",
      paidAmount: "TEST-PAID-AMOUNT",
      invoice: "TEST-INVOICE",
      note: "合約到期，先確認續約",
    },
  ]);
  runPayments(context);

  const beforeHistory = rowsById(loadRows(context, venue, `${sourceMonth}月`, sourceYear), id)[0];
  await runSmartImport(context, {
    venue,
    month: `${sourceMonth}月`,
    year: sourceYear,
    id,
    crmRow: { 編號: id, ...crmRow },
  });

  const afterHistoryRows = rowsById(loadRows(context, venue, `${sourceMonth}月`, sourceYear), id);
  assert.equal(afterHistoryRows.length, 1, `${label}: historical month must keep exactly one row`);
  const afterHistory = afterHistoryRows[0];
  for (const field of ["section", "name", "company", "cycle", "start", "end", "price", "paidDate", "paidAmount", "nextDate", "invoice"]) {
    assert.equal(afterHistory[field], beforeHistory[field], `${label}: historical ${field} must not change`);
  }

  const actualMonths = [];
  for (let year = sourceYear; year <= 2032; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      if (year === sourceYear && month === sourceMonth) continue;
      const rows = rowsById(loadRows(context, venue, `${month}月`, year), id);
      assert.ok(rows.length <= 1, `${label}: ${year}/${month} must not contain duplicates`);
      if (rows.length) actualMonths.push(`${year}/${month}`);
    }
  }
  assert.deepEqual(actualMonths, expectedMonths, `${label}: explicit first due and CRM cadence must agree`);
}

await verifyExplicitFirstDueCase({
  label: "211 office payment-day transition",
  sourceMonth: 4,
  id: "TST-211",
  oldRow: {
    section: "辦公室", name: "匿名辦公室", company: "匿名辦公室公司", cycle: "3M",
    start: "114/04/15", end: "115/04/15", price: "32000/m", nextDate: "115/07",
  },
  crmRow: {
    姓名: "匿名辦公室", 公司名稱: "匿名辦公室公司", 項目: "辦公室", 繳費方式: "3M",
    起始日期: "115/04/01", 合約到期日: "116/04/01", 金額: "32000/m",
  },
  expectedMonths: ["2026/7", "2026/10", "2027/1", "2027/4"],
});

await verifyExplicitFirstDueCase({
  label: "206 two-year prepaid",
  sourceMonth: 3,
  id: "TST-206",
  oldRow: {
    section: "營登", name: "匿名兩年預繳", company: "匿名兩年預繳商行", cycle: "6M",
    start: "113/03/13", end: "115/03/13", price: "1650/m", nextDate: "117/03",
  },
  crmRow: {
    姓名: "匿名兩年預繳", 公司名稱: "匿名兩年預繳商行", 項目: "營業登記", 繳費方式: "2Y",
    起始日期: "115/03/13", 合約到期日: "117/03/13", 金額: "1650/m",
  },
  expectedMonths: ["2028/3"],
});

await verifyExplicitFirstDueCase({
  label: "6M to annual transition",
  sourceMonth: 6,
  id: "TST-6M-Y",
  oldRow: {
    section: "營登", name: "匿名改年繳", company: "匿名改年繳公司", cycle: "6M",
    start: "113/06/01", end: "115/06/01", price: "1690/m", nextDate: "116/06",
  },
  crmRow: {
    姓名: "匿名改年繳", 公司名稱: "匿名改年繳公司", 項目: "營登", 繳費方式: "Y",
    起始日期: "115/06/01", 合約到期日: "118/06/01", 金額: "1800/m",
  },
  expectedMonths: ["2027/6", "2028/6", "2029/6"],
});

await verifyExplicitFirstDueCase({
  label: "temporary annual payment then CRM 6M cadence",
  sourceMonth: 6,
  id: "TST-Y-6M",
  oldRow: {
    section: "營登", name: "匿名暫時年繳", company: "匿名暫時年繳公司", cycle: "6M",
    start: "113/06/01", end: "115/06/01", price: "1690/m", nextDate: "116/06",
  },
  crmRow: {
    姓名: "匿名暫時年繳", 公司名稱: "匿名暫時年繳公司", 項目: "營業登記", 繳費方式: "6M",
    起始日期: "115/06/01", 合約到期日: "117/06/01", 金額: "1690/m",
  },
  expectedMonths: ["2027/6", "2027/12", "2028/6"],
});

const sameCompanyContext = createContext();
const sharedCompany = "匿名同名公司-不得合併";
setBaseRows(sameCompanyContext, "taichung", 2026, "9月", [
  {
    section: "營登",
    id: "TST-TC-SAME-1",
    name: "匿名同名測試一",
    company: sharedCompany,
    cycle: "6M",
    start: "113/09/01",
    end: "115/09/01",
    price: "1500/m",
    note: "合約到期，先確認續約",
  },
  {
    section: "營登",
    id: "TST-TC-SAME-2",
    name: "匿名同名測試二",
    company: sharedCompany,
    cycle: "6M",
    start: "114/09/01",
    end: "116/09/01",
    price: "1600/m",
    note: "",
  },
]);
runPayments(sameCompanyContext);
await runSmartImport(sameCompanyContext, {
  venue: "taichung",
  month: "9月",
  year: 2026,
  id: "TST-TC-SAME-1",
  crmRow: {
    編號: "TST-TC-SAME-1",
    姓名: "匿名同名測試一",
    公司名稱: sharedCompany,
    項目: "營業登記",
    繳費方式: "6M",
    起始日期: "115/09/01",
    合約到期日: "117/09/01",
    金額: "1800/m",
  },
});
const sameCompanyRows = loadRows(sameCompanyContext, "taichung", "9月", 2026);
assert.equal(rowsById(sameCompanyRows, "TST-TC-SAME-1").length, 1, "exact ID target must remain one row");
assert.equal(rowsById(sameCompanyRows, "TST-TC-SAME-2").length, 1, "same company with another ID must remain untouched");
assert.equal(rowsById(sameCompanyRows, "TST-TC-SAME-2")[0].start, "114/09/01", "other ID period must not change");

const sameCompanyHuanruiContext = createContext();
setBaseRows(sameCompanyHuanruiContext, "huanrui", 2026, "10月", [
  {
    section: "營登",
    id: "V9981",
    name: "匿名環瑞同名測試一",
    company: sharedCompany,
    cycle: "Y",
    start: "114/10/01",
    end: "115/10/01",
    price: "1500/m",
    note: "合約到期，先確認續約",
  },
  {
    section: "營登",
    id: "V9982",
    name: "匿名環瑞同名測試二",
    company: sharedCompany,
    cycle: "Y",
    start: "114/10/01",
    end: "116/10/01",
    price: "1600/m",
    note: "",
  },
]);
runPayments(sameCompanyHuanruiContext);
await runSmartImport(sameCompanyHuanruiContext, {
  venue: "huanrui",
  month: "10月",
  year: 2026,
  id: "V9981",
  crmRow: {
    編號: "V9981",
    姓名: "匿名環瑞同名測試一",
    公司名稱: sharedCompany,
    項目: "營業登記",
    繳費方式: "Y",
    起始日期: "115/10/01",
    合約到期日: "116/10/01",
    金額: "1800/m",
  },
});
const sameCompanyHuanruiRows = loadRows(sameCompanyHuanruiContext, "huanrui", "10月", 2026);
assert.equal(rowsById(sameCompanyHuanruiRows, "V9981").length, 1, "huanrui exact ID target must remain one row");
assert.equal(rowsById(sameCompanyHuanruiRows, "V9982").length, 1, "huanrui same company with another ID must remain untouched");
assert.equal(rowsById(sameCompanyHuanruiRows, "V9982")[0].start, "114/10/01", "huanrui other ID period must not change");

const invalidDateCases = [
  { label: "blank start", start: "", end: "117/11/01" },
  { label: "blank end", start: "115/11/01", end: "" },
  { label: "reversed period", start: "117/11/01", end: "116/11/01" },
  { label: "invalid calendar date", start: "115/02/31", end: "116/02/28" },
];

for (const invalidCase of invalidDateCases) {
  const context = createContext();
  setBaseRows(context, "taichung", 2026, "11月", [
    {
      section: "營登",
      id: "TST-TC-DATE",
      name: "匿名日期防呆",
      company: "匿名日期防呆公司",
      cycle: "Y",
      start: "114/11/01",
      end: "115/11/01",
      price: "1500/m",
      paidDate: "TEST-PAID-DATE",
      paidAmount: "TEST-PAID-AMOUNT",
      invoice: "TEST-INVOICE",
      note: "合約到期，先確認續約",
    },
  ]);
  runPayments(context);
  const before = JSON.stringify(context.localStorage.dump());
  await runSmartImport(context, {
    venue: "taichung",
    month: "11月",
    year: 2026,
    id: "TST-TC-DATE",
    crmRow: {
      編號: "TST-TC-DATE",
      姓名: "匿名日期防呆",
      公司名稱: "匿名日期防呆公司",
      項目: "營業登記",
      繳費方式: "Y",
      起始日期: invalidCase.start,
      合約到期日: invalidCase.end,
      金額: "1800/m",
    },
  });
  assert.equal(JSON.stringify(context.localStorage.dump()), before, `${invalidCase.label}: invalid CRM dates must not mutate payment data`);
}

const sameVenueSwitchContext = createContext();
setBaseRows(sameVenueSwitchContext, "taichung", 2026, "7月", [
  {
    section: "營登",
    id: "TST-TC-SWITCH",
    name: "匿名切月測試",
    company: "匿名切月公司",
    cycle: "Y",
    start: "114/07/01",
    end: "115/07/01",
    price: "1500/m",
    note: "合約到期，先確認續約",
  },
]);
setBaseRows(sameVenueSwitchContext, "taichung", 2026, "8月", []);
runPayments(sameVenueSwitchContext);
const sameVenueSwitchBefore = JSON.stringify(sameVenueSwitchContext.localStorage.dump());
await runDeferredSwitchImport(sameVenueSwitchContext, {
  source: { venue: "taichung", month: "7月", year: 2026, id: "TST-TC-SWITCH" },
  destination: { venue: "taichung", month: "8月", year: 2026 },
  crmRow: {
    編號: "TST-TC-SWITCH",
    姓名: "匿名切月測試",
    公司名稱: "匿名切月公司",
    項目: "營業登記",
    繳費方式: "Y",
    起始日期: "115/07/01",
    合約到期日: "116/07/01",
    金額: "1800/m",
  },
});
assert.equal(
  JSON.stringify(sameVenueSwitchContext.localStorage.dump()),
  sameVenueSwitchBefore,
  "switching month while CRM loads must not mutate either month",
);

const crossVenueSwitchContext = createContext();
setBaseRows(crossVenueSwitchContext, "taichung", 2026, "4月", [
  {
    section: "辦公室",
    id: "211",
    name: "匿名跨館測試台中",
    company: "匿名跨館台中公司",
    cycle: "3M",
    start: "114/04/01",
    end: "115/04/01",
    price: "30000/m",
    note: "合約到期，先確認續約",
  },
]);
setBaseRows(crossVenueSwitchContext, "huanrui", 2026, "4月", [
  {
    section: "辦公室",
    id: "211",
    name: "匿名跨館測試環瑞",
    company: "匿名跨館環瑞公司",
    cycle: "3M",
    start: "114/04/01",
    end: "116/04/01",
    price: "32000/m",
    note: "",
  },
]);
runPayments(crossVenueSwitchContext);
const crossVenueSwitchBefore = JSON.stringify(crossVenueSwitchContext.localStorage.dump());
await runDeferredSwitchImport(crossVenueSwitchContext, {
  source: { venue: "taichung", month: "4月", year: 2026, id: "211" },
  destination: { venue: "huanrui", month: "4月", year: 2026 },
  crmRow: {
    編號: "211",
    姓名: "匿名跨館測試台中",
    公司名稱: "匿名跨館台中公司",
    項目: "辦公室",
    繳費方式: "3M",
    起始日期: "115/04/01",
    合約到期日: "116/04/01",
    金額: "33000/m",
  },
});
assert.equal(
  JSON.stringify(crossVenueSwitchContext.localStorage.dump()),
  crossVenueSwitchBefore,
  "switching venue while CRM loads must not mutate either venue even when IDs overlap",
);

const nonBillableContext = createContext();
setBaseRows(nonBillableContext, "huanrui", 2026, "6月", [
  {
    section: "自由座",
    id: "V9999",
    name: "匿名不收款測試",
    company: "匿名不收款公司",
    cycle: "M",
    start: "115/06/01",
    end: "-",
    price: "3000/m",
    manualStatus: "nonbillable",
    note: "不收款",
  },
]);
runPayments(nonBillableContext);
const nonBillableBefore = JSON.stringify(loadRows(nonBillableContext, "huanrui", "6月", 2026));
await runSmartImport(nonBillableContext, {
  venue: "huanrui",
  month: "6月",
  year: 2026,
  id: "V9999",
  crmRow: {
    編號: "V9999",
    姓名: "匿名不收款測試",
    公司名稱: "匿名不收款公司",
    項目: "辦公室",
    繳費方式: "6M",
    起始日期: "115/06/01",
    合約到期日: "116/06/01",
    金額: "10000/m",
  },
});
assert.equal(
  JSON.stringify(loadRows(nonBillableContext, "huanrui", "6月", 2026)),
  nonBillableBefore,
  "nonbillable history must remain untouched",
);

function installCrmBridge(context, venue, year, rows) {
  context.localStorage.setItem(
    "hj-crm-payment-bridge-v1",
    JSON.stringify({
      venues: {
        [venue]: {
          years: {
            [String(year)]: rows.map((row) => ({
              id: row.id,
              name: row.name,
              companyName: row.company,
              item: row.item,
              cycle: row.cycle,
              start: row.start,
              end: row.end,
              amount: row.amount,
            })),
          },
        },
      },
    }),
  );
}

const noCrmBackfillContext = createContext();
setBaseRows(noCrmBackfillContext, "taichung", 2026, "1月", [
  {
    section: "營登", id: "TST-NO-CRM", name: "匿名無CRM", company: "匿名無CRM公司",
    cycle: "Y", start: "114/01/01", end: "115/01/01", price: "1800/m", nextDate: "116/01",
  },
]);
runPayments(noCrmBackfillContext);
vm.runInContext(`backfillFuturePaymentsFromMonth("taichung", "1月", 2026, monthAbsoluteIndexFor(2027, 12))`, noCrmBackfillContext);
assert.equal(
  rowsById(loadRows(noCrmBackfillContext, "taichung", "1月", 2027), "TST-NO-CRM").length,
  0,
  "annual backfill must not guess from payment history when CRM is unavailable",
);

const explicitAfterEndContext = createContext();
setBaseRows(explicitAfterEndContext, "taichung", 2026, "1月", [
  {
    section: "營登", id: "TST-269", name: "匿名代收", company: "匿名代收公司",
    cycle: "Y", start: "115/01/01", end: "115/12/31", price: "1800/m", nextDate: "116/01",
  },
]);
runPayments(explicitAfterEndContext);
installCrmBridge(explicitAfterEndContext, "taichung", 2026, [
  {
    id: "TST-269", name: "匿名代收", company: "匿名代收公司", item: "代收信件",
    cycle: "Y", start: "115/01/01", end: "115/12/31", amount: "1800/m",
  },
]);
vm.runInContext(`backfillFuturePaymentsFromMonth("taichung", "1月", 2026, monthAbsoluteIndexFor(2027, 12))`, explicitAfterEndContext);
const explicitAfterEndRows = rowsById(loadRows(explicitAfterEndContext, "taichung", "1月", 2027), "TST-269");
assert.equal(explicitAfterEndRows.length, 1, "explicit next-payment evidence must create one due row after CRM end month");
assert.equal(explicitAfterEndRows[0].section, "營登", "代收信件 must remain in the CRM service section");
assert.equal(
  vm.runInContext(`isContractConfirmationRow(${JSON.stringify(explicitAfterEndRows[0])}, "1月", 2027)`, explicitAfterEndContext),
  true,
  "the explicit due row after contract end must require renewal confirmation",
);

const prepaidBackfillContext = createContext();
setBaseRows(prepaidBackfillContext, "taichung", 2026, "3月", [
  {
    section: "營登", id: "TST-206-BACKFILL", name: "匿名預繳", company: "匿名預繳公司",
    cycle: "6M", start: "113/03/13", end: "115/03/13", price: "1650/m", nextDate: "117/03",
  },
]);
runPayments(prepaidBackfillContext);
installCrmBridge(prepaidBackfillContext, "taichung", 2026, [
  {
    id: "TST-206-BACKFILL", name: "匿名預繳", company: "匿名預繳公司", item: "營業登記",
    cycle: "6M", start: "115/03/13", end: "117/03/13", amount: "1650/m",
  },
]);
vm.runInContext(`backfillFuturePaymentsFromMonth("taichung", "3月", 2026, monthAbsoluteIndexFor(2028, 12))`, prepaidBackfillContext);
assert.equal(rowsById(loadRows(prepaidBackfillContext, "taichung", "9月", 2026), "TST-206-BACKFILL").length, 0);
assert.equal(rowsById(loadRows(prepaidBackfillContext, "taichung", "3月", 2027), "TST-206-BACKFILL").length, 0);
assert.equal(
  rowsById(loadRows(prepaidBackfillContext, "taichung", "3月", 2028), "TST-206-BACKFILL").length,
  1,
  "explicit prepaid next-payment month must override ordinary CRM cadence for the first generated row",
);

const authoritativeTimelineContext = createContext();
setBaseRows(authoritativeTimelineContext, "taichung", 2026, "2月", [
  {
    section: "營登", id: "TST-AUTH", name: "匿名權威時間線", company: "匿名權威時間線公司",
    cycle: "6M", start: "114/02/15", end: "116/02/15", price: "1800/m", nextDate: "115/08",
  },
]);
setBaseRows(authoritativeTimelineContext, "taichung", 2026, "8月", [
  {
    section: "營登", id: "TST-AUTH", name: "匿名權威時間線", company: "匿名權威時間線公司",
    cycle: "6M", start: "114/02/15", end: "116/02/15", price: "1800/m", nextDate: "116/02",
  },
]);
runPayments(authoritativeTimelineContext);
installCrmBridge(authoritativeTimelineContext, "taichung", 2026, [
  {
    id: "TST-AUTH", name: "匿名權威時間線", company: "匿名權威時間線公司", item: "營業登記",
    cycle: "6M", start: "115/02/15", end: "117/02/15", amount: "1800/m",
  },
]);
vm.runInContext(`backfillFuturePaymentsForVenue("taichung", 2026, 2027)`, authoritativeTimelineContext);
assert.equal(
  rowsById(loadRows(authoritativeTimelineContext, "taichung", "2月", 2027), "TST-AUTH").length,
  1,
  "annual backfill must select the latest explicit next-payment anchor once per customer",
);
assert.equal(
  rowsById(loadRows(authoritativeTimelineContext, "taichung", "8月", 2026), "TST-AUTH").length,
  1,
  "annual backfill must not rewrite or duplicate the latest historical payment row",
);
vm.runInContext(`backfillFuturePaymentsForVenue("taichung", 2026, 2027)`, authoritativeTimelineContext);
assert.equal(
  rowsById(loadRows(authoritativeTimelineContext, "taichung", "2月", 2027), "TST-AUTH").length,
  1,
  "annual backfill must be idempotent when the same year is processed again",
);

const authoritativePrepaidContext = createContext();
setBaseRows(authoritativePrepaidContext, "taichung", 2026, "3月", [
  {
    section: "營登", id: "TST-AUTH-PREPAID", name: "匿名跨年預繳", company: "匿名跨年預繳公司",
    cycle: "6M", start: "113/03/13", end: "115/03/13", price: "1650/m", nextDate: "117/03",
  },
]);
runPayments(authoritativePrepaidContext);
installCrmBridge(authoritativePrepaidContext, "taichung", 2026, [
  {
    id: "TST-AUTH-PREPAID", name: "匿名跨年預繳", company: "匿名跨年預繳公司", item: "營業登記",
    cycle: "6M", start: "115/03/13", end: "117/03/13", amount: "1650/m",
  },
]);
vm.runInContext(`backfillFuturePaymentsForVenue("taichung", 2026, 2027)`, authoritativePrepaidContext);
assert.equal(rowsById(loadRows(authoritativePrepaidContext, "taichung", "3月", 2027), "TST-AUTH-PREPAID").length, 0);
assert.equal(rowsById(loadRows(authoritativePrepaidContext, "taichung", "9月", 2027), "TST-AUTH-PREPAID").length, 0);

const reopenedYearContext = createContext();
setBaseRows(reopenedYearContext, "taichung", 2026, "1月", [
  {
    section: "營登", id: "TST-REOPEN", name: "匿名年度重跑", company: "匿名年度重跑公司",
    cycle: "Y", start: "114/01/10", end: "115/01/10", price: "1800/m", nextDate: "116/01",
  },
]);
runPayments(reopenedYearContext);
installCrmBridge(reopenedYearContext, "taichung", 2026, [
  {
    id: "TST-REOPEN", name: "匿名年度重跑", company: "匿名年度重跑公司", item: "營業登記",
    cycle: "Y", start: "115/01/10", end: "116/01/10", amount: "1800/m",
  },
]);
vm.runInContext(`
  localStorage.setItem(paymentBackfillStateKey, JSON.stringify({
    [paymentBackfillVersion + ":2027"]: true,
  }));
  scheduleInitialBackfill(2027);
`, reopenedYearContext);
assert.equal(
  rowsById(loadRows(reopenedYearContext, "taichung", "1月", 2027), "TST-REOPEN").length,
  1,
  "reopening a previously processed year must rerun idempotent backfill after CRM changes",
);
vm.runInContext(`scheduleInitialBackfill(2027)`, reopenedYearContext);
assert.equal(
  rowsById(loadRows(reopenedYearContext, "taichung", "1月", 2027), "TST-REOPEN").length,
  1,
  "rerunning a reopened year must not duplicate the generated payment row",
);
assert.equal(
  rowsById(loadRows(reopenedYearContext, "taichung", "1月", 2026), "TST-REOPEN").length,
  1,
  "rerunning a reopened year must not rewrite the historical payment row",
);

const loaderSource = fs.readFileSync(new URL("../db-page-loader.js", import.meta.url), "utf8");
const paymentScriptLoadIndex = loaderSource.indexOf("for (const script of pageScripts[page]) await loadScript(script);");
const paymentSyncIndex = loaderSource.indexOf('if (page === "payments") window.HJ_DB.installLocalStorageSync();');
assert.ok(paymentScriptLoadIndex >= 0, "payment page loader must load its page script");
assert.ok(paymentSyncIndex > paymentScriptLoadIndex, "payment persistence must start after payment bootstrap");
assert.equal(
  loaderSource.includes('if (page === "payments") {\n        window.setTimeout'),
  false,
  "payment persistence must not leave a post-render click gap",
);

console.log(`payment smart import regression passed: ${fixtures.length} anonymous matrices + identity/date/switch/nonbillable guards`);
