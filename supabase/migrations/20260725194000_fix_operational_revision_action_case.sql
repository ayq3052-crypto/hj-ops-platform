begin;

alter table public.audit_logs
  add column if not exists actor_auth_id uuid;

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
    actor_auth_id,
    notes
  ) values (
    tg_table_name,
    target_id,
    upper(tg_op),
    old_json,
    new_json,
    changed,
    null,
    auth.uid(),
    'automatic operational revision'
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.capture_operational_revision() is
  'Append-only before/after evidence for every operational data mutation. Audit action values match the uppercase audit_logs constraint.';

commit;
