-- TradeTactix AI: signal access by request and administrator approval.
-- Safe to run more than once.
--
-- A signed-in user sends a request with their Telegram username. The
-- administrator approves it for a chosen time (24 hours, 7 days, 30 days or a
-- custom number of hours). Approval gives Pro access until that time; when it
-- passes, signals and alerts stop on their own because everything checks
-- subscriptions.pro_until against the current time.

-- ---------- Ledger: record time grants in hours ----------

alter table public.credit_ledger add column if not exists hours integer;
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('payment', 'admin_grant', 'admin_revoke', 'access_grant', 'access_end'));

-- ---------- Requests ----------

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  telegram_username text not null check (telegram_username ~ '^[A-Za-z0-9_]{5,32}$'),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  granted_hours integer,
  granted_until timestamptz,
  admin_note text not null default '',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- One waiting request per person.
create unique index if not exists access_requests_one_pending on public.access_requests (user_id) where status = 'pending';
create index if not exists access_requests_status_idx on public.access_requests (status, created_at desc);

alter table public.access_requests enable row level security;
drop policy if exists "access_read_own" on public.access_requests;
create policy "access_read_own" on public.access_requests
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.access_requests from anon, authenticated;
grant select on public.access_requests to authenticated;

-- Signals are for approved members only: no free previews.
update public.app_settings set free_previews_per_month = 0, updated_at = now() where id;

-- ---------- Users ----------

create or replace function public.request_access(p_telegram text, p_note text default '')
returns public.access_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_tg text := btrim(ltrim(btrim(coalesce(p_telegram, '')), '@'));
  v_row public.access_requests;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if v_tg !~ '^[A-Za-z0-9_]{5,32}$' then
    raise exception 'Enter your Telegram username: 5 to 32 letters, numbers or underscores.' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = v_user;
  begin
    insert into public.access_requests (user_id, email, telegram_username, note)
    values (v_user, coalesce(v_email, ''), v_tg, left(btrim(coalesce(p_note, '')), 300))
    returning * into v_row;
  exception when unique_violation then
    raise exception 'Your request is already waiting for approval.' using errcode = '23505';
  end;
  return v_row;
end;
$$;
revoke all on function public.request_access(text, text) from public, anon;
grant execute on function public.request_access(text, text) to authenticated;

-- ---------- Administrator ----------

-- Adds (or with negative hours, removes) Pro time. Internal only.
create or replace function public.apply_hours(p_user uuid, p_hours integer, p_reason text, p_note text, p_by uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  insert into public.subscriptions (user_id) values (p_user) on conflict (user_id) do nothing;
  select pro_until into v_until from public.subscriptions where user_id = p_user for update;
  -- Time starts from now if access has lapsed; otherwise it is added on top.
  v_until := greatest(coalesce(v_until, now()), now()) + make_interval(hours => p_hours);
  if v_until <= now() then v_until := null; end if;
  update public.subscriptions set pro_until = v_until, updated_at = now() where user_id = p_user;
  insert into public.credit_ledger (user_id, credits, hours, reason, note, created_by)
  values (p_user, greatest(1, ceil(abs(p_hours) / 24.0)::integer) * sign(p_hours)::integer, p_hours, p_reason, coalesce(p_note, ''), p_by);
  return v_until;
end;
$$;
revoke all on function public.apply_hours(uuid, integer, text, text, uuid) from public, anon, authenticated;

create or replace function public.admin_review_access(p_id uuid, p_approve boolean, p_hours integer default null, p_note text default '')
returns public.access_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.access_requests;
  v_until timestamptz;
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_row from public.access_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = '22023'; end if;
  if v_row.status <> 'pending' then raise exception 'This request was already %.', v_row.status using errcode = '22023'; end if;
  if p_approve then
    if p_hours is null or p_hours < 1 or p_hours > 8760 then
      raise exception 'Choose an access time between 1 hour and 365 days.' using errcode = '22023';
    end if;
    v_until := public.apply_hours(v_row.user_id, p_hours, 'access_grant', left(coalesce(p_note, ''), 300), (select auth.uid()));
  end if;
  update public.access_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    granted_hours = case when p_approve then p_hours else null end,
    granted_until = v_until,
    admin_note = left(coalesce(p_note, ''), 300),
    reviewed_by = (select auth.uid()),
    reviewed_at = now()
  where id = p_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_review_access(uuid, boolean, integer, text) from public, anon;
grant execute on function public.admin_review_access(uuid, boolean, integer, text) to authenticated;

-- Give or extend access directly, without a request.
create or replace function public.admin_grant_hours(p_user uuid, p_hours integer, p_note text default '')
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if p_hours is null or p_hours = 0 or abs(p_hours) > 8760 then
    raise exception 'Hours must be between -8760 and 8760, and not zero.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'User not found.' using errcode = '22023'; end if;
  return public.apply_hours(p_user, p_hours, case when p_hours > 0 then 'access_grant' else 'access_end' end, left(coalesce(p_note, ''), 300), (select auth.uid()));
end;
$$;
revoke all on function public.admin_grant_hours(uuid, integer, text) from public, anon;
grant execute on function public.admin_grant_hours(uuid, integer, text) to authenticated;

-- End someone's access now.
create or replace function public.admin_end_access(p_user uuid, p_note text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  update public.subscriptions set pro_until = null, updated_at = now() where user_id = p_user and pro_until > now();
  if found then
    insert into public.credit_ledger (user_id, credits, hours, reason, note, created_by)
    values (p_user, -1, 0, 'access_end', left(coalesce(p_note, ''), 300), (select auth.uid()));
  end if;
end;
$$;
revoke all on function public.admin_end_access(uuid, text) from public, anon;
grant execute on function public.admin_end_access(uuid, text) to authenticated;

create or replace function public.admin_list_access_requests(p_status text default 'pending')
returns table (id uuid, user_id uuid, email text, telegram_username text, note text, status text,
  granted_hours integer, granted_until timestamptz, created_at timestamptz, reviewed_at timestamptz,
  pro_until timestamptz, telegram_linked boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return query
    select r.id, r.user_id, r.email, r.telegram_username, r.note, r.status, r.granted_hours, r.granted_until,
           r.created_at, r.reviewed_at, s.pro_until, (l.user_id is not null)
    from public.access_requests r
    left join public.subscriptions s on s.user_id = r.user_id
    left join public.telegram_links l on l.user_id = r.user_id
    where p_status = 'all' or r.status = p_status
    order by r.created_at desc
    limit 200;
end;
$$;
revoke all on function public.admin_list_access_requests(text) from public, anon;
grant execute on function public.admin_list_access_requests(text) to authenticated;

-- ---------- Server-only: who to notify on Telegram ----------

create or replace function public.alerts_admin_chats(p_secret text)
returns table (chat_id bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select l.chat_id from public.telegram_links l join public.admins a on a.user_id = l.user_id;
end;
$$;
revoke all on function public.alerts_admin_chats(text) from public, anon, authenticated;
grant execute on function public.alerts_admin_chats(text) to anon;

create or replace function public.alerts_request_info(p_secret text, p_request uuid)
returns table (email text, telegram_username text, status text, granted_until timestamptz, chat_id bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_secret_ok(p_secret) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select r.email, r.telegram_username, r.status, r.granted_until, l.chat_id
    from public.access_requests r left join public.telegram_links l on l.user_id = r.user_id
    where r.id = p_request;
end;
$$;
revoke all on function public.alerts_request_info(text, uuid) from public, anon, authenticated;
grant execute on function public.alerts_request_info(text, uuid) to anon;
