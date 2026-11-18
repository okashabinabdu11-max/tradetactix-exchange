-- TradeTactix: Chart Pro, paid in Ethiopian Birr (Telebirr or CBE bank transfer).
-- Separate from signals Pro. The member pays, pastes the transaction reference,
-- and waits; an administrator approves after checking the money arrived.
-- Payment details are entered by the administrator in Admin; a method is shown
-- to members only when it has an account name and number and is switched on.
-- Safe to run more than once.

-- Plans are made by the administrator (name, days, price in birr). None exist
-- until the administrator adds one, so no price is ever made up here.
create table if not exists public.chart_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  days integer not null check (days between 1 and 3650),
  price_etb numeric(10, 2) not null check (price_etb > 0),
  enabled boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.chart_plans enable row level security;
drop policy if exists "chart_plans_read" on public.chart_plans;
create policy "chart_plans_read" on public.chart_plans for select to anon, authenticated using (enabled or (select public.is_admin()));
revoke all on public.chart_plans from anon, authenticated;
grant select on public.chart_plans to anon, authenticated;

create table if not exists public.etb_methods (
  id text primary key check (id in ('telebirr', 'cbe')),
  label text not null,
  account_name text not null default '',
  account_number text not null default '',
  enabled boolean not null default false,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint etb_method_complete check (not enabled or (length(btrim(account_name)) > 0 and length(btrim(account_number)) > 0))
);
insert into public.etb_methods (id, label, sort) values ('telebirr', 'Telebirr', 1), ('cbe', 'CBE (Commercial Bank of Ethiopia)', 2)
on conflict (id) do nothing;
alter table public.etb_methods enable row level security;
drop policy if exists "etb_methods_read" on public.etb_methods;
create policy "etb_methods_read" on public.etb_methods for select to authenticated using (enabled or (select public.is_admin()));
revoke all on public.etb_methods from anon, authenticated;
grant select on public.etb_methods to authenticated;

create table if not exists public.chart_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chart_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.chart_subscriptions enable row level security;
drop policy if exists "chart_subs_read_own" on public.chart_subscriptions;
create policy "chart_subs_read_own" on public.chart_subscriptions for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.chart_subscriptions from anon, authenticated;
grant select on public.chart_subscriptions to authenticated;

create table if not exists public.etb_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null references public.etb_methods (id),
  plan_id uuid references public.chart_plans (id) on delete set null,
  plan_name text not null default '',
  amount_etb numeric(10, 2) not null,
  days integer not null,
  reference text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text not null default '',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- One receipt can be used once (a rejected one frees it to be corrected).
create unique index if not exists etb_payments_ref_unique on public.etb_payments (method, upper(reference)) where status <> 'rejected';
create index if not exists etb_payments_user_idx on public.etb_payments (user_id, created_at desc);
alter table public.etb_payments enable row level security;
drop policy if exists "etb_payments_read_own" on public.etb_payments;
create policy "etb_payments_read_own" on public.etb_payments for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.etb_payments from anon, authenticated;
grant select on public.etb_payments to authenticated;

-- Chart Pro for the signed-in person: administrators always have it.
create or replace function public.my_chart_access()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_until timestamptz;
begin
  if v_user is null then return jsonb_build_object('signed_in', false, 'chart_pro', false); end if;
  if public.is_admin() then return jsonb_build_object('signed_in', true, 'chart_pro', true, 'unlimited', true); end if;
  select chart_until into v_until from public.chart_subscriptions where user_id = v_user;
  return jsonb_build_object('signed_in', true, 'chart_pro', coalesce(v_until > now(), false), 'chart_until', v_until);
end;
$$;
revoke all on function public.my_chart_access() from public;
grant execute on function public.my_chart_access() to anon, authenticated;

-- The member says they paid: method + reference from the receipt.
create or replace function public.submit_etb_payment(p_plan uuid, p_method text, p_reference text)
returns public.etb_payments
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_plan public.chart_plans;
  v_row public.etb_payments;
begin
  if v_user is null then raise exception 'Open your account first.' using errcode = '28000'; end if;
  if not exists (select 1 from public.etb_methods where id = p_method and enabled) then raise exception 'This payment method is not open.' using errcode = '22023'; end if;
  if v_ref !~ '^[A-Z0-9-]{6,40}$' then raise exception 'Enter the transaction reference from your receipt (6 to 40 letters and numbers).' using errcode = '22023'; end if;
  if exists (select 1 from public.etb_payments where user_id = v_user and status = 'pending') then
    raise exception 'You already have a payment waiting for approval.' using errcode = '22023';
  end if;
  select * into v_plan from public.chart_plans where id = p_plan and enabled;
  if not found then raise exception 'Choose a Chart Pro plan.' using errcode = '22023'; end if;
  begin
    insert into public.etb_payments (user_id, method, plan_id, plan_name, amount_etb, days, reference)
    values (v_user, p_method, v_plan.id, v_plan.name, v_plan.price_etb, v_plan.days, v_ref) returning * into v_row;
  exception when unique_violation then
    raise exception 'This transaction reference has already been used.' using errcode = '23505';
  end;
  return v_row;
