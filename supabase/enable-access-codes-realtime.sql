-- Enable instant approval notifications (Realtime) while keeping data locked down.
-- Run after access-codes-system.sql

-- 1. Let authenticated users receive Realtime updates ONLY on their own code row
drop policy if exists access_codes_select_own_realtime on public.access_codes;
create policy access_codes_select_own_realtime on public.access_codes
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.access_codes to authenticated;

-- 2. Add table to Realtime publication (instant push when admin approves)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'access_codes'
  ) then
    alter publication supabase_realtime add table public.access_codes;
  end if;
end $$;