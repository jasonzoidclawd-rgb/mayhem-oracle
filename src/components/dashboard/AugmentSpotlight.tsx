import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedDescriptionRecord, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { rarityBadgeClass } from "./tier-style";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";

export type SpotlightAugment = LocalizedNameRecord & LocalizedDescriptionRecord & {
  slug: string;
  rarity: string;
  icon: string;
  wikiDescription?: string;
};

export async function AugmentSpotlight({
  augment,
  locale,
  isChangedThisPatch,
  entityPresentation,
}: {
  augment: SpotlightAugment;
  locale: string;
  isChangedThisPatch: boolean;
  entityPresentation: EntityPresentationData;
}) {
  const t = await getTranslations("dashboard");
  const tChampion = await getTranslations("champion");
  const name = localizedName(augment, locale);
  const description = locale === "zh-TW"
    ? augment.description_zh_TW ?? ""
    : locale === "zh-CN"
      ? augment.description_zh_CN ?? ""
      : locale === "ja"
        ? augment.description_ja ?? ""
        : locale === "ko"
          ? augment.description_ko ?? ""
          : augment.description ?? augment.wikiDescription ?? "";
  const entityRef = resolveEntityRef(entityPresentation, "augment", { slug: augment.slug }, locale) ?? {
    type: "augment" as const,
    id: augment.slug,
    slug: augment.slug,
    routeIdentifier: "",
    localizedName: name,
    iconUrl: augment.icon ?? "",
    known: false,
    canonicalId: augment.slug,
    name,
    icon: augment.icon,
    lifecycle: "unknown" as const,
  };

  return (
    <div className="glass-card reveal p-4 md:col-span-3 lg:col-span-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("spotlightTitle")}</h3>
        {isChangedThisPatch && (
          <span className="shrink-0 rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
            {t("spotlightTag")}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0">
          <EntityLink entity={entityRef} variant="standard" rarity={augment.rarity} className="text-base font-medium" />
          <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${rarityBadgeClass(augment.rarity)}`}>
            {tChampion(augment.rarity as "prismatic" | "gold" | "silver")}
          </span>
        </div>
      </div>
      {description && (
        <p className="mt-3 line-clamp-3 text-sm text-[var(--color-text-secondary)]">{description}</p>
      )}
      <Link href="/augments" className="mt-3 flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline">
        {t("spotlightCta")} →
      </Link>
    </div>
  );
}
