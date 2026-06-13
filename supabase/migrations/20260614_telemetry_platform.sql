-- Telemetry ingestion metadata (Milestone 3B). Raw safe exports live in R2;
-- BigQuery holds long-term de-identified events. Supabase stores only
-- operational metadata: device links, batch receipts, and dedupe keys.

-- ── device codes (collector → website linking) ──────────────────────────────
-- Collector requests a short code; a signed-in user approves it, minting a
-- device token. Codes are stored hashed and expire fast.
create table public.device_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  platform text not null check (platform in ('windows', 'macos')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  claimed_by uuid references auth.users(id),
  device_id uuid references public.devices(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.device_codes enable row level security;
-- No user policies: the device-code lifecycle runs entirely through
-- service-role API routes (issue, approve). Users never read this table.

-- ── telemetry batches (R2 receipts) ─────────────────────────────────────────
create table public.telemetry_batches (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  r2_key text not null,
  game_count integer not null check (game_count > 0),
  schema_version integer not null default 1,
  status text not null default 'stored'
    check (status in ('stored', 'processed', 'quarantined')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index telemetry_batches_user_idx on public.telemetry_batches (user_id, created_at desc);
create index telemetry_batches_status_idx on public.telemetry_batches (status);

alter table public.telemetry_batches enable row level security;

-- A contributor may see their own upload receipts; writes are service-role only.
create policy "telemetry batches are self-readable"
  on public.telemetry_batches for select
  using (user_id = auth.uid());

-- ── ingested games (idempotent dedupe) ──────────────────────────────────────
-- One row per game_hash ever accepted. The upload route consults this to drop
-- duplicates; the BigQuery loader marks them processed.
create table public.ingested_games (
  game_hash text primary key,
  batch_id uuid not null references public.telemetry_batches(id) on delete cascade,
  contributor_id uuid references auth.users(id),
  ingested_at timestamptz not null default now()
);

alter table public.ingested_games enable row level security;
-- Service-role only; dedupe lookups happen server-side with the service client.

-- ── trial credit finalization (referral, M3B Task 3B.2) ─────────────────────
-- Consume a reserved trial credit once a contributor-owned match with the
-- reserved game_hash is accepted AND the game exceeded eight minutes.
create or replace function public.finalize_trial_credit(p_game_hash text, p_duration_seconds integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.referral_progress%rowtype;
begin
  if p_duration_seconds < 480 then
    return false;  -- under eight minutes: never consumes a credit
  end if;

  select * into v_row
  from public.referral_progress
  where reserved_game_hash = p_game_hash
  for update;
  if not found then
    return false;
  end if;

  update public.referral_progress
  set credits_consumed = credits_consumed + 1,
      reserved_game_hash = null,
      reserved_at = null
  where id = v_row.id
    and credits_consumed < credits_granted;

  return true;
end;
$$;

revoke execute on function public.finalize_trial_credit(text, integer) from public;
