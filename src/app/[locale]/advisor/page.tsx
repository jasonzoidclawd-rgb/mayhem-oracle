import { AdvisorClient } from "@/components/advisor/AdvisorClient";
import { normalizeAugmentSet } from "@/lib/data/augment-set";
import type { ComboMetadataEntry } from "@/lib/scoring/offered-ranking";
import type { AbilityProfile, ChampionBaseStats } from "@/lib/types";
import { readFile } from "fs/promises";
import { getTranslations, setRequestLocale } from "next-intl/server";
import path from "path";

type RawChampion = {
  slug: string;
  name: string;
  icon?: string;
  tier?: string;
  win_rate?: number;
  baseStats?: ChampionBaseStats;
};

type RawAugment = {
  slug: string;
  name: string;
  displayName?: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  rarity?: "silver" | "gold" | "prismatic";
  win_rate?: number | null;
  icon?: string;
  set?: string | null;
  wikiSet?: string | null;
  description?: string;
  wikiDescription?: string;
  notes?: string[];
  kit_tags?: string[];
  flags?: {
    system_breaker?: boolean;
    lifecycle?: string;
  };
};

type RawAbilityProfiles = { profiles: Record<string, AbilityProfile> };
type RawCombo = {
  champion: string;
  augment: string;
  tier: "SS" | "S" | "A" | "B" | "C" | "D";
  ref?: string;
  source?: string;
};

type ChampionData = { champions: RawChampion[] };
type AugmentData = { augments: RawAugment[] };
type ComboData = { combos: RawCombo[] };

function compactAbilityProfile(profile: AbilityProfile | undefined): AbilityProfile | undefined {
  if (!profile) return undefined;

  return {
    damageType: profile.damageType,
    attackType: profile.attackType,
    playstyle: profile.playstyle,
    abilities: profile.abilities.map(({ key, description, stats }) => ({
      key,
      name: "",
      icon: "",
      description,
      stats,
    })),
  };
}

function normalizeComboKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&amp;|&#38;|&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function comboTier(tier: RawCombo["tier"]): ComboMetadataEntry["tier"] {
  if (tier === "SS") return "S";
  if (tier === "D") return "C";
  return tier;
}

