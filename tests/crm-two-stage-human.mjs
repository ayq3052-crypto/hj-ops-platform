import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.env.HJ_CRM_TEST_URL || "http://127.0.0.1:8770/crm.html";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const taichungRows = [
  {
    uid: "tc-180",
    id: "180",
    name: "單段測試",
    company: "單段合約",
    category: "行號",
    item: "營登",
    cycle: "Y",
    contractYears: "1",
    start: "115/07/01",
    end: "116/07/01",
    amount: "1800/m",
    folder: "active",
    venue: "taichung",
  },
  {
    uid: "tc-217",
    id: "217",
    name: "",
    company: "台中兩段測試",
    category: "B辦",
    item: "辦公室",
    cycle: "M",
    contractYears: "5",
    start: "114/06/01",
    end: "119/06/01",
    signedAt: "113/05/31",
    amount: "10880/m",
    deposit: "9880/未退",
    payDay: "1",
    folder: "active",
    venue: "taichung",
  },
];

const huanruiRows = [
  {
    uid: "hr-v06",
    id: "V06",
    name: "",
    company: "環瑞兩段測試",
    category: "事務所",
    item: "營登",
    cycle: "2Y",
    contractYears: "2",
    start: "116/06/18",
    end: "118/06/18",
    signedAt: "116/06/17",
    amount: "1200/m",
    deposit: "6000/未退",
    payDay: "1",
    folder: "active",
    venue: "huanrui",
  },
];

const source = {
  generatedAt: new Date().toISOString(),
  activeVenue: "taichung",
  sources: {
    taichung: { label: "台中館", sourceLabel: "隔離人類操作測試", sourceLink: "", idMode: "number" },
    huanrui: { label: "環瑞館", sourceLabel: "隔離人類操作測試", sourceLink: "", idMode: "v" },
  },
  venues: {
    taichung: { activeYear: "2026", years: { 2026: taichungRows }, ended: [] },
    huanrui: { activeYear: "2026", years: { 2026: huanruiRows }, ended: [] },
  },
};

