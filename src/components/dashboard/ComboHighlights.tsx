import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";

export type RankedCombo = {
  champion: LocalizedNameRecord & { slug: string; rank: number; icon: string };
  augment: LocalizedNameRecord & { slug: string };
};

export async function ComboHighlights({ combos }: { combos: RankedCombo[] }) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  return (
    <div className="glass-card reveal p-4 md:col-span-3 lg:col-span-4">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("combosTitle")}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {combos.map(({ champion, augment }, i) => (
          <li key={`${champion.slug}-${augment.slug}-${i}`} className="flex items-center gap-2 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={champion.icon} alt="" className="h-7 w-7 shrink-0 rounded-md" />
            <span className="truncate text-[var(--color-text-primary)]">{localizedName(champion, locale)}</span>
            <span className="shrink-0 text-[var(--color-text-muted)]">+</span>
            <span className="truncate text-[var(--color-text-secondary)]">{localizedName(augment, locale)}</span>
          </li>
        ))}
      </ul>
      <Link href="/advisor" className="mt-3 flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline">
        {t("combosCta")} →
      </Link>
    </div>
  );
}
