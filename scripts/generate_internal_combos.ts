/**
 * Generate current champion×augment combo tiers from internal data.
 *
 * The scraped arammayhem combo table can lag hotfixes and still reference
 * removed augments. This runs after pool-rules generation, so every combo is
 * derived from the current internal champion pool and structured ability data.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { abilityAugmentFit } from "../src/lib/scoring/ability-augment-fit";
import { analyzeInteractions, type MechanicalInteraction } from "../src/lib/scoring/augment-interactions";
import { getChampionAugmentPool } from "../src/lib/scoring/pool-orchestrator";
import type { AbilityProfile, ChampionBaseStats, ChampionTag, PoolRules } from "../src/lib/types";

const DATA_DIR = resolve(__dirname, "..", process.env.MAYHEM_DATA_DIR ?? "data/internal");

type ComboTier = "S" | "A" | "B" | "C";

type Champion = {
  slug: string;
  name: string;
  baseStats?: ChampionBaseStats;
  kit_tags?: ChampionTag[];
};

type Augment = {
  slug: string;
  name: string;
  rarity: "silver" | "gold" | "prismatic";
  type?: "ability" | "quest" | "standalone";
  description?: string;
  wikiDescription?: string;
  kit_tags?: ChampionTag[];
  flags?: {
    system_breaker?: boolean;
    lifecycle?: string;
  };
};

type Combo = {
  champion: string;
  augment: string;
  augmentSlug: string;
  tier: ComboTier;
  ref: string;
};

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

function writeJson(filename: string, data: unknown): void {
  writeFileSync(
    join(DATA_DIR, filename),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

function tierForInteraction(interaction: MechanicalInteraction): ComboTier {
  if (interaction.type === "trap") return "C";
  if (interaction.strength >= 3) return "S";
  if (interaction.strength === 2) return "A";
  return "B";
}

function tierForFit(strength: number): ComboTier | undefined {
  if (strength <= -1) return "C";
  if (strength >= 3) return "S";
  if (strength === 2) return "A";
  if (strength === 1) return "B";
  return undefined;
}

const TIER_PRIORITY: Record<ComboTier, number> = { S: 4, A: 3, C: 2, B: 1 };

function upsertCombo(map: Map<string, Combo>, combo: Combo): void {
  const key = `${combo.champion}:${combo.augmentSlug}`;
  const current = map.get(key);
  if (!current || TIER_PRIORITY[combo.tier] > TIER_PRIORITY[current.tier]) {
    map.set(key, combo);
  }
}

function main(): void {
  const championsData = readJson<{ patch?: string; scraped_at?: string; champions: Champion[] }>("champions.json");
  const augmentsData = readJson<{ augments: Augment[] }>("augments.json");
  const abilitiesData = readJson<{ profiles: Record<string, AbilityProfile> }>("abilities.json");
  const poolRules = readJson<PoolRules>("pool-rules.json");

  const combos = new Map<string, Combo>();

  for (const champion of championsData.champions) {
    const abilityProfile = abilitiesData.profiles[champion.slug];
    if (!abilityProfile || !champion.baseStats) continue;

    const pool = getChampionAugmentPool({
      championSlug: champion.slug,
      augments: augmentsData.augments,
      abilityProfile,
      baseStats: champion.baseStats,
      championKitTags: champion.kit_tags ?? [],
      poolRules,
    });
    const poolAugments = [...pool.silver, ...pool.gold, ...pool.prismatic];

    const interactions = analyzeInteractions(
      {
        name: champion.name,
        slug: champion.slug,
        baseStats: champion.baseStats,
        abilityProfile,
      },
      poolAugments.map((augment) => ({
        slug: augment.slug,
        name: augment.name,
        description: augment.description ?? "",
        wikiDescription: augment.wikiDescription,
      })),
    );

    for (const interaction of interactions) {
      upsertCombo(combos, {
        champion: champion.slug,
        augment: interaction.augmentName,
        augmentSlug: interaction.augmentSlug,
        tier: tierForInteraction(interaction),
        ref: `mechanical:${interaction.mechanic.toLowerCase()}`,
      });
    }

    for (const augment of poolAugments) {
      const fit = abilityAugmentFit(
        {
          slug: augment.slug,
          type: augment.type,
          wikiDescription: augment.wikiDescription,
        },
        abilityProfile,
      );
      const tier = fit ? tierForFit(fit.strength) : undefined;
      if (!tier) continue;

      upsertCombo(combos, {
        champion: champion.slug,
        augment: augment.name,
        augmentSlug: augment.slug,
        tier,
        ref: `ability-fit:${fit.eligibleKeys.join("/") || "none"}`,
      });
    }
  }

  const tierOrder: Record<ComboTier, number> = { S: 0, A: 1, B: 2, C: 3 };
  const rows = [...combos.values()].sort((left, right) =>
    left.champion.localeCompare(right.champion) ||
    tierOrder[left.tier] - tierOrder[right.tier] ||
    left.augment.localeCompare(right.augment),
  );

  writeJson("combos.json", {
    patch: championsData.patch,
    scraped_at: championsData.scraped_at,
    generated_from: "internal-pool-mechanics",
    combos: rows,
  });

  const counts = rows.reduce<Record<string, number>>((accumulator, combo) => {
    accumulator[combo.tier] = (accumulator[combo.tier] ?? 0) + 1;
    return accumulator;
  }, {});
  console.log(
    `Generated ${rows.length} internal combos from current pool/mechanics: ` +
      ["S", "A", "B", "C"].map((tier) => `${tier}=${counts[tier] ?? 0}`).join(" "),
  );
}

main();
