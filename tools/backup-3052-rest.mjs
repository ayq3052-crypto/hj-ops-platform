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

const runManagementQuery = async (query) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ read_only: true, query }),
  });
  if (!response.ok) {
    throw new Error(`無法取得正式資料庫結構 (${response.status})`);
  }
  return response.json();
};

const tables = await runManagementQuery(`
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
`);

const schemaObjects = await runManagementQuery(`
  with
  app_roles(role_name) as (
    values ('anon'::text), ('authenticated'::text), ('service_role'::text)
  ),
  sequence_objects as (
    select
      'sequence'::text as kind,
      10 as sort_order,
      s.sequencename::text as object_name,
      format(
        'create sequence public.%I as %s increment by %s minvalue %s maxvalue %s start with %s cache %s %s;%s',
        s.sequencename,
        s.data_type,
        s.increment_by,
        s.min_value,
        s.max_value,
        s.start_value,
        s.cache_size,
        case when s.cycle then 'cycle' else 'no cycle' end,
        case
          when s.last_value is null then ''
          else format(
            E'\\nselect setval(%L::regclass, %s, true);',
            format('public.%I', s.sequencename),
            s.last_value
          )
        end
      ) as definition
    from pg_sequences s
    where s.schemaname = 'public'
  ),
  function_objects as (
    select
      'function'::text as kind,
      40 as sort_order,
      p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object_name,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
  ),
  index_objects as (
    select
      'index'::text as kind,
      60 as sort_order,
      i.relname::text as object_name,
      pg_get_indexdef(i.oid) || ';' as definition
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    left join pg_constraint con on con.conindid = i.oid
    where n.nspname = 'public'
      and con.oid is null
  ),
  view_objects as (
    select
      'view'::text as kind,
      70 as sort_order,
      v.viewname::text as object_name,
      format(
        'create or replace view public.%I as%s%s;',
        v.viewname,
        E'\\n',
        pg_get_viewdef(format('public.%I', v.viewname)::regclass, true)
      ) as definition
    from pg_views v
    where v.schemaname = 'public'
  ),
  policy_objects as (
    select
      'policy'::text as kind,
      80 as sort_order,
      p.tablename || '.' || p.policyname as object_name,
      format(
        'create policy %I on public.%I as %s for %s to %s%s%s;',
        p.policyname,
        p.tablename,
        p.permissive,
        p.cmd,
        (
          select string_agg(quote_ident(role_name), ', ' order by ordinality)
          from unnest(p.roles) with ordinality as policy_role(role_name, ordinality)
        ),
        case when p.qual is null then '' else format(' using (%s)', p.qual) end,
        case when p.with_check is null then '' else format(' with check (%s)', p.with_check) end
      ) as definition
    from pg_policies p
    where p.schemaname = 'public'
  ),
  trigger_objects as (
    select
      'trigger'::text as kind,
      90 as sort_order,
      c.relname || '.' || t.tgname as object_name,
      pg_get_triggerdef(t.oid, true) || ';' as definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
  ),
  schema_grants as (
    select
      'grant'::text as kind,
      100 as sort_order,
      'schema.public.' || r.role_name as object_name,
      format(
        'grant %s on schema public to %I;',
        array_to_string(
          array_remove(array[
            case when has_schema_privilege(r.role_name, 'public', 'USAGE') then 'usage' end,
            case when has_schema_privilege(r.role_name, 'public', 'CREATE') then 'create' end
          ], null),
          ', '
        ),
        r.role_name
      ) as definition
    from app_roles r
    where has_schema_privilege(r.role_name, 'public', 'USAGE')
       or has_schema_privilege(r.role_name, 'public', 'CREATE')
  ),
  relation_grants as (
    select
      'grant'::text as kind,
      110 as sort_order,
      c.relname || '.' || r.role_name as object_name,
      format(
        'grant %s on %s public.%I to %I;',
        array_to_string(
          array_remove(array[
            case when has_table_privilege(r.role_name, c.oid, 'SELECT') then 'select' end,
            case when has_table_privilege(r.role_name, c.oid, 'INSERT') then 'insert' end,
            case when has_table_privilege(r.role_name, c.oid, 'UPDATE') then 'update' end,
            case when has_table_privilege(r.role_name, c.oid, 'DELETE') then 'delete' end,
            case when has_table_privilege(r.role_name, c.oid, 'TRUNCATE') then 'truncate' end,
            case when has_table_privilege(r.role_name, c.oid, 'REFERENCES') then 'references' end,
            case when has_table_privilege(r.role_name, c.oid, 'TRIGGER') then 'trigger' end
          ], null),
          ', '
        ),
        case when c.relkind = 'S' then 'sequence' else 'table' end,
        c.relname,
        r.role_name
      ) as definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join app_roles r
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and (
        has_table_privilege(r.role_name, c.oid, 'SELECT')
        or has_table_privilege(r.role_name, c.oid, 'INSERT')
        or has_table_privilege(r.role_name, c.oid, 'UPDATE')
        or has_table_privilege(r.role_name, c.oid, 'DELETE')
        or has_table_privilege(r.role_name, c.oid, 'TRUNCATE')
        or has_table_privilege(r.role_name, c.oid, 'REFERENCES')
        or has_table_privilege(r.role_name, c.oid, 'TRIGGER')
      )
  ),
  function_grants as (
    select
      'grant'::text as kind,
      120 as sort_order,
      p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ').' || r.role_name as object_name,
      format(
        'grant execute on function public.%I(%s) to %I;',
        p.proname,
        pg_get_function_identity_arguments(p.oid),
        r.role_name
      ) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join app_roles r
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  )
  select kind, sort_order, object_name, definition
  from (
    select * from sequence_objects
    union all select * from function_objects
    union all select * from index_objects
    union all select * from view_objects
    union all select * from policy_objects
    union all select * from trigger_objects
    union all select * from schema_grants
    union all select * from relation_grants
    union all select * from function_grants
  ) all_objects
  order by sort_order, object_name
`);
await mkdir(outputDir, { recursive: true, mode: 0o700 });

const manifest = {
  format: "hj-3052-rest-backup-v3",
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

const schemaJson = `${JSON.stringify(schemaObjects, null, 2)}\n`;
const schemaFileName = "schema-objects.json";
await writeFile(path.join(outputDir, schemaFileName), schemaJson, { mode: 0o600 });
manifest.schema = {
  fileName: schemaFileName,
  objects: schemaObjects.length,
  sha256: createHash("sha256").update(schemaJson).digest("hex"),
};

await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

process.stdout.write(`TABLES_EXPORTED=${manifest.tables.length}\n`);
process.stdout.write(`ROWS_EXPORTED=${manifest.tables.reduce((sum, table) => sum + table.rows, 0)}\n`);
process.stdout.write(`SCHEMA_OBJECTS_EXPORTED=${schemaObjects.length}\n`);
