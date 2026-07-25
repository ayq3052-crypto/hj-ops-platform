begin;

drop function if exists public.save_confirmed_crm_renewal(uuid, integer, date, date, jsonb, jsonb);

drop trigger if exists crm_year_rows_capture_revision on public.crm_year_rows;
drop function if exists public.capture_crm_year_row_revision();
drop table if exists public.crm_year_row_revisions;

do $$
begin
  if exists (
    select 1
    from public.crm_year_rows
    group by branch_id, year, customer_no
    having count(*) > 1
  ) then
    raise exception '已有同客戶同年度多循環資料；為避免資料遺失，停止回復舊唯一鍵';
  end if;
end;
$$;

alter table public.crm_year_rows
  drop constraint if exists crm_year_rows_branch_year_customer_period_unique;
alter table public.crm_year_rows
  add constraint crm_year_rows_branch_year_customer_unique unique (branch_id, year, customer_no);

alter table public.crm_year_rows
  drop constraint if exists crm_year_rows_cycle_state_check,
  drop constraint if exists crm_year_rows_contract_period_check,
  drop column if exists cycle_state,
  drop column if exists contract_period,
  drop column if exists confirmed_at;

commit;
