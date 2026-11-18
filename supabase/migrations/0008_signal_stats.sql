-- TradeTactix AI: public win rate of the signals the bot actually sent and followed.
-- Only totals leave the database (no entries, stops or targets), so anyone may read them.
-- Win rate = TP / (TP + SL). Breakeven closes are shown separately. Expired signals are not counted.
-- Safe to run more than once.

create or replace function public.signal_stats()
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
    on t.status in ('tp', 'sl', 'be') and t.closed_at >= now() - p.span
  group by p.period, p.ord
  order by p.ord;
$$;
revoke all on function public.signal_stats() from public;
grant execute on function public.signal_stats() to anon, authenticated;
