-- signal_stats: counts only finished signals inside each window
\set ON_ERROR_STOP on
begin;
delete from public.signal_trades;
insert into public.signal_trades (signal_key, direction, entry, stop, target, opened_at, status, result_pips, closed_at) values
 ('a','buy',1,0,4,now()-interval '2 days','tp', 300, now()-interval '2 days'),
 ('b','buy',1,0,4,now()-interval '3 days','sl', -80, now()-interval '3 days'),
 ('c','buy',1,0,4,now()-interval '4 days','tp', 250, now()-interval '4 days'),
 ('d','buy',1,0,4,now()-interval '5 days','be', 0, now()-interval '5 days'),
 ('e','buy',1,0,4,now()-interval '20 days','sl', -90, now()-interval '20 days'),
 ('f','buy',1,0,4,now()-interval '40 days','tp', 999, now()-interval '40 days'),
 ('g','buy',1,0,4,now()-interval '1 day','expired', null, now()-interval '1 day'),
 ('h','buy',1,0,4,now()-interval '1 hour','open', null, null);
do $$
declare w record; m record;
begin
  select * into w from public.signal_stats() where period = 'week';
  select * into m from public.signal_stats() where period = 'month';
  if (w.wins, w.losses, w.breakeven, w.pips) is distinct from (2, 1, 1, 470::numeric) then raise exception 'week wrong: %', w; end if;
  if (m.wins, m.losses, m.breakeven, m.pips) is distinct from (2, 2, 1, 380::numeric) then raise exception 'month wrong: %', m; end if;
end $$;
delete from public.signal_trades;
do $$ declare w record; begin
  select * into w from public.signal_stats() where period = 'week';
  if (w.wins, w.losses, w.breakeven, w.pips) is distinct from (0, 0, 0, 0::numeric) then raise exception 'empty wrong: %', w; end if;
end $$;
set local role anon;
select count(*) from public.signal_stats();
rollback;
\echo ' STATS TESTS PASSED'
