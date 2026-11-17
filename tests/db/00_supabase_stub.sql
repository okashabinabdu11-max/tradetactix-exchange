-- Minimal stand-in for the parts of Supabase the migrations rely on, so they
-- can be tested on a plain local Postgres. Never run this on the real project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'abdurahmanshelemo@gmail.com'),
  ('00000000-0000-0000-0000-00000000000b', 'customer@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'other@example.com');
