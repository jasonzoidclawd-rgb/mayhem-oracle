-- Trial credits are consumed at lease reservation time. Telemetry finalization
-- only clears or refunds a reservation after a verified game upload.

create or replace function public.reserve_trial_credit(p_user_id uuid, p_game_hash text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.referral_progress%rowtype;
  v_now timestamptz := now();
  v_stale_cutoff timestamptz := v_now - interval '40 minutes';
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_game_hash), '') is null then
    raise exception 'game hash is required' using errcode = '22023';
  end if;

  select * into v_row
  from public.referral_progress
  where user_id = p_user_id
    and reserved_game_hash = p_game_hash
    and reserved_at >= v_stale_cutoff
  order by reserved_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'game_hash', v_row.reserved_game_hash,
      'reserved_at', v_row.reserved_at
    );
  end if;

  select * into v_row
  from public.referral_progress
  where user_id = p_user_id
    and credits_consumed < credits_granted
  order by created_at asc
  limit 1
  for update;

  if not found then
    return null;
  end if;

  update public.referral_progress
  set credits_consumed = credits_consumed + 1,
      reserved_game_hash = p_game_hash,
      reserved_at = v_now
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'game_hash', v_row.reserved_game_hash,
    'reserved_at', v_row.reserved_at
  );
end;
$$;

revoke execute on function public.reserve_trial_credit(uuid, text) from public;
grant execute on function public.reserve_trial_credit(uuid, text) to service_role;

create or replace function public.finalize_trial_credit(p_game_hash text, p_duration_seconds integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.referral_progress%rowtype;
begin
  select * into v_row
  from public.referral_progress
  where reserved_game_hash = p_game_hash
  for update;

  if not found then
    return false;
  end if;

  if p_duration_seconds < 480 then
    update public.referral_progress
    set credits_consumed = greatest(credits_consumed - 1, 0),
        reserved_game_hash = null,
        reserved_at = null
    where id = v_row.id;
    return false;
  end if;

  update public.referral_progress
  set reserved_game_hash = null,
      reserved_at = null
  where id = v_row.id;

  return true;
end;
$$;

revoke execute on function public.finalize_trial_credit(text, integer) from public;
grant execute on function public.finalize_trial_credit(text, integer) to service_role;
