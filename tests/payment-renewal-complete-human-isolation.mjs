import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.join(__dirname, "artifacts", "payment-renewal-complete-human-isolation");
const baseUrl =
  process.env.HJ_TEST_BASE_URL ||
  "http://127.0.0.1:8767/payments-scroll-test.html?live-data=1";
const customerId = "T-COMPLETE-ISO";

await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const row = ({
  venue = "taichung",
  start,
  end,
  paidDate = "",
  paidAmount = "",
  invoice = "",
  note = "合約到期，先確認續約",
} = {}) => ({
  section: "年繳 / 2Y",
  id: customerId,
  name: venue === "taichung" ? "隔離測試台中" : "隔離測試環瑞",
  company: venue === "taichung" ? "完成狀態台中測試" : "完成狀態環瑞測試",
  cycle: "Y",
  start,
  end,
  price: "1000/m",
  paidDate,
  paidAmount,
  nextDate: "",
  invoice,
  note,
  manualStatus: "",
});

const storageKey = (year, venue, month) =>
  `hjPaymentRows${year}_${venue}_${month}月_v1`;

async function setPeriod(year, venue, month) {
  await page.selectOption("#yearSelect", String(year));
  await page.waitForTimeout(80);
  const venueToolbar = page.locator(`[data-venue-toolbar="${venue}"]`);
  if ((await venueToolbar.getAttribute("aria-expanded")) !== "true") {
    await venueToolbar.click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(80);
  }
  await page.click(
    `.month-tab[data-venue="${venue}"][data-month="${month}月"]:visible`,
  );
  await page.waitForTimeout(120);
}

function exactRow() {
  return page
    .locator(".payment-row")
    .filter({ has: page.locator("span:first-child", { hasText: new RegExp(`^${customerId}$`) }) });
}

function exactStatus() {
  return exactRow().locator(".sheet-status");
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const formalHashBefore = await page.evaluate(() => window.HJ_TEST_FORMAL_DATA_HASH || "");

  await page.evaluate(
    ({ keys, rows }) => {
      for (const [key, value] of Object.entries(rows)) {
        localStorage.setItem(key, JSON.stringify(value));
      }
      localStorage.removeItem(keys.nextCycle);
    },
    {
      keys: {
        nextCycle: storageKey(2027, "taichung", 2),
      },
      rows: {
        [storageKey(2026, "taichung", 2)]: [
          row({
            start: "114/02/01",
            end: "115/02/01",
            paidDate: "2/1",
            paidAmount: "12000",
            invoice: "✔️",
          }),
        ],
        [storageKey(2026, "taichung", 3)]: [
          row({
            start: "114/03/01",
            end: "115/03/01",
            paidDate: "3/1",
            paidAmount: "12000",
            invoice: "✔️",
          }),
        ],
        [storageKey(2026, "huanrui", 2)]: [
          row({
            venue: "huanrui",
            start: "114/02/01",
            end: "115/02/01",
            paidDate: "2/1",
            paidAmount: "12000",
            invoice: "✔️",
          }),
        ],
      },
    },
  );

  await page.reload({ waitUntil: "networkidle" });
  await setPeriod(2026, "taichung", 2);

  assert.equal(await exactRow().count(), 1, "台中 2026/02 測試列應只有一筆");
  const completeButton = exactRow().locator("[data-complete-renewal-row]");
  assert.equal(await completeButton.count(), 1, "已收款、已開票的舊循環應可點擊完成");
  await completeButton.click();
  await page.waitForTimeout(150);
  assert.equal(await exactStatus().innerText(), "完成", "點擊後舊循環應顯示完成");

  await page.screenshot({
    path: path.join(artifactDir, "01-taichung-feb-completed.png"),
    fullPage: true,
  });

  await page.reload({ waitUntil: "networkidle" });
  await setPeriod(2026, "taichung", 2);
  assert.equal(
    await exactStatus().innerText(),
    "完成",
    "重新整理後完成狀態必須保留",
  );

  const savedManualStatus = await page.evaluate(
    ({ key, id }) => {
      const rows = JSON.parse(localStorage.getItem(key) || "[]");
      return rows.find((item) => String(item.id) === id)?.manualStatus || "";
    },
    { key: storageKey(2026, "taichung", 2), id: customerId },
  );
  assert.equal(savedManualStatus, "done", "完成狀態必須真正寫入該月份隔離資料");

  await setPeriod(2026, "taichung", 3);
  assert.notEqual(
    await exactStatus().innerText(),
    "完成",
    "同編號不同月份不可被一起標記完成",
  );
  assert.equal(
    await page.locator(".row-editor:visible").count(),
    0,
    "切換月份後不可殘留上一月份編輯區",
  );

  await setPeriod(2026, "huanrui", 2);
  assert.notEqual(
    await exactStatus().innerText(),
    "完成",
    "同編號不同館不可被一起標記完成",
  );

  await page.evaluate(
    ({ key, nextRow }) => {
      localStorage.setItem(key, JSON.stringify([nextRow]));
    },
    {
      key: storageKey(2027, "taichung", 2),
      nextRow: row({
        start: "115/02/01",
        end: "116/02/01",
      }),
    },
  );

  await page.reload({ waitUntil: "networkidle" });
  await setPeriod(2027, "taichung", 2);
  assert.equal(await exactRow().count(), 1, "下一期循環應只有一筆");
  assert.equal(
    await exactStatus().innerText(),
    "確認續約",
    "完成舊循環不可誤關下一期循環的確認續約",
  );
  assert.notEqual(
    await exactStatus().innerText(),
    "完成",
    "下一期循環不可繼承舊循環的完成狀態",
  );

  await page.screenshot({
    path: path.join(artifactDir, "02-next-cycle-still-renewal.png"),
    fullPage: true,
  });

  const formalHashAfter = await page.evaluate(() => window.HJ_TEST_FORMAL_DATA_HASH || "");
  assert.equal(formalHashAfter, formalHashBefore, "真人隔離測試不得改動正式資料快照");

  console.log(
    JSON.stringify(
      {
        ok: true,
        customerId,
        checks: [
          "完成狀態重新整理後仍保留",
          "同編號不同月份不連動",
          "同編號不同館不連動",
          "切換月份不殘留編輯區",
          "下一期仍顯示確認續約",
          "正式資料快照未改動",
        ],
        artifacts: artifactDir,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
