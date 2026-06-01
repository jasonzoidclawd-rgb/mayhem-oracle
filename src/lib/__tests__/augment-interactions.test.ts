import { describe, expect, test } from "vitest";
import { analyzeInteractions, detectAugmentMechanics } from "../scoring/augment-interactions";
import type { AbilityProfile, ChampionBaseStats } from "../types";

const baseStats: ChampionBaseStats = {
  baseHP: 600,
  hpGrowth: 100,
  baseArmor: 30,
  armorGrowth: 4,
  baseMR: 30,
  mrGrowth: 1.3,
  baseAD: 60,
  adGrowth: 3,
  baseAS: 0.65,
  asGrowth: 3,
  attackRange: 550,
  moveSpeed: 335,
  baseMP: 400,
  mpGrowth: 50,
  baseHPRegen: 6,
  hpRegenGrowth: 0.6,
};

const casterProfile: AbilityProfile = {
  damageType: "magic",
  attackType: "ranged",
  playstyle: { damage: 5, durability: 1, crowdControl: 3, mobility: 2, utility: 2 },
  abilities: [
    { key: "Q", name: "Spark", icon: "q.png", description: "Fires a spell.", stats: { apRatio: 0.8, cooldown: [4], manaCost: [60], damageType: "magic" } },
    { key: "W", name: "Field", icon: "w.png", description: "Burns enemies over time.", stats: { apRatio: 0.7, cooldown: [8], manaCost: [70], damageType: "magic", isDot: true, isAoe: true } },
    { key: "E", name: "Root", icon: "e.png", description: "Roots an enemy.", stats: { apRatio: 0.5, cooldown: [10], manaCost: [80], damageType: "magic", ccType: "root" } },
    { key: "R", name: "Nova", icon: "r.png", description: "Large explosion.", stats: { apRatio: 1.0, cooldown: [80], manaCost: [100], damageType: "magic", baseDamage: [150, 250, 350] } },
  ],
};

const physicalProfile: AbilityProfile = {
  damageType: "physical",
  attackType: "ranged",
  playstyle: { damage: 4, durability: 2, crowdControl: 1, mobility: 2, utility: 1 },
  abilities: [
    { key: "Q", name: "Shot", icon: "q.png", description: "Empowers attacks.", stats: { totalAdRatio: 1.1, cooldown: [12], manaCost: [50], damageType: "physical", isOnHit: true } },
    { key: "W", name: "Volley", icon: "w.png", description: "Fires arrows.", stats: { totalAdRatio: 0.8, cooldown: [14], manaCost: [60], damageType: "physical" } },
    { key: "E", name: "Scout", icon: "e.png", description: "Utility spell.", stats: { cooldown: [18], manaCost: [40] } },
    { key: "R", name: "Arrow", icon: "r.png", description: "Stuns from long range.", stats: { totalAdRatio: 0.3, cooldown: [80], manaCost: [100], damageType: "physical", ccType: "stun", baseDamage: [200, 350, 500] } },
  ],
};

describe("detectAugmentMechanics", () => {
  test("detects dash mechanics without treating snowball text as a champion dash", () => {
    expect(detectAugmentMechanics("After you dash, deal bonus damage.")).toContain("DASH_SYNERGY");
    expect(detectAugmentMechanics("Your snowball deals bonus damage.")).not.toContain("DASH_SYNERGY");
  });
});

describe("analyzeInteractions", () => {
  test("keeps the stronger trap when an augment has both synergy and trap signals", () => {
    const interactions = analyzeInteractions(
      { slug: "caster", name: "Caster", baseStats, abilityProfile: casterProfile },
      [
        {
          slug: "bad-hybrid",
          name: "Bad Hybrid",
          description: "Gain attack speed and life steal. Your abilities can critically strike.",
        },
      ],
    );

    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      augmentSlug: "bad-hybrid",
      type: "synergy",
      mechanic: "ABILITY_CRIT",
      strength: 3,
    });
  });

  test("flags attack-speed augments as traps for pure casters and synergies for physical attackers", () => {
    const augment = { slug: "speed", name: "Speed", description: "Gain attack speed." };

    const casterSignals = analyzeInteractions(
      { slug: "caster", name: "Caster", baseStats, abilityProfile: casterProfile },
      [augment],
    );
    const physicalSignals = analyzeInteractions(
      { slug: "marksman", name: "Marksman", baseStats, abilityProfile: physicalProfile },
      [augment],
    );

    expect(casterSignals[0]).toMatchObject({ type: "trap", mechanic: "ATTACK_SPEED" });
    expect(physicalSignals[0]).toMatchObject({ type: "synergy", mechanic: "ATTACK_SPEED" });
  });
});
