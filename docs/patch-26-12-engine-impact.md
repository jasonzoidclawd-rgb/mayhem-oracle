# Patch 26.12 ARAM Mayhem engine impact study

Date: 2026-05-30
Status: pre-live/PBE preview; revisit when Riot publishes full 26.12 patch notes and live telemetry appears.

## Sources checked

- Riot dev blog, “/dev: Augmentmaxxing ARAM: Mayhem”, 2026-05-28:
  https://www.leagueoflegends.com/en-us/news/dev/dev-augmentmaxxing-aram-mayhem/
- Riot TL;DW “Mayhem, Ranked 5s & More Dev Update”, 2026-05-27:
  https://www.leagueoflegends.com/en-us/news/dev/tldw-mayhem-ranked-5s-more-dev-update/
- arammayhem.com 26.12 PBE preview augment pages:
  https://arammayhem.com/augments/
  https://arammayhem.com/augments/chain-reaction/
  https://arammayhem.com/augments/echo-cast/
  https://arammayhem.com/augments/multishot/
  https://arammayhem.com/augments/spell-split/
  https://arammayhem.com/augments/tripleshot/
  https://arammayhem.com/augments/poro-stampede/
  https://arammayhem.com/augments/hellbent/
  https://arammayhem.com/augments/support-main/
  https://arammayhem.com/augments/tooth-fairy/
  https://arammayhem.com/augments/endless-decimation/
  https://arammayhem.com/augments/from-downtown/
  https://arammayhem.com/augments/pressure-cooker/
  https://arammayhem.com/augments/shark-tempest/

## What is changing in 26.12

1. Trait system is being phased out.
   Riot explicitly says Patch 26.12 removes the Trait system to make room for new systems. Some popular Traits survive as standalone Augments instead of multi-augment trait bonuses.

2. Standalone augment value matters more than trait completion.
   Riot’s stated problem with Traits: they homogenized builds/games, outshined champions, and made individual augment picks feel underwhelming because too much power was locked behind trait effects.

3. New Ability Augments are being introduced.
   These significantly enhance one chosen champion ability. Examples currently visible in PBE preview data:
   - Multishot: quest on chosen ability hits; reward fires more missiles by quest level.
   - Tripleshot: chosen ability targets two additional enemies in front of you.
   - Echo Cast: casting chosen ability sends a clone toward cursor and recasts it.
   - Spell Split: chosen ability missile splits on hit, at max range, or on recast.
   - Chain Reaction: chosen knockback can collide with champions/terrain for knockup and damage.

4. New Quest Augments are being expanded.
   Examples currently visible in PBE preview data:
   - Tooth Fairy: burst enemies to drop Teeth; Teeth give permanent Lethality and Magic Penetration.
   - Support Main: heal allies to complete quest; rewards heal-over-time on heals.
   - Poro Stampede: gather Poro Snax/feed Poros; rewards Poro Charge waves by quest level.
   - From Downtown: snipe enemy champions with abilities; rewards meteor damage.
   - Pressure Cooker: nearby max-HP-scaling burn; quest increases size/damage.

5. Some new augments are non-quest standalone combat pattern augments.
   Examples:
   - Hellbent: attacks/abilities grant stacks; at max stacks, revive empowered on death.
   - Endless Decimation: autocasts circular axe in combat, with outer-edge bonus damage/heal.
   - Shark Tempest: Snowball gains shark storm slow/damage/trap behavior.

## Impact on current Mayhem Oracle engine

### Highest risk: scoring still rewards trait/set completion

Current scoring still contains trait-era assumptions:
- overlay/src/scoring/oracle-score.ts uses setTierBonus, sameSetSynergy, augmentSetId, pickedSetIds, and set/wikiSet metadata.
- src/lib/data/augment-set.ts normalizes augment set membership.
- The Augments UI still exposes set-centric views such as “Augment Sets”.

26.12 removes the game system that justified same-set synergy. If 26.12 data still contains stale set/wikiSet fields from scraping, Oracle could over-score old trait clusters and incorrectly recommend completing nonexistent trait bonuses.

Required change:
- Add a patch-aware mechanic mode.
- For patch >= 26.12, disable sameSetSynergy and do not treat set/wikiSet as a scoring bonus unless the augment has a verified standalone combo/synergy rule.
- Keep set labels only as historical/catalog metadata, not live scoring input.

### High risk: new augments have 0%/missing live telemetry

arammayhem.com marks new 26.12 augments as PBE preview with live win/pick rates unavailable. Current scoring uses augment.win_rate as base and falls back to 50 only when win_rate is null/non-finite. If scraped PBE previews come in as 0, new augments will sort as trash even when they are likely build-defining.

