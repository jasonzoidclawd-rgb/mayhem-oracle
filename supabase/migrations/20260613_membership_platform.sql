-- Membership platform schema (Milestone 2, Task 2.1)
-- Invariants enforced here and pinned by src/lib/__tests__/entitlements.test.ts:
--   * RLS on every table; users read their own rows only.
--   * Users can never write entitlements, invite codes, or model releases —
--     those move only through service-role/admin routes or the security-definer
--     redeem function below.
--   * Invite codes are stored as sha-256 hashes, never plaintext.
--   * Trial grants are unique per (account, device).

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are self-readable"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles are self-updatable"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Auto-provision a profile row at signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── entitlements ────────────────────────────────────────────────────────────
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('member', 'trial')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  granted_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index entitlements_user_idx on public.entitlements (user_id);

alter table public.entitlements enable row level security;

-- Read-only for the owner; all writes happen via service-role admin routes
-- or security-definer functions. No insert/update/delete policies on purpose.
create policy "entitlements are self-readable"
  on public.entitlements for select
  using (user_id = auth.uid());

create policy "entitlements are admin-readable"
  on public.entitlements for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ── invite codes ────────────────────────────────────────────────────────────
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  kind text not null check (kind in ('member', 'trial')),
  member_duration_days integer,
  max_redemptions integer not null default 1,
  redemption_count integer not null default 0,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

-- Admin visibility only; redemption goes through redeem_invite() and never
-- needs users to read this table.
create policy "invite codes are admin-readable"
  on public.invite_codes for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ── devices (collector / overlay links) ─────────────────────────────────────
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_hash text not null unique,
  platform text not null check (platform in ('windows', 'macos')),
  label text,
  linked_at timestamptz not null default now(),
  revoked boolean not null default false,
  last_seen_at timestamptz
);

create index devices_user_idx on public.devices (user_id);

alter table public.devices enable row level security;

create policy "devices are self-readable"
  on public.devices for select
  using (user_id = auth.uid());

-- ── invite redemptions ──────────────────────────────────────────────────────
create table public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.invite_codes(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id),
  redeemed_at timestamptz not null default now(),
  unique (invite_code_id, user_id)
);

alter table public.invite_redemptions enable row level security;

create policy "redemptions are self-readable"
  on public.invite_redemptions for select
  using (user_id = auth.uid());

-- ── referral progress (three trial game credits) ────────────────────────────
create table public.referral_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id),
  credits_granted integer not null default 3,
  credits_consumed integer not null default 0 check (credits_consumed >= 0),
  reserved_game_hash text,
  reserved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);

alter table public.referral_progress enable row level security;

create policy "referral progress is self-readable"
  on public.referral_progress for select
  using (user_id = auth.uid());

-- ── decision sessions (member history) ──────────────────────────────────────
create table public.decision_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model_version text not null,
  mode text not null check (mode in ('competitive', 'exploration')),
  champion_slug text not null,
  round smallint not null check (round between 1 and 4),
  context jsonb not null,
  result_summary jsonb not null,
  created_at timestamptz not null default now()
);

create index decision_sessions_user_idx
  on public.decision_sessions (user_id, created_at desc);

alter table public.decision_sessions enable row level security;

create policy "decision sessions are self-readable"
  on public.decision_sessions for select
  using (user_id = auth.uid());

create policy "decision sessions are self-insertable"
  on public.decision_sessions for insert
  with check (user_id = auth.uid());

-- ── decision feedback ───────────────────────────────────────────────────────
create table public.decision_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.decision_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  verdict text not null check (verdict in ('useful', 'inaccurate')),
  reason text,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

alter table public.decision_feedback enable row level security;

create policy "feedback is self-readable"
  on public.decision_feedback for select
  using (user_id = auth.uid());

create policy "feedback is self-insertable"
  on public.decision_feedback for insert
  with check (user_id = auth.uid());

-- ── model releases ──────────────────────────────────────────────────────────
create table public.model_releases (
  id uuid primary key default gen_random_uuid(),
  model_version text not null unique,
  engine_version text not null,
  data_version text not null,
  config_sha256 text not null,
  signature text not null,
  package_url text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'rolled-back')),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.model_releases enable row level security;

-- Members may see which model is active (version chip in the UI); candidates
-- and rollbacks are service-role/admin territory.
create policy "active releases are readable"
  on public.model_releases for select
  using (status = 'active' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ── invite redemption (atomic, security definer) ────────────────────────────
-- Called with the user's own client; takes the code HASH so plaintext codes
-- never transit SQL logs. member → dated entitlement; trial → referral
-- credits, exactly once per (account, device) via the unique constraint.
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

  -- unique (invite_code_id, user_id) makes double-redemption raise.
  insert into public.invite_redemptions (invite_code_id, user_id, device_id)
  values (v_invite.id, v_user, p_device_id);

  if v_invite.kind = 'member' then
    if v_invite.member_duration_days is not null then
      v_expires := now() + make_interval(days => v_invite.member_duration_days);
    end if;
    insert into public.entitlements (user_id, kind, starts_at, expires_at, note)
    values (v_user, 'member', now(), v_expires, 'invite:' || v_invite.id);
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
    -- unique (user_id, device_id) makes repeat trials raise.
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
