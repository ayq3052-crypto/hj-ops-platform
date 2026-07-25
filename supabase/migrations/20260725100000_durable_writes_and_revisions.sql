begin;

create table if not exists public.page_saved_state (
  id uuid primary key default gen_random_uuid(),
  state_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.page_saved_state enable row level security;

drop policy if exists page_saved_state_authenticated_select on public.page_saved_state;
create policy page_saved_state_authenticated_select
on public.page_saved_state for select to authenticated using (true);

drop policy if exists page_saved_state_authenticated_insert on public.page_saved_state;
create policy page_saved_state_authenticated_insert
on public.page_saved_state for insert to authenticated with check (true);

drop policy if exists page_saved_state_authenticated_update on public.page_saved_state;
create policy page_saved_state_authenticated_update
on public.page_saved_state for update to authenticated using (true) with check (true);

grant select, insert, update on public.page_saved_state to authenticated;

create or replace function public.capture_operational_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_json jsonb;
  new_json jsonb;
  changed text[];
  target_id uuid;
begin
  old_json := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  target_id := case when tg_op = 'DELETE' then old.id else new.id end;

  select coalesce(array_agg(k order by k), array[]::text[])
  into changed
  from jsonb_object_keys(coalesce(old_json, '{}'::jsonb) || coalesce(new_json, '{}'::jsonb)) as keys(k)
  where old_json -> k is distinct from new_json -> k;

  insert into public.audit_logs (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_fields,
    actor_id,
    notes
  ) values (
    tg_table_name,
    target_id,
    lower(tg_op),
    old_json,
    new_json,
    changed,
    auth.uid(),
    'automatic operational revision'
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers',
    'crm_year_rows',
    'payment_month_rows',
    'payments',
    'message_drafts',
    'contracts',
    'contract_documents',
    'quotes',
    'quote_items',
    'page_saved_state'
  ]
  loop
    execute format('drop trigger if exists capture_operational_revision on public.%I', table_name);
    execute format(
      'create trigger capture_operational_revision after insert or update or delete on public.%I for each row execute function public.capture_operational_revision()',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists audit_logs_authenticated_delete on public.audit_logs;
drop policy if exists audit_logs_authenticated_update on public.audit_logs;
drop policy if exists audit_logs_authenticated_insert on public.audit_logs;
revoke insert, update, delete on public.audit_logs from authenticated, anon;
grant select on public.audit_logs to authenticated;

comment on table public.page_saved_state is
  'Database-backed state for data-bearing 3052 pages that previously relied only on browser storage.';
comment on function public.capture_operational_revision() is
  'Append-only before/after evidence for every operational data mutation.';

commit;
