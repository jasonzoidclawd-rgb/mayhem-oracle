import { describe, expect, test } from "vitest";
import { evaluateAllSetSynergies, getSetDescription } from "../scoring/set-synergy";
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

const marksmanProfile: AbilityProfile = {
  damageType: "physical",
  attackType: "ranged",
  playstyle: { damage: 4, durability: 2, crowdControl: 1, mobility: 2, utility: 1 },
  abilities: [
    { key: "Q", name: "Shot", icon: "q.png", description: "Fires a projectile.", stats: { totalAdRatio: 1.0, cooldown: [8], manaCost: [50], damageType: "physical" } },
    { key: "W", name: "Volley", icon: "w.png", description: "Fires more projectiles.", stats: { totalAdRatio: 0.8, cooldown: [10], manaCost: [60], damageType: "physical" } },
    { key: "E", name: "Step", icon: "e.png", description: "Moves quickly.", stats: { cooldown: [14], manaCost: [40] } },
    { key: "R", name: "Barrage", icon: "r.png", description: "Fires a final projectile.", stats: { totalAdRatio: 1.2, cooldown: [80], manaCost: [100], damageType: "physical" } },
  ],
};

const mageProfile: AbilityProfile = {
  damageType: "magic",
  attackType: "ranged",
  playstyle: { damage: 5, durability: 1, crowdControl: 2, mobility: 1, utility: 2 },
  abilities: [
    { key: "Q", name: "Bolt", icon: "q.png", description: "Magic bolt.", stats: { apRatio: 0.8, cooldown: [5], manaCost: [90], damageType: "magic", isAoe: true } },
    { key: "W", name: "Zone", icon: "w.png", description: "Magic zone.", stats: { apRatio: 0.8, cooldown: [6], manaCost: [100], damageType: "magic", isAoe: true } },
    { key: "E", name: "Burst", icon: "e.png", description: "Magic burst.", stats: { apRatio: 0.7, cooldown: [7], manaCost: [110], damageType: "magic", isAoe: true } },
    { key: "R", name: "Nova", icon: "r.png", description: "Magic nova.", stats: { apRatio: 1.0, cooldown: [80], manaCost: [120], damageType: "magic" } },
  ],
};

describe("evaluateAllSetSynergies", () => {
  test("sorts set affinities by tier and then slug", () => {
    const results = evaluateAllSetSynergies(
      [
        { slug: "jinx", name: "Jinx", icon: "jinx.png", tags: ["marksman"], baseStats },
        { slug: "veigar", name: "Veigar", icon: "veigar.png", tags: ["mage"], baseStats },
        { slug: "lux", name: "Lux", icon: "lux.png", tags: ["mage", "support"], baseStats },
      ],
      {
        jinx: marksmanProfile,
        veigar: mageProfile,
        lux: mageProfile,
      },
    );

    const stackosaurus = results.find((r) => r.setName === "Stackosaurus Rex");
    expect(stackosaurus?.topChampions.map((c) => `${c.slug}:${c.tier}`)).toEqual([
      "veigar:S+",
      "jinx:A",
    ]);
  });

  test("skips champions without ability profiles and returns descriptions for known sets", () => {
    const results = evaluateAllSetSynergies(
      [
        { slug: "jinx", name: "Jinx", icon: "jinx.png", tags: ["marksman"], baseStats },
        { slug: "missing", name: "Missing", icon: "missing.png", tags: ["marksman"], baseStats },
      ],
      { jinx: marksmanProfile },
    );

    const firecracker = results.find((r) => r.setName === "Firecracker");
    expect(firecracker?.topChampions.map((c) => c.slug)).toEqual(["jinx"]);
    expect(getSetDescription("Firecracker")).toContain("Projectile");
    expect(getSetDescription("Unknown Set")).toBe("");
  });
});
