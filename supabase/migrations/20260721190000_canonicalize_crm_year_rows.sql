begin;

do $$
begin
  if exists (
    select 1
    from public.crm_year_rows
    group by branch_id, year, public.hj_normalize_customer_no(customer_no)
    having count(*) > 1
  ) then
    raise exception 'crm_year_rows contains customer_no collisions after V normalization';
  end if;
end;
$$;

update public.crm_year_rows
set
  customer_no = public.hj_normalize_customer_no(customer_no),
  row_data = case
    when jsonb_typeof(row_data) = 'object' then
      jsonb_set(
        row_data,
        '{id}',
        to_jsonb(public.hj_normalize_customer_no(coalesce(row_data->>'id', customer_no))),
        true
      )
    else row_data
  end
where customer_no is distinct from public.hj_normalize_customer_no(customer_no)
   or (
     jsonb_typeof(row_data) = 'object'
     and row_data ? 'id'
     and row_data->>'id' is distinct from public.hj_normalize_customer_no(row_data->>'id')
   );

drop trigger if exists crm_year_rows_canonical_customer_no on public.crm_year_rows;
create trigger crm_year_rows_canonical_customer_no
before insert or update of customer_no on public.crm_year_rows
for each row execute function public.hj_canonicalize_customer_no_trigger();

commit;
