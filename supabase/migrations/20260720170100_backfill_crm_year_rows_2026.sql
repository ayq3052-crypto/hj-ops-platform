insert into public.crm_year_rows (
  branch_id,
  customer_id,
  year,
  customer_no,
  folder,
  source_row_key,
  row_data,
  source
)
select
  c.branch_id,
  c.id,
  2026,
  c.customer_no,
  case when c.crm_status = 'ended' then 'ended' else 'active' end,
  c.source_row_key,
  coalesce(c.source_snapshot, '{}'::jsonb) || jsonb_build_object(
    'id', c.customer_no,
    'name', coalesce(c.customer_name, ''),
    'company', coalesce(c.company_name, ''),
    'item', coalesce(
      nullif(c.source_snapshot ->> 'item', ''),
      case coalesce(ct.service_type, c.service_type)
        when 'registration' then '營登'
        when 'office' then '辦公室'
        when 'seat' then '自由座'
        when 'mail' then '代收信件'
        when 'meeting_room' then '會議室'
        when 'company_registration' then '公司登記'
        else '其他'
      end
    ),
    'cycle', coalesce(ct.payment_cycle, c.payment_cycle, ''),
    'start', case when coalesce(ct.start_date, c.contract_start) is null then ''
      else concat(extract(year from coalesce(ct.start_date, c.contract_start))::integer - 1911, '/', extract(month from coalesce(ct.start_date, c.contract_start))::integer, '/', extract(day from coalesce(ct.start_date, c.contract_start))::integer) end,
    'end', case when coalesce(ct.end_date, c.contract_end) is null then ''
      else concat(extract(year from coalesce(ct.end_date, c.contract_end))::integer - 1911, '/', extract(month from coalesce(ct.end_date, c.contract_end))::integer, '/', extract(day from coalesce(ct.end_date, c.contract_end))::integer) end,
    'amount', coalesce(nullif(c.source_snapshot ->> 'amount', ''), case when coalesce(ct.monthly_amount, c.monthly_amount) is null then '' else concat(coalesce(ct.monthly_amount, c.monthly_amount), '/m') end),
    'folder', case when c.crm_status = 'ended' then 'ended' else 'active' end,
    'venue', b.code,
    'uid', coalesce(c.source_row_key, concat(b.code, '-2026-', c.customer_no))
  ),
  'backfill_20260720'
from public.customers c
join public.branches b on b.id = c.branch_id
left join lateral (
  select contract.*
  from public.contracts contract
  where contract.customer_id = c.id
  order by contract.created_at desc
  limit 1
) ct on true
on conflict (branch_id, year, customer_no) do nothing;
