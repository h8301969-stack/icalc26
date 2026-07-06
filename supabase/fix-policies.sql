-- Run this FIRST if you get "policy already exists" errors.
-- Then run schema.sql (use the latest copy from supabase/schema.sql).

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;