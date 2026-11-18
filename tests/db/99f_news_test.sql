\set ON_ERROR_STOP on
begin;
insert into public.server_secrets(name, value) values ('alerts', repeat('k', 40)) on conflict (name) do update set value = excluded.value;
delete from public.news_outlooks;
select public.alerts_news_save(repeat('k',40), 'soon', 'CPI m/m', now() + interval '30 minutes', '0.3%', '0.2%', 'bearish', 'medium', 'Hot inflation expected.', 'up', 'down', 'ai');
select public.alerts_news_save(repeat('k',40), 'later', 'NFP', now() + interval '5 hours', '150K', '120K', 'neutral', 'low', 'No lean.', 'up', 'down', 'rules');
select public.alerts_news_save(repeat('k',40), 'soon', 'CPI m/m', now() + interval '30 minutes', '0.3%', '0.2%', 'bullish', 'high', 'changed?', 'up', 'down', 'ai'); -- ignored
do $$
declare n int; first boolean; second boolean; b text;
begin
  select count(*) into n from public.alerts_news_missing(repeat('k',40), array['soon','later','new1']); if n <> 1 then raise exception 'missing %', n; end if;
  select bias into b from public.news_outlooks where event_key = 'soon'; if b <> 'bearish' then raise exception 'overwritten'; end if;
  select count(*) into n from public.alerts_news_due(repeat('k',40)); if n <> 1 then raise exception 'due %', n; end if;
  first := public.alerts_news_claim(repeat('k',40), 'soon'); second := public.alerts_news_claim(repeat('k',40), 'soon');
  if not first or second then raise exception 'claim % %', first, second; end if;
  select count(*) into n from public.alerts_news_due(repeat('k',40)); if n <> 0 then raise exception 'due after claim %', n; end if;
  select count(*) into n from public.alerts_news_list(repeat('k',40)); if n <> 2 then raise exception 'list %', n; end if;
end $$;
do $$ begin perform public.alerts_news_due('wrong'); raise exception 'secret not checked'; exception when insufficient_privilege then null; end $$;
rollback;
\echo ' NEWS TESTS PASSED'
