begin;

alter table public.crm_year_rows
  add column if not exists cycle_state text,
  add column if not exists contract_period integer,
  add column if not exists confirmed_at timestamptz;

update public.crm_year_rows
set cycle_state = case
  when year = 2026 then 'historical'
  when coalesce(source_row_key, '') ~ ('-' || year::text || '$') then 'legacy_generated'
  else 'historical'
end
where cycle_state is null;

update public.crm_year_rows
set contract_period = 0
where contract_period is null;

alter table public.crm_year_rows
  alter column cycle_state set default 'legacy_generated',
  alter column cycle_state set not null,
  alter column contract_period set default 0,
  alter column contract_period set not null;

alter table public.crm_year_rows
  drop constraint if exists crm_year_rows_cycle_state_check;
alter table public.crm_year_rows
  add constraint crm_year_rows_cycle_state_check
  check (cycle_state in ('historical', 'confirmed', 'legacy_generated', 'invalidated'));

alter table public.crm_year_rows
  drop constraint if exists crm_year_rows_contract_period_check;
alter table public.crm_year_rows
  add constraint crm_year_rows_contract_period_check check (contract_period >= 0);

alter table public.crm_year_rows
  drop constraint if exists crm_year_rows_branch_year_customer_unique;
alter table public.crm_year_rows
  add constraint crm_year_rows_branch_year_customer_period_unique
  unique (branch_id, year, customer_no, contract_period);

create index if not exists crm_year_rows_customer_cycle_idx
  on public.crm_year_rows (branch_id, customer_no, contract_period, year);

