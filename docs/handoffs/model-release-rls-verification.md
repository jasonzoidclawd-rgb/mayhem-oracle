# Model-Release RLS & Trial-Lease Live Verification

The 2026-07-02 security fixes (trial-credit consume-on-reserve, model_releases
anon lockout) ship as Supabase migrations:

- `supabase/migrations/20260702_trial_reserve_rpc.sql`
- `supabase/migrations/20260702_model_release_rls.sql`

Migration files alone do not prove deployed behavior. Deploy order matters:
**push/deploy the app first** (new `getActiveRelease` uses the service client
and works under either policy), **then apply the migrations** (old app code +
new policy would break bootstrap for the gap window).

## Post-migration verification (run against the live project)

1. Anon key must see zero release rows:

```bash
curl -s "$SUPABASE_URL/rest/v1/model_releases?select=package_url&status=eq.active" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# expected: []
```

2. The version view must expose only version fields (authenticated role; anon
   gets zero rows here too since the grant is `to authenticated`):

```bash
curl -s "$SUPABASE_URL/rest/v1/model_release_versions?select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# expected: [] for anon; version/engine/data/status fields only for authenticated
```

3. Bootstrap still works end-to-end for a member (service-role path):
   `GET /api/overlay/bootstrap` with a member session returns the manifest.

Record date + results below when run; do not report R2 as live-verified until
then.

## Known edge (R1, accepted 2026-07-02)

Re-requesting a lease for the SAME `gameHash` more than 40 minutes after the
reservation consumes a second credit (the fresh-reservation branch requires
`reserved_at >= now() - 40min`). Mayhem games are almost always shorter than
the lease window; telemetry finalization of the game clears the reservation.
Revisit only if credit-consumption complaints appear.

## Verification log

- (pending)
