import assert from "node:assert/strict";
import fs from "node:fs";

const loader = fs.readFileSync(new URL("../db-page-loader.js", import.meta.url), "utf8");
const crm = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const payments = fs.readFileSync(new URL("../ops/payments.js", import.meta.url), "utf8");

const crmLoader = loader.match(/crm:\s*\[([^\]]+)\]/)?.[1] || "";
const paymentLoader = loader.match(/payments:\s*\[([^\]]+)\]/)?.[1] || "";

assert.ok(crmLoader.includes("payment-audit-engine.js"), "CRM 必須載入核對引擎");
assert.ok(crmLoader.indexOf("payment-audit-engine.js") < crmLoader.indexOf("app.js"), "CRM 核對引擎必須先載入");
assert.ok(paymentLoader.includes("payment-audit-engine.js"), "繳費表必須載入核對引擎");
assert.ok(paymentLoader.indexOf("payment-audit-engine.js") < paymentLoader.indexOf("payments.js"), "繳費核對引擎必須先載入");

[
  "crm-save",
  "crm-folder-change",
  "crm-year-switch",
  "crm-year-create",
].forEach((trigger) => assert.ok(crm.includes(`\"${trigger}\"`), `CRM 缺少 ${trigger} 觸發`));

[
  "payment-smart-import-before",
  "payment-smart-import-after",
  "payment-year-switch",
  "payment-year-create",
].forEach((trigger) => assert.ok(payments.includes(`\"${trigger}\"`), `繳費表缺少 ${trigger} 觸發`));

assert.ok(payments.includes("paymentRowsByMonthOverride"), "繳費核對必須使用只讀月表快照");
assert.ok(payments.includes("previousRowsByMonthOverride"), "繳費核對必須包含前一年度快照");

console.log("payment audit trigger wiring: PASS");
