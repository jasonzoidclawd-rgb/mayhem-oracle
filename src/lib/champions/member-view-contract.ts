import type { ComboTier, OracleScoreResult } from "@/lib/scoring/oracle-score";
import type { AugmentMechanic, MechanicalInteraction } from "@/lib/scoring/augment-interactions";

export type ChampionMemberPoolLayerKey = "source" | "lifecycle" | "hard" | "tags" | "items";

export interface ChampionMemberAugment {
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: "prismatic" | "gold" | "silver";
  winRate: number | null;
  kitTags: string[];
}

export interface ChampionMemberRanking {
  augment: ChampionMemberAugment;
  score: number;
  breakdown: OracleScoreResult["breakdown"];
  comboTier?: ComboTier;
}

export interface ChampionMemberInteraction extends MechanicalInteraction {
  mechanic: AugmentMechanic;
  augment: Pick<ChampionMemberAugment, "slug" | "name" | "icon">;
}

export interface ChampionMemberViewPayload {
  championSlug: string;
  version: {
    patch: string;
    dataVersion: string;
  };
  profile: {
    resource: "mana" | "energy" | "none";
    attackType: "melee" | "ranged" | "unknown";
    damageType: "physical" | "magic" | "mixed";
    kitTags: string[];
  };
  pool: {
    total: number;
    totalAugments: number;
    layers: Array<{
      key: ChampionMemberPoolLayerKey;
      kept: number;
      removed: number;
    }>;
    raritySummary: Array<{
      key: "silver" | "gold" | "prismatic";
      count: number;
    }>;
    highlights: ChampionMemberRanking[];
  };
  matrixAugmentNames: Record<string, string>;
  rankings: ChampionMemberRanking[];
  interactions: {
    synergies: ChampionMemberInteraction[];
    traps: ChampionMemberInteraction[];
  };
}
