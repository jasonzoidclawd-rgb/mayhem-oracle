import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { tierBadgeClass } from "./tier-style";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";

export type TierChampion = LocalizedNameRecord & {
  slug: string;
  tier: string;
  rank: number;
  icon: string;
};

export async function TierMiniGrid({ champions, entityPresentation }: { champions: TierChampion[]; entityPresentation: EntityPresentationData }) {
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
        {champions.map((champion) => {
          const entityRef = resolveEntityRef(entityPresentation, "champion", { slug: champion.slug }, locale);
          return (
            <li key={champion.slug}>
              <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border-default)] p-2 transition-colors hover:border-[var(--color-border-hover)]">
                {entityRef ? (
                  <EntityLink entity={entityRef} variant="standard" className="min-w-0 flex-1" />
                ) : (
                  <Link href={`/champions/${champion.slug}`} className="flex min-w-0 flex-1 items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={champion.icon} alt={localizedName(champion, locale)} className="h-8 w-8 shrink-0 rounded-md" />
                    <span className="truncate text-sm text-[var(--color-text-primary)]">{localizedName(champion, locale)}</span>
                  </Link>
                )}
                <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${tierBadgeClass(champion.tier)}`}>
                  {champion.tier}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
