# ARAM Mayhem — Game Mechanics Reference
# Source: Player-verified corrections (2026-04-02), cross-referenced with gameplay

> This document captures the VERIFIED rules of ARAM Mayhem's augment system.
> Anything marked ⚠️ UNVERIFIED needs official data confirmation before shipping.

---

## 1. Augment Selection Timing

Four selection rounds, triggered by **level thresholds**:

| Round | Level | Death Required? | Notes |
|-------|-------|-----------------|-------|
| 1     | 3     | **No**          | Opens at game start for all players |
| 2     | 7     | **Yes**         | Queued until next death |
| 3     | 11    | **Yes**         | Queued until next death |
| 4     | 15    | **Yes**         | Queued until next death |

**Shop-gate mechanic** (official wiki): Selection screens only appear when
**the shop is enabled** — which means the player is either:
- **Dead** (waiting to respawn), OR
- **At the spawn platform** after respawning or completing a Recall
  (including via the "Cheating" augment which grants Recall)

If the level threshold is met while the shop is disabled (mid-combat),
the selection is queued and presented as soon as the shop re-enables.
If multiple selections queue up (e.g., you hit 11 and 15 before dying),
they are offered **sequentially in order** upon your next shop-enabled state.

This creates **"strategic feeding"** — dying at the right moment to unlock
queued augments before a key teamfight.

---

## 2. Tier Synchronization (全場同步)

**Core rule** (official wiki): "Every player is offered the same tier of
augments in each selection screen; the tier itself is random each time."

- If Round 2 rolls Prismatic for you, every other player also sees Prismatic.
- This is a fairness mechanic — no single player gets a tier advantage.

### Official Tier Constraint

**"The first and second selection screens cannot both offer Silver-tier
augments in a given game."** (wiki source)

This is the only officially documented constraint on tier distribution.
It means:
- Round 1 CAN be any tier (Silver, Gold, or Prismatic)
- IF Round 1 is Silver, Round 2 is guaranteed Gold or Prismatic
- IF Round 1 is Gold/Prismatic, Round 2 has no constraint
- Rounds 3 and 4 have no documented constraints

⚠️ UNVERIFIED: Exact probability weights per round are not published.
Player experience suggests higher-tier rounds become more common in
later selections, but the exact distribution needs crowdsource data.

### Exceptions to Tier Sync

1. **Golden Reroll (Tier-Up)**: Unlocked via Mayhem Progression Track.
   Progression track levels **4, 13, and 31** increase the chances of
   receiving a Golden Reroll. When used, upgrades one slot's tier by
   one level (Silver→Gold, Gold→Prismatic). This is the primary way
   to break tier sync.

2. **Extra Reroll augments**: Certain augments (e.g., from Blitz data)
   grant "one additional reroll per slot on your next Augment selection."
   This means a player could potentially see up to **9 augments** in a
   single round (3 slots × 3 options each).

3. **Qualitative Change Augments (質變增幅)**: Lower-tier augments that
   function as "system breakers." They don't break tier sync, but they
   break the assumption that Silver < Gold < Prismatic in impact.

### Progression Track Interaction

From Riot support: "Once you unlock a new augment [via progression track],
they'll be **guaranteed to appear in your next match** (Silver Augments
excluded) provided they fit the augment draft."

This means newly unlocked augments temporarily have 100% appearance rate,
which significantly affects the probability model for players actively
progressing through the track.

---

## 3. Reroll Mechanism (獨立重骰)

This is the most important mechanic for the Oracle Score algorithm.

### Per-Slot Independent Reroll

Each augment selection round presents **3 augment cards**. Each card has its
own reroll button directly beneath it.

```
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Augment │  │ Augment │  │ Augment │
│    A    │  │    B    │  │    C    │
└─────────┘  └─────────┘  └─────────┘
  [Reroll]     [Reroll]     [Reroll]
```

- Each slot can be rerolled **once** independently
- Rerolling slot A does NOT affect slots B or C
- Per round: **minimum 3, maximum 6** unique augments viewable
- Player selects exactly **1** augment from whatever is currently showing

