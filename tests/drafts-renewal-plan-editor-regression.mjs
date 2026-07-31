import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../ops/drafts.js", import.meta.url), "utf8");
const start = source.indexOf("function formatMoney(");
const end = source.indexOf("function isRenewalDraftMessage(");

assert.notEqual(start, -1, "找不到 formatMoney");
assert.notEqual(end, -1, "找不到 isRenewalDraftMessage");

const context = {};
vm.createContext(context);
vm.runInContext(
  `${source.slice(start, end)}
  this.renewalPlanFromBody = renewalPlanFromBody;
  this.replaceRenewalPlanSection = replaceRenewalPlanSection;`,
  context,
);

const oneLine = "✅ 一年合約：$1,800/每月，年繳 $21,600。";
const twoLine = "✅ 兩年合約：$1,690/每月，年繳 $20,280。（一年繳一次，共分兩年繳。）";
const headings = [
  "📌 續約方案：",
  "📌 續約優惠方案：",
  "📌 提前約定續約優惠方案：",
  "📌 續約優惠方案:",
];

const plans = [
  {
    name: "只選一年",
    plan: { one: { enabled: true, monthly: "1800" }, two: { enabled: false, monthly: "1690" } },
    includes: [oneLine],
    excludes: [twoLine],
  },
  {
    name: "只選兩年",
    plan: { one: { enabled: false, monthly: "1800" }, two: { enabled: true, monthly: "1690" } },
    includes: [twoLine],
    excludes: [oneLine],
  },
  {
    name: "兩個都選",
    plan: { one: { enabled: true, monthly: "1800" }, two: { enabled: true, monthly: "1690" } },
    includes: [oneLine, twoLine],
    excludes: [],
  },
  {
    name: "兩個都不選",
    plan: { one: { enabled: false, monthly: "1800" }, two: { enabled: false, monthly: "1690" } },
    includes: ["✅ 續約方案請依 CRM / 合約確認。"],
    excludes: [oneLine, twoLine],
  },
];

for (const heading of headings) {
  for (const test of plans) {
    const original = `開頭資料\n\n${heading}\n${oneLine}\n${twoLine}\n\n💡 請回覆您的續約方式：\n後續資料`;
    const result = context.replaceRenewalPlanSection(original, test.plan);
    assert.ok(result.startsWith("開頭資料"), `${heading} ${test.name}：前文被改動`);
    assert.ok(result.endsWith("後續資料"), `${heading} ${test.name}：後文被改動`);
    assert.ok(result.includes(heading), `${heading} ${test.name}：標題未保留`);
    for (const expected of test.includes) {
      assert.ok(result.includes(expected), `${heading} ${test.name}：缺少 ${expected}`);
    }
    for (const unexpected of test.excludes) {
      assert.ok(!result.includes(unexpected), `${heading} ${test.name}：不應保留 ${unexpected}`);
    }
  }
}

const unchanged = "沒有方案區塊的人工內容";
assert.equal(
  context.replaceRenewalPlanSection(unchanged, plans[0].plan),
  unchanged,
  "找不到方案區塊時不可改寫人工內容",
);

const parsed = context.renewalPlanFromBody(`${oneLine}\n${twoLine}`);
assert.deepEqual(
  JSON.parse(JSON.stringify(parsed)),
  {
    one: { enabled: true, monthly: "1800" },
    two: { enabled: true, monthly: "1690" },
  },
  "方案金額解析錯誤",
);

console.log(`PASS renewal plan editor regression: ${headings.length * plans.length + 2} checks`);
