import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../ops/payment-audit-engine.js", import.meta.url), "utf8");

function loadEngine(globals = {}) {
  const window = { ...structuredClone(globals) };
  const context = vm.createContext({
    window,
    globalThis: window,
    console,
    structuredClone,
  });
  vm.runInContext(source, context, { filename: "payment-audit-engine.js" });
  return { engine: window.HJPaymentAudit, window };
}

const { engine } = loadEngine();

assert.ok(engine, "核對引擎必須掛在 window.HJPaymentAudit");
assert.equal(typeof engine.auditYear, "function");
assert.equal(typeof engine.auditCustomer, "function");
assert.equal(typeof engine.actionableFindings, "function");

for (const service of ["營登", "營業登記", "代收信件", "虛擬辦公室"]) {
  for (const cycle of ["Y", "2Y", "3Y"]) {
    assert.equal(engine.displaySectionForServiceAndCycle(service, cycle), "年繳 / 2Y", `${service} + ${cycle}`);
  }
  for (const cycle of ["M", "3M", "6M"]) {
    assert.equal(engine.displaySectionForServiceAndCycle(service, cycle), "營登", `${service} + ${cycle}`);
  }
}
for (const cycle of ["M", "3M", "6M", "Y", "2Y", "3Y"]) {
  assert.equal(engine.displaySectionForServiceAndCycle("辦公室", cycle), "辦公室", `辦公室 + ${cycle}`);
  assert.equal(engine.displaySectionForServiceAndCycle("自由座", cycle), "自由座", `自由座 + ${cycle}`);
}

function crmRow(overrides = {}) {
  return {
    branch_code: "taichung",
    customer_no: "A01",
    customer_name: "測試客戶",
    company_name: "測試有限公司",
    service_type: "營登",
    payment_cycle: "6M",
    contract_start: "2026-02-15",
    contract_end: "2027-02-15",
    monthly_amount: 1800,
    crm_status: "active",
    ...overrides,
  };
}

function paymentRow(overrides = {}) {
  return {
    branch_code: "taichung",
    year: 2027,
    month: 2,
    customer_no: "A01",
    customer_name: "測試客戶",
    company_name: "測試有限公司",
    service_type: "營登",
    payment_cycle: "6M",
    contract_start: "2026-02-15",
    contract_end: "2027-02-15",
    amount_due: 10800,
    source_snapshot: {
      name: "測試客戶",
      company: "測試有限公司",
      cycle: "6M",
      start: "115/02/15",
      end: "116/02/15",
      price: "1800/m",
    },
    ...overrides,
  };
}

{
  const report = engine.auditYear({
    venue: "taichung",
    year: 2028,
    crmRows: [crmRow({
      customer_no: "206",
      service_type: "營登",
      payment_cycle: "6M",
      contract_start: "2028-04-13",
      contract_end: "2030-04-13",
    })],
    paymentRowsByMonth: {},
    previousRowsByMonth: {
      3: [paymentRow({
        year: 2026,
        month: 3,
        customer_no: "206",
        nextDate: "117/03",
      })],
    },
  });
  assert.equal(
    report.missing.some(item => item.id === "206" && item.month === 3 && item.evidence === "PAYMENT_NEXT_DATE"),
    true,
    "舊繳費列的下次繳費日必須成為應收核對依據",
  );
}

{
  const report = engine.auditYear({
    venue: "taichung",
    year: 2026,
    crmRows: [crmRow({
      customer_no: "269",
      service_type: "代收信件",
      payment_cycle: "Y",
      contract_start: "2026-01-01",
      contract_end: "2026-12-31",
    })],
    paymentRowsByMonth: {},
    previousRowsByMonth: {},
  });
  assert.equal(report.missing[0]?.service, "代收信件", "代收信件必須保留 CRM 服務身分");
}

function audit({ crmRows = [crmRow()], paymentRows = [], sourceRows = [] } = {}) {
  return engine.auditYear({
    venue: "taichung",
    year: 2027,
    crmRows,
    paymentRowsByMonth: { 2: paymentRows },
    previousRowsByMonth: { 8: sourceRows },
  });
}

