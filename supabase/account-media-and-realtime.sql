-- Avatars + wallpapers in Storage, live calculator Realtime, Telegram snapshot file ids.
-- Safe to re-run.

alter table public.user_settings
  add column if not exists telegram_snapshot_files jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'profile-avatars',
    'profile-avatars',
    false,
    3145728,
    array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
  ),
  (
    'wallpapers',
    'wallpapers',
    false,
    5242880,
    array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
  )
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatars_select_own" on storage.objects;
create policy "profile_avatars_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "profile_avatars_insert_own" on storage.objects;
create policy "profile_avatars_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "profile_avatars_update_own" on storage.objects;
create policy "profile_avatars_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "wallpapers_select_own" on storage.objects;
create policy "wallpapers_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'wallpapers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "wallpapers_insert_own" on storage.objects;
create policy "wallpapers_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'wallpapers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "wallpapers_update_own" on storage.objects;
create policy "wallpapers_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'wallpapers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'wallpapers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

alter table public.invoices replica identity full;
alter table public.calc_history replica identity full;
alter table public.inventory_items replica identity full;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.invoices';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.calc_history';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.inventory_items';
  exception when duplicate_object then null;
  end;
end $$;
