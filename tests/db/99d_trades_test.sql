\set ON_ERROR_STOP on
create or replace function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
set role authenticated;
do $$ begin
  assert pg_temp.fails($q$select * from public.signal_trades$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.alerts_open_trade('x','k','buy',1,1,1,now())$q$) like '%permission denied%';
end $$;
reset role; set role anon;
do $$ declare s text := 'test-secret-0123456789-0123456789-abc'; begin
  assert pg_temp.fails($q$select public.alerts_open_trade('wrong','k','buy',1,1,1,now())$q$) like '%Not allowed%';
  perform public.alerts_open_trade(s, 'buy-1', 'buy', 4008, 4000, 4032, now());
  perform public.alerts_open_trade(s, 'buy-1', 'buy', 1, 1, 1, now());
  assert (select count(*) from public.alerts_open_trades(s)) = 1;
  assert (select entry from public.alerts_open_trades(s)) = 4008, 'second open call changes nothing';
  assert public.alerts_trade_event(s, 'buy-1', 'be_move') = true;
  assert public.alerts_trade_event(s, 'buy-1', 'be_move') = false, 'BE notice only once';
  assert public.alerts_trade_event(s, 'buy-1', 'tp', 240) = true;
  assert public.alerts_trade_event(s, 'buy-1', 'sl', -80) = false, 'a closed trade cannot close again';
  assert (select count(*) from public.alerts_open_trades(s)) = 0;
  assert pg_temp.fails($q$select public.alerts_trade_event('test-secret-0123456789-0123456789-abc', 'buy-1', 'bogus')$q$) like '%Bad event%';
end $$;
reset role;
do $$ begin assert (select status = 'tp' and result_pips = 240 from public.signal_trades where signal_key = 'buy-1'); end $$;
select 'TRADE TESTS PASSED' as result;
