import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { rarityBadgeClass } from "./tier-style";

export type ChangedAugment = LocalizedNameRecord & {
  slug: string;
  rarity: string;
  icon: string;
};

export async function MoversCarousel({ augments }: { augments: ChangedAugment[] }) {
  if (augments.length === 0) return null;

  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  return (
    <div className="glass-card reveal p-4 md:col-span-3 lg:col-span-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("augmentChangesTitle")}</h3>
        <span className="shrink-0 rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
          {t("augmentChangesCount", { count: augments.length })}
        </span>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {augments.map((augment) => (
          <Link
            key={augment.slug}
            href="/augments"
            className="flex shrink-0 flex-col items-center gap-1 rounded-lg border border-[var(--color-border-default)] p-2 transition-colors hover:border-[var(--color-border-hover)]"
            style={{ width: "76px" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={augment.icon} alt="" className="h-10 w-10 rounded-md" />
            <span className="truncate text-center text-[11px] text-[var(--color-text-secondary)]">
              {localizedName(augment, locale)}
            </span>
            <span className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${rarityBadgeClass(augment.rarity)}`}>
              {augment.rarity}
            </span>
          </Link>
        ))}
      </div>
      <Link href="/augments" className="mt-2 flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline">
        {t("augmentChangesCta")} →
      </Link>
    </div>
  );
}
