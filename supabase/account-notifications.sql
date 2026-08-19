-- In-account profile notifications (safe to re-run)
create table if not exists public.account_notifications (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  actor_profile_id text not null default '',
  target_profile_id text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists account_notifications_user_target_idx
  on public.account_notifications (user_id, target_profile_id, created_at desc);

alter table public.account_notifications enable row level security;

drop policy if exists account_notifications_select_own on public.account_notifications;
create policy account_notifications_select_own
  on public.account_notifications for select
  using (auth.uid() = user_id);

drop policy if exists account_notifications_insert_own on public.account_notifications;
create policy account_notifications_insert_own
  on public.account_notifications for insert
  with check (auth.uid() = user_id);

drop policy if exists account_notifications_update_own on public.account_notifications;
create policy account_notifications_update_own
  on public.account_notifications for update
  using (auth.uid() = user_id);

-- Realtime for live toasts on other devices under the same account
do $$
begin
  alter publication supabase_realtime add table public.account_notifications;
exception
  when duplicate_object then null;
end $$;
