import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { tierBadgeClass } from "./tier-style";

export type TierChampion = LocalizedNameRecord & {
  slug: string;
  tier: string;
  rank: number;
  icon: string;
};

export async function TierMiniGrid({ champions }: { champions: TierChampion[] }) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  return (
    <div className="glass-card reveal p-4 md:col-span-6 lg:col-span-8">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("tierBoardTitle")}</h3>
        <Link href="/champions" className="flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline">
          {t("tierBoardCta")} →
        </Link>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {champions.map((champion) => (
          <li key={champion.slug}>
            <Link
              href={`/champions/${champion.slug}`}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] p-2 transition-colors hover:border-[var(--color-border-hover)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={champion.icon} alt="" className="h-8 w-8 shrink-0 rounded-md" />
              <span className="truncate text-sm text-[var(--color-text-primary)]">{localizedName(champion, locale)}</span>
              <span className={`ml-auto shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${tierBadgeClass(champion.tier)}`}>
                {champion.tier}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