{
  const input = {
    crmRows: [crmRow()],
    paymentRowsByMonth: { 2: [] },
    previousRowsByMonth: {},
  };
  const before = structuredClone(input);
  const first = engine.auditYear({ venue: "taichung", year: 2027, ...input });
  const second = engine.auditYear({ venue: "taichung", year: 2027, ...input });

  assert.deepEqual(input, before, "核對不得修改 CRM 或繳費資料");
  assert.deepEqual(first, second, "相同輸入必須得到相同結果");
  assert.equal(first.missing.map(item => item.code).join(","), "MISSING_EXPECTED_ROW");
}

{
  const report = audit({ paymentRows: [paymentRow(), paymentRow()] });
  assert.equal(report.exactDuplicates.length, 1, "同一週期重複列必須被抓到");
  assert.equal(report.multiplePeriods.length, 0);
}

{
  const report = audit({
    paymentRows: [
      paymentRow(),
      paymentRow({
        payment_cycle: "Y",
        contract_start: "2027-02-15",
        contract_end: "2028-02-15",
        source_snapshot: {
          name: "測試客戶",
          company: "測試有限公司",
          cycle: "Y",
          start: "116/02/15",
          end: "117/02/15",
          price: "2000/m",
        },
      }),
    ],
  });
  assert.equal(report.multiplePeriods.length, 1, "同月同客戶的不同週期必須分開回報");
}

{
  const report = audit({
    crmRows: [crmRow({
      service_type: "營登",
      payment_cycle: "Y",
      monthly_amount: 2000,
      contract_start: "2027-02-15",
      contract_end: "2028-02-15",
    })],
    paymentRows: [paymentRow()],
  });

  assert.equal(report.mismatches.length, 0, "歷史列不能因 CRM 已更新新週期就被判成錯誤");
  assert.equal(report.missing.length, 0, "續約月的舊週期收款列可承接本次收款，不得另外製造新列");
}

{
  const report = audit({
    crmRows: [crmRow({ crm_status: "已結束" })],
    paymentRows: [],
  });
  assert.equal(report.missing.length, 0, "已結束客戶不應產生應收缺列");
}

{
  const report = audit({
    crmRows: [crmRow()],
    paymentRows: [paymentRow({ status: "不收款" })],
  });
  assert.equal(report.missing.length, 0, "不收款列不應被重新判為缺列");
  assert.equal(report.nonBillable.length, 1);
}

{
  const report = audit({
    crmRows: [crmRow({
      service_type: "辦公室",
      contract_start: "2027-02-15",
      contract_end: "2028-02-15",
    })],
    sourceRows: [paymentRow({
      year: 2026,
      month: 8,
      service_type: "自由座",
      contract_start: "2026-02-15",
      contract_end: "2027-02-15",
      status: "不收款",
    })],
  });
  assert.deepEqual(
    Array.from(report.missing, item => item.month),
    [2, 8],
    "舊年度的不收款紀錄不能讓同編號的新合約永遠不收款",
  );
}

{
  const report = audit({
    crmRows: [crmRow({
      service_type: "辦公室",
      contract_start: "2027-02-15",
      contract_end: "2028-02-15",
    })],
    paymentRows: [paymentRow({
      service_type: "自由座",
      contract_start: "2026-02-15",
      contract_end: "2027-02-15",
      status: "不收款",
    })],
  });
  assert.equal(report.missing.some(item => item.month === 2), true, "同月舊週期不收款不能冒充新合約已排程");
}

{
  const report = audit({
    crmRows: [crmRow({
      service_type: "辦公室",
      contract_start: "2027-02-15",
      contract_end: "2028-02-15",
    })],
    paymentRows: [paymentRow({
      service_type: "自由座",
      contract_start: "2026-02-15",
      contract_end: "2027-02-15",
      status: "完成",
      payment_amount: 3000,
    })],
  });
  assert.equal(
    report.missing.some(item => item.month === 2),
    true,
    "舊自由座即使已收款，也不能冒充同編號的新辦公室應收",
  );
}

