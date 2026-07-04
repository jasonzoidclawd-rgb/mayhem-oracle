import type { Metadata } from "next";
import {
  AdvisorMemberClient,
  type AdvisorAugmentOption,
  type AdvisorChampionOption,
} from "@/components/advisor/AdvisorMemberClient";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { MembershipGate } from "@/components/membership/MembershipGate";
import type { DecisionGrade } from "@/lib/contracts/decision";
import { loadPublicJson } from "@/lib/data/public-loader";
import { readMemberAccess } from "@/lib/membership/read-member-access";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/site";
import { localizedName } from "@/lib/i18n/localized-name";

type RawChampion = {
  slug: string;
  name: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  icon?: string;
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
  icon?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "advisor" });
  const route = "/advisor";
  const title = t("title");
  const description = t("description");
  const url = localizedUrl(route, locale as Locale);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(route),
    },
    openGraph: { title, description, url, locale },
    twitter: { card: "summary_large_image", title, description },
  };
}

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
          <GoogleSignInButton next={`/${locale}/advisor`} label={t("signInCta")} size="medium" />
        ) : null}
      </div>
    );
  }

  const { champions } = loadPublicJson<{ champions: RawChampion[] }>("champions.json");
  const { augments } = loadPublicJson<{ augments: RawAugment[] }>("augments.json");

  const championOptions: AdvisorChampionOption[] = champions
    .map((champion) => ({
      slug: champion.slug,
      name: localizedName(champion, locale),
      icon: champion.icon,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const augmentOptions: AdvisorAugmentOption[] = augments.map((augment) => ({
    slug: augment.slug,
    displayName: localizedName(augment, locale),
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
