begin;

create or replace function public.normalize_customer_actor_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapped_app_user_id uuid;
begin
  if new.created_by is not null
    and not exists (
      select 1
      from public.app_users
      where id = new.created_by
    ) then
    select id
    into mapped_app_user_id
    from public.app_users
    where auth_user_id = new.created_by
      and status = 'active'
    limit 1;

    new.created_by := mapped_app_user_id;
  end if;

  mapped_app_user_id := null;

  if new.updated_by is not null
    and not exists (
      select 1
      from public.app_users
      where id = new.updated_by
    ) then
    select id
    into mapped_app_user_id
    from public.app_users
    where auth_user_id = new.updated_by
      and status = 'active'
    limit 1;

    new.updated_by := mapped_app_user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_customer_actor_references
on public.customers;

create trigger normalize_customer_actor_references
before insert or update of created_by, updated_by
on public.customers
for each row
execute function public.normalize_customer_actor_references();

revoke all on function public.normalize_customer_actor_references()
from public, anon, authenticated;

comment on function public.normalize_customer_actor_references() is
  'Converts auth.users ids supplied by authenticated CRM writes into app_users ids before customer foreign keys are checked. Missing app_users mappings remain null while audit_logs.actor_auth_id preserves the authenticated actor.';

commit;
