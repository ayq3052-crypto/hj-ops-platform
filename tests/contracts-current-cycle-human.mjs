import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "/Users/hourjungle/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fixture = {
  activeVenue: "huanrui",
  sources: {
    huanrui: { label: "環瑞館", idMode: "v" },
    taichung: { label: "台中館", idMode: "number" },
  },
  venues: {
    huanrui: {
      activeYear: "2026",
      years: {
        2026: [
          {
            id: "T900", name: "舊循環", company: "測試公司", item: "營登", cycle: "Y",
            start: "114/08/01", end: "115/08/01", amount: "1600/m", folder: "active",
            cycleState: "historical", contractPeriod: 1, isCurrentContract: false, uid: "old-T900",
          },
          {
            id: "T900", name: "目前循環", company: "測試公司", item: "營登", cycle: "Y",
            start: "115/08/01", end: "116/08/01", amount: "1690/m", folder: "active",
            cycleState: "confirmed", contractPeriod: 2, isCurrentContract: true, uid: "renewed-T900",
          },
          {
            id: "T901", name: "正常單筆", company: "對照公司", item: "營登", cycle: "2Y",
            start: "115/08/23", end: "117/08/23", amount: "1800/m", folder: "active",
            cycleState: "confirmed", contractPeriod: 2, isCurrentContract: true, uid: "single-T901",
          },
        ],
        2027: [
          {
            id: "T900", name: "舊預生列", company: "測試公司", item: "營登", cycle: "Y",
            start: "115/08/01", end: "116/08/01", amount: "1690/m", folder: "active",
            cycleState: "legacy_generated", contractPeriod: 0, isCurrentContract: false, uid: "stale-T900-2027",
          },
        ],
      },
    },
    taichung: { activeYear: "2026", years: { 2026: [], 2027: [] } },
  },
};

const originalHtml = await readFile(path.join(repoRoot, "contracts.html"), "utf8");
const testHtml = originalHtml
  .replace(/\s*<script src="\.\/auth-gate\.js[^>]*><\/script>/u, "")
  .replace(/\s*<script src="\.\/db-client\.js[^>]*><\/script>/u, "")
  .replace(
    /\s*<script src="\.\/db-page-loader\.js[^>]*><\/script>/u,
    `\n<script>window.HJ_CRM_SOURCE_DATA = ${JSON.stringify(fixture)}; window.hjCrmSourceData = window.HJ_CRM_SOURCE_DATA; window.HJCrmCycle.projectCyclesToYearShells(window.HJ_CRM_SOURCE_DATA.venues.huanrui, 2026);</script>\n<script src="./contracts.js"></script>`,
  );

const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
    if (requestPath === "/contracts-test.html") {
      response.writeHead(200, { "content-type": contentTypes[".html"] });
      response.end(testHtml);
      return;
    }
    const target = path.resolve(repoRoot, `.${requestPath}`);
    if (!target.startsWith(`${repoRoot}${path.sep}`)) throw new Error("invalid path");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": contentTypes[path.extname(target)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/contracts-test.html?venue=huanrui&year=2026`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('[data-id="T900"]').count(), 1, "2026同編號只能顯示一張卡");
  assert.equal(await page.locator('[data-id="T901"]').count(), 1, "正常單筆客戶必須保持一張卡");
  assert.match(await page.locator("#contractSummary").innerText(), /115年08月01日[\s\S]*116年08月01日/u, "2026必須顯示目前循環日期");
  if (process.env.HJ_CONTRACT_SCREENSHOT_PREFIX) {
    await page.screenshot({ path: `${process.env.HJ_CONTRACT_SCREENSHOT_PREFIX}-2026.png`, fullPage: true });
  }

  await page.selectOption("#yearSelect", "2027");
  await page.waitForFunction(() => document.querySelector("#yearSelect")?.value === "2027");
  assert.equal(await page.locator('[data-id="T900"]').count(), 1, "目前循環必須出現在涵蓋的2027年度");
  assert.equal(await page.locator('[data-id="T901"]').count(), 1, "正常跨年客戶不得消失或重複");
  assert.match(await page.locator("#contractSummary").innerText(), /115年08月01日[\s\S]*116年08月01日/u, "2027必須沿用同一目前循環");
  if (process.env.HJ_CONTRACT_SCREENSHOT_PREFIX) {
    await page.screenshot({ path: `${process.env.HJ_CONTRACT_SCREENSHOT_PREFIX}-2027.png`, fullPage: true });
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log("contracts-current-cycle-human: PASS");
