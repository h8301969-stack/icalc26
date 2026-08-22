-- Access plans: Premium (mini-profiles) vs Regular.
-- Stop seeding 200 unused codes; mint one 7-char code per Premium/Regular click.
-- Run in Supabase SQL editor after deploy.

alter table public.access_codes
  add column if not exists plan text not null default 'regular'
    check (plan in ('premium', 'regular'));

alter table public.user_settings
  add column if not exists account_plan text not null default 'regular'
    check (account_plan in ('premium', 'regular'));

-- Wipe the old unused pool (the former 200 seed).
create or replace function public.admin_clear_unused_access_codes(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  delete from public.access_codes where status = 'unused';
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

-- Mint a single unused code with a plan (premium | regular).
create or replace function public.admin_issue_access_code(p_token uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_code text;
  attempts int := 0;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_plan := lower(trim(coalesce(p_plan, 'regular')));
  if v_plan not in ('premium', 'regular') then
    return jsonb_build_object('ok', false, 'error', 'plan must be premium or regular');
  end if;

  loop
    attempts := attempts + 1;
    v_code := public.generate_access_code();
    begin
      insert into public.access_codes (code, status, plan)
      values (v_code, 'unused', v_plan);
      exit;
    exception when unique_violation then
      if attempts > 64 then
        return jsonb_build_object('ok', false, 'error', 'Could not generate unique code');
      end if;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'code', v_code, 'plan', v_plan, 'status', 'unused');
end;
$$;

-- Stop auto-seeding 200 codes on admin login.
create or replace function public.seed_access_codes_if_empty()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally no-op: codes are minted on Premium/Regular click only.
  return 0;
end;
$$;

-- Include plan in admin list payloads.
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
      'plan', coalesce(ac.plan, 'regular'),
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
    order by ac.created_at desc
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

-- On approve: copy plan onto the linked user's settings (when user_id known).
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
  v_plan text;
  v_user uuid;
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
  where code = v_code and status = 'pending'
  returning coalesce(plan, 'regular'), user_id into v_plan, v_user;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not pending.');
  end if;

  if v_user is not null then
    insert into public.user_settings (user_id, account_plan)
    values (v_user, v_plan)
    on conflict (user_id) do update
      set account_plan = excluded.account_plan;
  end if;

  return jsonb_build_object('ok', true, 'status', 'approved', 'plan', v_plan);
end;
$$;

-- When a user redeems / links an approved code, ensure account_plan is set.
create or replace function public.apply_access_code_plan_to_user(p_code text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
begin
  select coalesce(plan, 'regular') into v_plan
  from public.access_codes
  where code = upper(trim(p_code));

  if v_plan is null then
    return;
  end if;

  insert into public.user_settings (user_id, account_plan)
  values (p_user_id, v_plan)
  on conflict (user_id) do update
    set account_plan = excluded.account_plan;
end;
$$;

grant execute on function public.admin_clear_unused_access_codes(uuid) to anon, authenticated;
grant execute on function public.admin_issue_access_code(uuid, text) to anon, authenticated;
grant execute on function public.admin_list_access_codes(uuid, text) to anon, authenticated;
grant execute on function public.admin_approve_code(uuid, text, text) to anon, authenticated;
grant execute on function public.apply_access_code_plan_to_user(text, uuid) to anon, authenticated;

-- One-shot cleanup for existing DBs (safe: only unused rows).
-- Admins can also trigger via RPC after opening a session.
-- delete from public.access_codes where status = 'unused';
