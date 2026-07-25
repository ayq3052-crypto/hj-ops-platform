import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../db-client.js", import.meta.url), "utf8");
const context = {
  window: {},
  console,
  Date,
  URL,
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(source, context);

const normalize = context.window.HJ_DB.normalizePaymentDateForDb;

assert.equal(normalize("7/8", 2026), "2026-07-08", "繳費日可使用人類輸入的月/日");
assert.equal(normalize("7/24", 2026), "2026-07-24", "繳費日須依所選年度補足西元年");
assert.equal(normalize("115/07/24"), "2026-07-24", "完整民國日期須轉成資料庫日期");
assert.equal(normalize("2026-07-24"), "2026-07-24", "完整西元日期保持不變");
assert.equal(normalize("116/07"), null, "只有年/月時不可猜日期，原字串留在人工快照");
assert.equal(normalize("2/30", 2026), null, "不存在的日期不可寫入資料庫");

process.stdout.write("DB_PAYMENT_DATE_STORAGE_PASS\n");
