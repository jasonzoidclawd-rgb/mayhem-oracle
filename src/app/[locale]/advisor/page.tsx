import { AdvisorClient } from "@/components/advisor/AdvisorClient";
import type { ComboMetadataEntry } from "@/lib/scoring/offered-ranking";
import type { AbilityProfile } from "@/lib/types";
import { readFile } from "fs/promises";
import { getTranslations, setRequestLocale } from "next-intl/server";
import path from "path";

type RawChampion = {
  slug: string;
  name: string;
  icon?: string;
  tier?: string;
  win_rate?: number;
};

type RawAugment = {
  slug: string;
  name: string;
  displayName?: string;
  rarity?: "silver" | "gold" | "prismatic";
  win_rate?: number | null;
  icon?: string;
  set?: string | null;
  description?: string;
  wikiDescription?: string;
  notes?: string[];
  kit_tags?: string[];
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

function compactAbilityProfile(profile: AbilityProfile | undefined) {
  if (!profile) return undefined;

  return {
    damageType: profile.damageType,
    attackType: profile.attackType,
    playstyle: profile.playstyle,
    abilities: [],
  };
}

function normalizeComboKey(value: string): string {
  return value.trim().toLowerCase();
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
  const championOptions = champions.map(({ slug, name, icon, tier, win_rate }) => ({
    slug,
    name,
    icon,
    tier,
    win_rate,
    abilityProfile: compactAbilityProfile(profiles[slug]),
  }));
  const augmentOptions = augments.map(
    ({ slug, name, displayName, rarity, win_rate, icon, set, description, wikiDescription, notes, kit_tags }) => ({
      slug,
      name,
      displayName: displayName ?? name,
      rarity: rarity ?? "gold",
      win_rate: win_rate ?? null,
      icon: icon ?? "",
      set: set ?? undefined,
      description,
      wikiDescription,
      notes,
      kit_tags,
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
          offeredAugmentLabel: t("offeredAugmentLabel"),
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
          rankLabel: t("rankLabel"),
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
        }}
      />
    </div>
  );
}
