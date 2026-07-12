import type { Metadata } from "next";
import {
  CompanionClient,
  type CompanionAugmentOption,
  type CompanionChampionOption,
} from "@/components/companion/CompanionClient";
import { readChampionsFile, readAugmentsFile } from "@/lib/data/read-public-file";
import { readMemberAccess } from "@/lib/membership/read-member-access";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/site";
import { localizedName } from "@/lib/i18n/localized-name";
import { readEntityPresentationFile } from "@/lib/data/read-public-file";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";

type RawChampion = {
  slug: string;
  name: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
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
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "companion" });
  const route = "/companion";
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

  const [{ champions }, { augments }] = await Promise.all([
    readChampionsFile<{ champions: RawChampion[] }>(),
    readAugmentsFile<{ augments: RawAugment[] }>(),
  ]);
  const entityData = await readEntityPresentationFile<EntityPresentationData>();

  const championOptions: CompanionChampionOption[] = champions
    .map((champion) => ({
      slug: champion.slug,
      name: localizedName(champion, locale),
      searchName: champion.name,
      entity: resolveEntityRef(entityData, "champion", { slug: champion.slug }, locale) ?? undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const augmentOptions: CompanionAugmentOption[] = augments.map((augment) => ({
    slug: augment.slug,
    displayName: localizedName(augment, locale),
    searchName: augment.name,
    rarity: augment.rarity ?? "gold",
    entity: resolveEntityRef(entityData, "augment", { slug: augment.slug }, locale) ?? undefined,
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