### Reroll Guarantees

- **Same-tier guarantee**: Rerolled augment is the same tier (Silver→Silver, etc.)
- **No duplicates**: Rerolled result won't match any currently visible card
- **Exception**: Golden Reroll can upgrade the tier (see Tier Sync exceptions)

---

## 4. Smart Tailoring (智慧篩選)

The augment pool is NOT the full list. The system filters based on:

1. **Champion tags**: Role, damage type, resource type
   - No-mana champions won't see mana-related augments
   - Tank champions get weighted toward durability augments
   - Champions with on-hit mechanics (like Urgot W) see more attack augments

2. **Champion abilities**: Specific ability tags (Attack, Ability, On-Hit, etc.)
   - Urgot's W carries [Attack] + [On-Hit] tags → opens Marksmage, Tap Dancer
   - W also counts as [Ability] → opens Phenomenal Evil

3. **⚠️ UNVERIFIED — Item influence**: Gemini claimed buying specific items
   (e.g., Recurve Bow) can shift the tailoring weights. This would be huge
   for strategy but needs verification.

### Effective Pool Size (N_tailored)

The filtered pool size varies dramatically by champion archetype:

| Champion Type          | Approx N_tailored | Targeting Ease |
|------------------------|-------------------|----------------|
| Pure tank (Malphite)   | ~25-30            | Very easy       |
| AD fighter (Sett)      | ~35-40            | Easy            |
| Hybrid (Kayle, Urgot)  | ~50-60            | Medium          |
| Full mage (Brand)      | ~40-50            | Medium          |
| Flexible (Ezreal)      | ~60-80            | Hard            |

⚠️ These are estimates. Actual pool sizes need data mining from arammayhem.com
or game client inspection.

---

## 5. Probability Model

### Formula: Targeting a Specific Augment

Given:
- k = number of augments viewable (3 without rerolls, 6 with all rerolls used)
- N = N_tailored (effective pool size after smart tailoring)

```
P(finding target) = 1 - C(N-1, k) / C(N, k) = k / N
```

Simplified: **P = k / N**

### Practical Examples

| Scenario                    | k  | N   | P(target) |
|-----------------------------|----|-----|-----------|
| No rerolls, wide pool       | 3  | 60  | 5.0%      |
| No rerolls, narrow pool     | 3  | 25  | 12.0%     |
| All rerolls, wide pool      | 6  | 60  | 10.0%     |
| All rerolls, narrow pool    | 6  | 25  | 24.0%     |

### Combo Probability (needing 2 specific augments across 2 rounds)

```
P(combo) = P(piece_1 in round_X) × P(piece_2 in round_Y)
```

Example: Phenomenal Evil (Silver, round 1) + Marksmage (Gold, round 2)
- P₁ = 6/40 = 15%
- P₂ = 6/35 = 17%
- P(combo) = 0.15 × 0.17 = **2.6%**

This is low per game but across 10+ games becomes likely. The Oracle Score
algorithm should weight combo synergies accordingly.

---

## 6. Qualitative Change Augments (質變增幅)

These are augments that **rewrite champion mechanics** regardless of their tier
color. They exist across all tiers and are the true "S-tier" picks.

### Known System Breakers

| Augment             | Tier      | Tags            | Qualitative Change |
|---------------------|-----------|-----------------|-------------------|
| Marksmage           | Gold      | Attack, Ability | AP→AA damage conversion |
| Jeweled Gauntlet    | Prismatic | Ability, Crit   | Skills can crit |
| Vulnerability       | Silver    | Attack, Crit    | On-hit & DoT can crit |
| Tap Dancer          | Prismatic | Attack, Move    | Attack speed → move speed |
| Mystic Punch        | Prismatic | Attack, Haste   | AAs reduce ability CD |
| Earthwake           | Prismatic | Movement, Dmg   | Dashes deal AoE damage |
| Draw Your Sword     | ?         | Attack          | Ranged→Melee conversion |
| Master of Duality   | ?         | Attack, Ability | AA↔Ability cross-stacking |
| Slow and Steady     | ?         | Attack          | Bonus AS → AD conversion |

