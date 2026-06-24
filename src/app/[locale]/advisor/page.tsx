import {
  AdvisorMemberClient,
  type AdvisorAugmentOption,
  type AdvisorChampionOption,
} from "@/components/advisor/AdvisorMemberClient";
import { MembershipGate } from "@/components/membership/MembershipGate";
import type { DecisionGrade } from "@/lib/contracts/decision";
import { loadPublicJson } from "@/lib/data/public-loader";
import { readMemberAccess } from "@/lib/membership/read-member-access";
import { getTranslations, setRequestLocale } from "next-intl/server";

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

  // Gate the member tool. Non-members get an upsell instead of the live form.
  const { active, signedIn } = await readMemberAccess();
  if (!active) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16">
        <MembershipGate title={t("lockedTitle")} body={t("lockedBody")} cta={t("lockedCta")} />
        {!signedIn ? (
          <a
            href={`/api/auth/signin?next=/${locale}/advisor`}
            className="text-sm text-amber-300 transition hover:underline"
          >
            {t("signInCta")}
          </a>
        ) : null}
      </div>
    );
  }

  const { champions } = loadPublicJson<{ champions: RawChampion[] }>("champions.json");
  const { augments } = loadPublicJson<{ augments: RawAugment[] }>("augments.json");

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
