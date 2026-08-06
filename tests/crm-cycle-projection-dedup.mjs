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

const oldCycle = {
  id: "T900",
  start: "114/08/01",
  end: "115/08/01",
  folder: "active",
  cycleState: "historical",
  contractPeriod: 1,
  isCurrentContract: false,
  uid: "old-T900",
};

const renewedCycle = {
  id: "T900",
  start: "115/08/01",
  end: "116/08/01",
  folder: "active",
  cycleState: "confirmed",
  contractPeriod: 2,
  isCurrentContract: true,
  uid: "renewed-T900",
};

const staleFutureShell = {
  ...renewedCycle,
  cycleState: "legacy_generated",
  contractPeriod: 0,
  isCurrentContract: false,
  uid: "stale-T900-2027",
};

const renewalVenueData = {
  years: {
    2026: [oldCycle, renewedCycle],
    2027: [staleFutureShell],
  },
};

cycle.projectCyclesToYearShells(renewalVenueData, 2026);

const selected2026 = cycle.selectCurrentRows(renewalVenueData.years[2026]);
assert.equal(selected2026.length, 1, "同編號的新舊循環在合約列表只能顯示一筆");
assert.equal(selected2026[0].uid, renewedCycle.uid, "合約列表必須選目前 CRM 相符的已確認循環");

const visible2027 = cycle
  .selectCurrentRows(renewalVenueData.years[2027])
  .filter((row) => !["legacy_generated", "invalidated", "draft"].includes(row.cycleState));
assert.equal(visible2027.length, 1, "舊預生列不得阻止目前循環出現在涵蓋的未來年度");
assert.equal(visible2027[0].uid, `${renewedCycle.uid}-projection-2027`);

const unaffectedSingleRow = {
  id: "T901",
  start: "115/08/23",
  end: "117/08/23",
  folder: "active",
  cycleState: "confirmed",
  contractPeriod: 2,
  isCurrentContract: true,
  uid: "single-T901",
};
assert.deepEqual(
  cycle.selectCurrentRows([unaffectedSingleRow]),
  [unaffectedSingleRow],
  "原本每年只有一筆的正常客戶不得被改動",
);

console.log("CRM contract current-cycle selection: OK");
