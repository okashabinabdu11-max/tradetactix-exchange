-- Behaviour tests for 0012_chart_drawings.sql
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
reset role; delete from public.chart_drawings;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into public.chart_drawings (user_id, symbol, drawings) values ('00000000-0000-0000-0000-00000000000c', 'XAU/USD', '[{"type":"hline"}]');
insert into public.chart_drawings (user_id, symbol, drawings) values ('00000000-0000-0000-0000-00000000000c', 'EUR/USD', '[]')
  on conflict (user_id, symbol) do update set drawings = excluded.drawings;
do $$ begin
  assert (select count(*) from public.chart_drawings) = 2;
  assert pg_temp.fails($q$insert into public.chart_drawings (user_id, symbol) values ('00000000-0000-0000-0000-00000000000a', 'GBP/USD')$q$) like '%row-level security%';
  assert pg_temp.fails($q$insert into public.chart_drawings (user_id, symbol, drawings) values ('00000000-0000-0000-0000-00000000000c', 'bad', '[]')$q$) like '%check%';
  assert pg_temp.fails($q$insert into public.chart_drawings (user_id, symbol, drawings) values ('00000000-0000-0000-0000-00000000000c', 'GBP/USD', '{}')$q$) like '%check%';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.chart_drawings) = 0, 'cannot see other members drawings';
  update public.chart_drawings set drawings = '[]'; delete from public.chart_drawings;
end $$;
reset role;
do $$ begin assert (select count(*) from public.chart_drawings) = 2, 'others could not change them'; end $$;
set role anon;
do $$ begin assert pg_temp.fails($q$select * from public.chart_drawings$q$) like '%permission denied%'; end $$;
reset role;
\echo 99i chart drawings ok
