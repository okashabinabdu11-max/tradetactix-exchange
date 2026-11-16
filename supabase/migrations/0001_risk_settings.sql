-- TradeTactix AI, Stage 2: personal risk limits.
-- Safe to run more than once.

create table if not exists public.risk_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  risk_percent numeric(5, 2) not null default 1
    check (risk_percent > 0 and risk_percent <= 100),
  min_reward_to_risk numeric(4, 2) not null default 3
    check (min_reward_to_risk >= 3 and min_reward_to_risk <= 20),
  max_trades_per_day integer not null default 3
    check (max_trades_per_day between 1 and 50),
  max_daily_loss_percent numeric(5, 2) not null default 3
    check (max_daily_loss_percent > 0 and max_daily_loss_percent <= 100),
  updated_at timestamptz not null default now()
);

-- Row-level security: each signed-in user can only see and change their own row.
alter table public.risk_settings enable row level security;

drop policy if exists "risk_settings_select_own" on public.risk_settings;
create policy "risk_settings_select_own" on public.risk_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "risk_settings_insert_own" on public.risk_settings;
create policy "risk_settings_insert_own" on public.risk_settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "risk_settings_update_own" on public.risk_settings;
create policy "risk_settings_update_own" on public.risk_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Signed-in users may read and write through the API; visitors may not.
revoke all on public.risk_settings from anon;
grant select, insert, update on public.risk_settings to authenticated;

-- Keep updated_at current.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists risk_settings_touch on public.risk_settings;
create trigger risk_settings_touch
  before update on public.risk_settings
  for each row execute function public.touch_updated_at();
