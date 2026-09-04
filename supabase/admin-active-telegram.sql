-- Admin can view + edit a shop's Telegram Bot API + chat ID from Active codes.
-- Safe to re-run. Requires access-telegram.sql (columns + admin_set_access_business_info).

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
      'telegram_bot_token', coalesce(ac.telegram_bot_token, ''),
      'telegram_chat_id', coalesce(ac.telegram_chat_id, ''),
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

create or replace function public.admin_set_access_telegram(
  p_token uuid,
  p_code text,
  p_telegram_bot_token text,
  p_telegram_chat_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_uid uuid;
  v_token text;
  v_chat text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  v_token := nullif(trim(coalesce(p_telegram_bot_token, '')), '');
  v_chat := nullif(trim(coalesce(p_telegram_chat_id, '')), '');
  if v_token is null or v_chat is null then
    return jsonb_build_object('ok', false, 'error', 'Telegram Bot API token and chat ID are required.');
  end if;

  update public.access_codes
  set
    telegram_bot_token = v_token,
    telegram_chat_id = v_chat
  where code = v_code
  returning user_id into v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Access code not found.');
  end if;

  if v_uid is not null then
    insert into public.user_settings (user_id, telegram_bot_token, telegram_chat_id)
    values (v_uid, v_token, v_chat)
    on conflict (user_id) do update
    set
      telegram_bot_token = excluded.telegram_bot_token,
      telegram_chat_id = excluded.telegram_chat_id,
      updated_at = now();
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_set_access_telegram(uuid, text, text, text) to anon, authenticated;
