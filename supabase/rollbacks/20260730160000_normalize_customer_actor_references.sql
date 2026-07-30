begin;

drop trigger if exists normalize_customer_actor_references
on public.customers;

drop function if exists public.normalize_customer_actor_references();

commit;
