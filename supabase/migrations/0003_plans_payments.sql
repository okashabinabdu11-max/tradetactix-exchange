-- TradeTactix AI, Stage 7: plans, credits, USDT payment claims and admin.
-- Safe to run more than once.
--
-- Security model
--   * No table below can be written directly by a signed-in user. Every change
--     goes through a function that checks who is calling.
--   * Credits are added in exactly two places: when an administrator approves a
--     payment claim, and when an administrator grants credits by hand.
--   * A payment network cannot be switched on until it is marked verified and
--     has a token contract recorded.

-- ---------- Administrators ----------

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

-- The owner's account. Nothing happens if that account does not exist yet.
insert into public.admins (user_id)
select id from auth.users where lower(email) = 'abdurahmanshelemo@gmail.com'
on conflict do nothing;

-- ---------- Settings (one row) ----------

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  pro_price_usdt numeric(10, 2) not null default 10 check (pro_price_usdt > 0),
  credits_per_purchase integer not null default 30 check (credits_per_purchase between 1 and 3650),
  hours_per_credit integer not null default 24 check (hours_per_credit between 1 and 720),
  free_previews_per_month integer not null default 10 check (free_previews_per_month between 0 and 1000),
  free_shows_levels boolean not null default false,
  free_analysis boolean not null default false,
  free_advanced_journal boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "settings_read_all" on public.app_settings;
create policy "settings_read_all" on public.app_settings for select to anon, authenticated using (true);
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;

-- ---------- Payment networks ----------

create table if not exists public.payment_networks (
  id text primary key check (id in ('bep20', 'trc20', 'plasma', 'aptos')),
  label text not null,
  receiving_address text not null,
  token_contract text,
  token_decimals integer check (token_decimals between 0 and 30),
  -- Whether this app can check transactions on this chain automatically.
  -- A network without an automatic check can never be switched on.
  auto_verify boolean not null default false,
  explorer_tx_url text,
  enabled boolean not null default false,
  verified boolean not null default false,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint network_enabled_needs_verification check (
    not enabled or (verified and auto_verify and token_contract is not null and token_decimals is not null))
);

-- Receiving addresses exactly as supplied by the owner. Every network starts
-- switched off and unverified; token contracts are filled in when verified.
insert into public.payment_networks (id, label, receiving_address, auto_verify, explorer_tx_url, sort) values
  ('bep20', 'USDT on BNB Smart Chain (BEP20)', '0x3030c068eca3e9d104ebb005564fa7a50231f9b9', true, 'https://bscscan.com/tx/', 1),
  ('trc20', 'USDT on TRON (TRC20)', 'TBPuZUcRgVSjqZ1vkvRqsKSAKs24aLgNWF', true, 'https://tronscan.org/#/transaction/', 2),
  ('plasma', 'USDT on Plasma', '0x3030c068eca3e9d104ebb005564fa7a50231f9b9', true, 'https://plasmascan.to/tx/', 3),
  ('aptos', 'USDT on Aptos', '0xe3f9f6deddf7bcfac6d7bb62a584cf8a024b94239d6ce07105f02a63287e10a0', false, 'https://explorer.aptoslabs.com/txn/', 4)
on conflict (id) do nothing;

alter table public.payment_networks enable row level security;
drop policy if exists "networks_read_enabled" on public.payment_networks;
create policy "networks_read_enabled" on public.payment_networks
  for select to authenticated using (enabled or (select public.is_admin()));
revoke all on public.payment_networks from anon, authenticated;
grant select on public.payment_networks to authenticated;

