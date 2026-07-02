# Overlay Member Data-Pack (Owner decision Q2: fetch on the fly)

Decision (2026-07-02): stop bundling member-depth catalogs (augment win
rates, full combos, pool rules) inside overlay installers. Acquire them at
runtime behind the existing entitlement gate. This closes review finding N7 /
GPT round-1 fix #1.

## Recommended architecture: entitlement-gated data pack (not per-query API)

Reuse the signed model-release plumbing — the bootstrap manifest already
carries `dataVersion`:

1. **Build**: `overlay/scripts/sync-data.mjs` becomes `build-datapack.mjs` —
   same compaction, but output is a single versioned archive
   (`datapack-<dataVersion>.json[.gz]` + sha256) uploaded to R2 by the release
   workflow, not written into `overlay/public/data/`.
2. **Installer** ships public-layer data only (or nothing and shows a
   "sign in to sync" state). `audit-windows-artifact.mjs` gains a member-field
   scan (`win_rate`, non-S-tier combos, pool-rule exclusions) so a regression
   fails packaging.
3. **Acquisition**: after device-token auth, `GET /api/overlay/bootstrap`
   (already entitlement-or-lease gated) adds `dataPack: {url (short-lived
   signed R2 URL), sha256, dataVersion}`. Overlay downloads, verifies hash,
   caches in the app-data dir, hot-reloads catalogs.
4. **Refresh**: on launch and per game-session, compare manifest
   `dataVersion` to cache; re-fetch when it changes (daily cadence).
5. **Offline**: cached pack keeps working — the gate controls acquisition,
   not possession; a lapsed member keeps at most a stale pack. Acceptable per
   owner; revisit only if churn abuse appears.
6. **Trial users**: same path while holding an active lease (post-R1 leases
   consume credits, so packs aren't infinitely farmable; packs go stale
   without an entitlement anyway).

## Why not the alternatives

- **Live scoring API per offer** (`/api/decision/evaluate`, already exists):
  keep as the member-coach fallback path, but as the primary source it adds
  in-draft latency, needs mid-game connectivity, and idles the local scoring
  twin + parity architecture.
- **Encrypted bundle + post-auth key**: key extraction defeats it; adds
  complexity without a real gate.

## Tasks (round 3, after round-2 merge)

1. Convert sync script → data-pack builder + R2 upload step in the release
   workflow; wire `dataPackUrl` signing into bootstrap deps (R2 presigned,
   ~10 min TTL).
2. Overlay Rust/TS: download-verify-cache-load path + "syncing/locked" UI
   states; delete `overlay/public/data` bundling.
3. Rework `overlay-packaged-data.test.ts`: it currently codifies the bundling
   (asserts member fields present in the package) — invert it to assert the
   installer payload is public-layer only and the pack builder output matches
   internal data.
4. Extend the artifact audit (blocking packaging check).
Verify: fresh install without sign-in exposes no member catalogs
(`/usr/bin/grep -r win_rate <bundle dir>` empty); member sign-in populates
cache; cross-parity suite still green against the pack builder output.
