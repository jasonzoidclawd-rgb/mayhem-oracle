import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadChampionDetailData } from "@/lib/champions/detail-data";
import type {
  ChampionMemberAugment,
  ChampionMemberInteraction,
  ChampionMemberPoolLayerKey,
  ChampionMemberViewPayload,
} from "@/lib/champions/member-view-contract";
import { buildComboTierLookup } from "@/lib/data/combo-lookup";
import { localizedDescription, localizedName } from "@/lib/i18n/localized-name";
import { buildPoolProfile } from "@/lib/scoring/augment-tailoring";
import { analyzeInteractions, type MechanicalInteraction } from "@/lib/scoring/augment-interactions";
import { computeOracleScore } from "@/lib/scoring/oracle-score";
import { getChampionAugmentPool } from "@/lib/scoring/pool-orchestrator";

async function readInternalDataVersion(): Promise<string> {
  const raw = await readFile(
    path.join(process.cwd(), "data", "internal", "meta.json"),
    "utf8",
  );
  const meta = JSON.parse(raw) as { scraped_at?: unknown };
  if (typeof meta.scraped_at !== "string" || meta.scraped_at.length === 0) {
    throw new Error("internal champion data version is missing");
  }
  return meta.scraped_at;
}

function pickTopInteractions(
  interactions: MechanicalInteraction[],
  limit: number,
): MechanicalInteraction[] {
  return [
    ...interactions.filter((interaction) => interaction.strength === 3),
    ...interactions.filter((interaction) => interaction.strength === 2),
  ].slice(0, limit);
}

export async function buildChampionMemberView(
  championSlug: string,
  locale: string,
): Promise<ChampionMemberViewPayload> {
  const [data, dataVersion] = await Promise.all([
    loadChampionDetailData("member"),
    readInternalDataVersion(),
  ]);
  const champion = data.champions.find((entry) => entry.slug === championSlug);
  if (!champion) throw new Error("unknown champion");

  const abilityProfile = data.abilities[championSlug];
  const poolProfile = buildPoolProfile(
    championSlug,
    abilityProfile,
    champion.baseStats,
  );
  const pool = getChampionAugmentPool({
    championSlug,
    augments: data.augments,
    abilityProfile,
    baseStats: champion.baseStats,
    championKitTags: champion.kit_tags ?? [],
    poolRules: data.poolRules,
  });
  const poolAugments = [...pool.silver, ...pool.gold, ...pool.prismatic];
  const comboBySlug = buildComboTierLookup(championSlug, data.combos, data.augments);
  const championWinRate = typeof champion.win_rate === "number" ? champion.win_rate : undefined;

  const toAugment = (augment: (typeof data.augments)[number]): ChampionMemberAugment => ({
    slug: augment.slug,
    name: localizedName(augment, locale),
    description:
      localizedDescription(augment, locale) ||
      augment.wikiDescription ||
      augment.description ||
      "",
    icon: augment.icon,
    rarity: augment.rarity,
    winRate: augment.win_rate,
    kitTags: augment.kit_tags ?? [],
  });

  const rankings = championWinRate === undefined
    ? []
    : poolAugments
      .map((augment) => {
        const comboTier = comboBySlug.get(augment.slug);
        const score = computeOracleScore({
          augment,
          championWinRate,
          comboTier,
          abilityProfile,
          isSystemBreaker: augment.flags?.system_breaker === true,
        });
        return {
          augment: toAugment(augment),
          score: score.total,
          breakdown: score.breakdown,
          comboTier,
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);

  const excludedByReason = pool.excluded.reduce<Record<string, number>>(
    (counts, entry) => {
      counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const countExcluded = (...reasons: string[]) =>
    reasons.reduce((total, reason) => total + (excludedByReason[reason] ?? 0), 0);
  let remainder = pool.total;
  const layers: ChampionMemberViewPayload["pool"]["layers"] = [
    { key: "source", kept: remainder, removed: 0 },
  ];
  const appendLayer = (
    key: ChampionMemberPoolLayerKey,
    removed: number,
  ) => {
    remainder -= removed;
    layers.push({ key, kept: remainder, removed });
  };
  appendLayer("lifecycle", countExcluded("disabled", "removed"));
  appendLayer("hard", countExcluded("hard-exclusion"));
  appendLayer("tags", countExcluded("tag-mismatch"));
  appendLayer("items", countExcluded("item-exclusion"));

  let synergies: ChampionMemberInteraction[] = [];
  let traps: ChampionMemberInteraction[] = [];
  if (abilityProfile && champion.baseStats) {
    const analyzed = analyzeInteractions(
      {
        name: localizedName(champion, locale),
        slug: champion.slug,
        baseStats: champion.baseStats,
        abilityProfile,
      },
      poolAugments.map((augment) => {
        const memberAugment = toAugment(augment);
        return {
          slug: memberAugment.slug,
          name: memberAugment.name,
          description: memberAugment.description,
          wikiDescription: memberAugment.description,
        };
      }),
    );
    const augmentBySlug = new Map(
      poolAugments.map((augment) => [augment.slug, toAugment(augment)]),
    );
    const attachAugment = (
      interaction: MechanicalInteraction,
    ): ChampionMemberInteraction => {
      const augment = augmentBySlug.get(interaction.augmentSlug);
      if (!augment) throw new Error(`interaction augment missing: ${interaction.augmentSlug}`);
      return {
        ...interaction,
        augment: {
          slug: augment.slug,
          name: augment.name,
          icon: augment.icon,
        },
      };
    };
    synergies = pickTopInteractions(
      analyzed.filter((interaction) => interaction.type === "synergy"),
      12,
    ).map(attachAugment);
    traps = pickTopInteractions(
      analyzed.filter((interaction) => interaction.type === "trap"),
      8,
    ).map(attachAugment);
  }

  return {
    championSlug,
    version: { patch: data.patch, dataVersion },
    profile: {
      resource: poolProfile.resource,
      attackType: poolProfile.attackType,
      damageType: poolProfile.damageType,
      kitTags: champion.kit_tags ?? [],
    },
    pool: {
      total: pool.total,
      totalAugments: data.augments.length,
      layers,
      raritySummary: (["silver", "gold", "prismatic"] as const).map((key) => ({
        key,
        count: pool[key].length,
      })),
      highlights: rankings.slice(0, 6),
    },
    matrixAugmentNames: Object.fromEntries(
      data.augments.map((augment) => [augment.slug, localizedName(augment, locale)]),
    ),
    rankings,
    interactions: { synergies, traps },
  };
}
