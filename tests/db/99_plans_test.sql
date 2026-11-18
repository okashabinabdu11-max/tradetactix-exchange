-- Behaviour tests for 0003_plans_payments.sql. Any failed assert aborts the run.
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

\set admin '''00000000-0000-0000-0000-00000000000a'''
\set cust  '''00000000-0000-0000-0000-00000000000b'''
\set other '''00000000-0000-0000-0000-00000000000c'''
\set h1 '''0x1111111111111111111111111111111111111111111111111111111111111111'''
\set h1upper '''0X1111111111111111111111111111111111111111111111111111111111111111'''
\set h2 '''0x2222222222222222222222222222222222222222222222222222222222222222'''

-- 0005 switches free previews off; these tests cover the preview mechanism itself.
update public.app_settings set free_previews_per_month = 10 where id;
set role authenticated;

-- 1. Anonymous and free entitlements
select pg_temp.as_user(null);
do $$ begin assert (public.my_entitlement() ->> 'signed_in') = 'false'; end $$;
select pg_temp.as_user(:cust);
do $$ declare e jsonb := public.my_entitlement(); begin
  assert e ->> 'plan' = 'free' and (e ->> 'credits')::int = 0 and e ->> 'shows_levels' = 'false' and (e ->> 'previews_limit')::int = 10, e::text;
end $$;

-- 2. The owner is admin with unlimited Pro
select pg_temp.as_user(:admin);
do $$ declare e jsonb := public.my_entitlement(); begin
  assert e ->> 'plan' = 'pro' and e ->> 'is_admin' = 'true' and e ->> 'unlimited' = 'true', e::text;
end $$;

-- 3. Customers cannot write tables or call admin functions
select pg_temp.as_user(:cust);
do $$ begin
  assert pg_temp.fails($q$insert into public.subscriptions (user_id, pro_until) values ('00000000-0000-0000-0000-00000000000b', now() + interval '1 year')$q$) like '%permission denied%';
  assert pg_temp.fails($q$update public.app_settings set pro_price_usdt = 0.01$q$) like '%permission denied%';
  assert pg_temp.fails($q$update public.payment_claims set status = 'approved'$q$) like '%permission denied%';
  assert pg_temp.fails($q$insert into public.admins values ('00000000-0000-0000-0000-00000000000b')$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.apply_credits('00000000-0000-0000-0000-00000000000b', 999, 'admin_grant', null, '', null)$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.admin_grant_credits('00000000-0000-0000-0000-00000000000b', 30)$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_update_settings('{"pro_price_usdt": 1}')$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_overview()$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select * from public.admin_list_users('')$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_set_network('bep20', true, true, '0xabc', 18, null)$q$) like '%Administrators only%';
  assert pg_temp.fails($q$select public.admin_record_verification(gen_random_uuid(), '{"ok": true}')$q$) like '%Administrators only%';
  assert (select count(*) from public.payment_networks) = 0, 'disabled networks are hidden from customers';
end $$;

-- 4. Payments are refused while the network is off
do $$ begin
  assert pg_temp.fails($q$select public.start_payment('bep20')$q$) like '%not open%';
end $$;

-- 5. A network cannot be enabled before it is verified with a token contract and decimals,
--    and a network without an automatic check can never be enabled
select pg_temp.as_user(:admin);
do $$ begin
  assert pg_temp.fails($q$select public.admin_set_network('bep20', true, null, null, null, null)$q$) like '%only be switched on%';
  assert pg_temp.fails($q$select public.admin_set_network('bep20', true, true, null, null, null)$q$) like '%only be switched on%';
  assert pg_temp.fails($q$select public.admin_set_network('bep20', true, true, '0xTOKEN', null, null)$q$) like '%only be switched on%';
  assert pg_temp.fails($q$select public.admin_set_network('aptos', true, true, '0xTOKEN', 6, null)$q$) like '%only be switched on%';
  perform public.admin_set_network('bep20', true, true, '0xTOKEN', 18, null);
  assert (select enabled and verified and token_contract = '0xTOKEN' and token_decimals = 18 and explorer_tx_url = 'https://bscscan.com/tx/' from public.payment_networks where id = 'bep20');
  assert (select receiving_address from public.payment_networks where id = 'bep20') = '0x3030c068eca3e9d104ebb005564fa7a50231f9b9';
  assert (select receiving_address from public.payment_networks where id = 'trc20') = 'TBPuZUcRgVSjqZ1vkvRqsKSAKs24aLgNWF';
  assert (select receiving_address from public.payment_networks where id = 'plasma') = '0x3030c068eca3e9d104ebb005564fa7a50231f9b9';
  assert (select receiving_address from public.payment_networks where id = 'aptos') = '0xe3f9f6deddf7bcfac6d7bb62a584cf8a024b94239d6ce07105f02a63287e10a0';
end $$;

