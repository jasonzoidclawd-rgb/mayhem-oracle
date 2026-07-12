import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { rarityBadgeClass } from "./tier-style";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";

export type SpotlightAugment = LocalizedNameRecord & {
  slug: string;
  rarity: string;
  icon: string;
  wikiDescription?: string;
};

export async function AugmentSpotlight({
  augment,
  isChangedThisPatch,
  entityPresentation,
}: {
  augment: SpotlightAugment;
  isChangedThisPatch: boolean;
  entityPresentation: EntityPresentationData;
}) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const name = localizedName(augment, locale);
  const entityRef = resolveEntityRef(entityPresentation, "augment", { slug: augment.slug }, locale);

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
          {entityRef ? <EntityLink entity={entityRef} variant="standard" className="text-base font-medium" /> : <p className="truncate text-base font-medium text-[var(--color-text-primary)]">{name}</p>}
          <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${rarityBadgeClass(augment.rarity)}`}>
            {augment.rarity}
          </span>
        </div>
      </div>
      {augment.wikiDescription && (
        <p className="mt-3 line-clamp-3 text-sm text-[var(--color-text-secondary)]">{augment.wikiDescription}</p>
      )}
      <Link href="/augments" className="mt-3 flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline">
        {t("spotlightCta")} →
      </Link>
    </div>
  );
}
