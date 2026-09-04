-- Inventory photos: local cache first, then this bucket (new-device login), then Telegram.
-- Path: {auth.uid()}/{item_id}.jpg
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  false,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "item_images_select_own" on storage.objects;
create policy "item_images_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "item_images_insert_own" on storage.objects;
create policy "item_images_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "item_images_update_own" on storage.objects;
create policy "item_images_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
