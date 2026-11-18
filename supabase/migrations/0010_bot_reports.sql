-- TradeTactix: weekly results post, access-ending reminders and the daily admin report.
-- Each post is claimed once in bot_posts, so it is sent a single time even if runs overlap.
-- Safe to run more than once. Server-only: every function needs the secret.

create table if not exists public.bot_posts (
  kind text not null,
  post_key text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, post_key)
);
alter table public.bot_posts enable row level security;
revoke all on public.bot_posts from anon, authenticated;

-- True only for the first caller for this kind and key.
create or replace function public.alerts_claim_post(p_secret text, p_kind text, p_key text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  insert into public.bot_posts (kind, post_key) values (left(p_kind, 20), left(p_key, 120)) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.alerts_claim_post(text, text, text) from public, anon, authenticated;
grant execute on function public.alerts_claim_post(text, text, text) to anon;

-- Lets a post be tried again when sending failed (for example the bot is not in the channel yet).
create or replace function public.alerts_release_post(p_secret text, p_kind text, p_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from public.bot_posts where kind = p_kind and post_key = p_key;
end;
$$;
revoke all on function public.alerts_release_post(text, text, text) from public, anon, authenticated;
grant execute on function public.alerts_release_post(text, text, text) to anon;

-- Finished signals since a time: TP, SL, breakeven and total pips.
create or replace function public.alerts_period_stats(p_secret text, p_since timestamptz)
returns table (wins integer, losses integer, breakeven integer, pips numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select (count(*) filter (where status = 'tp'))::integer, (count(*) filter (where status = 'sl'))::integer,
           (count(*) filter (where status = 'be'))::integer, coalesce(sum(result_pips), 0)::numeric
    from public.signal_trades where status in ('tp', 'sl', 'be') and closed_at >= p_since;
end;
$$;
revoke all on function public.alerts_period_stats(text, timestamptz) from public, anon, authenticated;
grant execute on function public.alerts_period_stats(text, timestamptz) to anon;

-- Members (not admins) with Telegram linked whose access ends within 24 hours.
create or replace function public.alerts_expiring(p_secret text)
returns table (user_id uuid, chat_id bigint, pro_until timestamptz, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select s.user_id, l.chat_id, s.pro_until, u.email::text
    from public.subscriptions s
    join auth.users u on u.id = s.user_id
    left join public.telegram_links l on l.user_id = s.user_id
    where s.pro_until > now() and s.pro_until <= now() + interval '24 hours'
      and not exists (select 1 from public.admins a where a.user_id = s.user_id)
    order by s.pro_until;
end;
$$;
revoke all on function public.alerts_expiring(text) from public, anon, authenticated;
grant execute on function public.alerts_expiring(text) to anon;

-- Numbers for the daily admin report (the last 24 hours, and right now).
create or replace function public.alerts_daily_numbers(p_secret text)
returns table (pending_requests integer, active_members integer, telegram_members integer, new_accounts integer, signals_sent integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select
    (select count(*) from public.access_requests where status = 'pending')::integer,
    (select count(*) from public.subscriptions s where s.pro_until > now() and not exists (select 1 from public.admins a where a.user_id = s.user_id))::integer,
    (select count(*) from public.subscriptions s join public.telegram_links l on l.user_id = s.user_id where s.pro_until > now())::integer,
    (select count(*) from auth.users where created_at >= now() - interval '24 hours')::integer,
    (select count(*) from public.alert_log where sent_at >= now() - interval '24 hours' and state in ('buy', 'sell'))::integer;
end;
$$;
revoke all on function public.alerts_daily_numbers(text) from public, anon, authenticated;
grant execute on function public.alerts_daily_numbers(text) to anon;

-- News safety pause: a high-impact US release within 30 minutes before or after this time.
create or replace function public.alerts_news_near(p_secret text, p_at timestamptz default now())
returns table (title text, starts_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select o.title, o.starts_at from public.news_outlooks o
    where o.starts_at between p_at - interval '30 minutes' and p_at + interval '30 minutes'
    order by abs(extract(epoch from o.starts_at - p_at)) limit 1;
end;
$$;
revoke all on function public.alerts_news_near(text, timestamptz) from public, anon, authenticated;
grant execute on function public.alerts_news_near(text, timestamptz) to anon;
