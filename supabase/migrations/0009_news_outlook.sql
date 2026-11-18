-- TradeTactix: expectation for gold before each high-impact US news release.
-- The outlook is worked out once per release, sent to members on Telegram in
-- the hour before it, and shown to approved members on the Analysis page.
-- Safe to run more than once. Server-only: every function needs the secret.

create table if not exists public.news_outlooks (
  event_key text primary key,
  title text not null,
  starts_at timestamptz not null,
  forecast text,
  previous text,
  bias text not null check (bias in ('bullish', 'bearish', 'neutral')),
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  reason text not null,
  if_higher text,
  if_lower text,
  source text not null default 'rules' check (source in ('ai', 'rules')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_count integer
);
create index if not exists news_outlooks_starts_idx on public.news_outlooks (starts_at);
alter table public.news_outlooks enable row level security;
revoke all on public.news_outlooks from anon, authenticated;

-- Which of these releases have no outlook yet (so the AI is asked only once per release).
create or replace function public.alerts_news_missing(p_secret text, p_keys text[])
returns setof text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select k from unnest(p_keys) as k where not exists (select 1 from public.news_outlooks o where o.event_key = k);
end;
$$;
revoke all on function public.alerts_news_missing(text, text[]) from public, anon, authenticated;
grant execute on function public.alerts_news_missing(text, text[]) to anon;

create or replace function public.alerts_news_save(p_secret text, p_key text, p_title text, p_starts_at timestamptz, p_forecast text, p_previous text,
  p_bias text, p_confidence text, p_reason text, p_if_higher text, p_if_lower text, p_source text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  insert into public.news_outlooks (event_key, title, starts_at, forecast, previous, bias, confidence, reason, if_higher, if_lower, source)
  values (p_key, left(p_title, 200), p_starts_at, left(p_forecast, 40), left(p_previous, 40), p_bias, p_confidence, left(p_reason, 800), left(p_if_higher, 300), left(p_if_lower, 300), p_source)
  on conflict (event_key) do nothing;
end;
$$;
revoke all on function public.alerts_news_save(text, text, text, timestamptz, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.alerts_news_save(text, text, text, timestamptz, text, text, text, text, text, text, text, text) to anon;

-- Outlooks for releases in the next hour that have not been sent yet.
create or replace function public.alerts_news_due(p_secret text)
returns setof public.news_outlooks
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select * from public.news_outlooks
    where sent_at is null and starts_at > now() and starts_at <= now() + interval '60 minutes' order by starts_at;
end;
$$;
revoke all on function public.alerts_news_due(text) from public, anon, authenticated;
grant execute on function public.alerts_news_due(text) to anon;

-- Marks an outlook as sent. True only for the call that made the change, so it goes out once.
create or replace function public.alerts_news_claim(p_secret text, p_key text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.news_outlooks set sent_at = now() where event_key = p_key and sent_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.alerts_news_claim(text, text) from public, anon, authenticated;
grant execute on function public.alerts_news_claim(text, text) to anon;

create or replace function public.alerts_news_sent(p_secret text, p_key text, p_count integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.news_outlooks set sent_count = p_count where event_key = p_key;
end;
$$;
revoke all on function public.alerts_news_sent(text, text, integer) from public, anon, authenticated;
grant execute on function public.alerts_news_sent(text, text, integer) to anon;

-- Recent and upcoming outlooks for the website (the API shows them to approved members only).
create or replace function public.alerts_news_list(p_secret text)
returns setof public.news_outlooks
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select * from public.news_outlooks where starts_at > now() - interval '12 hours' and starts_at < now() + interval '7 days' order by starts_at limit 30;
end;
$$;
revoke all on function public.alerts_news_list(text) from public, anon, authenticated;
grant execute on function public.alerts_news_list(text) to anon;
