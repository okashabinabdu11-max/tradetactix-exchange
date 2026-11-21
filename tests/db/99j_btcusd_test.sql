-- Behaviour tests for 0013_btcusd.sql: results are kept per market.
\set ON_ERROR_STOP on
begin;
insert into public.server_secrets(name, value) values ('alerts', repeat('k', 40)) on conflict (name) do update set value = excluded.value;
delete from public.signal_trades;
do $$
declare s text := repeat('k', 40); r record; w record;
begin
  -- Gold calls without a market, exactly as before.
  perform public.alerts_open_trade(s, 'buy-1', 'buy', 4008, 4000, 4032, now() - interval '2 hours');
  perform public.alerts_open_trade(s, 'BTCUSD-sell-1', 'sell', 98250.125, 98700, 96500, now() - interval '1 hour', 'BTCUSD');
  assert (select symbol from public.signal_trades where signal_key = 'buy-1') = 'XAUUSD';
  assert (select symbol from public.signal_trades where signal_key = 'BTCUSD-sell-1') = 'BTCUSD';
  assert (select entry from public.signal_trades where signal_key = 'BTCUSD-sell-1') = 98250.125, 'bitcoin price kept exactly';
  assert (select count(*) from public.alerts_open_trades(s)) = 2, 'both markets are followed';
  assert (select symbol from public.alerts_open_trades(s) where signal_key = 'BTCUSD-sell-1') = 'BTCUSD';

  -- Latest trade is per market; no argument means gold.
  assert (select signal_key from public.alerts_latest_trade(s)) = 'buy-1';
  assert (select signal_key from public.alerts_latest_trade(s, 'BTCUSD')) = 'BTCUSD-sell-1';

  perform public.alerts_trade_event(s, 'buy-1', 'tp', 240);
  perform public.alerts_trade_event(s, 'BTCUSD-sell-1', 'tp', 1750);
  select * into r from public.alerts_period_stats(s, now() - interval '1 day');
  assert (r.wins, r.pips) = (1, 240::numeric), 'gold stats are gold only';
  select * into r from public.alerts_period_stats(s, now() - interval '1 day', 'BTCUSD');
  assert (r.wins, r.pips) = (1, 1750::numeric), 'bitcoin stats are bitcoin only';
  select * into w from public.signal_stats() where period = 'week';
  assert (w.wins, w.pips) = (1, 240::numeric);
  select * into w from public.signal_stats('BTCUSD') where period = 'week';
  assert (w.wins, w.pips) = (1, 1750::numeric);
end $$;
do $$ begin
  insert into public.signal_trades (signal_key, symbol, direction, entry, stop, target, opened_at) values ('x', 'EURUSD', 'buy', 1, 0, 2, now());
  raise exception 'unknown market accepted';
exception when check_violation then null; end $$;
set local role anon;
select count(*) from public.signal_stats('BTCUSD');
rollback;
\echo ' BTCUSD TESTS PASSED'