-- 6. Customer starts a payment, gets a unique exact amount, then submits the hash
select pg_temp.as_user(:cust);
do $$ declare c public.payment_claims; c2 public.payment_claims; begin
  assert (select count(*) from public.payment_networks) = 1, 'only the enabled network is visible';
  assert pg_temp.fails($q$select public.start_payment('trc20')$q$) like '%not open%';
  c := public.start_payment('bep20');
  assert c.status = 'awaiting' and c.amount_usdt > 10 and c.amount_usdt < 11 and c.credits = 30 and c.receiving_address = '0x3030c068eca3e9d104ebb005564fa7a50231f9b9', c::text;
  c2 := public.start_payment('bep20');
  assert c2.id = c.id, 'reopening returns the same open payment';
  assert pg_temp.fails(format('select public.submit_payment_claim(%L, %L)', c.id, 'not-a-hash')) like '%does not look like%';
  c := public.submit_payment_claim(c.id, '  0x1111111111111111111111111111111111111111111111111111111111111111 ');
  assert c.status = 'pending' and c.tx_hash = '0x1111111111111111111111111111111111111111111111111111111111111111' and c.submitted_at is not null;
  assert pg_temp.fails(format('select public.submit_payment_claim(%L, %L)', c.id, '0x2222222222222222222222222222222222222222222222222222222222222222')) like '%no longer open%';
  assert (public.my_entitlement() ->> 'plan') = 'free', 'a claim alone gives nothing';
  assert pg_temp.fails(format('select public.admin_review_claim(%L, true)', c.id)) like '%Administrators only%';
end $$;
-- another user cannot claim the same transaction, even with different letter case, or touch others' payments
select pg_temp.as_user(:other);
do $$ declare c public.payment_claims; begin
  c := public.start_payment('bep20');
  assert pg_temp.fails(format('select public.submit_payment_claim(%L, %L)', c.id, '0x1111111111111111111111111111111111111111111111111111111111111111')) like '%already been claimed%';
  assert (select count(*) from public.payment_claims) = 1, 'sees only own payments';
end $$;

-- 7. Approval needs a passing on-chain check, then 30 credits = 30 days of Pro, once only
select pg_temp.as_user(:admin);
do $$ declare c public.payment_claims; id uuid; begin
  id := (select x.id from public.payment_claims x where x.status = 'pending');
  assert (select count(*) from public.admin_list_claims('pending')) = 1;
  assert (select count(*) from public.admin_list_claims('awaiting')) = 1;
  assert pg_temp.fails(format('select public.admin_review_claim(%L, true)', id)) like '%on-chain check passes%';
  assert pg_temp.fails(format($q$select public.admin_record_verification(%L, '{"ok": true, "network": "bep20", "txHash": "0xdead"}')$q$, id)) like '%different transaction%';
  c := public.admin_record_verification(id, '{"ok": false, "network": "bep20", "txHash": "0x1111111111111111111111111111111111111111111111111111111111111111", "problems": ["2 of 15 confirmations"]}');
  assert c.onchain_verified_at is null and c.onchain ->> 'ok' = 'false';
  assert pg_temp.fails(format('select public.admin_review_claim(%L, true)', id)) like '%on-chain check passes%';
  c := public.admin_record_verification(id, '{"ok": true, "network": "bep20", "txHash": "0x1111111111111111111111111111111111111111111111111111111111111111"}');
  assert c.onchain_verified_at is not null;
  c := public.admin_review_claim(id, true, 'checked');
  assert c.status = 'approved';
  assert pg_temp.fails(format('select public.admin_review_claim(%L, true)', id)) like '%not waiting for review%';
  assert pg_temp.fails(format($q$select public.admin_record_verification(%L, '{"ok": true}')$q$, id)) like '%not waiting for review%';
end $$;
select pg_temp.as_user(:cust);
do $$ declare e jsonb := public.my_entitlement(); begin
  assert e ->> 'plan' = 'pro' and (e ->> 'credits')::int = 30 and e ->> 'shows_levels' = 'true', e::text;
  assert (e ->> 'pro_until')::timestamptz between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour';
  assert (select count(*) from public.credit_ledger) = 1;
end $$;

-- 8. Rejected claims give nothing and free the hash; open payments are capped; old ones expire
select pg_temp.as_user(:admin);
do $$ begin perform public.admin_set_network('trc20', true, true, 'TTOKEN', 6, null); perform public.admin_set_network('plasma', true, true, '0xTOKEN', 6, null); end $$;
select pg_temp.as_user(:other);
do $$ declare c public.payment_claims; begin
  c := (select x from public.payment_claims x where x.status = 'awaiting' limit 1);
  perform public.submit_payment_claim(c.id, '0x2222222222222222222222222222222222222222222222222222222222222222');
  c := public.start_payment('trc20');
  perform public.submit_payment_claim(c.id, 'ABCDEF0000000000000000000000000000000000000000000000000000000000');
  c := public.start_payment('trc20');
  assert pg_temp.fails(format('select public.submit_payment_claim(%L, %L)', c.id, 'abcdef0000000000000000000000000000000000000000000000000000000000')) like '%already been claimed%';
  assert (select count(*) from public.payment_claims where status in ('awaiting', 'pending')) = 3;
  assert pg_temp.fails($q$select public.start_payment('plasma')$q$) like '%3 open payments%';
