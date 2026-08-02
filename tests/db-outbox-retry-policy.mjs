import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../db-client.js", import.meta.url), "utf8");

assert.doesNotMatch(source, /setTimeout\(flush,\s*5000\)/, "失敗後不可每 5 秒無限重試");
assert.doesNotMatch(source, /addEventListener\("focus"[\s\S]{0,300}flush\(/, "聚焦頁面不可觸發舊佇列");
assert.doesNotMatch(source, /addEventListener\("visibilitychange"[\s\S]{0,300}flush\(/, "切換分頁不可觸發舊佇列");
assert.match(source, /localStorage\.getItem\(key\)\s*===\s*value/, "只可保留仍符合目前內容的待同步項目");
assert.match(
  source,
  /beforeunload[\s\S]{0,160}if\s*\(!flushPromise\)\s*return/,
  "只有正在寫入時才可阻擋離開",
);

const startupStart = source.indexOf("loadOutbox();");
const startupEnd = source.indexOf('window.addEventListener("online"', startupStart);
assert.ok(startupStart >= 0 && startupEnd > startupStart, "找不到待同步佇列啟動區段");
assert.doesNotMatch(source.slice(startupStart, startupEnd), /flush\(/, "開啟頁面不可自動重送舊佇列");

console.log("PASS db-outbox-retry-policy");
