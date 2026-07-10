-- Business info for access codes + user settings (invoice branding)
-- Run in Supabase SQL Editor after access-codes-system.sql

alter table public.access_codes
  add column if not exists business_name text,
  add column if not exists business_phone text,
  add column if not exists business_address text;

alter table public.user_settings
  add column if not exists business_name text,
  add column if not exists business_phone text,
  add column if not exists business_address text;

-- User submits business details after one-time access is approved
create or replace function public.submit_access_business_info(
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
  v_row public.access_codes%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  v_code := upper(trim(p_code));
  if char_length(v_code) <> 7 then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if nullif(trim(p_business_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Business name is required.');
  end if;

  select * into v_row
  from public.access_codes
  where code = v_code
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Access code not found.');
  end if;

  if v_row.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'This code is not linked to your account.');
  end if;

  if v_row.status not in ('approved', 'pending') then
    return jsonb_build_object('ok', false, 'error', 'Business info cannot be saved for this code status.');
  end if;

  update public.access_codes
  set
    business_name = trim(p_business_name),
    business_phone = nullif(trim(coalesce(p_business_phone, '')), ''),
    business_address = nullif(trim(coalesce(p_business_address, '')), '')
  where code = v_code;

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

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_access_codes(
  p_token uuid,
  p_tab text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', ac.code,
      'status', ac.status,
      'username', ac.username,
      'email', ac.email,
      'user_id', ac.user_id,
      'admin_memo', ac.admin_memo,
      'business_name', ac.business_name,
      'business_phone', ac.business_phone,
      'business_address', ac.business_address,
      'created_at', ac.created_at,
      'requested_at', ac.requested_at,
      'approved_at', ac.approved_at,
      'denied_at', ac.denied_at,
      'paused_at', ac.paused_at
    )
    order by ac.created_at asc
  ), '[]'::jsonb)
  into v_rows
  from public.access_codes ac
  where case p_tab
    when 'unused' then ac.status = 'unused'
    when 'pending' then ac.status = 'pending'
    when 'approved' then ac.status in ('approved', 'paused')
    else false
  end;

  return jsonb_build_object('ok', true, 'codes', v_rows);
end;
$$;

grant execute on function public.submit_access_business_info(text, text, text, text) to authenticated;

-- Logged-in user updates business info from Settings
create or replace function public.update_user_business_info(
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
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  if nullif(trim(p_business_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Business name is required.');
  end if;

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

  update public.access_codes
  set
    business_name = trim(p_business_name),
    business_phone = nullif(trim(coalesce(p_business_phone, '')), ''),
    business_address = nullif(trim(coalesce(p_business_address, '')), '')
  where user_id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.update_user_business_info(text, text, text) to authenticated;