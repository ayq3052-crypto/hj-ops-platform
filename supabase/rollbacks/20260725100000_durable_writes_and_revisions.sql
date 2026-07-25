begin;

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
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop trigger if exists capture_operational_revision on public.%I', table_name);
    end if;
  end loop;
end;
$$;

drop function if exists public.capture_operational_revision();
drop table if exists public.page_saved_state;

create policy audit_logs_authenticated_insert
on public.audit_logs for insert to authenticated with check (true);
create policy audit_logs_authenticated_update
on public.audit_logs for update to authenticated using (true) with check (true);
create policy audit_logs_authenticated_delete
on public.audit_logs for delete to authenticated using (true);
grant insert, update, delete on public.audit_logs to authenticated;

commit;
