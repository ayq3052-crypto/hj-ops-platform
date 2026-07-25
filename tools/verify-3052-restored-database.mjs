import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sourceDirectory = process.argv[2];
const databaseUrl = process.env.HJ_RESTORE_DB_URL;
const psqlBin = process.env.HJ_PSQL_BIN || "/opt/homebrew/opt/libpq/bin/psql";

if (!sourceDirectory || !path.isAbsolute(sourceDirectory)) {
  throw new Error("請提供解密後備份目錄的絕對路徑");
}
if (!databaseUrl) throw new Error("缺少 HJ_RESTORE_DB_URL");

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
const canonicalRows = (rows) => rows
  .map((row) => JSON.stringify(canonicalize(row)))
  .sort();
const digestRows = (rows) => createHash("sha256")
  .update(canonicalRows(rows).join("\n"))
  .digest("hex");

const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));
let restoredRows = 0;

for (const table of manifest.tables) {
  const sourceRows = JSON.parse(await readFile(path.join(sourceDirectory, table.fileName), "utf8"));
  const sql =
    `select coalesce(json_agg(row_to_json(restored_row)), '[]'::json) ` +
    `from public.${quoteIdentifier(table.tableName)} restored_row`;
  const output = execFileSync(
    psqlBin,
    [databaseUrl, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
  const targetRows = JSON.parse(output || "[]");
  if (targetRows.length !== sourceRows.length) {
    throw new Error(`${table.tableName} 還原筆數不符：${targetRows.length} != ${sourceRows.length}`);
  }
  if (digestRows(targetRows) !== digestRows(sourceRows)) {
    throw new Error(`${table.tableName} 還原內容雜湊不符`);
  }
  restoredRows += targetRows.length;
}

process.stdout.write("RESTORE_CONTENT_VERIFIED=true\n");
process.stdout.write(`TABLES_RESTORED=${manifest.tables.length}\n`);
process.stdout.write(`ROWS_RESTORED=${restoredRows}\n`);
