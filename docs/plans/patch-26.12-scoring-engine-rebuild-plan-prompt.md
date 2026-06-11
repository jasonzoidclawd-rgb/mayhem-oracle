# PLAN MODE — Mayhem Oracle: Patch 26.12 Scoring Engine Rebuild

You are in plan mode. Research and produce an execution plan only — no code edits, no commits.
Ultrathink. Load context exhaustively before writing the plan; use the full context window. Read files completely, don't skim.

Repo: https://github.com/jasonzoidclawd-rgb/mayhem-oracle (local: `~/Desktop/mayhem-oracle/`, overlay at `overlay/`)
Provenance: two prior Opus 4.6 analysis sessions (claude.ai shares `73999e07…` and `dedb7497…`). Their conclusions are distilled below — treat this section as authoritative; do not attempt to fetch the links.

## Why this plan exists

League patch 26.12 structurally breaks the Oracle Score algorithm:

1. **Augment Sets / Traits are removed entirely** from ARAM Mayhem (Riot cites homogenized builds). Former set effects return as standalone augments (e.g. Stackosaurus is now self-contained).
2. **New augment class: Ability Augments** — each enhances one specific ability, is champion-scoped, and uses a `[SPELL]` token that resolves to a per-champion ability slot. Champion-fit scoring must move from kit-tag level to ability-slot level.
3. **~1/3 corpus turnover**: 50+ new augments added, ~40 removed.

Decisions already locked in `PRD-scoring-engine-26.12.md` (honor them; flag if you find them wrong):
- `same_set_synergy` is **deleted, not zeroed** — dead dimensions are tech debt that confuses Codex.
- New dimension `ability_augment_fit` requires a new data file `champion-ability-slots.json`. CommunityDragon first; it may not expose `[SPELL]` slot bindings — the plan must include a fallback sourcing strategy.
- **Phase 0 (data foundation) is a hard, blocking prerequisite**: `augments.json` needs a `type` field and the tag bitmask must be regenerated from 26.12 `map12.bin.json` / `map30.bin.json` before any scoring work begins.
- System Breakers (質變增幅) must be re-verified empirically against 26.12 (live data or CDragon tag check).

## Required reading (in full, before planning)

- `CLAUDE.md` and `AGENTS.md` (verify actual filename — may be `AGENT.md`)
- `PRD-scoring-engine-26.12.md` if present in the repo; if absent, say so and plan from the facts above
- Scoring: `computeOracleScore`, `analyzeInteractions` (±3/6/9 interaction deltas), `ORACLE_PROFILE_MECHANICS` exclusion set
- Pool pipeline: `src/lib/championPoolBitmask.ts`, `augment-tailoring.ts`, overlay `pool-orchestrator.ts`, `public/data/champion-augment-pools.json` (pipeline order: bitmask gate → disabled/removed lifecycle → `isInAugmentPool` heuristics → kit_tags intersection → item exclusions)
- Data scripts: bitmask generator, `scripts/fill_augment_locales.py`, patch-notes scrapers
- Test suites (vitest + `overlay/` cargo) and existing git tags (`overlay-ocr-fix-bc794bc`, `scoring-mechanical-interaction`, …)
- Verify the 26.12 change list against live sources (official patch notes, arammayhem.com) before locking the plan.

## What the plan must contain

1. **Phased execution plan decomposed into Codex `/goal`-sized sessions.** Every session follows the house meta-pattern: verified baseline (git tag) → red test first → minimum change → explicit blast radius ("do not touch" list) → definition of done.
2. **Phase 0 — 26.12 data foundation (blocking):** `augments.json` `type` field; bitmask regen from 26.12 bins; ability-slot data sourcing (CDragon probe + fallback); removed/disabled lifecycle updates; locale name backfill for all new augments across en / zh-TW / zh-CN / ja / ko.
3. **Scoring engine rework:** audit every Oracle Score dimension against 26.12 — which survive, which die (`same_set_synergy` confirmed dead; check whether `set_tier_bonus` is coupled to Sets or to rarity and decide accordingly), what replaces them (`ability_augment_fit`, the EV layer: score × draw probability × round weight). Treat any new weights as hypotheses to validate against live 26.12 data, not constants.
4. **Web ↔ overlay parity:** `divergedChampions: 0` as definition of done. Known pre-26.12 drift in `augment-tailoring.ts` (Illaoi, Olaf, Katarina, Nilah) — recheck under 26.12 data; the corpus turnover may change the diverged set.
5. **CLAUDE.md + AGENTS.md rewrite.** Core philosophy: token efficiency, first principles, compounding engineering (every session leaves the repo easier to work on — tags, tests, state automation). Hard cap **≤200 lines each**, target well under. Keep the `<!-- STATE:START/END -->` sentinel + post-commit hook design (`scripts/update-state.sh`, `scripts/state.json`, `scripts/install-hooks.sh`). Cut anything an agent can derive from the repo itself. Verification steps are non-negotiable — token savings that eliminate test signal are false economy.
6. **Repo decision:** evaluate in-place refactor vs. new repo vs. extracting shared scoring/data into a package. Give explicit criteria (value of git history and tags, CI + Vercel wiring, blast radius, migration cost) and a recommendation. A changed algorithm is not by itself a reason for a new repo; recommend one only if the criteria genuinely point there.
7. **Risk register + rollback:** per phase — which tag to cut before starting, how to revert, and what gates "done" (test counts, binary timestamp check after any Rust change; `cargo check` alone is insufficient).
8. **Context budget per session:** name which files each `/goal` needs in context and what stays out. Token efficiency is a deliverable, not a vibe.

## Constraints

- $0 budget. Static JSON + GitHub Actions cron + Vercel architecture stays.
- Overlay working state is sacred: tag before touching it. Current passing suite (~82–85 tests — verify the live count) must not regress.
- Shell commands in the plan must be paste-safe for zsh with `INTERACTIVE_COMMENTS` off — no `#` comment lines inside command blocks.
- Output: the plan only. Do not start implementing.

## Open questions the plan must resolve (probe, don't assume)

- Does CDragon 26.12 expose `[SPELL]` slot bindings per champion? Record the answer and the chosen sourcing path.
- Are System Breaker tags derivable from 26.12 bin data, or is a manual curated list still required?
- Did 26.12 change selection mechanics (rounds at levels 3/7/11/15, 3-slot independent reroll, tier sync, Golden Reroll)? Verify before assuming `GAME_MECHANICS.md` still holds; the OCR trigger logic depends on it.
