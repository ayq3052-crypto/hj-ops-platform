import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = process.argv[2];
const projectRef = process.env.HJ_SUPABASE_PROJECT_REF || "khpgrfpnvgzkfjmxhuny";
const accessToken = process.env.HJ_SUPABASE_ACCESS_TOKEN;
const serviceRoleKey = process.env.HJ_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.HJ_SUPABASE_URL || `https://${projectRef}.supabase.co`;

if (!outputDir || !path.isAbsolute(outputDir)) throw new Error("備份輸出目錄必須是絕對路徑");
if (!accessToken) throw new Error("缺少 HJ_SUPABASE_ACCESS_TOKEN");
if (!serviceRoleKey) throw new Error("缺少 HJ_SUPABASE_SERVICE_ROLE_KEY");

const managementResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    read_only: true,
    query: `
      select
        t.tablename as table_name,
        c.relrowsecurity as row_security,
        coalesce(
          (
            select jsonb_agg(a.attname order by x.ordinality)
            from pg_index i
            cross join lateral unnest(i.indkey) with ordinality as x(attnum, ordinality)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = x.attnum
            where i.indrelid = format('public.%I', t.tablename)::regclass
              and i.indisprimary
          ),
          '[]'::jsonb
        ) as primary_key,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'name', a.attname,
                'type', format_type(a.atttypid, a.atttypmod),
                'notNull', a.attnotnull,
                'defaultExpression', pg_get_expr(d.adbin, d.adrelid),
                'identity', a.attidentity,
                'generated', a.attgenerated
              )
              order by a.attnum
            )
            from pg_attribute a
            left join pg_attrdef d
              on d.adrelid = a.attrelid
             and d.adnum = a.attnum
            where a.attrelid = format('public.%I', t.tablename)::regclass
              and a.attnum > 0
              and not a.attisdropped
          ),
          '[]'::jsonb
        ) as columns,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'name', con.conname,
                'type', con.contype,
                'definition', pg_get_constraintdef(con.oid, true)
              )
              order by con.contype, con.conname
            )
            from pg_constraint con
            where con.conrelid = format('public.%I', t.tablename)::regclass
              and con.contype in ('p', 'u', 'f', 'c')
          ),
          '[]'::jsonb
        ) as constraints
      from pg_tables t
      join pg_class c
        on c.oid = format('public.%I', t.tablename)::regclass
      where t.schemaname = 'public'
      order by t.tablename
    `,
  }),
});
if (!managementResponse.ok) {
  throw new Error(`無法取得正式資料表清單 (${managementResponse.status})`);
}
const tables = await managementResponse.json();
await mkdir(outputDir, { recursive: true, mode: 0o700 });

const manifest = {
  format: "hj-3052-rest-backup-v2",
  projectRef,
  createdAt: new Date().toISOString(),
  tables: [],
};

for (const tableInfo of tables) {
  const tableName = String(tableInfo.table_name || "");
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) throw new Error(`不安全的資料表名稱：${tableName}`);
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${tableName}?select=*&limit=1000&offset=${offset}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) throw new Error(`備份 ${tableName} 失敗 (${response.status})`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  const json = `${JSON.stringify(rows)}\n`;
  const fileName = `${tableName}.json`;
  await writeFile(path.join(outputDir, fileName), json, { mode: 0o600 });
  manifest.tables.push({
    tableName,
    fileName,
    rows: rows.length,
    primaryKey: Array.isArray(tableInfo.primary_key) ? tableInfo.primary_key : [],
    columns: Array.isArray(tableInfo.columns) ? tableInfo.columns : [],
    constraints: Array.isArray(tableInfo.constraints) ? tableInfo.constraints : [],
    rowSecurity: Boolean(tableInfo.row_security),
    sha256: createHash("sha256").update(json).digest("hex"),
  });
}

await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

process.stdout.write(`TABLES_EXPORTED=${manifest.tables.length}\n`);
process.stdout.write(`ROWS_EXPORTED=${manifest.tables.reduce((sum, table) => sum + table.rows, 0)}\n`);
