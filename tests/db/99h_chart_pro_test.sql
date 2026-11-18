-- Behaviour tests for 0011_chart_pro.sql (Chart Pro paid in birr).
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
\set admin '''00000000-0000-0000-0000-00000000000a'''
\set other '''00000000-0000-0000-0000-00000000000c'''
reset role;
delete from public.etb_payments; delete from public.chart_subscriptions; delete from public.chart_plans;
update public.etb_methods set enabled = false, account_name = '', account_number = '';

-- 1. Members cannot change plans, methods or payments; nothing is on offer yet
set role authenticated; select pg_temp.as_user(:other);
do $$ begin
  assert (public.my_chart_access() ->> 'chart_pro') = 'false';
  assert (select count(*) from public.chart_plans) = 0;
  assert (select count(*) from public.etb_methods) = 0, 'disabled methods hidden from members';
  assert pg_temp.fails($q$select public.admin_save_chart_plan(null, 'Month', 30, 100, true)$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_set_etb_method('cbe', 'x', '1', true)$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select * from public.admin_list_etb_payments()$q$) like '%Administrators only%';
  assert pg_temp.fails($q$insert into public.chart_subscriptions (user_id, chart_until) values ('00000000-0000-0000-0000-00000000000c', now() + interval '9 days')$q$) like '%permission denied%';
  assert pg_temp.fails($q$insert into public.chart_plans (name, days, price_etb) values ('free', 9, 1)$q$) like '%permission denied%';
end $$;

-- 2. Admin always has Chart Pro, makes plans, cannot switch on a method without details
select pg_temp.as_user(:admin);
do $$ declare p public.chart_plans; begin
  assert (public.my_chart_access() ->> 'chart_pro') = 'true';
  assert pg_temp.fails($q$select public.admin_save_chart_plan(null, ' ', 30, 100, true)$q$) like '%name%';
  assert pg_temp.fails($q$select public.admin_save_chart_plan(null, 'X', 0, 100, true)$q$) like '%Days%';
  assert pg_temp.fails($q$select public.admin_save_chart_plan(null, 'X', 30, 0, true)$q$) like '%price%';
  p := public.admin_save_chart_plan(null, 'Monthly', 30, 450.5, true, 1);
  assert p.price_etb = 450.50 and p.days = 30;
  p := public.admin_save_chart_plan(p.id, 'Monthly', 31, 400, true, 1);
  assert p.days = 31 and p.price_etb = 400;
  perform public.admin_save_chart_plan(null, 'Old', 7, 50, false, 2);
  assert pg_temp.fails($q$select public.admin_set_etb_method('telebirr', '', '', true)$q$) like '%etb_method_complete%';
  perform public.admin_set_etb_method('telebirr', 'Test Name', '0900000000', true);
end $$;

-- 3. Member sees only the enabled plan and method, pays, waits
select pg_temp.as_user(:other);
do $$ declare r public.etb_payments; pid uuid; oldp uuid; begin
  assert (select count(*) from public.chart_plans) = 1;
  assert (select count(*) from public.etb_methods) = 1;
  pid := (select id from public.chart_plans);
  reset role; oldp := (select id from public.chart_plans where name = 'Old'); set role authenticated;
  assert pg_temp.fails(format('select public.submit_etb_payment(%L, %L, %L)', oldp, 'telebirr', 'ABC12345')) like '%Choose a Chart Pro plan%';
  assert pg_temp.fails(format('select public.submit_etb_payment(%L, %L, %L)', pid, 'cbe', 'ABC12345')) like '%not open%';
  assert pg_temp.fails(format('select public.submit_etb_payment(%L, %L, %L)', pid, 'telebirr', 'ab')) like '%reference%';
  r := public.submit_etb_payment(pid, 'telebirr', ' abc12345 ');
  assert r.status = 'pending' and r.reference = 'ABC12345' and r.amount_etb = 400 and r.days = 31 and r.plan_name = 'Monthly', r::text;
  assert pg_temp.fails(format('select public.submit_etb_payment(%L, %L, %L)', pid, 'telebirr', 'ZZZ12345')) like '%already have a payment%';
  assert (public.my_chart_access() ->> 'chart_pro') = 'false';
end $$;

-- 4. Admin approves: 31 days added; a reused reference is refused
select pg_temp.as_user(:admin);
do $$ declare id uuid; r public.etb_payments; begin
  id := (select x.id from public.admin_list_etb_payments('pending') x limit 1);
  assert (select plan_name from public.admin_list_etb_payments('pending') limit 1) = 'Monthly';
  r := public.admin_review_etb_payment(id, true, 'ok');
  assert r.status = 'approved';
  assert pg_temp.fails(format('select public.admin_review_etb_payment(%L, true)', id)) like '%approved%';
end $$;
select pg_temp.as_user(:other);
do $$ declare pid uuid := (select id from public.chart_plans); begin
  assert (public.my_chart_access() ->> 'chart_pro') = 'true';
  assert ((public.my_chart_access() ->> 'chart_until')::timestamptz) between now() + interval '30 days 23 hours' and now() + interval '31 days 1 hour';
  assert pg_temp.fails(format('select public.submit_etb_payment(%L, %L, %L)', pid, 'telebirr', 'abc12345')) like '%already been used%';
end $$;
reset role;
\echo 99h chart pro ok
