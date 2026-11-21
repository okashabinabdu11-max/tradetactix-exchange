-- TradeTactix AI: signals for BTCUSD as well as XAUUSD.
-- Every followed signal now records its market, so results are counted per
-- market (gold in pips, bitcoin in dollars of price) and never mixed.
-- Existing signals are all gold. Safe to run more than once.

alter table public.signal_trades add column if not exists symbol text not null default 'XAUUSD';
do $$ begin
  alter table public.signal_trades add constraint signal_trades_symbol_check check (symbol in ('XAUUSD', 'BTCUSD'));
exception when duplicate_object then null; end $$;
create index if not exists signal_trades_symbol_idx on public.signal_trades (symbol, opened_at desc);

-- Bitcoin prices need more room than gold (for example 98250.125).
alter table public.signal_trades alter column entry type numeric(14, 3), alter column stop type numeric(14, 3), alter column target type numeric(14, 3);
alter table public.signal_trades alter column result_pips type numeric(12, 1);

-- The old versions are replaced by ones with a market (gold by default), so
-- calls without a market keep meaning gold.
drop function if exists public.alerts_open_trade(text, text, text, numeric, numeric, numeric, timestamptz);
drop function if exists public.alerts_latest_trade(text);
drop function if exists public.alerts_period_stats(text, timestamptz);
drop function if exists public.signal_stats();

create or replace function public.alerts_open_trade(p_secret text, p_key text, p_direction text, p_entry numeric, p_stop numeric, p_target numeric, p_opened_at timestamptz, p_symbol text default 'XAUUSD')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  insert into public.signal_trades (signal_key, symbol, direction, entry, stop, target, opened_at)
  values (p_key, coalesce(p_symbol, 'XAUUSD'), p_direction, p_entry, p_stop, p_target, p_opened_at)
  on conflict (signal_key) do nothing;
end;
$$;
revoke all on function public.alerts_open_trade(text, text, text, numeric, numeric, numeric, timestamptz, text) from public, anon, authenticated;
grant execute on function public.alerts_open_trade(text, text, text, numeric, numeric, numeric, timestamptz, text) to anon;

create or replace function public.alerts_latest_trade(p_secret text, p_symbol text default 'XAUUSD')
returns setof public.signal_trades
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select * from public.signal_trades
    where status <> 'expired' and symbol = coalesce(p_symbol, 'XAUUSD')
    order by opened_at desc limit 1;
end;
$$;
revoke all on function public.alerts_latest_trade(text, text) from public, anon, authenticated;
grant execute on function public.alerts_latest_trade(text, text) to anon;

create or replace function public.alerts_period_stats(p_secret text, p_since timestamptz, p_symbol text default 'XAUUSD')
returns table (wins integer, losses integer, breakeven integer, pips numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select (count(*) filter (where t.status = 'tp'))::integer, (count(*) filter (where t.status = 'sl'))::integer,
           (count(*) filter (where t.status = 'be'))::integer, coalesce(sum(t.result_pips), 0)::numeric
    from public.signal_trades t
    where t.status in ('tp', 'sl', 'be') and t.closed_at >= p_since and t.symbol = coalesce(p_symbol, 'XAUUSD');
end;
$$;
revoke all on function public.alerts_period_stats(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.alerts_period_stats(text, timestamptz, text) to anon;

-- Public win rate per market: totals only. Bitcoin "pips" are dollars of price.
create or replace function public.signal_stats(p_symbol text default 'XAUUSD')
returns table (period text, wins integer, losses integer, breakeven integer, pips numeric)
language sql stable security definer set search_path = ''
as $$
  select p.period,
         (count(t.signal_key) filter (where t.status = 'tp'))::integer,
         (count(t.signal_key) filter (where t.status = 'sl'))::integer,
         (count(t.signal_key) filter (where t.status = 'be'))::integer,
         coalesce(sum(t.result_pips), 0)::numeric
  from (values ('week', interval '7 days', 1), ('month', interval '30 days', 2)) as p(period, span, ord)
  left join public.signal_trades t
    on t.status in ('tp', 'sl', 'be') and t.closed_at >= now() - p.span and t.symbol = coalesce(p_symbol, 'XAUUSD')
  group by p.period, p.ord
  order by p.ord;
$$;
revoke all on function public.signal_stats(text) from public;
grant execute on function public.signal_stats(text) to anon, authenticated;

-- The admin results list is unchanged: bitcoin signal keys start with "BTCUSD-".

notify pgrst, 'reload schema';