end;
$$;
revoke all on function public.submit_etb_payment(uuid, text, text) from public, anon;
grant execute on function public.submit_etb_payment(uuid, text, text) to authenticated;

-- ---------- Administrators ----------
-- Add a plan (p_id null) or change one. Switching a plan off hides it from members.
create or replace function public.admin_save_chart_plan(p_id uuid, p_name text, p_days integer, p_price numeric, p_enabled boolean, p_sort integer default 0)
returns public.chart_plans
language plpgsql security definer set search_path = ''
as $$
declare v_row public.chart_plans; v_name text := left(btrim(coalesce(p_name, '')), 60);
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Give the plan a name.' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'Days must be 1 to 3650.' using errcode = '22023'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter a price in birr above 0.' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.chart_plans (name, days, price_etb, enabled, sort)
    values (v_name, p_days, round(p_price, 2), coalesce(p_enabled, true), coalesce(p_sort, 0)) returning * into v_row;
  else
    update public.chart_plans set name = v_name, days = p_days, price_etb = round(p_price, 2),
      enabled = coalesce(p_enabled, true), sort = coalesce(p_sort, 0), updated_at = now()
      where id = p_id returning * into v_row;
    if not found then raise exception 'Plan not found.' using errcode = '22023'; end if;
  end if;
  return v_row;
end;
$$;
revoke all on function public.admin_save_chart_plan(uuid, text, integer, numeric, boolean, integer) from public, anon;
grant execute on function public.admin_save_chart_plan(uuid, text, integer, numeric, boolean, integer) to authenticated;

create or replace function public.admin_set_etb_method(p_id text, p_account_name text, p_account_number text, p_enabled boolean)
returns public.etb_methods
language plpgsql security definer set search_path = ''
as $$
declare v_row public.etb_methods;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  update public.etb_methods
    set account_name = left(btrim(coalesce(p_account_name, '')), 120), account_number = left(btrim(coalesce(p_account_number, '')), 60),
        enabled = coalesce(p_enabled, false), updated_at = now()
    where id = p_id returning * into v_row;
  if not found then raise exception 'Unknown payment method.' using errcode = '22023'; end if;
  return v_row;
end;
$$;
revoke all on function public.admin_set_etb_method(text, text, text, boolean) from public, anon;
grant execute on function public.admin_set_etb_method(text, text, text, boolean) to authenticated;

create or replace function public.admin_list_etb_payments(p_status text default 'pending')
returns table (id uuid, email text, method text, plan_name text, amount_etb numeric, days integer, reference text, status text, admin_note text, created_at timestamptz, chart_until timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return query
    select p.id, u.email::text, p.method, p.plan_name, p.amount_etb, p.days, p.reference, p.status, p.admin_note, p.created_at, s.chart_until
    from public.etb_payments p join auth.users u on u.id = p.user_id
    left join public.chart_subscriptions s on s.user_id = p.user_id
    where p_status = 'all' or p.status = p_status
    order by p.created_at desc limit 100;
end;
$$;
revoke all on function public.admin_list_etb_payments(text) from public, anon;
grant execute on function public.admin_list_etb_payments(text) to authenticated;

-- Approving adds the paid days after the current end (or from now).
create or replace function public.admin_review_etb_payment(p_id uuid, p_approve boolean, p_note text default '')
returns public.etb_payments
language plpgsql security definer set search_path = ''
as $$
declare v_row public.etb_payments;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_row from public.etb_payments where id = p_id for update;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;
  if v_row.status <> 'pending' then raise exception 'This payment is %, not waiting for review.', v_row.status using errcode = '22023'; end if;
  update public.etb_payments
    set status = case when p_approve then 'approved' else 'rejected' end, admin_note = left(coalesce(p_note, ''), 500),
        reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_id returning * into v_row;
  if p_approve then
    insert into public.chart_subscriptions (user_id, chart_until) values (v_row.user_id, now() + make_interval(days => v_row.days))
    on conflict (user_id) do update
      set chart_until = greatest(coalesce(public.chart_subscriptions.chart_until, now()), now()) + make_interval(days => v_row.days), updated_at = now();
  end if;
  return v_row;
end;
$$;
revoke all on function public.admin_review_etb_payment(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_etb_payment(uuid, boolean, text) to authenticated;

-- For the payment notice to the admin (server-only).
create or replace function public.alerts_etb_info(p_secret text, p_id uuid)
returns table (email text, method text, plan_name text, amount_etb numeric, reference text, status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select u.email::text, p.method, p.plan_name, p.amount_etb, p.reference, p.status
    from public.etb_payments p join auth.users u on u.id = p.user_id where p.id = p_id;
end;
$$;
revoke all on function public.alerts_etb_info(text, uuid) from public, anon, authenticated;
grant execute on function public.alerts_etb_info(text, uuid) to anon;