create table if not exists public.crm_year_row_revisions (
  id uuid primary key default gen_random_uuid(),
  crm_year_row_id uuid not null,
  branch_id uuid not null,
  year integer not null,
  customer_no text not null,
  contract_period integer not null,
  previous_row jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create index if not exists crm_year_row_revisions_lookup_idx
  on public.crm_year_row_revisions (branch_id, customer_no, year, contract_period, changed_at desc);

create or replace function public.capture_crm_year_row_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_year_row_revisions (
    crm_year_row_id,
    branch_id,
    year,
    customer_no,
    contract_period,
    previous_row,
    changed_by
  ) values (
    old.id,
    old.branch_id,
    old.year,
    old.customer_no,
    old.contract_period,
    to_jsonb(old),
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists crm_year_rows_capture_revision on public.crm_year_rows;
create trigger crm_year_rows_capture_revision
before update or delete on public.crm_year_rows
for each row execute function public.capture_crm_year_row_revision();

create or replace function public.save_confirmed_crm_renewal(
  p_customer_id uuid,
  p_expected_contract_period integer,
  p_expected_start date,
  p_expected_end date,
  p_customer_payload jsonb,
  p_year_row_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_customer public.customers%rowtype;
  customer_patch public.customers%rowtype;
  saved_year_row public.crm_year_rows%rowtype;
  next_period integer;
begin
  select * into customer_patch from jsonb_populate_record(null::public.customers, p_customer_payload);

  select *
  into current_customer
  from public.customers
  where id = p_customer_id
  for update;

  if current_customer.id is null then
    raise exception '找不到可續約的目前 CRM';
  end if;
  if p_expected_contract_period is null or p_expected_contract_period < 1 then
    raise exception 'CRM 期次無法判讀，請重新整理後再續約';
  end if;
  if current_customer.contract_start is distinct from p_expected_start
    or current_customer.contract_end is distinct from p_expected_end then
    raise exception 'CRM 已被其他分頁更新，請重新整理後再續約';
  end if;
  if customer_patch.branch_id is distinct from current_customer.branch_id
    or customer_patch.customer_no is distinct from current_customer.customer_no then
    raise exception '續約資料與原客戶不一致，已停止儲存';
  end if;
  if customer_patch.contract_start is null
    or customer_patch.contract_end is null
    or customer_patch.contract_end <= customer_patch.contract_start
    or customer_patch.payment_cycle is null then
    raise exception '續約 CRM 日期或繳費方式不完整，已停止儲存';
  end if;
  if (p_year_row_payload ->> 'branch_id')::uuid is distinct from current_customer.branch_id
    or p_year_row_payload ->> 'customer_no' is distinct from current_customer.customer_no
    or (p_year_row_payload ->> 'year')::integer is distinct from extract(year from customer_patch.contract_start)::integer then
    raise exception '續約年度列與 CRM 不一致，已停止儲存';
  end if;

  select greatest(coalesce(max(nullif(contract_period, 0)), 1), 1) + 1
  into next_period
  from public.crm_year_rows
  where customer_id = p_customer_id
    and cycle_state in ('historical', 'confirmed');

  if next_period is distinct from p_expected_contract_period + 1 then
    raise exception 'CRM 已被其他分頁更新，請重新整理後再續約';
  end if;

  update public.customers
  set
    legacy_no = customer_patch.legacy_no,
    customer_name = customer_patch.customer_name,
    company_name = customer_patch.company_name,
    company_tax_id = customer_patch.company_tax_id,
    identity_number = customer_patch.identity_number,
    birthday = customer_patch.birthday,
    phone = customer_patch.phone,
    email = customer_patch.email,
    address = customer_patch.address,
    service_type = customer_patch.service_type,
    payment_cycle = customer_patch.payment_cycle,
    monthly_amount = customer_patch.monthly_amount,
    deposit_amount = customer_patch.deposit_amount,
    contract_start = customer_patch.contract_start,
    contract_end = customer_patch.contract_end,
    payment_day = customer_patch.payment_day,
    crm_status = customer_patch.crm_status,
    source_system = customer_patch.source_system,
    source_row_key = customer_patch.source_row_key,
    source_snapshot = customer_patch.source_snapshot,
    notes = customer_patch.notes,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_customer_id;

  insert into public.crm_year_rows (
    branch_id, customer_id, year, customer_no, folder, source_row_key,
    row_data, source, cycle_state, contract_period, confirmed_at
  ) values (
    (p_year_row_payload ->> 'branch_id')::uuid,
    p_customer_id,
    (p_year_row_payload ->> 'year')::integer,
    p_year_row_payload ->> 'customer_no',
    coalesce(p_year_row_payload ->> 'folder', 'active'),
    nullif(p_year_row_payload ->> 'source_row_key', ''),
    coalesce(p_year_row_payload -> 'row_data', '{}'::jsonb),
    coalesce(p_year_row_payload ->> 'source', 'web_crm'),
    'confirmed',
    next_period,
    now()
  )
  on conflict (branch_id, year, customer_no, contract_period)
  do update set
    customer_id = excluded.customer_id,
    folder = excluded.folder,
    source_row_key = excluded.source_row_key,
    row_data = excluded.row_data,
    source = excluded.source,
    cycle_state = excluded.cycle_state,
    confirmed_at = excluded.confirmed_at,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into saved_year_row;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'branch_id', saved_year_row.branch_id,
    'contract_period', next_period,
    'year_row_id', saved_year_row.id
  );
end;
$$;

alter table public.crm_year_row_revisions enable row level security;

drop policy if exists crm_year_row_revisions_authenticated_select on public.crm_year_row_revisions;
create policy crm_year_row_revisions_authenticated_select
on public.crm_year_row_revisions for select to authenticated using (true);

grant select on public.crm_year_row_revisions to authenticated;
revoke execute on function public.save_confirmed_crm_renewal(uuid, integer, date, date, jsonb, jsonb) from public, anon;
grant execute on function public.save_confirmed_crm_renewal(uuid, integer, date, date, jsonb, jsonb) to authenticated;

comment on column public.crm_year_rows.cycle_state is
  'historical/confirmed are real cycles; legacy_generated/invalidated never feed payment smart import.';
comment on column public.crm_year_rows.contract_period is
  '0 means legacy snapshot without proven renewal period; confirmed renewals use 1,2,3...';
comment on table public.crm_year_row_revisions is
  'Append-only safety history for CRM year-row updates and deletes.';

commit;
