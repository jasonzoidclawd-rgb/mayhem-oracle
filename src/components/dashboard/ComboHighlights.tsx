import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";

export type RankedCombo = {
  champion: LocalizedNameRecord & { slug: string; rank: number; icon: string };
  augment: LocalizedNameRecord & { slug: string };
};

export async function ComboHighlights({ combos, entityPresentation }: { combos: RankedCombo[]; entityPresentation: EntityPresentationData }) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  return (
    <div className="glass-card reveal p-4 md:col-span-3 lg:col-span-4">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("combosTitle")}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {combos.map(({ champion, augment }, i) => (
          <li key={`${champion.slug}-${augment.slug}-${i}`} className="flex items-center gap-2 text-sm">
            <EntityLink entity={resolveEntityRef(entityPresentation, "champion", { slug: champion.slug }, locale) ?? {
              type: "champion",
              id: champion.slug,
              slug: champion.slug,
              routeIdentifier: "",
              localizedName: localizedName(champion, locale),
              iconUrl: champion.icon ?? "",
              known: false,
              canonicalId: champion.slug,
              name: localizedName(champion, locale),
              icon: champion.icon,
              lifecycle: "unknown",
            }} variant="compact" />
            <span className="shrink-0 text-[var(--color-text-muted)]">+</span>
            <EntityLink entity={resolveEntityRef(entityPresentation, "augment", { slug: augment.slug }, locale) ?? {
              type: "augment",
              id: augment.slug,
              slug: augment.slug,
              routeIdentifier: "",
              localizedName: localizedName(augment, locale),
              iconUrl: "",
              known: false,
              canonicalId: augment.slug,
              name: localizedName(augment, locale),
              lifecycle: "unknown",
            }} variant="compact" />
          </li>
        ))}
      </ul>
      <Link href="/advisor" className="mt-3 flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline">
        {t("combosCta")} →
      </Link>
    </div>
  );
}