const stub = `(() => {
  const source = ${JSON.stringify(source)};
  window.__savedCrmRows = [];
  window.__paymentWriteCount = 0;
  window.HJ_DB = {
    ensureSession: async () => ({ user: { id: "isolated-human-test" } }),
    applyPlatformGlobals: async () => {
      window.HJ_CRM_SOURCE_DATA = source;
      window.hjCrmSourceData = source;
      window.hjImportedPaymentData = {};
      window.hjImportedPaymentDataByYear = {};
      window.hjDefaultPaymentRows = [];
      return { crmSource: source };
    },
    migrateLegacyCrmYears: async () => ({ migrated: false }),
    refreshPlatformData: async () => ({ crmSource: source }),
    clearLegacyLocalDataForDb: () => {},
    installLocalStorageSync: () => {},
    saveCrmRow: async (row) => {
      window.__savedCrmRows.push(JSON.parse(JSON.stringify(row)));
      return { id: row.id };
    },
  };
})();`;

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1998, height: 1338 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.route("**/db-client.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: stub }));

const openCustomer = async (venue, id) => {
  await page.goto(`${baseUrl}?venue=${venue}&year=2026&id=${encodeURIComponent(id)}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".record-card");
  await page.waitForFunction((customerId) => document.querySelector("#detailCompany") && new URL(location.href).searchParams.get("id") === customerId, id);
};

const enterTwoStage = async ({ stage1Years, stage2Years, stage2Amount }) => {
  await page.locator("#editButton").click();
  await page.locator('[data-stage-action="add"]').click();
  await page.locator('[name="stage1Years"]').fill(stage1Years);
  await page.locator('[name="stage2Years"]').fill(stage2Years);
  await page.locator('[name="stage2Amount"]').fill(stage2Amount);
  await page.locator("#detailCompany").click();
  await page.waitForTimeout(150);
};

await openCustomer("taichung", "217");
await enterTwoStage({ stage1Years: "2", stage2Years: "3", stage2Amount: "11880/m" });
assert.equal(await page.locator('[name="stage1Start"]').inputValue(), "114/06/01");
assert.equal(await page.locator('[name="stage1End"]').inputValue(), "116/05/31");
assert.equal(await page.locator('[name="stage2Start"]').inputValue(), "116/06/01");
assert.equal(await page.locator('[name="stage2End"]').inputValue(), "119/06/01");
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "台中館不得出現水平溢位");
await page.screenshot({ path: "work/crm-two-stage-taichung-edit.png", fullPage: false });
await page.locator("#saveButton").click();
await page.waitForFunction(() => window.__savedCrmRows.length === 1);

const taichungSaved = await page.evaluate(() => window.__savedCrmRows[0]);
assert.equal(taichungSaved.hasSecondStage, true);
assert.equal(taichungSaved.stage2Kind, "price_change");
assert.equal(taichungSaved.start, "114/06/01");
assert.equal(taichungSaved.end, "119/06/01");
assert.equal(taichungSaved.contractYears, "5");
assert.equal(taichungSaved.pricingStages.length, 2);
assert.equal(await page.evaluate(() => window.__paymentWriteCount), 0);
assert.equal(await page.locator(".contract-stage-row").count(), 2);
const stageLifecycle = await page.evaluate((row) => ({
  insideContract: window.buildNextYearRow(row, "2027", "taichung"),
  afterFinalEnd: window.buildNextYearRow(row, "2030", "taichung"),
}), taichungSaved);
assert.equal(stageLifecycle.insideContract.hasSecondStage, true, "合約內跨年度仍應保留第二段");
assert.equal(stageLifecycle.afterFinalEnd.hasSecondStage, false, "合約最終到期後不可把第二段當續約帶入");
assert.equal(stageLifecycle.afterFinalEnd.amount, "11880/m", "新循環起始值應承接最後有效價格，不可退回第一段");

await page.locator("#editButton").click();
await page.locator('[name="stage1End"]').fill("116/05/30");
await page.locator("#saveButton").click();
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => window.__savedCrmRows.length), 1, "不連續日期不得儲存");
assert.match(await page.locator("#saveState").textContent(), /不一致|不可重疊|中斷/);
await page.locator("#cancelButton").click();

await openCustomer("taichung", "180");
assert.equal(await page.locator(".contract-stage-row").count(), 0, "普通客戶仍是單段畫面");
assert.equal(await page.locator('[name="contractYears"]').inputValue(), "1");

await openCustomer("huanrui", "V06");
await enterTwoStage({ stage1Years: "1", stage2Years: "1", stage2Amount: "1350/m" });
assert.equal(await page.locator('[name="stage1End"]').inputValue(), "117/06/17");
assert.equal(await page.locator('[name="stage2Start"]').inputValue(), "117/06/18");
assert.equal(await page.locator('[name="stage2End"]').inputValue(), "118/06/18");
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "環瑞館不得出現水平溢位");
await page.screenshot({ path: "work/crm-two-stage-huanrui-edit.png", fullPage: false });
await page.locator("#saveButton").click();
await page.waitForFunction(() => window.__savedCrmRows.length === 1);
const huanruiSaved = await page.evaluate(() => window.__savedCrmRows[0]);
assert.equal(huanruiSaved.id, "V06");
assert.equal(huanruiSaved.stage2Kind, "price_change");
assert.equal(huanruiSaved.stage2Amount, "1350/m");
assert.equal(await page.evaluate(() => window.__paymentWriteCount), 0);

console.log(JSON.stringify({
  taichung: taichungSaved.pricingStages,
  huanrui: huanruiSaved.pricingStages,
  invalidSaveBlocked: true,
  ordinarySingleStageUnchanged: true,
  paymentWrites: 0,
}, null, 2));

await browser.close();
