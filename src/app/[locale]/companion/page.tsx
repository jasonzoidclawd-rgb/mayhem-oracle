import {
  CompanionClient,
  type CompanionAugmentOption,
  type CompanionChampionOption,
} from "@/components/companion/CompanionClient";
import { loadPublicJson } from "@/lib/data/public-loader";
import { readMemberAccess } from "@/lib/membership/read-member-access";
import { setRequestLocale } from "next-intl/server";

type RawChampion = { slug: string; name: string };
type RawAugment = {
  slug: string;
  name: string;
  displayName?: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  rarity?: "silver" | "gold" | "prismatic";
};

// Companion always ships the public picker catalog — unlike /advisor, it does
// not swap the whole page for non-members. Only the verdict zone is gated
// (CompanionClient renders a MembershipGate inside the sheet on lock), so a
// signed-out visitor can still browse champions/augments at a glance.
export default async function CompanionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const initialAccess = await readMemberAccess();

  const { champions } = loadPublicJson<{ champions: RawChampion[] }>("champions.json");
  const { augments } = loadPublicJson<{ augments: RawAugment[] }>("augments.json");

  const localizedName = (augment: RawAugment): string => {
    if (locale === "zh-TW") return augment.name_zh_TW ?? augment.name_zh_CN ?? augment.name;
    if (locale === "zh-CN") return augment.name_zh_CN ?? augment.name;
    if (locale === "ja") return augment.name_ja ?? augment.name;
    if (locale === "ko") return augment.name_ko ?? augment.name;
    return augment.displayName ?? augment.name;
  };

  const championOptions: CompanionChampionOption[] = champions
    .map(({ slug, name }) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const augmentOptions: CompanionAugmentOption[] = augments.map((augment) => ({
    slug: augment.slug,
    displayName: localizedName(augment),
    rarity: augment.rarity ?? "gold",
  }));

  return (
    <CompanionClient
      champions={championOptions}
      augments={augmentOptions}
      initialAccess={initialAccess}
      locale={locale}
    />
  );
}
