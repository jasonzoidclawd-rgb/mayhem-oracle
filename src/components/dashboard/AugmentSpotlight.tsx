import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { rarityBadgeClass } from "./tier-style";

export type SpotlightAugment = LocalizedNameRecord & {
  slug: string;
  rarity: string;
  icon: string;
  wikiDescription?: string;
};

export async function AugmentSpotlight({
  augment,
  isChangedThisPatch,
}: {
  augment: SpotlightAugment;
  isChangedThisPatch: boolean;
}) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const name = localizedName(augment, locale);

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={augment.icon} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-[var(--color-text-primary)]">{name}</p>
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
