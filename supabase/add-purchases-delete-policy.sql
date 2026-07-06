-- Run in Supabase SQL Editor if purchases sync fails with permission errors.

drop policy if exists "purchases_delete_own" on public.purchases;
create policy "purchases_delete_own" on public.purchases for delete to authenticated
  using ((select auth.uid()) = user_id);