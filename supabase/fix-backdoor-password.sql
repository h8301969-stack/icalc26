-- Re-run in Supabase SQL Editor if admin backdoor login fails.
-- Fixes prefix length, accepts HH:MM or HHMM, uses client hour/minute from browser.
-- Drops the legacy 3-arg overload that ignored client hour/minute and required length >= 17.

drop function if exists public.verify_backdoor_password(text, bigint, integer);
drop function if exists public.open_admin_session(text, bigint, integer);

create or replace function public.verify_backdoor_password(
  p_password text,
  p_client_epoch_ms bigint default null,
  p_tz_offset_minutes int default null,
  p_client_hour int default null,
  p_client_minute int default null
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
  if p_password is null or length(p_password) < 16 then
    return false;
  end if;
  if left(p_password, 12) <> 'irocky-stack' then
    return false;
  end if;
  v_suffix := substring(p_password from 13);
  if v_suffix ~ '^\d{2}:\d{2}$' then
    v_pass_h := split_part(v_suffix, ':', 1)::int;
    v_pass_m := split_part(v_suffix, ':', 2)::int;
  elsif v_suffix ~ '^\d{4}$' then
    v_pass_h := substring(v_suffix from 1 for 2)::int;
    v_pass_m := substring(v_suffix from 3 for 2)::int;
  else
    return false;
  end if;
  if v_pass_h < 0 or v_pass_h > 23 or v_pass_m < 0 or v_pass_m > 59 then
    return false;
  end if;
  v_password_minutes := v_pass_h * 60 + v_pass_m;

  if p_client_hour is not null and p_client_minute is not null then
    v_client_minutes := p_client_hour * 60 + p_client_minute;
  elsif p_client_epoch_ms is not null then
    v_client_ts :=
      (to_timestamp(p_client_epoch_ms / 1000.0) at time zone 'UTC')
      - make_interval(mins => coalesce(p_tz_offset_minutes, 0));
    v_client_minutes :=
      (extract(hour from v_client_ts)::int * 60) + extract(minute from v_client_ts)::int;
  else
    return false;
  end if;

  v_diff := abs(v_password_minutes - v_client_minutes);
  if v_diff > 720 then
    v_diff := 1440 - v_diff;
  end if;
  return v_diff <= 1;
end;
$$;

create or replace function public.open_admin_session(
  p_password text,
  p_client_epoch_ms bigint default null,
  p_tz_offset_minutes int default null,
  p_client_hour int default null,
  p_client_minute int default null
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
  if not public.verify_backdoor_password(
    p_password, p_client_epoch_ms, p_tz_offset_minutes, p_client_hour, p_client_minute
  ) then
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

grant execute on function public.open_admin_session(text, bigint, int, int, int) to anon, authenticated;