-- ---------- Subscriptions and the credit ledger ----------

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pro_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  network text not null references public.payment_networks (id),
  -- Each payment gets its own exact amount (the price plus a few cents) so a
  -- transaction can be matched to the person who started the payment.
  amount_usdt numeric(10, 2) not null check (amount_usdt > 0),
  credits integer not null check (credits > 0),
  receiving_address text not null,
  tx_hash text,
  status text not null default 'awaiting' check (status in ('awaiting', 'pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz not null default now() + interval '24 hours',
  submitted_at timestamptz,
  onchain jsonb,
  onchain_verified_at timestamptz,
  admin_note text not null default '',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint claim_hash_when_submitted check (status in ('awaiting', 'expired') or tx_hash is not null)
);
-- One transaction can be claimed once. A rejected claim frees the hash so a
-- mistyped submission can be corrected.
create unique index if not exists payment_claims_tx_unique
  on public.payment_claims (network, lower(tx_hash)) where tx_hash is not null and status not in ('rejected', 'expired');
-- No two open payments on a network share an amount.
create unique index if not exists payment_claims_open_amount_unique
  on public.payment_claims (network, amount_usdt) where status in ('awaiting', 'pending');
create index if not exists payment_claims_user_idx on public.payment_claims (user_id, created_at desc);

alter table public.payment_claims enable row level security;
drop policy if exists "claims_read_own" on public.payment_claims;
create policy "claims_read_own" on public.payment_claims
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.payment_claims from anon, authenticated;
grant select on public.payment_claims to authenticated;

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  credits integer not null check (credits <> 0),
  reason text not null check (reason in ('payment', 'admin_grant', 'admin_revoke')),
  payment_id uuid references public.payment_claims (id),
  note text not null default '',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.credit_ledger enable row level security;
drop policy if exists "ledger_read_own" on public.credit_ledger;
create policy "ledger_read_own" on public.credit_ledger
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.credit_ledger from anon, authenticated;
grant select on public.credit_ledger to authenticated;

-- ---------- Free-plan signal previews ----------

create table if not exists public.signal_previews (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  signal_key text not null check (char_length(signal_key) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (user_id, month, signal_key)
);
alter table public.signal_previews enable row level security;
drop policy if exists "previews_read_own" on public.signal_previews;
create policy "previews_read_own" on public.signal_previews
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.signal_previews from anon, authenticated;
grant select on public.signal_previews to authenticated;

-- ---------- Internal: add or remove credits ----------

create or replace function public.apply_credits(p_user uuid, p_credits integer, p_reason text, p_payment uuid, p_note text, p_by uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_hours integer;
  v_until timestamptz;
begin
  select hours_per_credit into v_hours from public.app_settings;
  insert into public.subscriptions (user_id) values (p_user) on conflict (user_id) do nothing;
  select pro_until into v_until from public.subscriptions where user_id = p_user for update;
  -- Credits start counting from now if the subscription has lapsed.
  v_until := greatest(coalesce(v_until, now()), now()) + make_interval(hours => p_credits * v_hours);
  if v_until <= now() then v_until := null; end if;
  update public.subscriptions set pro_until = v_until, updated_at = now() where user_id = p_user;
  insert into public.credit_ledger (user_id, credits, reason, payment_id, note, created_by)
  values (p_user, p_credits, p_reason, p_payment, coalesce(p_note, ''), p_by);
  return v_until;
end;
$$;
revoke all on function public.apply_credits(uuid, integer, text, uuid, text, uuid) from public, anon, authenticated;

-- ---------- What the caller is entitled to ----------

create or replace function public.my_entitlement()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_admin boolean;
  v_until timestamptz;
  v_set public.app_settings;
  v_used integer;
  v_pro boolean;
begin
  select * into v_set from public.app_settings;
  if v_user is null then
    return jsonb_build_object('signed_in', false, 'plan', 'none', 'pro_price_usdt', v_set.pro_price_usdt,
      'credits_per_purchase', v_set.credits_per_purchase, 'hours_per_credit', v_set.hours_per_credit,
      'previews_limit', v_set.free_previews_per_month);
  end if;
  v_admin := public.is_admin();
  select pro_until into v_until from public.subscriptions where user_id = v_user;
  v_pro := v_admin or (v_until is not null and v_until > now());
  select count(*) into v_used from public.signal_previews
    where user_id = v_user and month = date_trunc('month', now())::date;
  return jsonb_build_object(
    'signed_in', true,
    'is_admin', v_admin,
    'plan', case when v_pro then 'pro' else 'free' end,
    'unlimited', v_admin,
    'pro_until', case when v_until > now() then v_until else null end,
    'credits', case when v_until > now()
      then ceil(extract(epoch from (v_until - now())) / 3600.0 / v_set.hours_per_credit)::integer else 0 end,
    'previews_used', v_used,
    'previews_limit', v_set.free_previews_per_month,
    'shows_levels', v_pro or v_set.free_shows_levels,
    'shows_analysis', v_pro or v_set.free_analysis,
    'advanced_journal', v_pro or v_set.free_advanced_journal,
    'pro_price_usdt', v_set.pro_price_usdt,
    'credits_per_purchase', v_set.credits_per_purchase,
    'hours_per_credit', v_set.hours_per_credit
  );
end;
$$;
revoke all on function public.my_entitlement() from public;
grant execute on function public.my_entitlement() to anon, authenticated;

-- A free user may look at a limited number of different signals each month.
-- Looking at the same signal again does not use another preview.
create or replace function public.use_signal_preview(p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_month date := date_trunc('month', now())::date;
  v_limit integer;
  v_used integer;
  v_seen boolean;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_key is null or char_length(p_key) not between 1 and 80 then raise exception 'Bad signal key.' using errcode = '22023'; end if;
  select free_previews_per_month into v_limit from public.app_settings;
  -- Serialise per user so two requests cannot both take the last preview.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 7));
  select exists (select 1 from public.signal_previews where user_id = v_user and month = v_month and signal_key = p_key) into v_seen;
  select count(*) into v_used from public.signal_previews where user_id = v_user and month = v_month;
  if v_seen then return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit); end if;
  if v_used >= v_limit then return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit); end if;
  insert into public.signal_previews (user_id, month, signal_key) values (v_user, v_month, p_key);
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit);
end;
$$;
revoke all on function public.use_signal_preview(text) from public, anon;
grant execute on function public.use_signal_preview(text) to authenticated;

