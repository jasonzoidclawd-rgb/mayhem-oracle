import { getTranslations, getLocale } from "next-intl/server";

export async function MetaAtAGlance({
  sPlusCount,
  championCount,
  augmentCount,
  changedAugmentCount,
  patch,
  updatedAt,
}: {
  sPlusCount: number;
  championCount: number;
  augmentCount: number;
  changedAugmentCount: number;
  patch: string;
  updatedAt: string;
}) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(updatedAt));

  const rows: Array<[string, string | number]> = [
    [t("metaSPlus"), sPlusCount],
    [t("metaChampions"), championCount],
    [t("metaAugments"), augmentCount],
    [t("metaChangedAugments"), changedAugmentCount],
    [t("metaPatch"), patch],
    [t("metaUpdated"), updated],
  ];

  return (
    <div className="glass-card reveal p-4 md:col-span-3 lg:col-span-4">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("metaTitle")}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
