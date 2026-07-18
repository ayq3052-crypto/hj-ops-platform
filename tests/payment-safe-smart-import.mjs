import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class MockElement {
  constructor() {
    this.value = "";
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  addEventListener() {}
  appendChild() {}
  remove() {}
  focus() {}
  scrollIntoView() {}
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
}

function makeContext() {
  const values = new Map();
  const elements = new Map();
  const document = {
    head: new MockElement(),
    querySelector(selector) {
      if (selector === "#paymentRows") return null;
      if (!elements.has(selector)) elements.set(selector, new MockElement());
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return new MockElement(); },
    addEventListener() {},
  };
  const localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries([...values.entries()].sort()); },
  };
  const context = {
    console, Date, Intl, Math, JSON, RegExp, Set, Map, Number, String, Boolean, Array, Object,
    parseInt, parseFloat, isNaN, document, localStorage,
  };
  context.window = {
    hjDefaultPaymentRows: [],
    hjImportedPaymentData: { taichung: {}, huanrui: {} },
    hjImportedPaymentDataByYear: { taichung: {}, huanrui: {} },
    HJPaymentAudit: { displaySectionForServiceAndCycle(service, cycle) {
      const text = String(service || "");
      if (text.includes("辦公室")) return "辦公室";
      if (text.includes("自由座")) return "自由座";
      if (text.includes("營登") || text.includes("營業登記")) return ["Y", "2Y", "3Y"].includes(String(cycle).toUpperCase()) ? "年繳 / 2Y" : "營登";
      return "";
    } },
    addEventListener() {}, requestAnimationFrame(fn) { fn(); },
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
    confirm() { return false; }, document, localStorage, lucide: { createIcons() {} },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../ops/payments.js", import.meta.url), "utf8"), context, { filename: "ops/payments.js" });
  return context;
}

function evalIn(context, source) {
  return vm.runInContext(source, context);
}

{
  const context = makeContext();
  context.__row = { section: "年繳 / 2Y", id: "105", company: "照鴻", cycle: "Y", start: "115/11/30", end: "116/11/30", price: "1800/m" };
  const plan = evalIn(context, `planFuturePaymentsForAddedCustomer(__row, "taichung", "11月", 2026, {sourceKind:"manual"})`);
  assert.equal(plan.candidates.length, 0, "annual contract must not create a renewal row at contract expiry");
  assert.equal(plan.stoppedForContract, true);
}

{
  const context = makeContext();
  context.__row = { section: "辦公室", id: "TST-OFFICE", company: "測試辦公室", cycle: "6M", start: "115/01/01", end: "116/01/01", price: "10000/m" };
  const plan = evalIn(context, `planFuturePaymentsForAddedCustomer(__row, "taichung", "1月", 2026, {sourceKind:"manual"})`);
  assert.deepEqual(Array.from(plan.candidates, (item) => `${item.year}/${item.month}/${item.row.section}`), ["2026/7月/辦公室"]);
}

{
  const context = makeContext();
  context.window.hjImportedPaymentDataByYear.taichung["2026"] = {
    "7月": [{ section: "辦公室", id: "TST-RENEW", name: "測試人員", company: "測試公司", cycle: "M", start: "114/06/01", end: "115/07/01", price: "10000/m", paidDate: "7/1", paidAmount: "10000", invoice: "V", note: "合約到期，先確認續約" }],
  };
  context.__current = { section: "辦公室", id: "TST-RENEW", name: "測試人員", company: "測試公司", cycle: "M", start: "114/06/01", end: "115/07/01", price: "10000/m", paidDate: "7/1", paidAmount: "10000", invoice: "V", note: "合約到期，先確認續約", _rowKey: "test-current" };
  evalIn(context, `activeVenue="taichung"; activeYear=2026; activeMonth="7月"; paymentRows=[__current]; selectedRowIndex=0;`);
  const before = JSON.stringify(context.localStorage.dump());
  context.__crm = [{ 編號: "TST-RENEW", 姓名: "測試人員", 公司: "測試公司", 項目: "辦公室", 繳費方式: "M", 起始日期: "115/07/01", 合約到期日: "116/07/01", 金額: "10000/m", _source: "google-sheet-crm-live" }];
  const result = await evalIn(context, `(async()=>{ isContractConfirmationRow=()=>true; findRenewalCrmMatch=()=>__crm[0]; validCompleteRenewalPeriod=()=>true; fetchCrmRows=()=>Promise.resolve(__crm); renderAll=()=>{}; showToast=(message)=>{globalThis.__toast=message}; return smartFillRenewalFromCrm(); })()`);
  assert.equal(result, true, context.__toast || "renewal preview should succeed");
  assert.equal(JSON.stringify(context.localStorage.dump()), before, "renewal smart fill must be preview-only");
  assert.equal(context.document.querySelector("#newCustomerId").value, "TST-RENEW");
  assert.equal(context.document.querySelector("#newCustomerSection").value, "辦公室");
}

{
  const context = makeContext();
  const prepare = () => {
    context.__crm = { 編號: "300", 姓名: "測試", 公司: "測試公司", 項目: "辦公室", 繳費方式: "M", 起始日期: "115/07/01", 合約到期日: "115/10/01", 金額: "1000/m", _source: "google-sheet-crm-live" };
    evalIn(context, `
      activeVenue="taichung"; activeYear=2026; activeMonth="7月"; paymentRows=loadPaymentRows(activeVenue,activeMonth,activeYear);
      fillNewCustomerFromCrm(__crm);
      setCrmCheckState("found", "found", "found", __crm);
      showToast=()=>{}; renderAll=()=>{};
    `);
  };
  prepare();
  const before = JSON.stringify(context.localStorage.dump());
  context.window.confirm = () => false;
  evalIn(context, `addCustomerToCurrentMonth()`);
  assert.equal(JSON.stringify(context.localStorage.dump()), before, "cancelled preview must not write");

  prepare();
  context.window.confirm = () => true;
  evalIn(context, `addCustomerToCurrentMonth()`);
  assert.equal(evalIn(context, `loadPaymentRows("taichung","7月",2026).filter(row=>row.id==="300").length`), 1);
  assert.equal(evalIn(context, `loadPaymentRows("taichung","8月",2026).filter(row=>row.id==="300").length`), 1);
  assert.equal(evalIn(context, `loadPaymentRows("taichung","9月",2026).filter(row=>row.id==="300").length`), 1);
  assert.equal(evalIn(context, `loadPaymentRows("taichung","10月",2026).filter(row=>row.id==="300").length`), 0, "expiry month must not be generated");

  const afterFirst = JSON.stringify(context.localStorage.dump());
  prepare();
  evalIn(context, `addCustomerToCurrentMonth()`);
  assert.equal(JSON.stringify(context.localStorage.dump()), afterFirst, "repeated confirmed add must be idempotent");
}

console.log("payment safe smart import: OK");

{
  const dbSource = fs.readFileSync(new URL("../db-client.js", import.meta.url), "utf8");
  const syncBlock = dbSource.slice(dbSource.indexOf("const syncPaymentRows"), dbSource.indexOf("const syncDraftEdits"));
  assert.ok(syncBlock.includes('.from("payment_month_rows")'), "payment sync table must be explicit");
  assert.equal(syncBlock.includes(".delete()"), false, "payment sync must never delete a whole month");
  assert.ok(syncBlock.includes("existingIdentities.has(identity)"), "payment sync must skip existing rows");
}

console.log("payment formal sync delete guard: OK");
