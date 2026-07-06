-- Run in Supabase SQL Editor if you already applied schema.sql before this RPC was added.
-- Enables sign-in with username (resolves to the account email).

create or replace function public.get_email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select u.email::text
  from auth.users u
  inner join public.user_profiles p on p.user_id = u.id
  where p.is_system = false
    and lower(trim(p.name)) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.get_email_for_username(text) from public;
grant execute on function public.get_email_for_username(text) to anon, authenticated;