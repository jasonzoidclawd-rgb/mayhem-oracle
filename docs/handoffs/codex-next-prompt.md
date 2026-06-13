# Codex dispatch — current assignment: Milestone 5 (member overlay)

You are Codex, co-implementing the Mayhem Oracle membership platform.
Contract: `docs/superpowers/plans/2026-06-13-claude-codex-split-implementation.md`.
Working agreement: `docs/superpowers/plans/2026-06-13-claude-codex-split-strategy.md`.
Status: M0, M1, M3A, M4 scaffold, and **M4 calibration are COMPLETE**
(`docs/handoffs/m4-codex.md` ends `M4 CALIBRATION COMPLETE`). This is the last
implementation milestone before M6 integration.

FIRST, before any work:
- If `docs/handoffs/m5-codex.md` ends with `M5 COMPLETE`, print "M5 already
  complete" and exit.
- Confirm `git -C . rev-parse --abbrev-ref HEAD` → `codex/model-overlay`. Never
  touch main or the main checkout. node_modules present.
- This milestone edits `overlay/**` (your exclusive path). Do NOT edit
  `supabase/**`, `src/app/api/**`, web components, or `messages/*.json` — those
  are Claude's and reach the overlay only as the documented HTTP contract below.

TASK: build the member overlay per plan Milestone 5. It performs LOCAL
inference from a signed model package (from M4) and verifies entitlement online
at app start and at every game start. No input automation; never display
augment win rate; keep the click-through card overlay.

You do NOT need Claude's API source — the overlay calls it over HTTP. Build
against these FROZEN contracts (verify shapes against `src/lib/contracts/*.ts`,
already on this branch):

OVERLAY HTTP CONTRACT (Claude-owned server; build against a fixture for offline
dev, swap to the real base URL via env `MAYHEM_API_BASE`):
- `GET {base}/api/overlay/bootstrap`
  → 200 `{ manifest: { modelVersion, engineVersion, dataVersion, configSha256,
    signature }, packageUrl: string, access: { kind: "member" | "trial" |
    "trial-lease" } }`
  → 401 `{error}` not signed in · 403 `{error}` no entitlement & no active
    trial lease · 404 `{error:"no-active-model"}`.
- `POST {base}/api/overlay/game-session` body `{ gameHash: string }`
  → 200 `{ lease: { kind, gameHash, expiresAt } }` · 401 · 403
    `{error:"no-trial-credits"}` · 400 invalid gameHash.

GRADE VISUAL LANGUAGE (mirror Claude's `src/lib/membership/grade-tokens.ts` so
web and overlay render identically — create an overlay-local module with these
exact values; order hot→weak; only `weak` is a warning):
- hot `#fbbf24`, strong `#34d399`, steady `#38bdf8`, average `#94a3b8`, weak `#fb7185`.

Build (Tasks per plan M5):
- `overlay/src/auth/**` — bootstrap entitlement check on app start and on every
  game start; on failure keep the free collector running and hide all member
  recommendation UI.
- `overlay/src/model/**` — download the M4 package, verify its Ed25519 signature
  against the embedded public key (`docs/handoffs/fixtures/m4/public-key.txt`),
  run local inference producing the same `DecisionResult` shape the web engine
  returns.
- `overlay/src/components/CoachPanel.tsx` — keyboard-toggle panel: reasons,
  skill/item/round interactions, confidence, competitive/exploration switch.
- Card markup: localized grade, hard warning, conditional probability, active
  mode. Populate `pickedAugments` from confirmed contributor round selections.
- Tests: `src/lib/__tests__/overlay-decision-parity.test.ts` proving overlay
  results match web engine fixtures exactly; Rust model-signature + entitlement
  tests.

Verify (homebrew openssl + python on PATH): `(cd overlay && npm run build)`,
`(cd overlay/src-tauri && cargo test)`, `(cd overlay/src-tauri && cargo check)`,
`npm test` green, `./node_modules/.bin/eslint src scripts` clean. Verify macOS;
keep Windows behind cfg and record it as unverified (Claude/user run Windows).
One commit per logical unit with `[M5]` markers; tick the M5 checkboxes.

COMPLIANCE (non-negotiable, this is the Riot-review surface): no input
automation, no hidden-information access, no augment win rate anywhere in the
overlay. The overlay surfaces multiple ranked options + warnings + reasons, not
a single forced answer.

RESUME PROTOCOL: re-runs on a schedule; continue from the first incomplete
item; append a session line to `docs/handoffs/m5-codex.md`. Commit here; if
push is sandbox-blocked, record "push pending" — Claude scribes. If a usage
limit interrupts, stop; next run resumes.

DEFINITION OF DONE: overlay builds on macOS, parity test proves overlay==web
on shared fixtures, entitlement is checked at start + game start, signature
failure is handled, no automation / no augment WR. Handoff
`docs/handoffs/m5-codex.md` per strategy §3. End that file with:

M5 COMPLETE
