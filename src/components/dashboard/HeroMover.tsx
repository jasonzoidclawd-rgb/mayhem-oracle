import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { tierBadgeClass } from "./tier-style";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";

export type HeroChampion = LocalizedNameRecord & {
  slug: string;
  tier: string;
  rank: number;
  win_rate: number;
  pick_rate: number;
  icon: string;
};

export async function HeroMover({
  champion,
  total,
  patch,
  entityPresentation,
}: {
  champion: HeroChampion;
  total: number;
  patch: string;
  entityPresentation: EntityPresentationData;
}) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const name = localizedName(champion, locale);
  const entityRef = resolveEntityRef(entityPresentation, "champion", { slug: champion.slug }, locale) ?? {
    type: "champion" as const,
    id: champion.slug,
    slug: champion.slug,
    routeIdentifier: "",
    localizedName: name,
    iconUrl: champion.icon ?? "",
    known: false,
    canonicalId: champion.slug,
    name,
    icon: champion.icon,
    lifecycle: "unknown" as const,
  };

  return (
    <div className="glass-card reveal flex items-center gap-4 p-4 md:col-span-6 lg:col-span-8">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-text-muted)]">{t("heroTopMover", { patch })}</p>
        <div className="mt-1 flex items-center gap-2">
          <EntityLink entity={entityRef} variant="standard" tier={champion.tier} className="min-w-0 text-lg font-semibold" />
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tierBadgeClass(champion.tier)}`}>
            {champion.tier}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[var(--color-text-secondary)]">
          <span>{t("heroRank", { rank: champion.rank, total })}</span>
          <span>
            {champion.win_rate.toFixed(1)}% <span className="text-[var(--color-text-muted)]">{t("heroWinRate")}</span>
          </span>
          <span>
            {champion.pick_rate.toFixed(1)}% <span className="text-[var(--color-text-muted)]">{t("heroPickRate")}</span>
          </span>
        </div>
      </div>
      <Link
        href={`/champions/${champion.slug}`}
        className="flex min-h-11 shrink-0 items-center rounded-lg border border-[var(--color-border-default)] px-3 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)]"
      >
        {t("heroCta", { name })}
      </Link>
    </div>
  );
}
