-- TradeTactix AI: follow each sent signal until it ends, so members get
-- "Put BE", "TP Done", "SL hit" or "Closed at breakeven" on Telegram.
-- Safe to run more than once. Server-only: every function needs the secret.

create table if not exists public.signal_trades (
  signal_key text primary key,
  direction text not null check (direction in ('buy', 'sell')),
  entry numeric(12, 3) not null,
  stop numeric(12, 3) not null,
  target numeric(12, 3) not null,
  opened_at timestamptz not null,
  be_sent_at timestamptz,
  status text not null default 'open' check (status in ('open', 'tp', 'sl', 'be', 'expired')),
  result_pips numeric(10, 1),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists signal_trades_open_idx on public.signal_trades (status) where status = 'open';
alter table public.signal_trades enable row level security;
revoke all on public.signal_trades from anon, authenticated;

-- Start following a signal. Calling it again for the same signal does nothing.
create or replace function public.alerts_open_trade(p_secret text, p_key text, p_direction text, p_entry numeric, p_stop numeric, p_target numeric, p_opened_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  insert into public.signal_trades (signal_key, direction, entry, stop, target, opened_at)
  values (p_key, p_direction, p_entry, p_stop, p_target, p_opened_at)
  on conflict (signal_key) do nothing;
end;
$$;
revoke all on function public.alerts_open_trade(text, text, text, numeric, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.alerts_open_trade(text, text, text, numeric, numeric, numeric, timestamptz) to anon;

create or replace function public.alerts_open_trades(p_secret text)
returns setof public.signal_trades
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select * from public.signal_trades where status = 'open' order by opened_at;
end;
$$;
revoke all on function public.alerts_open_trades(text) from public, anon, authenticated;
grant execute on function public.alerts_open_trades(text) to anon;

-- Records an event once. Returns true only for the call that made the change,
-- so each message is sent a single time even if two runs overlap.
create or replace function public.alerts_trade_event(p_secret text, p_key text, p_event text, p_pips numeric default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_event = 'be_move' then
    update public.signal_trades set be_sent_at = now() where signal_key = p_key and status = 'open' and be_sent_at is null;
  elsif p_event in ('tp', 'sl', 'be', 'expired') then
    update public.signal_trades set status = p_event, result_pips = p_pips, closed_at = now() where signal_key = p_key and status = 'open';
  else
    raise exception 'Bad event.' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.alerts_trade_event(text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.alerts_trade_event(text, text, text, numeric) to anon;

-- Telegram chats of everyone with access right now.
create or replace function public.alerts_member_chats(p_secret text)
returns table (chat_id bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select l.chat_id from public.telegram_links l
    where exists (select 1 from public.subscriptions s where s.user_id = l.user_id and s.pro_until > now())
       or exists (select 1 from public.admins a where a.user_id = l.user_id);
end;
$$;
revoke all on function public.alerts_member_chats(text) from public, anon, authenticated;
grant execute on function public.alerts_member_chats(text) to anon;

-- Results for the admin page.
create or replace function public.admin_signal_results()
returns table (signal_key text, direction text, entry numeric, stop numeric, target numeric, opened_at timestamptz, be_sent_at timestamptz, status text, result_pips numeric, closed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return query select t.signal_key, t.direction, t.entry, t.stop, t.target, t.opened_at, t.be_sent_at, t.status, t.result_pips, t.closed_at
    from public.signal_trades t order by t.opened_at desc limit 50;
end;
$$;
revoke all on function public.admin_signal_results() from public, anon;
grant execute on function public.admin_signal_results() to authenticated;
