-- Chart drawings saved to the account: each member's lines, zones and notes
-- for each pair, kept until the member deletes them. Times and prices only.
create table if not exists public.chart_drawings (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  symbol text not null check (symbol ~ '^[A-Z]{2,5}/[A-Z]{3,4}$'),
  drawings jsonb not null default '[]'::jsonb check (jsonb_typeof(drawings) = 'array' and pg_column_size(drawings) < 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
alter table public.chart_drawings enable row level security;
drop policy if exists "chart_drawings_own_read" on public.chart_drawings;
drop policy if exists "chart_drawings_own_insert" on public.chart_drawings;
drop policy if exists "chart_drawings_own_update" on public.chart_drawings;
drop policy if exists "chart_drawings_own_delete" on public.chart_drawings;
create policy "chart_drawings_own_read" on public.chart_drawings for select to authenticated using (user_id = (select auth.uid()));
create policy "chart_drawings_own_insert" on public.chart_drawings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "chart_drawings_own_update" on public.chart_drawings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "chart_drawings_own_delete" on public.chart_drawings for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.chart_drawings from anon, authenticated;
grant select, insert, update, delete on public.chart_drawings to authenticated;

notify pgrst, 'reload schema';
