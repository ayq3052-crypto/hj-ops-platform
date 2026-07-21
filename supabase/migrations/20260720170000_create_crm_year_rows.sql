create table if not exists public.crm_year_rows (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  year integer not null check (year between 2020 and 2200),
  customer_no text not null,
  folder text not null default 'active' check (folder in ('active', 'ended')),
  source_row_key text,
  row_data jsonb not null default '{}'::jsonb,
  source text not null default 'web_crm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  constraint crm_year_rows_branch_year_customer_unique unique (branch_id, year, customer_no)
);

create index if not exists crm_year_rows_branch_year_folder_idx
  on public.crm_year_rows (branch_id, year, folder);

create or replace function public.set_crm_year_rows_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists crm_year_rows_set_updated_at on public.crm_year_rows;
create trigger crm_year_rows_set_updated_at
before update on public.crm_year_rows
for each row execute function public.set_crm_year_rows_updated_at();

alter table public.crm_year_rows enable row level security;

drop policy if exists crm_year_rows_authenticated_select on public.crm_year_rows;
create policy crm_year_rows_authenticated_select
on public.crm_year_rows for select to authenticated
using (true);

drop policy if exists crm_year_rows_authenticated_insert on public.crm_year_rows;
create policy crm_year_rows_authenticated_insert
on public.crm_year_rows for insert to authenticated
with check (true);

drop policy if exists crm_year_rows_authenticated_update on public.crm_year_rows;
create policy crm_year_rows_authenticated_update
on public.crm_year_rows for update to authenticated
using (true) with check (true);

drop policy if exists crm_year_rows_authenticated_delete on public.crm_year_rows;
create policy crm_year_rows_authenticated_delete
on public.crm_year_rows for delete to authenticated
using (true);

grant select, insert, update, delete on public.crm_year_rows to authenticated;

comment on table public.crm_year_rows is
  '3052 CRM yearly snapshots. Current customer truth remains in customers/contracts; each year row preserves that year without overwriting prior years.';
