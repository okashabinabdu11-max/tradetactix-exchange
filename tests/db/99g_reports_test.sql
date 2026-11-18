\set ON_ERROR_STOP on
begin;
insert into public.server_secrets(name, value) values ('alerts', repeat('k', 40)) on conflict (name) do update set value = excluded.value;
delete from public.signal_trades; delete from public.bot_posts; delete from public.telegram_links; delete from public.subscriptions;
-- admin (a) and two customers: b ends in 5 hours, c ends in 3 days
insert into public.subscriptions (user_id, pro_until) values
 ('00000000-0000-0000-0000-00000000000a', now() + interval '2 hours'),
 ('00000000-0000-0000-0000-00000000000b', now() + interval '5 hours'),
 ('00000000-0000-0000-0000-00000000000c', now() + interval '3 days');
insert into public.telegram_links (user_id, chat_id) values ('00000000-0000-0000-0000-00000000000b', 111), ('00000000-0000-0000-0000-00000000000a', 999);
insert into public.signal_trades (signal_key, direction, entry, stop, target, opened_at, status, result_pips, closed_at) values
 ('w1','buy',1,0,4,now()-interval '1 day','tp',300,now()-interval '1 day'),
 ('w2','buy',1,0,4,now()-interval '2 day','sl',-80,now()-interval '2 day'),
 ('old','buy',1,0,4,now()-interval '9 day','tp',500,now()-interval '9 day');
do $$
declare r record; n int; a boolean; b boolean;
begin
  a := public.alerts_claim_post(repeat('k',40), 'weekly', '2026-W47'); b := public.alerts_claim_post(repeat('k',40), 'weekly', '2026-W47');
  if not a or b then raise exception 'claim % %', a, b; end if;
  perform public.alerts_release_post(repeat('k',40), 'weekly', '2026-W47');
  if not public.alerts_claim_post(repeat('k',40), 'weekly', '2026-W47') then raise exception 'release did not free the post'; end if;
  select * into r from public.alerts_period_stats(repeat('k',40), now() - interval '7 days');
  if (r.wins, r.losses, r.breakeven, r.pips) is distinct from (1, 1, 0, 220::numeric) then raise exception 'stats %', r; end if;
  select count(*) into n from public.alerts_expiring(repeat('k',40)); if n <> 1 then raise exception 'expiring count %', n; end if;
  select * into r from public.alerts_expiring(repeat('k',40)); if r.chat_id <> 111 or r.email <> 'customer@example.com' then raise exception 'expiring row %', r; end if;
  select * into r from public.alerts_daily_numbers(repeat('k',40));
  if r.active_members <> 2 or r.telegram_members <> 2 then raise exception 'daily %', r; end if;
end $$;
delete from public.news_outlooks;
select public.alerts_news_save(repeat('k',40), 'cpi', 'CPI m/m', now() + interval '20 minutes', '0.3%', '0.2%', 'bearish', 'low', 'x', 'u', 'd', 'rules');
select public.alerts_news_save(repeat('k',40), 'nfp', 'NFP', now() + interval '3 hours', '1', '1', 'neutral', 'low', 'x', 'u', 'd', 'rules');
do $$ declare n int; t text; begin
  select title into t from public.alerts_news_near(repeat('k',40)); if t is distinct from 'CPI m/m' then raise exception 'near %', t; end if;
  select count(*) into n from public.alerts_news_near(repeat('k',40), now() + interval '2 hours'); if n <> 0 then raise exception 'far %', n; end if;
  select title into t from public.alerts_news_near(repeat('k',40), now() + interval '45 minutes'); if t is distinct from 'CPI m/m' then raise exception 'after %', t; end if;
end $$;
do $$ begin perform public.alerts_expiring('wrong'); raise exception 'secret not checked'; exception when insufficient_privilege then null; end $$;
rollback;
\echo ' REPORT TESTS PASSED'
