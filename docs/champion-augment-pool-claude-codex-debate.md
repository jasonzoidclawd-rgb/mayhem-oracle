# Champion-Specific Augment Pool: Claude + Codex Debate

Date: 2026-05-07

## Why this file exists

The Claude CLI debate was a separate one-shot process. It does not share memory
with a later Claude chat/session. Use this file as the durable handoff artifact
for the champion-specific augment pool discussion.

## Debate Prompt Summary

Codex asked Claude to review this claim:

> The champion-specific augment pool is currently only partially real because
> `public/data/champions.json` and `public/data/augments.json` have no
> `kit_tags`, so `src/lib/scoring/pool-orchestrator.ts` Layer 3 tag intersection
> is inert.

Claude was asked to inspect:

- `src/lib/scoring/pool-orchestrator.ts`
- `src/lib/scoring/augment-tailoring.ts`
- `scripts/classify_champions.py`
- `scripts/classify_augments.py`
- `src/lib/__tests__/data-integrity.test.ts`

## Shared Conclusion

Claude agreed with the core claim.

Confirmed measurements:

- `public/data/champions.json`: `0/172` champions have `kit_tags`.
- `public/data/augments.json`: `0/195` augments have `kit_tags`.
- `getChampionAugmentPool` Layer 3 reads `aug.kit_tags ?? []`; because every
  augment has an empty tag list, every augment behaves as universal at that layer.
- `src/lib/__tests__/data-integrity.test.ts` does not assert tag coverage.

## Important Nuance

Claude corrected the wording:

- The pool is not completely unfiltered.
- Layer 2 still performs champion-specific hard gates via `isInAugmentPool`:
  resource, melee/ranged, CC-required, dash-required, spin-required,
  heal/shield-required, pure-mage, and pure-AD heuristics.
- More precise wording: the pool is partially champion-specific, but Smart
  Tailoring tag intersection is currently dead.

## Hidden Logic Flaw Claude Found

`mana` / `manaless` tag asymmetry is dangerous.

- `scripts/classify_augments.py` can assign `mana` and `manaless` to augments.
- `scripts/classify_champions.py` intentionally does not assign `mana` or
  `manaless` to champions because resource gating is handled in Layer 2.
- If an augment is tagged only `["mana"]`, Layer 3 will exclude it from every
  champion because no champion has the matching `mana` tag.

This should be fixed before committing classified augment output.

## Highest-Leverage Fix Plan

1. Fix `mana` / `manaless` tag asymmetry.
   - Preferred: remove resource tags from Layer 3 matching, or normalize them
     out before tag intersection.
   - Keep resource eligibility in `isInAugmentPool`.

2. Populate and commit `kit_tags`.
   - `scripts/classify_champions.py --dry-run` currently reports deterministic
     coverage for `172/172` champions.
   - `scripts/classify_augments.py` needs classifier output for augment tags.

3. Add data-integrity tests.
   - Assert champion tag coverage is nonzero and above an agreed threshold.
   - Assert augment tag coverage is nonzero and above an agreed threshold.
   - Add known examples such as Brand and Jeweled Gauntlet.

4. Add pool behavior tests.
   - Brand keeps spell/dot augments and excludes pure auto-attack bait.
   - Yasuo keeps crit/on-hit/melee augments.
   - Manaless champions exclude mana-required augments.
   - Owned augments trigger `mutually_exclusive` exclusions once that context is wired.

5. Keep the champion page diagnostic section, but treat it as a display of the
   current model, not proof that Smart Tailoring is correct.

## Debate Verdict

Do not spend the next pass polishing the champion page UI. The next real fix is
data and scoring logic:

- make tag data real,
- prevent resource tags from breaking Layer 3,
- add tests so tag coverage cannot silently disappear again.