{
  const report = audit({
    crmRows: [crmRow({ service_type: "營業登記" })],
    paymentRows: [paymentRow({
      service_type: "",
      section: "營登",
      source_snapshot: {
        name: "測試客戶",
        company: "測試有限公司",
        cycle: "6M",
        start: "115/02/15",
        end: "116/02/15",
        price: "1800/m",
        section: "營登",
      },
    })],
  });
  assert.equal(report.missing.length, 0, "營登與營業登記必須視為同一服務");
}

{
  const report = audit({
    crmRows: [crmRow({ branch_code: "huanrui" })],
    paymentRows: [],
  });
  assert.equal(report.missing.length, 0, "不可跨館混算");
}

{
  const report = audit({
    paymentRows: [paymentRow({ status: "待收款", notified_at: "2027-02-01" })],
  });
  const actionable = engine.actionableFindings(report, {
    today: "2027-02-16",
    notificationFollowUpDays: 6,
  });
  assert.equal(actionable.length, 1, "已通知超過追蹤天數且未收款才進每日行動清單");

  const quiet = engine.actionableFindings(report, {
    today: "2027-02-05",
    notificationFollowUpDays: 6,
  });
  assert.equal(quiet.length, 0, "尚未到追蹤日不能製造每日雜訊");
}

{
  const globals = {
    HJ_CRM_SOURCE_DATA: {
      activeVenue: "taichung",
      venues: {
        taichung: {
          activeYear: "2026",
          years: {
            2026: [{
              venue: "taichung",
              id: "A01",
              name: "測試客戶",
              company: "測試有限公司",
              item: "營登",
              cycle: "6M",
              start: "115/02/15",
              end: "116/02/15",
              price: "1800/m",
              folder: "active",
            }],
          },
        },
      },
    },
    hjImportedPaymentDataByYear: {
      taichung: {
        2027: {
          "2月": [{
            id: "A01",
            name: "測試客戶",
            company: "測試有限公司",
            section: "營登",
            cycle: "6M",
            start: "115/02/15",
            end: "116/02/15",
            price: "1800/m",
            paidDate: "2/15",
            paidAmount: "10800",
            status: "完成",
          }],
        },
      },
    },
  };
  const before = structuredClone(globals);
  const { engine: platformEngine, window: platformWindow } = loadEngine(globals);

  assert.equal(typeof platformEngine.runFromPlatformGlobals, "function", "三個入口必須共用正式資料轉接器");
  assert.equal(typeof platformEngine.getLastReport, "function", "必須能讀取同館同年度最後核對結果");

  const crmResult = platformEngine.runFromPlatformGlobals({ trigger: "crm-save", venue: "taichung", year: 2027 });
  const importResult = platformEngine.runFromPlatformGlobals({ trigger: "smart-import", venue: "taichung", year: 2027 });
  const yearResult = platformEngine.runFromPlatformGlobals({ trigger: "year-switch", venue: "taichung", year: 2027 });

  assert.deepEqual(crmResult.report, importResult.report, "CRM 與智慧帶入必須得到同一份核對結果");
  assert.deepEqual(importResult.report, yearResult.report, "智慧帶入與年度切換必須得到同一份核對結果");
  assert.equal(yearResult.report.missing.length, 0, "正式月份鍵 2月 必須被正確識別");
  assert.equal(yearResult.report.exactDuplicates.length, 0);
  assert.deepEqual(platformEngine.getLastReport({ venue: "taichung", year: 2027 }), yearResult);
  assert.equal(platformEngine.__testGlobals, undefined, "公開 API 不得暴露正式資料參照");
  assert.deepEqual(platformWindow.HJ_CRM_SOURCE_DATA, before.HJ_CRM_SOURCE_DATA, "引擎不得改寫瀏覽器中的 CRM 快照");
  assert.deepEqual(
    platformWindow.hjImportedPaymentDataByYear,
    before.hjImportedPaymentDataByYear,
    "引擎不得改寫瀏覽器中的繳費快照",
  );
  assert.deepEqual(globals, before, "測試輸入本身不得被改寫");
}

console.log("payment audit engine regression: PASS");
