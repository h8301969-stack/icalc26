-- Access codes + backdoor admin system
-- Run in Supabase SQL Editor after schema.sql
-- Safe to re-run: drops/recreates policies and functions

create extension if not exists "pgcrypto";

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists public.access_codes (
  code          text primary key check (char_length(code) = 7),
  status        text not null default 'unused'
                  check (status in ('unused', 'pending', 'approved', 'paused', 'denied')),
  user_id       uuid references auth.users(id) on delete set null,
  username      text,
  email         text,
  requested_at  timestamptz,
  approved_at   timestamptz,
  denied_at     timestamptz,
  paused_at     timestamptz,
  admin_memo    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token       uuid primary key default gen_random_uuid(),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_access_codes_status on public.access_codes(status);
create index if not exists idx_access_codes_user_id on public.access_codes(user_id);
create index if not exists idx_admin_sessions_expires on public.admin_sessions(expires_at);

alter table public.access_codes enable row level security;
alter table public.admin_sessions enable row level security;

-- No direct table access — all operations go through SECURITY DEFINER RPCs
revoke all on public.access_codes from public, anon, authenticated;
revoke all on public.admin_sessions from public, anon, authenticated;

-- ── Helpers ───────────────────────────────────────────────────────────────────

create or replace function public.generate_access_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
  idx int;
begin
  for i in 1..7 loop
    idx := floor(random() * length(chars) + 1)::int;
    result := result || substr(chars, idx, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.verify_backdoor_password(
  p_password text,
  p_client_epoch_ms bigint default null,
  p_tz_offset_minutes int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suffix text;
  v_pass_h int;
  v_pass_m int;
  v_password_minutes int;
  v_client_minutes int;
  v_client_ts timestamptz;
  v_diff int;
begin
  if p_password is null or length(p_password) < 17 then
    return false;
  end if;
  if left(p_password, 12) <> 'irocky-stack' then
    return false;
  end if;
  v_suffix := substring(p_password from 13);
  if v_suffix !~ '^\d{2}:\d{2}$' then
    return false;
  end if;
  v_pass_h := split_part(v_suffix, ':', 1)::int;
  v_pass_m := split_part(v_suffix, ':', 2)::int;
  if v_pass_h < 0 or v_pass_h > 23 or v_pass_m < 0 or v_pass_m > 59 then
    return false;
  end if;
  v_password_minutes := v_pass_h * 60 + v_pass_m;

  if p_client_epoch_ms is null then
    return false;
  end if;

  v_client_ts :=
    (to_timestamp(p_client_epoch_ms / 1000.0) at time zone 'UTC')
    - make_interval(mins => coalesce(p_tz_offset_minutes, 0));

  v_client_minutes :=
    (extract(hour from v_client_ts)::int * 60) + extract(minute from v_client_ts)::int;
  v_diff := abs(v_password_minutes - v_client_minutes);
  if v_diff > 720 then
    v_diff := 1440 - v_diff;
  end if;
  return v_diff <= 1;
end;
$$;

create or replace function public.is_valid_admin_session(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_sessions s
    where s.token = p_token
      and s.expires_at > now()
  );
$$;

create or replace function public.seed_access_codes_if_empty()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
  inserted int := 0;
  new_code text;
  attempts int;
begin
  select count(*)::int into existing from public.access_codes;
  if existing > 0 then
    return 0;
  end if;

  while inserted < 200 loop
    attempts := 0;
    loop
      new_code := public.generate_access_code();
      attempts := attempts + 1;
      begin
        insert into public.access_codes (code, status) values (new_code, 'unused');
        inserted := inserted + 1;
        exit;
      exception when unique_violation then
        if attempts > 64 then
          raise exception 'Could not generate unique access code';
        end if;
      end;
    end loop;
  end loop;

  return inserted;
end;
$$;

-- ── Public RPCs (anon + authenticated) ────────────────────────────────────────

create or replace function public.open_admin_session(
  p_password text,
  p_client_epoch_ms bigint default null,
  p_tz_offset_minutes int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_expires timestamptz;
  v_seeded int;
begin
  if not public.verify_backdoor_password(p_password, p_client_epoch_ms, p_tz_offset_minutes) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_seeded := public.seed_access_codes_if_empty();

  v_token := gen_random_uuid();
  v_expires := now() + interval '8 hours';
  insert into public.admin_sessions (token, expires_at) values (v_token, v_expires);

  return jsonb_build_object(
    'ok', true,
    'token', v_token::text,
    'expires_at', v_expires,
    'seeded', v_seeded
  );
end;
$$;

create or replace function public.request_access_code(
  p_code text,
  p_username text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.access_codes%rowtype;
begin
  v_code := upper(trim(p_code));
  if char_length(v_code) <> 7 then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if trim(p_username) = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter a username.');
  end if;
  if trim(p_email) = '' or position('@' in trim(p_email)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid email address.');
  end if;

  select * into v_row from public.access_codes where code = v_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if v_row.status <> 'unused' then
    return jsonb_build_object('ok', false, 'error', 'This access code is not available.');
  end if;

  update public.access_codes
  set
    status = 'pending',
    username = trim(p_username),
    email = lower(trim(p_email)),
    requested_at = now(),
    user_id = null,
    approved_at = null,
    denied_at = null,
    paused_at = null
  where code = v_code;

  return jsonb_build_object('ok', true, 'code', v_code, 'status', 'pending');
end;
$$;

create or replace function public.link_access_code_user(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := upper(trim(p_code));
  update public.access_codes
  set user_id = p_user_id
  where code = v_code
    and status = 'pending'
    and (user_id is null or user_id = p_user_id);

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Could not link access code.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.check_access_code_status(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.access_codes%rowtype;
begin
  v_code := upper(trim(p_code));
  select * into v_row from public.access_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', v_row.code,
    'status', v_row.status,
    'username', v_row.username,
    'email', v_row.email
  );
end;
$$;

create or replace function public.check_user_access_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_codes%rowtype;
begin
  select * into v_row
  from public.access_codes
  where user_id = p_user_id
  order by requested_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'code', v_row.code
  );
end;
$$;

create or replace function public.validate_login_access(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_codes%rowtype;
begin
  select ac.*
  into v_row
  from public.access_codes ac
  where lower(ac.email) = lower(trim(p_email))
  order by ac.requested_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'allowed', true);
  end if;

  if v_row.status = 'approved' then
    return jsonb_build_object('ok', true, 'allowed', true, 'status', v_row.status);
  end if;
  if v_row.status = 'pending' then
    return jsonb_build_object('ok', true, 'allowed', false, 'status', 'pending', 'code', v_row.code);
  end if;
  if v_row.status = 'paused' then
    return jsonb_build_object('ok', true, 'allowed', false, 'status', 'paused');
  end if;

  return jsonb_build_object('ok', true, 'allowed', false, 'status', v_row.status);
end;
$$;

-- ── Admin RPCs ────────────────────────────────────────────────────────────────

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
      'requested_at', ac.requested_at,
      'approved_at', ac.approved_at,
      'denied_at', ac.denied_at,
      'paused_at', ac.paused_at,
      'admin_memo', ac.admin_memo,
      'created_at', ac.created_at
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

create or replace function public.admin_deny_code(p_token uuid, p_code text)
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
    status = 'unused',
    user_id = null,
    username = null,
    email = null,
    requested_at = null,
    approved_at = null,
    denied_at = now(),
    paused_at = null
  where code = v_code and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not pending.');
  end if;
  return jsonb_build_object('ok', true, 'status', 'unused');
end;
$$;

create or replace function public.admin_pause_code(p_token uuid, p_code text)
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
  set status = 'paused', paused_at = now()
  where code = v_code and status = 'approved';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not active.');
  end if;
  return jsonb_build_object('ok', true, 'status', 'paused');
end;
$$;

create or replace function public.admin_resume_code(p_token uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_user_id uuid;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  select user_id into v_user_id
  from public.access_codes
  where code = v_code and status = 'paused';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not paused.');
  end if;

  update public.access_codes
  set status = 'approved', paused_at = null, approved_at = coalesce(approved_at, now())
  where code = v_code;

  return jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'code', v_code,
    'user_id', v_user_id,
    'needs_password_reset', v_user_id is not null
  );
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

create or replace function public.close_admin_session(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.admin_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────

grant execute on function public.open_admin_session(text, bigint, int) to anon, authenticated;
grant execute on function public.request_access_code(text, text, text) to anon, authenticated;
grant execute on function public.link_access_code_user(text, uuid) to anon, authenticated;
grant execute on function public.check_access_code_status(text) to anon, authenticated;
grant execute on function public.check_user_access_status(uuid) to anon, authenticated;
grant execute on function public.validate_login_access(text) to anon, authenticated;
grant execute on function public.admin_list_access_codes(uuid, text) to anon, authenticated;
grant execute on function public.admin_approve_code(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_update_memo(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_deny_code(uuid, text) to anon, authenticated;
grant execute on function public.admin_pause_code(uuid, text) to anon, authenticated;
grant execute on function public.admin_resume_code(uuid, text) to anon, authenticated;
grant execute on function public.close_admin_session(uuid) to anon, authenticated;

-- Run once after deploy to generate the initial 200-code batch (or auto-seeds on first backdoor login):
-- select public.seed_access_codes_if_empty();