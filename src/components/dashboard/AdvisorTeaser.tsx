import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function AdvisorTeaser() {
  const t = await getTranslations("dashboard");

  return (
    <div className="glass-card neon-border reveal p-4 md:col-span-3 lg:col-span-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("advisorTitle")}</h3>
        <span className="shrink-0 rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5 text-xs text-[var(--color-neon-primary)]">
          {t("advisorTag")}
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t("advisorBody")}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[t("advisorHot"), t("advisorSteady"), t("advisorReroll")].map((label) => (
          <span
            key={label}
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)] border border-[var(--color-border-default)]"
          >
            {label}
          </span>
        ))}
      </div>
      <Link
        href="/advisor"
        className="mt-3 flex min-h-11 items-center text-sm text-[var(--color-neon-primary)] hover:underline"
      >
        {t("advisorUnlock")} →
      </Link>
    </div>
  );
}
