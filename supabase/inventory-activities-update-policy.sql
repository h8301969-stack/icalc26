-- Allow upsert of activities / invoice logs across devices (safe to re-run)
drop policy if exists "inv_activities_update_own" on public.inventory_activities;
create policy "inv_activities_update_own" on public.inventory_activities for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "invoice_logs_update_own" on public.invoice_action_logs;
create policy "invoice_logs_update_own" on public.invoice_action_logs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "invoice_prints_update_own" on public.invoice_print_logs;
create policy "invoice_prints_update_own" on public.invoice_print_logs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
