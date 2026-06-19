# Mayhem Oracle membership platform — integration ready (2026-06-13)

All five implementation workstreams are complete, verified, and pushed to
origin. Only **M6 integration** remains, and it is intentionally left for you:
it merges to `main` and prepares the Riot review package — both human gates.

## What's done (branches on origin)

| Milestone | Branch @ tip | What |
| --- | --- | --- |
| M1 decision engine | (in all branches) | Unified round-aware engine, shrinkage scoring, internal/public data split, parity budget 0 |
| M2 web membership | `claude/web-membership-platform` @ `b24f86d` | Supabase membership + RLS, protected decision/overlay/admin APIs, mobile Advisor + champion matrix, account/admin pages, **paywall closed** (all member scoring server-gated on entitlement) |
| M3A collector | `codex/lcu-collector` @ `e22f889` | De-identified LCU Mayhem exporter, sanitizer, gzip batch, retry |
| M3B telemetry + ads | `claude/web-membership-platform` @ `b24f86d` | Device linking, allowlist re-validation, R2 upload, BigQuery loader + quarantine, referral finalize, consent-gated AdSense (off by flag) |
| M4 model | `codex/model-overlay` @ `7c4f0dd` | Ed25519 signing/packaging, manual-approval governance, fixture-backed calibration |
| M5 overlay | `codex/model-overlay` @ `7c4f0dd` | Signed local inference (matches web fixtures exactly), entitlement at app+game start, coach panel, compliant cards |

Verification at each tip: web 226 vitest tests + lint + build green; overlay
parity at budget 0; Rust + model tests green (under homebrew openssl/python).

## M6 — what you (or Codex under your supervision) do next

1. **Create `codex/platform-integration`** and merge in order: M1 → M2 → M3A →
   M3B → M4/M5. Codex resolves engine/overlay conflicts; web/API/i18n
   conflicts are mine (re-spawn me to assist). The branches share M1, so
   conflicts should be small.
2. **Run full verification** on the integrated branch: `npm test`, lint, web +
   overlay builds, `cargo test`, model/state harnesses, parity at budget 0.
3. **Security/privacy + product review** (checklist in the plan's Milestone 6).
4. **Merge to `main`** — your call; this is the gate I held all night.
5. **Riot review package** before any public overlay release.

## Deploy-time items you must provision ($0 where possible)

- **Hosting decision** (see `hosting-spike.md`): Vercel Hobby forbids ads.
  Recommended: ship now without ads (already gated behind
  `NEXT_PUBLIC_ADS_ENABLED`), move to Cloudflare Pages when ads are worth it.
- Supabase: run `supabase/migrations/2026061{3,4}_*.sql`; set
  `SUPABASE_SERVICE_ROLE_KEY`; mark your account admin via
  `app_metadata.role = 'admin'`; mint the first invite from `/admin`.
- R2 bucket + `R2_*` env; GCP BigQuery project + service account (run
  `scripts/telemetry/bigquery-schema.sql`); set the GitHub secrets the
  `ingest-telemetry` workflow reads.
- AdSense: `NEXT_PUBLIC_ADSENSE_CLIENT` + real slot IDs, then flip
  `NEXT_PUBLIC_ADS_ENABLED=true` on a commercial-permitted host.

## Known minor follow-ups (non-blocking)

- Cosmetic: strip dead augment-win-rate *rendering* from public pages (the
  data is already gone via M1, so nothing leaks — it just renders nothing).
- `AugmentsClient` computes a generic per-augment baseline client-side
  (accepted for the public DB; not champion-specific rankings).
- Windows overlay packaging + DMG + live-League/OCR remain unverified
  (env-blocked for Codex; need your real hardware).

## Automation note

The Claude (M2/M3B) overnight cron is being retired now that its milestones
are done. The Codex OS crontab (`~/bin/codex-mayhem-cron.sh`, every 2h) remains
but its dispatch is set to halt cleanly until you point it at M6.
