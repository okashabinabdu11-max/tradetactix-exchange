-- TradeTactix AI: lets the website show the signal that is running now
-- (pips running, Put BE) or how the last one ended (TP Done, SL hit, breakeven).
-- Safe to run more than once. Server-only: the website asks through /api/signal,
-- which shows it only to approved members.

create or replace function public.alerts_latest_trade(p_secret text)
returns setof public.signal_trades
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select * from public.signal_trades where status <> 'expired' order by opened_at desc limit 1;
end;
$$;
revoke all on function public.alerts_latest_trade(text) from public, anon, authenticated;
grant execute on function public.alerts_latest_trade(text) to anon;