### Impact on Oracle Score

The scoring algorithm should have a **qualitative multiplier** for these:
- If a champion can access a system breaker (via tag matching), that
  champion's ceiling is dramatically higher
- The Oracle Score should factor in: "what's the best thing that COULD happen"
  not just "what's the average outcome"

---

## 7. Mayhem-Specific Mechanics (vs Arena)

| Feature              | Arena (2v2v2v2)     | Mayhem (5v5 ARAM)       |
|----------------------|---------------------|-------------------------|
| Map                  | Small circular arenas | Howling Abyss / Butcher's Bridge / Koeshin's Crossing |
| Team size            | 2                   | 5                       |
| Win condition        | HP elimination       | Destroy Nexus           |
| Augment sets         | No                  | Removed in 26.12 (historical: 9 named sets) |
| Augment selection    | Between rounds       | On shop-enable (dead or at spawn) |
| Runes                | Enabled             | **Disabled** (some keystones via augments) |
| Summoner spells      | Selectable          | Flash mandatory, Exhaust disabled |
| Tier sync            | Per round            | Per round (all 10 players) |
| Reroll style         | Different            | 3-slot independent reroll |
| 5th augment slot     | N/A                 | **Yes** (via select special augments) |

### Historical (pre-26.12): Augment Sets (9 Named Sets, Patch 26.3–26.11)

