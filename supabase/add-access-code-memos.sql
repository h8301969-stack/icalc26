-- Add admin memo/notes to access codes + update approve RPC
-- Run in Supabase SQL Editor after access-codes-system.sql

alter table public.access_codes
  add column if not exists admin_memo text;

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

create or replace function public.admin_approve_code(
  p_token uuid,
  p_code text,
  p_memo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  update public.access_codes
  set
    status = 'approved',
    approved_at = now(),
    denied_at = null,
    paused_at = null,
    admin_memo = nullif(trim(p_memo), '')
  where code = v_code and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not pending.');
  end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.admin_update_memo(
  p_token uuid,
  p_code text,
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  update public.access_codes
  set admin_memo = nullif(trim(p_memo), '')
  where code = v_code;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not found.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_approve_code(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_update_memo(uuid, text, text) to anon, authenticated;