/**
 * Augment Set × Champion Synergy Analysis
 *
 * Evaluates how well each champion synergizes with each augment set
 * based on kit analysis, champion identity, and game mechanics.
 */

import type { AbilityProfile, ChampionBaseStats } from "../types";
import { analyzeKit, type KitAnalysis } from "./augment-interactions";

export type AffinityTier = "S+" | "S" | "A";

export interface ChampSetAffinity {
  slug: string;
  name: string;
  icon: string;
  tier: AffinityTier;
  reason: string;
}

export interface SetSynergyResult {
  setName: string;
  description: string;
  topChampions: ChampSetAffinity[];
}

// ─── Hard-coded champion groups ────────────────────────────────────────────

/** Champions with infinite stacking mechanics in their kit */
const INFINITE_STACKERS = new Set([
  "nasus",       // Q stacks
  "veigar",      // passive AP stacks
  "thresh",      // souls
  "senna",       // mist wraith stacks
  "aurelionsol", // stardust
  "kindred",     // marks
  "swain",       // soul fragments
  "chogath",     // R feast stacks
  "sion",        // W passive HP
  "smolder",     // stacks
  "belveth",     // lavender sea
  "mel",         // passive stacks
  "draven",      // League of Draven gold stacks
]);

/** Champions with death passives or death-as-strategy mechanics */
const DEATH_PASSIVE = new Set([
  "karthus", // death defied — casts for 7s after death
  "sion",    // glory in death — zombie mode
  "kogmaw",  // icathian surprise — explodes on death
]);

/** Core enchanter/healer champions */
const ENCHANTERS = new Set([
  "soraka", "sona", "lulu", "janna", "nami", "yuumi", "karma",
  "seraphine", "milio", "lux", "ivern", "taric", "rakan", "renata", "bard",
]);

/** Champions with heal or shield in kit beyond enchanters */
const HAS_HEAL_SHIELD = new Set([
  ...ENCHANTERS,
  "shen", "orianna", "nidalee", "karma", "kayle", "braum", "thresh",
  "morgana", "nilah", "vladimir", "aatrox", "drmundo",
]);

// ─── Set evaluation functions ──────────────────────────────────────────────

interface ChampInput {
  slug: string;
  name: string;
  icon: string;
  tags: string[];
  baseStats: ChampionBaseStats;
  profile: AbilityProfile;
}

type EvalFn = (c: ChampInput, k: KitAnalysis) => { tier: AffinityTier | null; reason: string };

