import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cycle = require("../ops/crm-cycle.js");

const currentContract = {
  id: "281",
  start: "115/07/24",
  end: "116/07/24",
  folder: "active",
  cycleState: "historical",
  contractPeriod: 1,
  isCurrentContract: true,
  uid: "current-281",
};

const storedYearRowWithoutPeriod = {
  ...currentContract,
  contractPeriod: 0,
  uid: "stored-281-2027",
};

const venueData = {
  years: {
    2026: [currentContract],
    2027: [storedYearRowWithoutPeriod],
  },
};

cycle.projectCyclesToYearShells(venueData, 2026);

assert.equal(
  venueData.years[2026].filter((row) => cycle.sameContract(row, currentContract)).length,
  1,
  "目前年度只保留一筆目前合約",
);
assert.equal(
  venueData.years[2027].filter((row) => cycle.sameContract(row, currentContract)).length,
  1,
  "相同編號與合約日期不得因 contractPeriod 0/1 差異在未來年度顯示兩筆",
);

console.log("CRM cycle projection dedup: OK");
