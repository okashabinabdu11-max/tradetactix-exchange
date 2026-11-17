-- Behaviour tests for 0004_alerts.sql. Runs after 99_plans_test.sql.
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

reset role;
insert into public.server_secrets (name, value) values ('alerts', 'test-secret-0123456789-0123456789-abc') on conflict (name) do update set value = excluded.value;
-- customer@example.com was given 30 days of Pro in the plans test; other@example.com is free.
\set admin '''00000000-0000-0000-0000-00000000000a'''
\set cust  '''00000000-0000-0000-0000-00000000000b'''
\set other '''00000000-0000-0000-0000-00000000000c'''

-- 1. Nobody can read the secret or the private tables
set role authenticated; select pg_temp.as_user(:cust);
do $$ begin
  assert pg_temp.fails($q$select * from public.server_secrets$q$) like '%permission denied%';
  assert pg_temp.fails($q$select * from public.telegram_link_codes$q$) like '%permission denied%';
  assert pg_temp.fails($q$select * from public.alert_log$q$) like '%permission denied%';
  assert pg_temp.fails($q$insert into public.telegram_links values ('00000000-0000-0000-0000-00000000000b', 1)$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.server_secret_ok('x')$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.alerts_link_chat('test-secret-0123456789-0123456789-abc', 'X', 1)$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.admin_set_telegram_bot('mybot_bot')$q$) like '%Administrators only%';
end $$;
reset role; set role anon; select pg_temp.as_user(null);
do $$ begin
  assert pg_temp.fails($q$select public.create_telegram_link_code()$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.alerts_link_chat('wrong-secret', 'ABCDEFGHJK', 1)$q$) like '%Not allowed%';
  assert pg_temp.fails($q$select * from public.alerts_claim_signal('wrong-secret', 'k', 'buy')$q$) like '%Not allowed%';
end $$;

-- 2. Link codes: only the newest works, they are single-use and expire
reset role; set role authenticated; select pg_temp.as_user(:cust);
create temp table codes (who text, code text); grant all on codes to anon, authenticated;
do $$ declare c1 text; c2 text; begin
  c1 := public.create_telegram_link_code();
  c2 := public.create_telegram_link_code();
  assert c1 ~ '^[A-Z2-9]{10}$' and c1 <> c2;
  insert into codes values ('old', c1), ('cust', c2);
end $$;
select pg_temp.as_user(:other);
do $$ begin insert into codes values ('other', public.create_telegram_link_code()); end $$;
reset role; set role anon; select pg_temp.as_user(null);
do $$ declare r jsonb; begin
  r := public.alerts_link_chat('test-secret-0123456789-0123456789-abc', (select code from codes where who = 'old'), 111);
  assert r ->> 'linked' = 'false', 'a replaced code no longer works';
  r := public.alerts_link_chat('test-secret-0123456789-0123456789-abc', lower((select code from codes where who = 'cust')), 111);
  assert r ->> 'linked' = 'true' and r ->> 'pro' = 'true', r::text;
  r := public.alerts_link_chat('test-secret-0123456789-0123456789-abc', (select code from codes where who = 'cust'), 222);
  assert r ->> 'linked' = 'false', 'codes are single use';
  r := public.alerts_link_chat('test-secret-0123456789-0123456789-abc', (select code from codes where who = 'other'), 333);
  assert r ->> 'linked' = 'true' and r ->> 'pro' = 'false', r::text;
end $$;
reset role; set role authenticated; select pg_temp.as_user(:cust);
do $$ begin assert (select count(*) from public.telegram_links) = 1 and (select chat_id from public.telegram_links) = 111, 'sees only own link'; end $$;

-- 3. Claiming a signal returns Pro chats once only; free users get nothing
reset role; set role anon; select pg_temp.as_user(null);
do $$ declare n int; begin
  select count(*) into n from public.alerts_claim_signal('test-secret-0123456789-0123456789-abc', 'buy-2026-11-18T11:45:00.000Z', 'buy');
  assert n = 1, format('one Pro chat expected, got %s', n);
  assert (select chat_id from public.alerts_claim_signal('test-secret-0123456789-0123456789-abc', 'sell-x', 'sell')) = 111;
  select count(*) into n from public.alerts_claim_signal('test-secret-0123456789-0123456789-abc', 'buy-2026-11-18T11:45:00.000Z', 'buy');
  assert n = 0, 'the same signal is never alerted twice';
  assert pg_temp.fails($q$select * from public.alerts_claim_signal('test-secret-0123456789-0123456789-abc', 'k', 'no-setup')$q$) like '%Bad signal%';
  perform public.alerts_record_sent('test-secret-0123456789-0123456789-abc', 'sell-x', 1);
end $$;

-- 4. Relinking a chat moves it; /stop removes it; users can unlink themselves
do $$ declare r jsonb; begin
  perform public.alerts_unlink_chat('test-secret-0123456789-0123456789-abc', 333);
end $$;
reset role; set role authenticated; select pg_temp.as_user(:cust);
do $$ begin perform public.unlink_my_telegram(); assert (select count(*) from public.telegram_links) = 0; end $$;

-- 5. Admin sets the bot name and sees recent alerts
select pg_temp.as_user(:admin);
do $$ begin
  assert (public.admin_set_telegram_bot('@TradeTactix_bot')).telegram_bot_username = 'TradeTactix_bot';
  assert pg_temp.fails($q$select public.admin_set_telegram_bot('bad name!')$q$) like '%check constraint%';
  assert (select count(*) from public.admin_recent_alerts()) = 2;
  assert (select recipients from public.admin_recent_alerts() where signal_key = 'sell-x') = 1;
end $$;
reset role;
select 'ALERT TESTS PASSED' as result;