const SET_DEFS: Record<string, { description: string; evaluate: EvalFn }> = {
  "Stackosaurus Rex": {
    description: "Infinite stacking — every fight makes you permanently stronger",
    evaluate: (c) => {
      if (INFINITE_STACKERS.has(c.slug))
        return { tier: "S+", reason: "Infinite stacking champion — stacks compound with augment stacks" };
      if (c.tags.includes("marksman"))
        return { tier: "A", reason: "Scales well with permanent stats from extended fights" };
      return { tier: null, reason: "" };
    },
  },

  "Firecracker": {
    description: "Projectile augments — more missiles, more explosions",
    evaluate: (c, k) => {
      if (c.tags.includes("marksman") && !k.isMelee)
        return { tier: "S+", reason: "Ranged marksman — every auto is a projectile" };
      if (!k.isMelee && k.primaryDamageType === "physical")
        return { tier: "S", reason: "Ranged physical dealer benefits from projectile enhancement" };
      if (!k.isMelee && k.aoeCount >= 2)
        return { tier: "A", reason: "Ranged caster with AoE projectile abilities" };
      return { tier: null, reason: "" };
    },
  },

  "Snowday": {
    description: "Mark/Dash snowball augments — stronger engages, bigger snowballs",
    evaluate: (c, k) => {
      if (k.isMelee && k.hardCCCount >= 2)
        return { tier: "S+", reason: "Melee engager with hard CC — snowball is primary engage tool" };
      if (k.isMelee && c.tags.includes("tank"))
        return { tier: "S", reason: "Melee tank relies on snowball for engagement" };
      if (k.isMelee)
        return { tier: "A", reason: "Melee champion uses snowball frequently" };
      return { tier: null, reason: "" };
    },
  },

  "Wee Woo Wee Woo": {
    description: "Heal & shield power — keep your team alive, win through sustain",
    evaluate: (c) => {
      if (ENCHANTERS.has(c.slug))
        return { tier: "S+", reason: "Dedicated enchanter — healing/shielding is core identity" };
      if (HAS_HEAL_SHIELD.has(c.slug))
        return { tier: "S", reason: "Has healing or shielding in kit" };
      if (c.tags.includes("support"))
        return { tier: "A", reason: "Support with team utility" };
      return { tier: null, reason: "" };
    },
  },

  "Archmage": {
    description: "Mana-scaling augments — bigger mana pool, bigger damage",
    evaluate: (c, k) => {
      if (!k.usesMana) return { tier: null, reason: "" };
      if (k.rotationManaCost >= 300 && k.totalApRatio >= 1.5)
        return { tier: "S+", reason: "Mana-hungry mage with high AP ratios" };
      if (k.rotationManaCost >= 200 && k.primaryDamageType === "magic")
        return { tier: "S", reason: "High mana costs benefit from mana scaling" };
      if (k.primaryDamageType === "magic")
        return { tier: "A", reason: "AP caster gets value from mana scaling" };
      return { tier: null, reason: "" };
    },
  },

  "Fully Automated": {
    description: "Auto-cast augments — abilities fire automatically",
    evaluate: (c, k) => {
      if (k.primaryDamageType === "magic" && k.avgCD <= 6)
        return { tier: "S+", reason: "Short cooldown mage — auto-cast maximizes spell uptime" };
      if (k.primaryDamageType === "magic" && k.aoeCount >= 3)
        return { tier: "S", reason: "AoE mage benefits from auto-cast" };
      if (k.primaryDamageType === "magic" && k.totalApRatio >= 1.5)
        return { tier: "A", reason: "Mage gets value from auto-cast" };
      return { tier: null, reason: "" };
    },
  },

  "Dive Bomb": {
    description: "Death-triggered augments — dying deals damage and disrupts",
    evaluate: (c, k) => {
      if (DEATH_PASSIVE.has(c.slug))
        return { tier: "S+", reason: "Death passive — dying is part of the gameplan" };
      // Squishy burst assassins die fast after going in — death triggers quickly
      if (c.tags.includes("assassin"))
        return { tier: "S", reason: "Burst assassin — dies fast after diving in, death effects trigger reliably" };
      // Squishy melee fighters without tank tag also die quickly
      if (k.isMelee && c.tags.includes("fighter") && !c.tags.includes("tank"))
        return { tier: "A", reason: "Melee fighter — dies in teamfights after engaging" };
      // Tanks take too long to die — death effects trigger too slowly
      if (k.isMelee && c.tags.includes("tank"))
        return { tier: "A", reason: "Tank — takes too long to die, death effects trigger late" };
      return { tier: null, reason: "" };
    },
  },

  "Make it Rain": {
    description: "Gold generation — earn gold faster, hit item power spikes earlier",
    evaluate: (c, k) => {
      if (c.tags.includes("marksman") && k.primaryDamageType === "physical")
        return { tier: "S+", reason: "Item-dependent ADC — gold advantage directly scales DPS" };
      if (k.totalApRatio >= 2.0 || k.totalAdRatio >= 2.0)
        return { tier: "S", reason: "High ratios scale well with item gold" };
      return { tier: null, reason: "" };
    },
  },

  "High Roller": {
    description: "RNG stat augments — random but potentially massive bonuses",
    evaluate: (c, k) => {
      if (k.totalApRatio >= 1.0 && k.totalAdRatio >= 0.5)
        return { tier: "S", reason: "Mixed scaling uses random stats efficiently" };
      return { tier: null, reason: "" };
    },
  },
};

// ─── Main evaluation ───────────────────────────────────────────────────────

export function evaluateAllSetSynergies(
  champions: { slug: string; name: string; icon: string; tags: string[]; baseStats: ChampionBaseStats }[],
  profiles: Record<string, AbilityProfile>,
): SetSynergyResult[] {
  const results: SetSynergyResult[] = [];

  for (const [setName, def] of Object.entries(SET_DEFS)) {
    const affinities: ChampSetAffinity[] = [];

    for (const champ of champions) {
      const profile = profiles[champ.slug];
      if (!profile) continue;

      const kit = analyzeKit(profile, champ.baseStats);
      const input: ChampInput = {
        slug: champ.slug,
        name: champ.name,
        icon: champ.icon,
        tags: champ.tags,
        baseStats: champ.baseStats,
        profile,
      };
      const { tier, reason } = def.evaluate(input, kit);
      if (tier) {
        affinities.push({ slug: champ.slug, name: champ.name, icon: champ.icon, tier, reason });
      }
    }

    // Sort: S+ first, then S, then A; secondary sort by slug for stability
    const order: Record<AffinityTier, number> = { "S+": 0, S: 1, A: 2 };
    affinities.sort((a, b) => {
      const tierDiff = order[a.tier] - order[b.tier];
      return tierDiff !== 0 ? tierDiff : a.slug.localeCompare(b.slug);
    });

    results.push({
      setName,
      description: def.description,
      topChampions: affinities,
    });
  }

  return results;
}

/** Get set descriptions (for client-side display when full eval not needed) */
export function getSetDescription(setName: string): string {
  return SET_DEFS[setName]?.description ?? "";
}
