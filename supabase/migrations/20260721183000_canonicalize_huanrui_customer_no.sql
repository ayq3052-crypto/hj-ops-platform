begin;

create or replace function public.hj_normalize_customer_no(input_value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := translate(
    btrim(coalesce(input_value, '')),
    'Ｖｖ０１２３４５６７８９',
    'Vv0123456789'
  );
begin
  if normalized ~* '^v[0-9]*$' then
    return 'V' || substring(normalized from 2);
  end if;
  return normalized;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.customers
    group by branch_id, public.hj_normalize_customer_no(customer_no)
    having count(*) > 1
  ) then
    raise exception 'customers contains customer_no collisions after V normalization';
  end if;

  if exists (
    select 1
    from public.contracts
    where contract_no is not null
    group by public.hj_normalize_customer_no(contract_no)
    having count(*) > 1
  ) then
    raise exception 'contracts contains contract_no collisions after V normalization';
  end if;
end;
$$;

update public.customers
set customer_no = public.hj_normalize_customer_no(customer_no)
where customer_no is distinct from public.hj_normalize_customer_no(customer_no);

update public.payment_month_rows
set
  customer_no = public.hj_normalize_customer_no(customer_no),
  source_snapshot = case
    when jsonb_typeof(source_snapshot) = 'object' then jsonb_set(source_snapshot, '{id}', to_jsonb(public.hj_normalize_customer_no(coalesce(source_snapshot->>'id', customer_no))), true)
    else source_snapshot
  end
where customer_no is distinct from public.hj_normalize_customer_no(customer_no)
   or (jsonb_typeof(source_snapshot) = 'object' and source_snapshot ? 'id' and source_snapshot->>'id' is distinct from public.hj_normalize_customer_no(source_snapshot->>'id'));

update public.contracts
set contract_no = public.hj_normalize_customer_no(contract_no)
where contract_no is not null
  and contract_no is distinct from public.hj_normalize_customer_no(contract_no);

do $$
begin
  if to_regclass('public.crm_year_rows') is not null then
    if exists (
      select 1
      from public.crm_year_rows
      group by branch_id, year, public.hj_normalize_customer_no(customer_no)
      having count(*) > 1
    ) then
      raise exception 'crm_year_rows contains customer_no collisions after V normalization';
    end if;
    update public.crm_year_rows
    set
      customer_no = public.hj_normalize_customer_no(customer_no),
      row_data = case
        when jsonb_typeof(row_data) = 'object' then jsonb_set(row_data, '{id}', to_jsonb(public.hj_normalize_customer_no(coalesce(row_data->>'id', customer_no))), true)
        else row_data
      end
    where customer_no is distinct from public.hj_normalize_customer_no(customer_no)
       or (jsonb_typeof(row_data) = 'object' and row_data ? 'id' and row_data->>'id' is distinct from public.hj_normalize_customer_no(row_data->>'id'));
  end if;
end;
$$;

create or replace function public.hj_canonicalize_customer_no_trigger()
returns trigger
language plpgsql
as $$
begin
  new.customer_no := public.hj_normalize_customer_no(new.customer_no);
  return new;
end;
$$;

create or replace function public.hj_canonicalize_contract_no_trigger()
returns trigger
language plpgsql
as $$
begin
  new.contract_no := public.hj_normalize_customer_no(new.contract_no);
  return new;
end;
$$;

drop trigger if exists customers_canonical_customer_no on public.customers;
create trigger customers_canonical_customer_no
before insert or update of customer_no on public.customers
for each row execute function public.hj_canonicalize_customer_no_trigger();

drop trigger if exists payment_month_rows_canonical_customer_no on public.payment_month_rows;
create trigger payment_month_rows_canonical_customer_no
before insert or update of customer_no on public.payment_month_rows
for each row execute function public.hj_canonicalize_customer_no_trigger();

drop trigger if exists contracts_canonical_contract_no on public.contracts;
create trigger contracts_canonical_contract_no
before insert or update of contract_no on public.contracts
for each row execute function public.hj_canonicalize_contract_no_trigger();

do $$
begin
  if to_regclass('public.crm_year_rows') is not null then
    execute 'drop trigger if exists crm_year_rows_canonical_customer_no on public.crm_year_rows';
    execute 'create trigger crm_year_rows_canonical_customer_no before insert or update of customer_no on public.crm_year_rows for each row execute function public.hj_canonicalize_customer_no_trigger()';
  end if;
end;
$$;

commit;