drop function if exists public.submit_payment_claim(text, text);

-- ---------- Customers: pay ----------

-- Step 1: reserve an exact amount on a network. Reuses the caller's open
-- payment on that network if there is one.
create or replace function public.start_payment(p_network text)
returns public.payment_claims
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_net public.payment_networks;
  v_set public.app_settings;
  v_row public.payment_claims;
  v_try integer := 0;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into v_net from public.payment_networks where id = p_network;
  if not found or not v_net.enabled then raise exception 'This payment network is not open.' using errcode = '22023'; end if;
  update public.payment_claims set status = 'expired' where status = 'awaiting' and expires_at < now();
  select * into v_row from public.payment_claims
    where user_id = v_user and network = p_network and status = 'awaiting' order by created_at desc limit 1;
  if found then return v_row; end if;
  if (select count(*) from public.payment_claims where user_id = v_user and status in ('awaiting', 'pending')) >= 3 then
    raise exception 'You already have 3 open payments. Finish or wait for those first.' using errcode = '22023';
  end if;
  select * into v_set from public.app_settings;
  loop
    v_try := v_try + 1;
    begin
      insert into public.payment_claims (user_id, network, amount_usdt, credits, receiving_address)
      values (v_user, p_network, v_set.pro_price_usdt + (1 + floor(random() * 99)) / 100.0, v_set.credits_per_purchase, v_net.receiving_address)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      if v_try >= 40 then raise exception 'Too many payments are open right now. Try again in a few minutes.' using errcode = '22023'; end if;
    end;
  end loop;
end;
$$;
revoke all on function public.start_payment(text) from public, anon;
grant execute on function public.start_payment(text) to authenticated;