end $$;
select pg_temp.as_user(:admin);
do $$ begin
  perform public.admin_review_claim((select id from public.payment_claims where tx_hash like '0x2222%'), false, 'not found on chain');
end $$;
select pg_temp.as_user(:other);
do $$ declare c public.payment_claims; begin
  assert (public.my_entitlement() ->> 'plan') = 'free';
  c := public.start_payment('bep20');
  perform public.submit_payment_claim(c.id, '0x2222222222222222222222222222222222222222222222222222222222222222');
end $$;
reset role;
update public.payment_claims set expires_at = now() - interval '1 minute' where status = 'awaiting';
set role authenticated;
select pg_temp.as_user(:other);
do $$ declare c public.payment_claims; begin
  assert pg_temp.fails(format('select public.submit_payment_claim(%L, %L)', (select x.id from public.payment_claims x where x.status = 'awaiting' limit 1), 'aa00000000000000000000000000000000000000000000000000000000000000')) like '%no longer open%';
  c := public.start_payment('trc20');
  assert c.status = 'awaiting' and (select count(*) from public.payment_claims where status = 'expired') = 1;
end $$;

-- 9. Free previews: 10 different signals a month, repeats are free, Pro is not counted against
do $$ declare r jsonb; begin
  for i in 1..10 loop r := public.use_signal_preview('sig-' || i); assert r ->> 'allowed' = 'true'; end loop;
  r := public.use_signal_preview('sig-3'); assert r ->> 'allowed' = 'true' and (r ->> 'used')::int = 10, 'repeat view is free';
  r := public.use_signal_preview('sig-11'); assert r ->> 'allowed' = 'false' and (r ->> 'used')::int = 10, r::text;
  assert (public.my_entitlement() ->> 'previews_used')::int = 10;
  assert pg_temp.fails($q$insert into public.signal_previews values ('00000000-0000-0000-0000-00000000000c', '2020-01-01', 'x')$q$) like '%permission denied%';
  assert pg_temp.fails($q$delete from public.signal_previews$q$) like '%permission denied%';
end $$;

-- 10. Admin: grants, revokes, settings, overview, users
select pg_temp.as_user(:admin);
do $$ declare o jsonb; u timestamptz; begin
  u := public.admin_grant_credits('00000000-0000-0000-0000-00000000000c', 7, 'gift');
  assert u between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour';
  u := public.admin_grant_credits('00000000-0000-0000-0000-00000000000c', -30, 'refund');
  assert u is null, 'revoking more than remains ends the subscription';
  assert pg_temp.fails($q$select public.admin_grant_credits('00000000-0000-0000-0000-00000000000c', 0)$q$) like '%not zero%';
  perform public.admin_update_settings('{"pro_price_usdt": 12.5, "credits_per_purchase": 31, "free_previews_per_month": 5}');
  assert (select pro_price_usdt = 12.5 and credits_per_purchase = 31 and hours_per_credit = 24 and free_previews_per_month = 5 from public.app_settings);
  assert pg_temp.fails($q$select public.admin_update_settings('{"pro_price_usdt": -1}')$q$) like '%check constraint%';
  o := public.admin_overview();
  assert (o ->> 'revenue_usdt')::numeric between 10.01 and 10.99 and (o ->> 'approved_payments')::int = 1 and (o ->> 'pending_claims')::int = 2
    and (o ->> 'awaiting_payments')::int = 1 and (o ->> 'active_subscribers')::int = 1 and (o ->> 'users')::int = 3, o::text;
  assert (select count(*) from public.admin_list_users('')) = 3 and (select count(*) from public.admin_list_users('customer')) = 1;
  assert (select count(*) from public.payment_networks) = 4, 'admin sees every network';
  perform public.admin_set_network('bep20', false, null, null, null, null);
end $$;
select pg_temp.as_user(:cust);
do $$ declare c public.payment_claims; begin
  assert pg_temp.fails($q$select public.start_payment('bep20')$q$) like '%not open%';
  c := public.start_payment('trc20');
  assert c.amount_usdt > 12.5 and c.amount_usdt < 13.5 and c.credits = 31, 'new price applies to new payments only';
end $$;

-- 11. Signed-out visitors can read prices but nothing else
reset role; set role anon; select pg_temp.as_user(null);
do $$ begin
  assert (select pro_price_usdt from public.app_settings) = 12.5;
  assert pg_temp.fails($q$select * from public.payment_networks$q$) like '%permission denied%';
  assert pg_temp.fails($q$select * from public.payment_claims$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.start_payment('bep20')$q$) like '%permission denied%';
  assert pg_temp.fails($q$select public.use_signal_preview('x')$q$) like '%permission denied%';
end $$;
reset role;
select 'ALL DATABASE TESTS PASSED' as result;
