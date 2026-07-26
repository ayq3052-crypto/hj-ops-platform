import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDirectory = process.argv[2];
const outputFile = process.argv[3];

if (!sourceDirectory || !path.isAbsolute(sourceDirectory)) {
  throw new Error("請提供解密後備份目錄的絕對路徑");
}
if (!outputFile || !path.isAbsolute(outputFile)) {
  throw new Error("請提供還原 SQL 的絕對輸出路徑");
}

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const qualifiedTable = (tableName) => `public.${quoteIdentifier(tableName)}`;
const safeType = (value) => {
  const type = String(value || "").trim();
  if (!/^[a-zA-Z0-9_ (),.[\]]+$/.test(type)) throw new Error(`不安全的欄位型別：${type}`);
  return type;
};
const dollarQuotedJson = (json, seed) => {
  let tag = `$hj3052_${seed}$`;
  let suffix = 0;
  while (json.includes(tag)) {
    suffix += 1;
    tag = `$hj3052_${seed}_${suffix}$`;
  }
  return `${tag}${json}${tag}`;
};

const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));
if (!["hj-3052-rest-backup-v2", "hj-3052-rest-backup-v3"].includes(manifest.format)) {
  throw new Error("只有 v2／v3 備份含有可獨立還原的資料表結構");
}

const schemaObjects = manifest.format === "hj-3052-rest-backup-v3"
  ? JSON.parse(await readFile(path.join(sourceDirectory, manifest.schema.fileName), "utf8"))
  : [];
const definitionsFor = (kind) => schemaObjects
  .filter((object) => object.kind === kind)
  .map((object) => String(object.definition || "").trim())
  .filter(Boolean);
const terminatedDefinitionsFor = (kind) => definitionsFor(kind)
  .map((definition) => definition.endsWith(";") ? definition : `${definition};`);

const lines = [
  "\\set ON_ERROR_STOP on",
  "begin;",
  "set local check_function_bodies = off;",
  "drop schema if exists public cascade;",
  "create schema public;",
];

lines.push(...terminatedDefinitionsFor("sequence"));

for (const table of manifest.tables) {
  const columns = table.columns.map((column) => {
    const nullable = column.notNull ? " not null" : "";
    return `  ${quoteIdentifier(column.name)} ${safeType(column.type)}${nullable}`;
  });
  lines.push(`create table ${qualifiedTable(table.tableName)} (\n${columns.join(",\n")}\n);`);
}

for (const table of manifest.tables) {
  const json = await readFile(path.join(sourceDirectory, table.fileName), "utf8");
  if (table.rows > 0) {
    const literal = dollarQuotedJson(json.trim(), table.tableName.replaceAll(/[^a-zA-Z0-9_]/g, "_"));
    lines.push(
      `insert into ${qualifiedTable(table.tableName)} ` +
      `select * from json_populate_recordset(null::${qualifiedTable(table.tableName)}, ${literal}::json);`,
    );
  }
}

for (const constraintType of ["p", "u", "c", "f"]) {
  for (const table of manifest.tables) {
    for (const constraint of table.constraints.filter((item) => item.type === constraintType)) {
      const definition = String(constraint.definition || "").trim();
      if (!definition || definition.includes(";")) {
        throw new Error(`${table.tableName} 的約束內容不安全`);
      }
      lines.push(
        `alter table ${qualifiedTable(table.tableName)} ` +
        `add constraint ${quoteIdentifier(constraint.name)} ${definition};`,
      );
    }
  }
}

lines.push(...terminatedDefinitionsFor("function"));

for (const table of manifest.tables) {
  for (const column of table.columns) {
    const defaultExpression = String(column.defaultExpression || "").trim();
    if (!defaultExpression) continue;
    if (defaultExpression.includes(";")) {
      throw new Error(`${table.tableName}.${column.name} 的預設值內容不安全`);
    }
    lines.push(
      `alter table ${qualifiedTable(table.tableName)} ` +
      `alter column ${quoteIdentifier(column.name)} set default ${defaultExpression};`,
    );
  }
}

lines.push(...terminatedDefinitionsFor("index"));
lines.push(...terminatedDefinitionsFor("view"));

for (const table of manifest.tables) {
  if (table.rowSecurity) {
    lines.push(`alter table ${qualifiedTable(table.tableName)} enable row level security;`);
  }
}

lines.push(...terminatedDefinitionsFor("policy"));
lines.push(...terminatedDefinitionsFor("trigger"));
lines.push(...terminatedDefinitionsFor("grant"));

lines.push("commit;");
await writeFile(outputFile, `${lines.join("\n\n")}\n`, { mode: 0o600 });
process.stdout.write(`RESTORE_SQL_CREATED=${outputFile}\n`);