export default async function AdvisorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("advisor");

  const dataDir = path.join(process.cwd(), "public", "data");
  const [championsRaw, augmentsRaw, abilitiesRaw, combosRaw] = await Promise.all([
    readFile(path.join(dataDir, "champions.json"), "utf-8"),
    readFile(path.join(dataDir, "augments.json"), "utf-8"),
    readFile(path.join(dataDir, "abilities.json"), "utf-8"),
    readFile(path.join(dataDir, "combos.json"), "utf-8"),
  ]);

  const { champions } = JSON.parse(championsRaw) as ChampionData;
  const { augments } = JSON.parse(augmentsRaw) as AugmentData;
  const { profiles } = JSON.parse(abilitiesRaw) as RawAbilityProfiles;
  const { combos } = JSON.parse(combosRaw) as ComboData;
  const augmentSlugByComboKey = new Map<string, string>();

  for (const augment of augments) {
    augmentSlugByComboKey.set(normalizeComboKey(augment.slug), augment.slug);
    augmentSlugByComboKey.set(normalizeComboKey(augment.name), augment.slug);
    if (augment.displayName) {
      augmentSlugByComboKey.set(normalizeComboKey(augment.displayName), augment.slug);
    }
  }

  const combosByChampion = combos.reduce<Record<string, Record<string, ComboMetadataEntry>>>(
    (accumulator, combo) => {
      const augmentSlug = augmentSlugByComboKey.get(normalizeComboKey(combo.augment));
      if (!augmentSlug) return accumulator;

      accumulator[combo.champion] ??= {};
      accumulator[combo.champion][augmentSlug] = {
        tier: comboTier(combo.tier),
        ref: combo.ref,
        source: combo.source ?? "combo-table",
      };

      return accumulator;
    },
    {},
  );
  const championOptions = champions.map(({ slug, name, icon, tier, win_rate, baseStats }) => ({
    slug,
    name,
    icon,
    tier,
    win_rate,
    abilityProfile: compactAbilityProfile(profiles[slug]),
    baseStats,
  }));
  const localizedAugmentName = (augment: RawAugment): string => {
    if (locale === "zh-TW") return augment.name_zh_TW ?? augment.name_zh_CN ?? augment.name;
    if (locale === "zh-CN") return augment.name_zh_CN ?? augment.name;
    if (locale === "ja") return augment.name_ja ?? augment.name;
    if (locale === "ko") return augment.name_ko ?? augment.name;
    return augment.displayName ?? augment.name;
  };

  const augmentOptions = augments.map(
    (augment) => ({
      slug: augment.slug,
      name: augment.name,
      displayName: localizedAugmentName(augment),
      rarity: augment.rarity ?? "gold",
      win_rate: augment.win_rate ?? null,
      icon: augment.icon ?? "",
      set: normalizeAugmentSet(augment.set, augment.wikiSet),
      description: augment.description,
      wikiDescription: augment.wikiDescription,
      notes: augment.notes,
      kit_tags: augment.kit_tags,
      flags: augment.flags,
    }),
  );

  return (
    <div className="py-8">
      <AdvisorClient
        champions={championOptions}
        augments={augmentOptions}
        combosByChampion={combosByChampion}
        copy={{
          title: t("title"),
          description: t("description"),
          championSelectorTitle: t("championSelectorTitle"),
          championSearchLabel: t("championSearchLabel"),
          championSearchPlaceholder: t("championSearchPlaceholder"),
          championSelectLabel: t("championSelectLabel"),
          championSelectPlaceholder: t("championSelectPlaceholder"),
          ownedAugmentsTitle: t("ownedAugmentsTitle"),
          ownedAugmentsLabel: t("ownedAugmentsLabel"),
          ownedAugmentsHelp: t("ownedAugmentsHelp"),
          offeredAugmentsTitle: t("offeredAugmentsTitle"),
          offeredAugmentLabel: t("offeredAugmentLabel", { number: "{number}" }),
          offeredAugmentPlaceholder: t("offeredAugmentPlaceholder"),
          duplicateOfferedWarning: t("duplicateOfferedWarning"),
          rerollTitle: t("rerollTitle"),
          normalRerollsLabel: t("normalRerollsLabel"),
          goldenRerollLabel: t("goldenRerollLabel"),
          seenRerollsLabel: t("seenRerollsLabel"),
          seenRerollsPlaceholder: t("seenRerollsPlaceholder"),
          shopTimingTitle: t("shopTimingTitle"),
          shopTimingLabel: t("shopTimingLabel"),
          shopAvailableNow: t("shopAvailableNow"),
          shopDelayedUntilShop: t("shopDelayedUntilShop"),
          shopCheatingRecall: t("shopCheatingRecall"),
          shopQueued: t("shopQueued"),
          selectionRoundTitle: t("selectionRoundTitle"),
          selectionRoundLabel: t("selectionRoundLabel"),
          selectionRoundLevel3: t("selectionRoundLevel3"),
          selectionRoundLevel7: t("selectionRoundLevel7"),
          selectionRoundLevel11: t("selectionRoundLevel11"),
          selectionRoundLevel15: t("selectionRoundLevel15"),
          screenTierLabel: t("screenTierLabel"),
          tierSilver: t("tierSilver"),
          tierGold: t("tierGold"),
          tierPrismatic: t("tierPrismatic"),
          resultsTitle: t("resultsTitle"),
          resultsIncomplete: t("resultsIncomplete"),
          rankLabel: t("rankLabel", { rank: "{rank}" }),
          scoreLabel: t("scoreLabel"),
          scoreBandLabel: t("scoreBandLabel"),
          reasonsLabel: t("reasonsLabel"),
          noReasons: t("noReasons"),
          rerollEvLabel: t("rerollEvLabel"),
          rerollStanceLabel: t("rerollStanceLabel"),
          rerollFactorLabel: t("rerollFactorLabel"),
          confidenceLabel: t("confidenceLabel"),
          shopTimingStatusLabel: t("shopTimingStatusLabel"),
          statusOpen: t("statusOpen"),
          statusClosed: t("statusClosed"),
          statusUnknown: t("statusUnknown"),
          reasonStrongCombo: t("reasonStrongCombo"),
          reasonTrapCombo: t("reasonTrapCombo"),
          reasonTrapPenalty: t("reasonTrapPenalty"),
          reasonAbilityTypeSynergy: t("reasonAbilityTypeSynergy"),
          reasonAttackTypeSynergy: t("reasonAttackTypeSynergy"),
          reasonCrowdControlSynergy: t("reasonCrowdControlSynergy"),
          reasonTagMismatch: t("reasonTagMismatch"),
          reasonSameSetProgress: t("reasonSameSetProgress"),
          reasonChampionModeOverride: t("reasonChampionModeOverride"),
          reasonChampionModeTrap: t("reasonChampionModeTrap"),
          reasonTextInferredCrowdControl: t("reasonTextInferredCrowdControl"),
          reasonMechanicalSynergy: t("reasonMechanicalSynergy"),
          reasonMechanicalTrap: t("reasonMechanicalTrap"),
          reasonOracleScoreBand: t("reasonOracleScoreBand"),
          reasonAugmentWinRateAvailable: t("reasonAugmentWinRateAvailable"),
          reasonAugmentWinRateMissing: t("reasonAugmentWinRateMissing"),
          factorGoldenUpgrade: t("factorGoldenUpgrade"),
          factorSameTierReroll: t("factorSameTierReroll"),
          factorIncompletePoolData: t("factorIncompletePoolData"),
          factorNoNormalRerolls: t("factorNoNormalRerolls"),
          factorLateSelectionRound: t("factorLateSelectionRound"),
          factorSeenRerolledOffers: t("factorSeenRerolledOffers"),
          stanceSameTierSearch: t("stanceSameTierSearch"),
          stanceUpgradeOpportunity: t("stanceUpgradeOpportunity"),
          stanceHoldCurrent: t("stanceHoldCurrent"),
          bandExcellent: t("bandExcellent"),
          bandGood: t("bandGood"),
          bandAverage: t("bandAverage"),
          bandWeak: t("bandWeak"),
          confidenceHigh: t("confidenceHigh"),
          confidenceMedium: t("confidenceMedium"),
          confidenceLow: t("confidenceLow"),
          summaryTitle: t("summaryTitle"),
          noSelection: t("noSelection"),
          selectedChampionLabel: t("selectedChampionLabel"),
          selectedOwnedLabel: t("selectedOwnedLabel"),
          selectedOffersLabel: t("selectedOffersLabel"),
          selectedRerollsLabel: t("selectedRerollsLabel"),
          selectedShopLabel: t("selectedShopLabel"),
          dataSummary: t("dataSummary", {
            championCount: championOptions.length,
            augmentCount: augmentOptions.length,
          }),
          baselineLabel: t("baselineLabel"),
          baselineNote: t("baselineNote", { armor: "{armor}" }),
          dpsDeltaLabel: t("dpsDeltaLabel"),
        }}
      />
    </div>
  );
}
