-- TradeTactix AI: trade journal.
-- Safe to run more than once.

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null default 'XAUUSD',
  direction text not null check (direction in ('buy', 'sell')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  entry_price numeric(12, 3) not null check (entry_price > 0),
  stop_loss numeric(12, 3) not null check (stop_loss > 0),
  take_profit numeric(12, 3) check (take_profit > 0),
  exit_price numeric(12, 3) check (exit_price > 0),
  lots numeric(8, 2) not null check (lots > 0),
  pnl numeric(14, 2),
  level_4h boolean not null default false,
  liquidity_1h boolean not null default false,
  retest_15m boolean not null default false,
  confirm_5m boolean not null default false,
  notes text not null default '',
  source text not null default 'manual' check (source in ('manual', 'mt5')),
  mt5_ticket text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trades_closed_together check ((exit_price is null) = (closed_at is null)),
  constraint trades_closed_after_open check (closed_at is null or closed_at >= opened_at),
  constraint trades_pnl_needs_close check (pnl is null or closed_at is not null),
  constraint trades_ticket_unique unique (user_id, mt5_ticket)
);

create index if not exists trades_user_opened_idx on public.trades (user_id, opened_at desc);

-- Row-level security: each signed-in user can only see and change their own trades.
alter table public.trades enable row level security;

drop policy if exists "trades_select_own" on public.trades;
create policy "trades_select_own" on public.trades
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own" on public.trades
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "trades_update_own" on public.trades;
create policy "trades_update_own" on public.trades
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "trades_delete_own" on public.trades;
create policy "trades_delete_own" on public.trades
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.trades from anon;
grant select, insert, update, delete on public.trades to authenticated;

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

drop trigger if exists trades_touch on public.trades;
create trigger trades_touch
  before update on public.trades
  for each row execute function public.touch_updated_at();
