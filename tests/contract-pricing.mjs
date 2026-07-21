import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pricing = require("../ops/contract-pricing.js");

const structured = (overrides = {}) => ({
  contractStart: "114/06/01",
  contractEnd: "119/06/01",
  amount: "10880/m",
  hasSecondStage: true,
  stage1Years: "2",
  stage1Start: "114/06/01",
  stage1End: "116/05/31",
  stage2Years: "3",
  stage2Start: "116/06/01",
  stage2End: "119/06/01",
  stage2Amount: "11880/m",
  stage2Kind: "price_change",
  pricingStages: [
    { years: "2", start: "114/06/01", end: "116/05/31", amount: "10880/m" },
    { years: "3", start: "116/06/01", end: "119/06/01", amount: "11880/m", kind: "price_change" },
  ],
  ...overrides,
});

{
  const row = structured();
  assert.deepEqual(
    [pricing.monthlyPriceAt(row, "116/05/01").monthly, pricing.monthlyPriceAt(row, "116/06/01").monthly],
    [10880, 11880],
  );
}

{
  const row = structured({
    contractStart: "116/06/18",
    contractEnd: "118/06/18",
    amount: "１，２００／ｍ",
    stage1Years: "1",
    stage1Start: "116/06/18",
    stage1End: "117/06/17",
    stage2Years: "1",
    stage2Start: "117/06/18",
    stage2End: "118/06/18",
    stage2Amount: "１，３５０／ｍ",
    pricingStages: [],
  });
  assert.equal(pricing.monthlyPriceAt(row, "116/06/18").monthly, 1200);
  assert.equal(pricing.monthlyPriceAt(row, "117/06/18").monthly, 1350);
}

{
  const incomplete = structured({ stage2Start: "", pricingStages: [] });
  const result = pricing.monthlyPriceAt(incomplete, "117/06/01");
  assert.match(result.error, /日期不完整/);
  assert.equal(result.monthly, undefined);
}

{
  const broken = structured({ stage2Start: "116/06/02", pricingStages: [] });
  assert.match(pricing.monthlyPriceAt(broken, "116/06/02").error, /重疊或中斷/);
}

{
  const legacy = {
    contractStart: "114/06/01",
    amount: "10880/m",
    pricePlan: "前2年10880，後3年11880",
  };
  assert.equal(pricing.monthlyPriceAt(legacy, "116/05/01").monthly, 10880);
  assert.equal(pricing.monthlyPriceAt(legacy, "116/06/01").monthly, 11880);
}

{
  const ordinary = { contractStart: "115/07/01", amount: "1800/m" };
  assert.equal(pricing.monthlyPriceAt(ordinary, "115/07/01").monthly, 1800);
}

console.log("contract pricing: OK");