-- Step 2: after paying, the customer gives the transaction hash.
create or replace function public.submit_payment_claim(p_claim uuid, p_tx_hash text)
returns public.payment_claims
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text := btrim(coalesce(p_tx_hash, ''));
  v_row public.payment_claims;
  v_ok boolean;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into v_row from public.payment_claims where id = p_claim and user_id = v_user for update;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;
  if v_row.status <> 'awaiting' or v_row.expires_at < now() then
    raise exception 'This payment is no longer open. Start a new one.' using errcode = '22023';
  end if;
  v_ok := case v_row.network
    when 'bep20' then v_hash ~ '^0x[0-9a-fA-F]{64}$'
    when 'plasma' then v_hash ~ '^0x[0-9a-fA-F]{64}$'
    when 'trc20' then v_hash ~ '^[0-9a-fA-F]{64}$'
    when 'aptos' then v_hash ~ '^0x[0-9a-fA-F]{1,64}$'
    else false end;
  if not v_ok then raise exception 'That does not look like a transaction hash for this network.' using errcode = '22023'; end if;
  begin
    update public.payment_claims set tx_hash = v_hash, status = 'pending', submitted_at = now()
      where id = p_claim returning * into v_row;
  exception when unique_violation then
    raise exception 'This transaction has already been claimed.' using errcode = '23505';
  end;
  return v_row;
end;
$$;
revoke all on function public.submit_payment_claim(uuid, text) from public, anon;
grant execute on function public.submit_payment_claim(uuid, text) to authenticated;

-- ---------- Administrator functions ----------

create or replace function public.admin_review_claim(p_id uuid, p_approve boolean, p_note text default '')
returns public.payment_claims
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.payment_claims;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'Claim not found.' using errcode = '22023'; end if;
  if v_row.status <> 'pending' then raise exception 'This claim is %, not waiting for review.', v_row.status using errcode = '22023'; end if;
  if p_approve and v_row.onchain_verified_at is null then
    raise exception 'Credits can only be added after the on-chain check passes.' using errcode = '22023';
  end if;
  update public.payment_claims
    set status = case when p_approve then 'approved' else 'rejected' end,
        admin_note = left(coalesce(p_note, ''), 500), reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_id returning * into v_row;
  if p_approve then
    perform public.apply_credits(v_row.user_id, v_row.credits, 'payment', v_row.id, v_row.admin_note, (select auth.uid()));
  end if;
  return v_row;
