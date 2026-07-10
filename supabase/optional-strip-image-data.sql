-- Optional one-time cleanup: remove image payloads/URLs already stored in Supabase.
-- Run AFTER setup.sql. Safe to re-run. Images remain on each device in localStorage.

update public.inventory_items
set image_url = null
where image_url is not null;

update public.user_profiles
set avatar_url = ''
where avatar_url <> '';

update public.user_settings
set custom_wallpapers = (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'header', slide->>'header',
        'subHeader', slide->>'subHeader',
        'image', ''
      )
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(custom_wallpapers) as slide
)
where custom_wallpapers is not null
  and custom_wallpapers <> '[]'::jsonb;