import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) throw new Error("請提供解密後備份目錄的絕對路徑");

const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
if (!["hj-3052-rest-backup-v1", "hj-3052-rest-backup-v2"].includes(manifest.format)) {
  throw new Error("備份格式無法辨識");
}

let totalRows = 0;
for (const table of manifest.tables || []) {
  const content = await readFile(path.join(directory, table.fileName), "utf8");
  const checksum = createHash("sha256").update(content).digest("hex");
  if (checksum !== table.sha256) throw new Error(`${table.tableName} checksum 不符`);
  const rows = JSON.parse(content);
  if (!Array.isArray(rows) || rows.length !== table.rows) throw new Error(`${table.tableName} 筆數不符`);
  if (manifest.format === "hj-3052-rest-backup-v2") {
    if (!Array.isArray(table.columns) || table.columns.length === 0) {
      throw new Error(`${table.tableName} 缺少欄位結構`);
    }
    if (!Array.isArray(table.constraints)) {
      throw new Error(`${table.tableName} 缺少約束結構`);
    }
  }
  totalRows += rows.length;
}

process.stdout.write(`BACKUP_CONTENT_VERIFIED=true\n`);
process.stdout.write(`TABLES_VERIFIED=${manifest.tables.length}\n`);
process.stdout.write(`ROWS_VERIFIED=${totalRows}\n`);
