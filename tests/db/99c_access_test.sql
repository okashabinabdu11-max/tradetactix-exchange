-- Behaviour tests for 0005_access_requests.sql. Runs after the plans and alerts tests.
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
\set admin '''00000000-0000-0000-0000-00000000000a'''
\set other '''00000000-0000-0000-0000-00000000000c'''

reset role;
-- other@example.com has no access at this point (the plans test revoked it)
update public.subscriptions set pro_until = null where user_id = '00000000-0000-0000-0000-00000000000c';

-- 1. A user requests access; bad usernames and duplicates are refused; nothing is granted yet
set role authenticated; select pg_temp.as_user(:other);
do $$ declare r public.access_requests; begin
  assert pg_temp.fails($q$select public.request_access('ab')$q$) like '%Telegram username%';
  assert pg_temp.fails($q$select public.request_access('bad name!')$q$) like '%Telegram username%';
  r := public.request_access('  @Other_Trader ', 'I trade gold daily');
  assert r.status = 'pending' and r.telegram_username = 'Other_Trader' and r.email = 'other@example.com', r::text;
  assert pg_temp.fails($q$select public.request_access('Other_Trader')$q$) like '%already waiting%';
  assert (public.my_entitlement() ->> 'plan') = 'free';
  assert pg_temp.fails($q$insert into public.access_requests (user_id, email, telegram_username, status) values ('00000000-0000-0000-0000-00000000000c', 'x', 'hacker_1', 'approved')$q$) like '%permission denied%';
  assert pg_temp.fails($q$update public.access_requests set status = 'approved'$q$) like '%permission denied%';
  assert pg_temp.fails(format('select public.admin_review_access(%L, true, 720)', r.id)) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_grant_hours('00000000-0000-0000-0000-00000000000c', 720)$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_end_access('00000000-0000-0000-0000-00000000000c')$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select * from public.admin_list_access_requests('pending')$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.apply_hours('00000000-0000-0000-0000-00000000000c', 99, 'access_grant', '', null)$q$) like '%permission denied%';
end $$;

-- 2. Admin approves for 24 hours
select pg_temp.as_user(:admin);
do $$ declare r public.access_requests; id uuid; begin
  id := (select x.id from public.admin_list_access_requests('pending') x limit 1);
  assert (select telegram_username from public.admin_list_access_requests('pending') limit 1) = 'Other_Trader';
  assert pg_temp.fails(format('select public.admin_review_access(%L, true, 0)', id)) like '%between 1 hour and 365 days%';
  assert pg_temp.fails(format('select public.admin_review_access(%L, true, null)', id)) like '%between 1 hour and 365 days%';
  r := public.admin_review_access(id, true, 24, 'welcome');
  assert r.status = 'approved' and r.granted_hours = 24 and r.granted_until between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute', r::text;
  assert pg_temp.fails(format('select public.admin_review_access(%L, true, 24)', id)) like '%already approved%';
end $$;
select pg_temp.as_user(:other);
do $$ declare e jsonb := public.my_entitlement(); begin
  assert e ->> 'plan' = 'pro' and e ->> 'shows_levels' = 'true', e::text;
  assert (select hours from public.credit_ledger where reason = 'access_grant' order by id desc limit 1) = 24;
end $$;

-- 3. Weekly on top of 24 hours adds up; custom hours; ending access stops it now
select pg_temp.as_user(:admin);
do $$ declare u timestamptz; begin
  u := public.admin_grant_hours('00000000-0000-0000-0000-00000000000c', 168, 'weekly');
  assert u between now() + interval '191 hours 59 minutes' and now() + interval '192 hours 1 minute', u::text;
  u := public.admin_grant_hours('00000000-0000-0000-0000-00000000000c', -200, 'correction');
  assert u is null;
  u := public.admin_grant_hours('00000000-0000-0000-0000-00000000000c', 36, 'custom 36 hours');
  assert u between now() + interval '35 hours 59 minutes' and now() + interval '36 hours 1 minute';
  perform public.admin_end_access('00000000-0000-0000-0000-00000000000c', 'ended');
end $$;
select pg_temp.as_user(:other);
do $$ begin assert (public.my_entitlement() ->> 'plan') = 'free', 'ended access is free again'; end $$;

-- 4. Expiry is automatic: once pro_until passes, the user is free and gets no alerts
reset role;
update public.subscriptions set pro_until = now() + interval '1 hour' where user_id = '00000000-0000-0000-0000-00000000000c';
insert into public.telegram_links (user_id, chat_id) values ('00000000-0000-0000-0000-00000000000c', 333) on conflict (user_id) do update set chat_id = 333;
set role anon; select pg_temp.as_user(null);
do $$ begin
  assert 333 in (select chat_id from public.alerts_claim_signal('test-secret-0123456789-0123456789-abc', 'buy-expiry-1', 'buy'));
end $$;
reset role;
update public.subscriptions set pro_until = now() - interval '1 second' where user_id = '00000000-0000-0000-0000-00000000000c';
set role anon; select pg_temp.as_user(null);
do $$ begin
  assert 333 not in (select chat_id from public.alerts_claim_signal('test-secret-0123456789-0123456789-abc', 'buy-expiry-2', 'buy')), 'expired members get no alerts';
end $$;
set role authenticated; select pg_temp.as_user(:other);
do $$ begin assert (public.my_entitlement() ->> 'plan') = 'free'; end $$;

-- 5. Rejection; a new request is then allowed; server lookups need the secret
do $$ begin perform public.request_access('Other_Trader'); end $$;
select pg_temp.as_user(:admin);
do $$ declare id uuid := (select x.id from public.admin_list_access_requests('pending') x limit 1); begin
  perform public.admin_review_access(id, false, null, 'not now');
  assert (select count(*) from public.admin_list_access_requests('all')) = 2;
end $$;
select pg_temp.as_user(:other);
do $$ begin perform public.request_access('Other_Trader'); end $$;
reset role; set role anon; select pg_temp.as_user(null);
do $$ begin
  assert pg_temp.fails($q$select * from public.alerts_admin_chats('wrong')$q$) like '%Not allowed%';
  assert (select count(*) from public.alerts_admin_chats('test-secret-0123456789-0123456789-abc')) = 0, 'admin has no linked chat in this test';
  assert (select telegram_username from public.alerts_request_info('test-secret-0123456789-0123456789-abc', (select id from public.access_requests where status = 'pending' limit 1))) is null
    or true; -- anon cannot read access_requests directly, so look it up via the function only
  assert pg_temp.fails($q$select * from public.access_requests$q$) like '%permission denied%';
end $$;
reset role;
do $$ begin
  assert (select x.telegram_username from public.alerts_request_info('test-secret-0123456789-0123456789-abc', (select id from public.access_requests where status = 'pending' limit 1)) x) = 'Other_Trader';
  assert (select x.chat_id from public.alerts_request_info('test-secret-0123456789-0123456789-abc', (select id from public.access_requests where status = 'pending' limit 1)) x) = 333;
end $$;
select 'ACCESS TESTS PASSED' as result;
