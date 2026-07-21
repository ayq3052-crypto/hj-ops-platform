import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dates = require("../ops/roc-date.js");
const engine = require("../ops/payment-smart-import-v2.js");

for (const value of ["118/7/1", "118/07/01", "１１８／７／１", "118-7-1", "118年7月1日"]) {
  assert.equal(dates.normalize(value), "118/07/01", `${value} 應統一為同一天`);
}
assert.equal(dates.same("118/7/1", "118/07/01"), true);
assert.equal(dates.same("118/7/1", "118/07/02"), false);

const base = {
  venue: "taichung",
  customerNo: "FORMAT",
  name: "日期測試",
  company: "日期測試",
  service: "營登",
  paymentCycle: "Y",
  contractStart: "118/7/1",
  contractEnd: "119/7/1",
  amount: "1490/m",
  status: "active",
};
const preview = engine.buildPreview({ crm: base, history: [], mode: "renewal", targetYear: 2029, targetMonth: 7 });
assert.equal(preview.ok, true);
assert.equal(preview.crm.contractStart, "118/07/01");
assert.equal(preview.crm.contractEnd, "119/07/01");
assert.equal(preview.payments[0].contractStart, "118/07/01");

const existing = [{ ...preview.payments[0], contractStart: "118/7/1", contractEnd: "119/7/1" }];
const inserted = engine.insertPreview(existing, preview);
assert.equal(inserted.inserted.length, 1, "付款列之外仍應新增一次續約提醒");
assert.equal(inserted.inserted[0].type, "renewal-reminder");
const rerun = engine.insertPreview(inserted.rows, preview);
assert.equal(rerun.inserted.length, 0, "補零差異不得造成重複新增");

process.stdout.write("ROC_DATE_NORMALIZATION_PASS\n");
