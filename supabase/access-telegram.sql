-- Shop Telegram link set by admin on Approve / Grant.
-- Stored on access_codes + copied to user_settings so any device can pull after login.
-- Auth / access codes are never 30-day cleaned. Safe to re-run.
--
-- Run AFTER setup.sql (and access-plans.sql if used).

alter table public.access_codes
  add column if not exists telegram_bot_token text,
  add column if not exists telegram_chat_id text;

alter table public.user_settings
  add column if not exists telegram_bot_token text,
  add column if not exists telegram_chat_id text;

-- Replace business-info setter with Telegram fields included.
drop function if exists public.admin_set_access_business_info(uuid, text, text, text, text);

create or replace function public.admin_set_access_business_info(
  p_token uuid,
  p_code text,
  p_business_name text,
  p_business_phone text default null,
  p_business_address text default null,
  p_telegram_bot_token text default null,
  p_telegram_chat_id text default null
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
  if char_length(v_code) <> 7 then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if nullif(trim(p_business_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Business name is required.');
  end if;

  v_token := nullif(trim(coalesce(p_telegram_bot_token, '')), '');
  v_chat := nullif(trim(coalesce(p_telegram_chat_id, '')), '');
  if v_token is null or v_chat is null then
    return jsonb_build_object('ok', false, 'error', 'Telegram Bot API token and chat ID are required before approve.');
  end if;

  update public.access_codes
  set
    business_name = trim(p_business_name),
    business_phone = nullif(trim(coalesce(p_business_phone, '')), ''),
    business_address = nullif(trim(coalesce(p_business_address, '')), ''),
    telegram_bot_token = v_token,
    telegram_chat_id = v_chat
  where code = v_code
  returning user_id into v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Access code not found.');
  end if;

  if v_uid is not null then
    insert into public.user_settings (
      user_id,
      business_name,
      business_phone,
      business_address,
      telegram_bot_token,
      telegram_chat_id
    )
    values (
      v_uid,
      trim(p_business_name),
      nullif(trim(coalesce(p_business_phone, '')), ''),
      nullif(trim(coalesce(p_business_address, '')), ''),
      v_token,
      v_chat
    )
    on conflict (user_id) do update
    set
      business_name = excluded.business_name,
      business_phone = excluded.business_phone,
      business_address = excluded.business_address,
      telegram_bot_token = excluded.telegram_bot_token,
      telegram_chat_id = excluded.telegram_chat_id,
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
    'business_address', coalesce(v_row.business_address, ''),
    'telegram_bot_token', coalesce(v_row.telegram_bot_token, ''),
    'telegram_chat_id', coalesce(v_row.telegram_chat_id, '')
  );
end;
$$;

-- Any signed-in shop device can pull its saved Telegram link (no re-paste).
create or replace function public.get_my_shop_telegram()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_token text;
  v_chat text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select us.telegram_bot_token, us.telegram_chat_id
  into v_token, v_chat
  from public.user_settings us
  where us.user_id = v_uid;

  if v_token is null or v_chat is null or length(trim(v_token)) = 0 or length(trim(v_chat)) = 0 then
    select ac.telegram_bot_token, ac.telegram_chat_id
    into v_token, v_chat
    from public.access_codes ac
    where ac.user_id = v_uid
      and ac.status in ('approved', 'paused')
    order by ac.approved_at desc nulls last
    limit 1;
  end if;

  if v_token is null or v_chat is null or length(trim(v_token)) = 0 or length(trim(v_chat)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No Telegram link on file.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'telegram_bot_token', trim(v_token),
    'telegram_chat_id', trim(v_chat)
  );
end;
$$;

grant execute on function public.admin_set_access_business_info(uuid, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_access_business_info(text) to authenticated;
grant execute on function public.get_my_shop_telegram() to authenticated;
