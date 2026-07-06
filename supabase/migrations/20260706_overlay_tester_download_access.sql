-- Overlay tester download access.
-- Extends the existing invite-code redemption path without adding a parallel
-- plaintext-code system. The MAYHEM-TEST-69420 plaintext code is represented
-- only by its sha-256 digest below.

alter table public.entitlements
  drop constraint if exists entitlements_kind_check;

alter table public.entitlements
  add constraint entitlements_kind_check
  check (kind in ('member', 'trial', 'overlay_tester'));

alter table public.invite_codes
  drop constraint if exists invite_codes_kind_check;

alter table public.invite_codes
  add constraint invite_codes_kind_check
  check (kind in ('member', 'trial', 'overlay_tester'));

create or replace function public.redeem_invite(p_code_hash text, p_device_id uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.invite_codes%rowtype;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.invite_codes
  where code_hash = p_code_hash
  for update;

  if not found then
    raise exception 'invalid invite code' using errcode = 'P0001';
  end if;
  if v_invite.revoked then
    raise exception 'invite code revoked' using errcode = 'P0001';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite code expired' using errcode = 'P0001';
  end if;
  if v_invite.redemption_count >= v_invite.max_redemptions then
    raise exception 'invite code exhausted' using errcode = 'P0001';
  end if;

  insert into public.invite_redemptions (invite_code_id, user_id, device_id)
  values (v_invite.id, v_user, p_device_id);

  if v_invite.kind = 'member' then
    if v_invite.member_duration_days is not null then
      v_expires := now() + make_interval(days => v_invite.member_duration_days);
    end if;
    insert into public.entitlements (user_id, kind, starts_at, expires_at, note)
    values (v_user, 'member', now(), v_expires, 'invite:' || v_invite.id);
  elsif v_invite.kind = 'overlay_tester' then
    if v_invite.member_duration_days is not null then
      v_expires := now() + make_interval(days => v_invite.member_duration_days);
    end if;
    insert into public.entitlements (user_id, kind, starts_at, expires_at, note)
    values (v_user, 'overlay_tester', now(), v_expires, 'invite:' || v_invite.id);
  else
    if p_device_id is null then
      raise exception 'trial codes require a linked device' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.devices
      where id = p_device_id and user_id = v_user and revoked = false
    ) then
      raise exception 'device not linked to this account' using errcode = 'P0001';
    end if;
    insert into public.referral_progress (user_id, device_id)
    values (v_user, p_device_id);
  end if;

  update public.invite_codes
  set redemption_count = redemption_count + 1
  where id = v_invite.id;

  return jsonb_build_object('kind', v_invite.kind, 'expires_at', v_expires);
end;
$$;

revoke execute on function public.redeem_invite(text, uuid) from public;
grant execute on function public.redeem_invite(text, uuid) to authenticated;

insert into public.invite_codes (
  code_hash,
  kind,
  member_duration_days,
  max_redemptions,
  expires_at,
  revoked,
  created_by
) values (
  'dde34cced03aa5c32a4aa18775fee4495365ec60e4609d569010788de071081e',
  'overlay_tester',
  3,
  1,
  now() + interval '3 days',
  false,
  null
)
on conflict (code_hash) do update
set
  kind = excluded.kind,
  member_duration_days = excluded.member_duration_days,
  max_redemptions = excluded.max_redemptions,
  expires_at = case
    when public.invite_codes.redemption_count = 0 then now() + interval '3 days'
    else public.invite_codes.expires_at
  end,
  revoked = false;
