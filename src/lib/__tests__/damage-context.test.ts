import { describe, expect, test } from "vitest";
import { parseAugmentStatDelta, computeAugmentDamageContext, computeChampionBaseline } from "../scoring/damage-context";
import type { ChampionBaseStats, AbilityProfile } from "../types";

const baseStats: ChampionBaseStats = {
  baseHP: 570, hpGrowth: 105,
  baseArmor: 27, armorGrowth: 4.2,
  baseMR: 30, mrGrowth: 1.3,
  baseAD: 57, adGrowth: 3,
  baseAS: 0.681, asGrowth: 2,
  attackRange: 550, moveSpeed: 340,
  baseMP: 469, mpGrowth: 21,
  baseHPRegen: 5.5, hpRegenGrowth: 0.55,
};

const physicalProfile: AbilityProfile = {
  damageType: "physical",
  attackType: "ranged",
  playstyle: { damage: 4, durability: 2, crowdControl: 1, mobility: 2, utility: 1 },
  abilities: [],
};

const magicProfile: AbilityProfile = {
  damageType: "magic",
  attackType: "ranged",
  playstyle: { damage: 4, durability: 1, crowdControl: 2, mobility: 1, utility: 2 },
  abilities: [],
};

describe("parseAugmentStatDelta", () => {
  test("returns empty object for non-stat description", () => {
    expect(parseAugmentStatDelta("")).toEqual({});
    expect(parseAugmentStatDelta("Jackpot! Gain 500 gold.")).toEqual({});
    expect(parseAugmentStatDelta("Lucky Gloves effect granted.")).toEqual({});
  });

  test("parses attack speed", () => {
    const result = parseAugmentStatDelta("Gain 20% attack speed.");
    expect(result.attackSpeed).toBeCloseTo(0.20);
  });

  test("parses high attack speed without capping", () => {
    const result = parseAugmentStatDelta("Gain 80% attack speed.");
    expect(result.attackSpeed).toBeCloseTo(0.80);
  });

  test("parses flat AD", () => {
    const result = parseAugmentStatDelta("Gain +20 Attack Damage.");
    expect(result.attackDamage).toBe(20);
  });

  test("parses crit chance", () => {
    const result = parseAugmentStatDelta("Gain 15% critical strike chance.");
    expect(result.critChance).toBeCloseTo(0.15);
  });

  test("parses crit damage", () => {
    const result = parseAugmentStatDelta("Gain 20% critical strike damage.");
    expect(result.critDamage).toBeCloseTo(0.20);
  });

  test("parses lethality", () => {
    const result = parseAugmentStatDelta("Gain 10 lethality.");
    expect(result.lethality).toBe(10);
  });

  test("parses armor penetration %", () => {
    const result = parseAugmentStatDelta("Gain 15% armor penetration.");
    expect(result.armorPenPct).toBeCloseTo(0.15);
  });

  test("parses multiple stats in one description", () => {
    const result = parseAugmentStatDelta("Gain +15 Attack Damage and 10% attack speed.");
    expect(result.attackDamage).toBe(15);
    expect(result.attackSpeed).toBeCloseTo(0.10);
  });

  test("does not parse champion-specific attack speed clause", () => {
    const result = parseAugmentStatDelta(
      "Abilities with dashes or blinks gain 175 ability haste . On Kalista , this augment instead grants her 125% bonus attack speed .",
    );
    expect(result.attackSpeed).toBeUndefined();
  });

  test("does not parse bonus-critical-damage formula as crit damage grant", () => {
    const result = parseAugmentStatDelta(
      "Your abilities can now critically strike for (145% + bonus critical damage ) damage. Additionally, gain 25% (+ 4. 5 % per 100 AP) critical strike chance .",
    );
    expect(result.critDamage).toBeUndefined();
  });

  test("does not parse spaced decimal fragment as crit chance", () => {
    const result = parseAugmentStatDelta(
      "Your abilities can now critically strike for (145% + bonus critical damage ) damage. Additionally, gain 25% (+ 4. 5 % per 100 AP) critical strike chance .",
    );
    expect(result.critChance).toBeUndefined();
  });

  test("still parses valid crit damage grant", () => {
    const result = parseAugmentStatDelta("Gain 20% critical strike damage.");
    expect(result.critDamage).toBeCloseTo(0.20);
  });
});

describe("computeChampionBaseline", () => {
  test("returns positive dps for a physical champion", () => {
    const baseline = computeChampionBaseline(baseStats, physicalProfile);
    expect(baseline.dps).toBeGreaterThan(0);
    expect(baseline.totalAD).toBeGreaterThan(0);
    expect(baseline.attackSpeed).toBeGreaterThan(0);
    expect(baseline.damageType).toBe("physical");
  });

  test("damageType reflects abilityProfile", () => {
    const baseline = computeChampionBaseline(baseStats, magicProfile);
    expect(baseline.damageType).toBe("magic");
  });
});

describe("computeAugmentDamageContext", () => {
  test("hasParsableStats is false for non-stat augment", () => {
    const ctx = computeAugmentDamageContext("Jackpot! Gain 500 gold.", baseStats, physicalProfile);
    expect(ctx.hasParsableStats).toBe(false);
    expect(ctx.dpsDeltaPct).toBe(0);
    expect(ctx.augmentedDps).toBe(ctx.baselineDps);
  });

  test("AD augment increases dps for physical champion", () => {
    const ctx = computeAugmentDamageContext("Gain +20 Attack Damage.", baseStats, physicalProfile);
    expect(ctx.hasParsableStats).toBe(true);
    expect(ctx.augmentedDps).toBeGreaterThan(ctx.baselineDps);
    expect(ctx.dpsDeltaPct).toBeGreaterThan(0);
  });

  test("attack speed augment increases dps", () => {
    const ctx = computeAugmentDamageContext("Gain 25% attack speed.", baseStats, physicalProfile);
    expect(ctx.hasParsableStats).toBe(true);
    expect(ctx.augmentedDps).toBeGreaterThan(ctx.baselineDps);
  });

  test("damageType passes through from abilityProfile", () => {
    const ctx = computeAugmentDamageContext("Gain +20 Attack Damage.", baseStats, magicProfile);
    expect(ctx.damageType).toBe("magic");
  });

  test("parsedStats contains the parsed fields", () => {
    const ctx = computeAugmentDamageContext("Gain +15 Attack Damage.", baseStats, physicalProfile);
    expect(ctx.parsedStats.attackDamage).toBe(15);
  });
});