end;
$$;
revoke all on function public.admin_review_claim(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_claim(uuid, boolean, text) to authenticated;

-- Stores the result of the server's on-chain check. Called by the server with
-- the administrator's own sign-in; a passing result is what unlocks approval.
create or replace function public.admin_record_verification(p_id uuid, p_result jsonb)
returns public.payment_claims
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.payment_claims;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'Claim not found.' using errcode = '22023'; end if;
  if v_row.status <> 'pending' then raise exception 'This claim is %, not waiting for review.', v_row.status using errcode = '22023'; end if;
  if coalesce(p_result ->> 'txHash', '') <> v_row.tx_hash or coalesce(p_result ->> 'network', '') <> v_row.network then
    raise exception 'The check was for a different transaction.' using errcode = '22023';
  end if;
  update public.payment_claims set
    onchain = p_result,
    onchain_verified_at = case when (p_result ->> 'ok') = 'true' then now() else null end
  where id = p_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_record_verification(uuid, jsonb) from public, anon;
grant execute on function public.admin_record_verification(uuid, jsonb) to authenticated;

create or replace function public.admin_grant_credits(p_user uuid, p_credits integer, p_note text default '')
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if p_credits is null or p_credits = 0 or abs(p_credits) > 3650 then
    raise exception 'Credits must be between -3650 and 3650, and not zero.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'User not found.' using errcode = '22023'; end if;
  return public.apply_credits(p_user, p_credits, case when p_credits > 0 then 'admin_grant' else 'admin_revoke' end,
    null, left(coalesce(p_note, ''), 500), (select auth.uid()));
end;
$$;
revoke all on function public.admin_grant_credits(uuid, integer, text) from public, anon;
grant execute on function public.admin_grant_credits(uuid, integer, text) to authenticated;

create or replace function public.admin_update_settings(p jsonb)
returns public.app_settings
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.app_settings;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  update public.app_settings set
    pro_price_usdt = coalesce((p ->> 'pro_price_usdt')::numeric, pro_price_usdt),
    credits_per_purchase = coalesce((p ->> 'credits_per_purchase')::integer, credits_per_purchase),
    hours_per_credit = coalesce((p ->> 'hours_per_credit')::integer, hours_per_credit),
    free_previews_per_month = coalesce((p ->> 'free_previews_per_month')::integer, free_previews_per_month),
    free_shows_levels = coalesce((p ->> 'free_shows_levels')::boolean, free_shows_levels),
    free_analysis = coalesce((p ->> 'free_analysis')::boolean, free_analysis),
    free_advanced_journal = coalesce((p ->> 'free_advanced_journal')::boolean, free_advanced_journal),
    updated_at = now()
  where id  -- Supabase refuses updates without a WHERE clause
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_update_settings(jsonb) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;

-- Switching a network on is refused by the table constraint unless it is
-- verified and has a token contract.
drop function if exists public.admin_list_claims(text);
drop function if exists public.admin_set_network(text, boolean, boolean, text, text);
create or replace function public.admin_set_network(p_id text, p_enabled boolean, p_verified boolean, p_token_contract text, p_token_decimals integer, p_explorer_tx_url text)
returns public.payment_networks
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.payment_networks;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  begin
    update public.payment_networks set
      verified = coalesce(p_verified, verified),
      token_contract = case when p_token_contract is null then token_contract else nullif(btrim(p_token_contract), '') end,
      token_decimals = coalesce(p_token_decimals, token_decimals),
      explorer_tx_url = case when p_explorer_tx_url is null then explorer_tx_url else nullif(btrim(p_explorer_tx_url), '') end,
      enabled = coalesce(p_enabled, enabled),
      updated_at = now()
    where id = p_id returning * into v_row;
  exception when check_violation then
    raise exception 'A network can only be switched on when it has an automatic check, is marked verified, and has a token contract and decimals.' using errcode = '22023';
  end;
  if v_row.id is null then raise exception 'Network not found.' using errcode = '22023'; end if;
  return v_row;
end;
$$;
revoke all on function public.admin_set_network(text, boolean, boolean, text, integer, text) from public, anon;
grant execute on function public.admin_set_network(text, boolean, boolean, text, integer, text) to authenticated;

create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'revenue_usdt', (select coalesce(sum(amount_usdt), 0) from public.payment_claims where status = 'approved'),
    'approved_payments', (select count(*) from public.payment_claims where status = 'approved'),
    'pending_claims', (select count(*) from public.payment_claims where status = 'pending'),
    'awaiting_payments', (select count(*) from public.payment_claims where status = 'awaiting' and expires_at > now()),
    'active_subscribers', (select count(*) from public.subscriptions where pro_until > now()),
    'users', (select count(*) from auth.users)
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

create or replace function public.admin_list_claims(p_status text default 'pending')
returns table (id uuid, email text, user_id uuid, network text, tx_hash text, amount_usdt numeric, credits integer,
  status text, admin_note text, created_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz,
  explorer_tx_url text, onchain jsonb, onchain_verified_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return query
    select c.id, u.email::text, c.user_id, c.network, c.tx_hash, c.amount_usdt, c.credits, c.status, c.admin_note,
           c.created_at, c.submitted_at, c.reviewed_at, n.explorer_tx_url, c.onchain, c.onchain_verified_at
    from public.payment_claims c
    join auth.users u on u.id = c.user_id
    join public.payment_networks n on n.id = c.network
    where (p_status = 'all' and c.status <> 'awaiting') or c.status = p_status
    order by coalesce(c.submitted_at, c.created_at) desc
    limit 200;
end;
$$;
revoke all on function public.admin_list_claims(text) from public, anon;
grant execute on function public.admin_list_claims(text) to authenticated;

create or replace function public.admin_list_users(p_search text default '')
returns table (user_id uuid, email text, created_at timestamptz, pro_until timestamptz, is_admin boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return query
    select u.id, u.email::text, u.created_at, s.pro_until, (a.user_id is not null)
    from auth.users u
    left join public.subscriptions s on s.user_id = u.id
    left join public.admins a on a.user_id = u.id
    where coalesce(p_search, '') = '' or u.email ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%'
    order by u.created_at desc
    limit 100;
end;
$$;
revoke all on function public.admin_list_users(text) from public, anon;
grant execute on function public.admin_list_users(text) to authenticated;