**Removed in 26.12** — Riot removed the Trait/Set system entirely ("homogenized
builds"). Former set effects return as standalone augments. Set labels survive
in the data as historical metadata only and must never affect scores.

Official sets with escalating bonuses at 2-4 augments collected:

| Set Name          | Theme / Effect                                              |
|-------------------|-------------------------------------------------------------|
| Dive              | Death and True Damage synergy                               |
| Firecracker       | Missiles bounce extra times to nearby enemies               |
| Factory           | Reduce costs, grow the Mayhem factory                       |
| Stackosaurus Rex  | Stack-based growth mechanics                                |
| Archmage          | Cast a spell → refund a random spell's cooldown             |
| Snowday           | Snowball (Mark/Dash) ability haste and damage               |
| Gold Rush         | Gold generation and gold-based bonuses                      |
| Autocast          | Autocast cooldown scaling with ability haste                |
| Wee Woo Wee Woo   | Support/frontline bonuses for allies below 50% HP           |

Set bonus tiers scaled at 2, 3, and 4 augments from the same set (historical).

**Bread Sandwich (historical, pre-26.12)**: acquiring all three "Bread"
augments (Bread and Butter, Bread and Cheese, Bread and Jam) granted a hidden
"Bread Sandwich" buff: **250 ultimate haste** and **50 ability haste on each
basic ability**. Re-verify against live 26.12 before citing.

### Hidden Combos (Official Wiki)

**Burn Stacking**: When a Burn stack is inflicted, all different Burn sources
stack the first source's effect and credit damage to the first source's owner.
(e.g., Tormentor inflicted first will be stacked by Slow Cooker)

### Transmuted Augments

Certain augments exist in "transmuted" form (e.g., "Transmuted: Jeweled
Gauntlet"). These are modified versions that may behave differently from
the original. Transmuted augments state this in their title.

### Special Items (Mayhem-Exclusive)

| Item                     | Notes                                    |
|--------------------------|------------------------------------------|
| Atma's Reckoning         | 10 ability haste                         |
| The Golden Spatula       | From Quest: Urf's Champion augment       |
| Jarvan I's               | Mayhem exclusive                         |
| Rite of Ruin             | Mayhem exclusive                         |
| Stormrazor               | Mayhem version                           |
| Sword of Blossoming Dawn | Upgraded via set bonus                   |

### Game Balance Overrides

- Attack speed cap: **5.0** (higher than normal)
- Every 1% crit chance over 100% grants **0.45 bonus AD or 0.75 AP** (adaptive)
- Anti-CC mechanic: 5+ seconds of CC in last 7 seconds → full cleanse + 3s immunity
- Nexus HP: 3000 (reduced from 5500 in 26.5)
- Nexus Tower HP: 3000 (increased from 1800 in 26.5)

---

## 8. Patch 26.12 — Structural Changes (live since 2026-06-09)

- **Traits / Augment Sets removed.** No active set bonuses; named set
  progression is gone. Historical set labels remain in scraped data.
- **New augment classes:** Ability Augments (significantly enhance one ability;
  the player chooses which; Riot pool-gates them: "You'll only ever receive
  Ability Augments that are usable for your champion") and Quest Augments
  (repeatable objective → reward). Corpus turnover: 40 removed, 59 added (live
  badge counts; official notes said 41/57).
- **Selection mechanics unchanged:** official notes are silent on rounds /
  slots / rerolls / tier sync / Golden Reroll — rounds at levels 3/7/11/15,
  3 slots, 1 independent reroll per slot presumed intact. See "26.12 Live
  Verification Gate" below for the pending in-game confirmation checklist.

---

## 9. Urgot W Interactions (Verified)

Included as reference since this was the test case in the Gemini session.

### W — Purge Mechanics
- Locks attack speed at **3.0** (fixed, ignores bonus AS)
- **Cannot crit** (fundamental limitation)
- Triggers on-hit effects at **50% effectiveness**
- Grants ghosting through minions/non-epic monsters
- After level 9: toggleable (no cooldown)

### Key Augment Synergies (Player-Verified)
- **Tap Dancer**: 3.0 fixed AS → extreme movement speed
- **Jeweled Gauntlet**: Bypasses "W can't crit" limitation
- **Marksmage**: AP stacking via Phenomenal Evil → W bullet damage
- **Slow and Steady**: Converts wasted AS bonuses into AD
- **Master of Duality**: W toggle exploit → infinite AD stacking
- **Vulnerability**: On-hit effects can now crit

### Advanced Tech: 3W+1A Toggle
After W is maxed (lv9+), cycle: W fires 3 shots → cancel W → 1 normal auto
attack (CAN crit, benefits from AS items) → re-activate W. High skill ceiling.

---

## Data Collection TODO

- [ ] Scrape complete augment list with tier + tags from arammayhem.com
- [ ] Build champion→tag mapping from CommunityDragon data
- [ ] Crowdsource or data-mine actual tier probability distribution per round
- [ ] Verify "item influence on smart tailoring" claim
- [ ] Map all augment set memberships
- [ ] Calculate N_tailored per champion archetype from actual pool data

---

## 26.12 Live Verification Gate (Session 12 — pending first live game)

OCR benchmark re-run 2026-06-12 under regenerated 26.12 data: 100% (16/16
labeled crops, avg 221 ms). The corpus contains only pre-26.12 card names —
no newly added augment crop exists yet, because corpus crops come from real
selection-screen screenshots. Hold the phase-2 tag until both gates pass:

1. Corpus refresh: screenshot selection rounds showing NEW 26.12 augments
   (ideally an Ability and a Quest augment), label them in
   `overlay/corpus/ground_truth.json`, run `scripts/build_ocr_corpus.py`,
   then `scripts/benchmark_ocr.py` — recognition must stay >= the pre-26.12
   rate (100%).
2. Live checklist (one game, overlay running):
   - [ ] Rounds trigger at levels 3 / 7 / 11 / 15
   - [ ] 3 cards per round; 1 independent reroll per slot
   - [ ] Tier sync holds across players
   - [ ] NEW chip + EV annotation render on badges (no set paths)
   - [ ] A NEW 26.12 augment name OCR-matches with the correct badge
   - [ ] Ability Augment pick flow: note whether the player chooses the
         ability in-game (record for fit-model refinement)

Any drift in rounds/slots/rerolls/tier-sync means CARD_NAME_REGIONS in
`overlay/src-tauri/src/lib.rs` may need a Rust rebuild — tag first, release
build, and verify the binary timestamp (`cargo check` alone is insufficient).
