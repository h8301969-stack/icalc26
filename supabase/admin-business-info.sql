-- Admin business info on grant/approve (separate from setup.sql).
--
-- Run this file in the Supabase SQL editor AFTER setup.sql.
-- Safe to re-run: uses create or replace.
-- Do not merge into setup.sql — keeps GitHub/Supabase deploys from conflicting.

create or replace function public.admin_set_access_business_info(
  p_token uuid,
  p_code text,
  p_business_name text,
  p_business_phone text default null,
  p_business_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_uid uuid;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  if char_length(v_code) <> 7 then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if nullif(trim(p_business_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Business name is required.');
  end if;

  update public.access_codes
  set
    business_name = trim(p_business_name),
    business_phone = nullif(trim(coalesce(p_business_phone, '')), ''),
    business_address = nullif(trim(coalesce(p_business_address, '')), '')
  where code = v_code
  returning user_id into v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Access code not found.');
  end if;

  if v_uid is not null then
    insert into public.user_settings (user_id, business_name, business_phone, business_address)
    values (
      v_uid,
      trim(p_business_name),
      nullif(trim(coalesce(p_business_phone, '')), ''),
      nullif(trim(coalesce(p_business_address, '')), '')
    )
    on conflict (user_id) do update
    set
      business_name = excluded.business_name,
      business_phone = excluded.business_phone,
      business_address = excluded.business_address,
      updated_at = now();
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_access_business_info(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_uid uuid;
  v_row public.access_codes%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  v_code := upper(trim(p_code));
  select * into v_row
  from public.access_codes
  where code = v_code;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Access code not found.');
  end if;

  if v_row.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'This code is not linked to your account.');
  end if;

  if v_row.status not in ('approved', 'pending') then
    return jsonb_build_object('ok', false, 'error', 'Business info is not available for this code status.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'business_name', coalesce(v_row.business_name, ''),
    'business_phone', coalesce(v_row.business_phone, ''),
    'business_address', coalesce(v_row.business_address, '')
  );
end;
$$;

grant execute on function public.admin_set_access_business_info(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.get_access_business_info(text) to authenticated;