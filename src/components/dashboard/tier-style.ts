const TIER_CLASS: Record<string, string> = {
  "S+": "tier-god",
  S: "tier-strong",
  A: "tier-good",
  B: "tier-avg",
  C: "tier-weak",
};

const RARITY_CLASS: Record<string, string> = {
  prismatic: "rarity-prismatic",
  gold: "rarity-gold",
  silver: "rarity-silver",
};

export function tierBadgeClass(tier: string): string {
  return TIER_CLASS[tier] ?? "tier-weak";
}

export function rarityBadgeClass(rarity: string): string {
  return RARITY_CLASS[rarity] ?? "rarity-silver";
}
