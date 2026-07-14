import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function PatchPulseBanner({ patch, updatedAt }: { patch: string; updatedAt: string }) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(updatedAt));

  return (
    <div className="glass-card reveal col-span-full flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-neon-primary)]" aria-hidden="true" />
      <span className="text-sm font-medium text-[var(--color-text-primary)]">
        {t("patchLive", { patch })}
      </span>
      <span className="text-xs text-[var(--color-text-muted)]">{t("metaUpdated")}: {updated}</span>
      <Link
        href="/patch-notes"
        className="ml-auto flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline"
      >
        {t("seeWhatChanged")} →
      </Link>
    </div>
  );
}