Required change:
- Treat lifecycle=preview/new and win_rate=0 as “unknown telemetry”, not real 0% win rate.
- Use neutral base 50 plus heuristic bonuses until live sample thresholds are met.
- Surface a “PBE preview / no live data” badge in catalog and advisor.

### High risk: Ability Augments need ability-level champion metadata

Current champion profiles model high-level damageType, attackType, playstyle, and ability descriptions. Ability Augments need per-ability properties:
- chosen ability slot eligibility
- missile/projectile vs targeted vs area vs self-cast
- knockback/knockup presence
- range/line skillshot behavior
- recast behavior
- multi-hit and clone interactions

Examples:
- Chain Reaction should heavily favor champions whose chosen ability knocks back and can collide with terrain/enemies.
- Spell Split should favor missile/projectile spells and be poor for non-missile casts.
- Echo Cast should favor high-impact spells that can be profitably duplicated from cursor direction.
- Multishot/Tripleshot should favor abilities with reliable hits and strong on-hit spell payloads.

Required change:
- Extend AbilityProfile abilities with structured flags such as projectile, targeted, aoe, knockback, knockup, pull, recast, heal, shield, snare/root, displacement, shortCooldown, longRange.
- Add abilityAugmentEligibility and abilityAugmentSynergy scoring separate from generic AP/AD/CC matching.

### Medium risk: Quest Augments need objective/reward taxonomy

The current engine mainly detects broad stat/playstyle preferences from descriptions. 26.12 Quest Augments are more objective-driven:
- burst threshold and pickup reward (Tooth Fairy)
- heal/shield volume (Support Main)
- long-range ability hits (From Downtown)
- nearby uptime/tank burn (Pressure Cooker)
- Poro/Snowball-specific gameplay hooks (Poro Stampede, Shark Tempest)

Required change:
- Add questObjective metadata: burstDamage, healingDone, snipes, nearbyBurnUptime, poroSnax, snowballHit, abilityHits.
- Add questReward metadata: permanentPen, healOverTime, meteorDamage, sizeScaling, summonerSpell, revive, autocastDamage.
- Score quest feasibility from champion kit and likely role, not just global win rate.

### Medium risk: UI copy/navigation should de-emphasize traits

Any page copy that implies current live “sets/traits” as a core recommendation mechanic becomes stale for 26.12. The catalog can still keep historical grouping, but advisor/tier recommendations should speak in terms of standalone augments, ability augments, quest augments, and verified combos.

Required change:
- Rename live-facing “Augment Sets” language for patch >= 26.12 to “Synergy Groups” or hide the tab when no active trait system exists.
- Add filters/badges for Ability Augment, Quest Augment, Preview, Standalone, and Retired Trait.

## Proposed implementation plan

1. Data model
   - Add fields to augment records:
     lifecycle: live | preview | removed | retired
     mechanics: ability_augment | quest | standalone | retired_trait
     questObjective?: string
     questReward?: string
     abilityHooks?: string[]
   - Add patchIntroduced and patchRemoved when known.

2. Scoring
   - Patch-aware mode switch: traits disabled for >= 26.12.
   - Unknown preview telemetry fallback: 0% + preview => base 50, not base 0.
   - Add ability-hook scoring layer using structured ability flags.
   - Add quest-feasibility scoring layer.

3. Data ingestion
   - Scraper should preserve PBE preview status from arammayhem.com pages.
   - Do not ingest PBE “0%” as a real win rate.
   - Backfill 26.12 preview augments with mechanic tags from known tooltip patterns.

4. UI
   - Patch notes page should show 26.12 as Preview until official release.
   - Augment cards should show Preview/New + Ability/Quest badges.
   - Advisor breakdown should explain “chosen ability synergy” and “quest feasibility” when those bonuses apply.

5. Tests
   - Regression test that patch >= 26.12 disables same-set synergy.
   - Regression test that preview win_rate=0 uses neutral unknown telemetry base.
   - Interaction tests for Chain Reaction/Spell Split/Support Main/Tooth Fairy archetypes.

## Immediate follow-up tickets

- Implement patch-aware scoring switch for set/trait bonuses.
- Add lifecycle-aware telemetry fallback for new preview augments.
- Extend AbilityProfile with ability flags and wire Chain Reaction / Multishot / Spell Split / Echo Cast / Tripleshot scoring.
- Add Quest Augment taxonomy and score Tooth Fairy / Support Main / From Downtown / Pressure Cooker / Poro Stampede feasibility.
- Update Augments UI copy for 26.12 so “sets” do not look like live trait mechanics.
