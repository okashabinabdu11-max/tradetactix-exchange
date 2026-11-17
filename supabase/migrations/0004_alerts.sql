-- TradeTactix AI: premium Telegram alerts. Safe to run more than once.
--
-- Security model
--   * Users can only create a short-lived link code for themselves.
--   * Everything else (linking a Telegram chat, finding who to alert, logging
--     sent alerts) is done by our server, which proves itself with a secret
--     kept in a private table that no user can read.

-- ---------- Private server secret ----------

create table if not exists public.server_secrets (
  name text primary key,
  value text not null check (char_length(value) >= 32)
);
alter table public.server_secrets enable row level security;
revoke all on public.server_secrets from anon, authenticated;

create or replace function public.server_secret_ok(p_secret text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.server_secrets s where s.name = 'alerts' and s.value = p_secret);
$$;
revoke all on function public.server_secret_ok(text) from public, anon, authenticated;

-- ---------- Bot username, shown to users ----------

alter table public.app_settings add column if not exists telegram_bot_username text
  check (telegram_bot_username is null or telegram_bot_username ~ '^[A-Za-z0-9_]{5,32}$');

create or replace function public.admin_set_telegram_bot(p_username text)
returns public.app_settings
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.app_settings;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  update public.app_settings set telegram_bot_username = nullif(btrim(ltrim(coalesce(p_username, ''), '@')), ''), updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_set_telegram_bot(text) from public, anon;
grant execute on function public.admin_set_telegram_bot(text) to authenticated;

-- ---------- Links between accounts and Telegram chats ----------

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  linked_at timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
drop policy if exists "telegram_read_own" on public.telegram_links;
create policy "telegram_read_own" on public.telegram_links
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.telegram_links from anon, authenticated;
grant select on public.telegram_links to authenticated;

create table if not exists public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Z2-9]{10}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;

create table if not exists public.alert_log (
  signal_key text primary key,
  state text not null,
  recipients integer not null default 0,
  sent_at timestamptz not null default now()
);
alter table public.alert_log enable row level security;
revoke all on public.alert_log from anon, authenticated;

-- A signed-in user asks for a one-time code to send to the bot.
create or replace function public.create_telegram_link_code()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  delete from public.telegram_link_codes where user_id = v_user or expires_at < now();
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '') into v_code
      from generate_series(1, 10);
    begin
      insert into public.telegram_link_codes (code, user_id) values (v_code, v_user);
      return v_code;
    exception when unique_violation then
      -- try another code
    end;
  end loop;
end;
$$;
revoke all on function public.create_telegram_link_code() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;

create or replace function public.unlink_my_telegram()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.telegram_links where user_id = (select auth.uid());
$$;
revoke all on function public.unlink_my_telegram() from public, anon;
grant execute on function public.unlink_my_telegram() to authenticated;

-- ---------- Server-only functions (need the secret) ----------

-- The bot received "/start CODE" from a chat: link that chat to the code's owner.
create or replace function public.alerts_link_chat(p_secret text, p_code text, p_chat_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from public.telegram_link_codes where code = upper(btrim(coalesce(p_code, ''))) and expires_at > now()
    returning user_id into v_user;
  if v_user is null then return jsonb_build_object('linked', false, 'reason', 'expired'); end if;
  -- One chat per account and one account per chat.
  delete from public.telegram_links where chat_id = p_chat_id or user_id = v_user;
  insert into public.telegram_links (user_id, chat_id) values (v_user, p_chat_id);
  return jsonb_build_object('linked', true, 'pro', exists (
    select 1 from public.subscriptions s where s.user_id = v_user and s.pro_until > now()
  ) or exists (select 1 from public.admins a where a.user_id = v_user));
end;
$$;
revoke all on function public.alerts_link_chat(text, text, bigint) from public, anon, authenticated;
grant execute on function public.alerts_link_chat(text, text, bigint) to anon;

create or replace function public.alerts_unlink_chat(p_secret text, p_chat_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from public.telegram_links where chat_id = p_chat_id;
end;
$$;
revoke all on function public.alerts_unlink_chat(text, bigint) from public, anon, authenticated;
grant execute on function public.alerts_unlink_chat(text, bigint) to anon;

-- A new signal: record it once and return the chats of current Pro members.
-- A second call with the same key returns nothing, so no alert is sent twice.
create or replace function public.alerts_claim_signal(p_secret text, p_key text, p_state text)
returns table (chat_id bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_state not in ('buy', 'sell') or char_length(coalesce(p_key, '')) not between 1 and 80 then
    raise exception 'Bad signal.' using errcode = '22023';
  end if;
  insert into public.alert_log (signal_key, state) values (p_key, p_state) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;
  return query
    select l.chat_id from public.telegram_links l
    where exists (select 1 from public.subscriptions s where s.user_id = l.user_id and s.pro_until > now())
       or exists (select 1 from public.admins a where a.user_id = l.user_id);
end;
$$;
revoke all on function public.alerts_claim_signal(text, text, text) from public, anon, authenticated;
grant execute on function public.alerts_claim_signal(text, text, text) to anon;

create or replace function public.alerts_record_sent(p_secret text, p_key text, p_count integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.alert_log set recipients = greatest(coalesce(p_count, 0), 0) where signal_key = p_key;
end;
$$;
revoke all on function public.alerts_record_sent(text, text, integer) from public, anon, authenticated;
grant execute on function public.alerts_record_sent(text, text, integer) to anon;

-- Recent alerts for the admin page.
create or replace function public.admin_recent_alerts()
returns table (signal_key text, state text, recipients integer, sent_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return query select a.signal_key, a.state, a.recipients, a.sent_at from public.alert_log a order by a.sent_at desc limit 20;
end;
$$;
revoke all on function public.admin_recent_alerts() from public, anon;
grant execute on function public.admin_recent_alerts() to authenticated;
