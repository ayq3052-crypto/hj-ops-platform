import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRef = process.env.HJ_SUPABASE_PROJECT_REF || "khpgrfpnvgzkfjmxhuny";
const accessToken = process.env.HJ_SUPABASE_ACCESS_TOKEN;
const sqlFile = process.argv[2];
const readOnly = process.argv.includes("--read-only");

if (!accessToken) throw new Error("缺少 HJ_SUPABASE_ACCESS_TOKEN");
if (!sqlFile) throw new Error("請提供 SQL 檔案路徑");

const query = await readFile(path.resolve(sqlFile), "utf8");
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ query, read_only: readOnly }),
});
const body = await response.text();
if (!response.ok) throw new Error(`Supabase query failed (${response.status}): ${body}`);
process.stdout.write(body);
