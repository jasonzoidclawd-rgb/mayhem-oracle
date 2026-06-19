import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DecisionEngineData, DecisionAugment } from "../decision/evaluate";
import { buildComboTierLookup, type ComboLookupEntry } from "./combo-lookup";
import type {
  AbilityProfile,
  ChampionBaseStats,
  ChampionTag,
  PoolRules,
} from "../types";

interface InternalChampion {
  slug: string;
  win_rate?: number | null;
  kit_tags?: ChampionTag[];
  baseStats?: ChampionBaseStats;
}

async function readInternalJson<T>(filename: string): Promise<T> {
  const filePath = path.join(process.cwd(), "data", "internal", filename);
  return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

export async function loadInternalDecisionData(
  championSlug: string,
): Promise<DecisionEngineData> {
  const [championsData, augmentsData, abilitiesData, combosData, poolRules] =
    await Promise.all([
      readInternalJson<{ champions: InternalChampion[] }>("champions.json"),
      readInternalJson<{ augments: DecisionAugment[] }>("augments.json"),
      readInternalJson<{ profiles: Record<string, AbilityProfile> }>("abilities.json"),
      readInternalJson<{ combos: ComboLookupEntry[] }>("combos.json"),
      readInternalJson<PoolRules>("pool-rules.json"),
    ]);
  const champion = championsData.champions.find((entry) => entry.slug === championSlug);
  if (!champion) throw new Error(`Unknown internal champion: ${championSlug}`);

  return {
    champion: {
      slug: champion.slug,
      winRate: champion.win_rate,
      kitTags: champion.kit_tags ?? [],
      abilityProfile: abilitiesData.profiles[champion.slug],
      baseStats: champion.baseStats,
    },
    augments: augmentsData.augments,
    poolRules,
    comboTiers: Object.fromEntries(
      buildComboTierLookup(champion.slug, combosData.combos, augmentsData.augments),
    ),
  };
}
