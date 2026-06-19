import {
  AdvisorMemberClient,
  type AdvisorAugmentOption,
  type AdvisorChampionOption,
} from "@/components/advisor/AdvisorMemberClient";
import type { DecisionGrade } from "@/lib/contracts/decision";
import { readFile } from "fs/promises";
import { getTranslations, setRequestLocale } from "next-intl/server";
import path from "path";

type RawChampion = { slug: string; name: string; icon?: string };
type RawAugment = {
  slug: string;
  name: string;
  displayName?: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  rarity?: "silver" | "gold" | "prismatic";
  icon?: string;
};

// The Advisor is a member tool: this page ships only the public picker catalog
// (slug/name/icon/rarity). All scoring — pools, weights, grades — comes from
// the entitlement-gated /api/decision/evaluate endpoint, never the client.
export default async function AdvisorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("membership");
  const tg = await getTranslations("grades");

  const dataDir = path.join(process.cwd(), "public", "data");
  const [championsRaw, augmentsRaw] = await Promise.all([
    readFile(path.join(dataDir, "champions.json"), "utf-8"),
    readFile(path.join(dataDir, "augments.json"), "utf-8"),
  ]);

  const { champions } = JSON.parse(championsRaw) as { champions: RawChampion[] };
  const { augments } = JSON.parse(augmentsRaw) as { augments: RawAugment[] };

  const localizedName = (augment: RawAugment): string => {
    if (locale === "zh-TW") return augment.name_zh_TW ?? augment.name_zh_CN ?? augment.name;
    if (locale === "zh-CN") return augment.name_zh_CN ?? augment.name;
    if (locale === "ja") return augment.name_ja ?? augment.name;
    if (locale === "ko") return augment.name_ko ?? augment.name;
    return augment.displayName ?? augment.name;
  };

  const championOptions: AdvisorChampionOption[] = champions
    .map(({ slug, name, icon }) => ({ slug, name, icon }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const augmentOptions: AdvisorAugmentOption[] = augments.map((augment) => ({
    slug: augment.slug,
    displayName: localizedName(augment),
    rarity: augment.rarity ?? "gold",
    icon: augment.icon,
  }));

  const gradeLabels: Record<DecisionGrade, string> = {
    hot: tg("hot"),
    strong: tg("strong"),
    steady: tg("steady"),
    average: tg("average"),
    weak: tg("weak"),
  };

  return (
    <div className="py-8">
      <AdvisorMemberClient
        champions={championOptions}
        augments={augmentOptions}
        copy={{
          title: t("advTitle"),
          subtitle: t("advSubtitle"),
          champion: t("advChampion"),
          championPlaceholder: t("advChampionPlaceholder"),
          mode: t("advMode"),
          modeCompetitive: t("advModeCompetitive"),
          modeExploration: t("advModeExploration"),
          round: t("advRound"),
          rarity: t("advRarity"),
          raritySilver: t("advRaritySilver"),
          rarityGold: t("advRarityGold"),
          rarityPrismatic: t("advRarityPrismatic"),
          offered: t("advOffered"),
          offeredHelp: t("advOfferedHelp"),
          rerolls: t("advRerolls"),
          goldenReroll: t("advGoldenReroll"),
          evaluate: t("advEvaluate"),
          evaluating: t("advEvaluating"),
          results: t("advResults"),
          poolSize: t("advPoolSize"),
          probability: t("advProbability"),
          confidence: t("advConfidence"),
          confHigh: t("advConfHigh"),
          confMedium: t("advConfMedium"),
          confLow: t("advConfLow"),
          warnings: t("advWarnings"),
          reasons: t("advReasons"),
          rerollStance: t("advRerollStance"),
          stanceKeep: t("advStanceKeep"),
          stanceConsider: t("advStanceConsider"),
          stanceReroll: t("advStanceReroll"),
          stanceGolden: t("advStanceGolden"),
          needOffers: t("advNeedOffers"),
          signIn: t("advSignIn"),
          gradeLabels,
          lockedTitle: t("lockedTitle"),
          lockedBody: t("lockedBody"),
          lockedCta: t("lockedCta"),
        }}
      />
    </div>
  );
}
