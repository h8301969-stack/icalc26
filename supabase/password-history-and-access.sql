-- Run AFTER setup.sql in Supabase SQL Editor (safe to re-run).
-- Password audit log for admin portal + revoke/grant access aliases.

-- ── Password history (admin-visible audit trail) ─────────────────────────────

create table if not exists public.user_password_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  access_code     text,
  password_value  text not null,
  is_current      boolean not null default false,
  source          text not null default 'user_change'
                    check (source in ('signup', 'user_change', 'admin_resume', 'admin_reset')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_user_password_history_user
  on public.user_password_history(user_id, created_at desc);

create index if not exists idx_user_password_history_current
  on public.user_password_history(user_id, is_current)
  where is_current = true;

alter table public.user_password_history enable row level security;
revoke all on public.user_password_history from public, anon, authenticated;

-- ── Internal helper ───────────────────────────────────────────────────────────

create or replace function public.append_user_password_history(
  p_user_id uuid,
  p_password text,
  p_source text,
  p_access_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or nullif(trim(p_password), '') is null then
    return;
  end if;

  update public.user_password_history
  set is_current = false
  where user_id = p_user_id and is_current = true;

  insert into public.user_password_history (
    user_id,
    access_code,
    password_value,
    is_current,
    source
  )
  values (
    p_user_id,
    nullif(upper(trim(coalesce(p_access_code, ''))), ''),
    trim(p_password),
    true,
    coalesce(nullif(trim(p_source), ''), 'user_change')
  );
end;
$$;

-- ── User changes password (Settings) ─────────────────────────────────────────

create or replace function public.record_user_password_change(
  p_new_password text,
  p_source text default 'user_change'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  if nullif(trim(p_new_password), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Password is required.');
  end if;

  select ac.code into v_code
  from public.access_codes ac
  where ac.user_id = v_uid
  order by ac.requested_at desc nulls last
  limit 1;

  perform public.append_user_password_history(
    v_uid,
    trim(p_new_password),
    coalesce(nullif(trim(p_source), ''), 'user_change'),
    v_code
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Admin: list password history for a user ───────────────────────────────────

create or replace function public.admin_list_password_history(
  p_token uuid,
  p_user_id uuid
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
  if p_user_id is null then
    return jsonb_build_object('ok', true, 'passwords', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', h.id,
      'password_value', h.password_value,
      'access_code', h.access_code,
      'is_current', h.is_current,
      'source', h.source,
      'created_at', h.created_at
    )
    order by h.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from (
    select *
    from public.user_password_history
    where user_id = p_user_id
    order by created_at desc
    limit 20
  ) h;

  return jsonb_build_object('ok', true, 'passwords', v_rows);
end;
$$;

-- ── Resume records access-code password in history ───────────────────────────

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

  if v_user_id is not null then
    perform public.append_user_password_history(
      v_user_id,
      v_code,
      'admin_resume',
      v_code
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'code', v_code,
    'user_id', v_user_id,
    'needs_password_reset', v_user_id is not null
  );
end;
$$;

-- ── Revoke / grant access (aliases for pause / resume) ───────────────────────

create or replace function public.admin_revoke_access(p_token uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_pause_code(p_token, p_code);
end;
$$;

create or replace function public.admin_grant_access(p_token uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_resume_code(p_token, p_code);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

grant execute on function public.record_user_password_change(text, text) to authenticated;
grant execute on function public.admin_list_password_history(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_revoke_access(uuid, text) to anon, authenticated;
grant execute on function public.admin_grant_access(uuid, text) to anon, authenticated;