import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata() {
  const t = await getTranslations("notFound");
  return { title: t("title") };
}

export default async function LocalizedNotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-neon-primary)]">404</p>
      <h1 className="mt-3 text-3xl font-bold text-[var(--color-text-primary)]">{t("title")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t("body")}</p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-[var(--color-border-hover)] px-4 text-sm font-medium text-[var(--color-neon-primary)]"
      >
        {t("cta")}
      </Link>
    </main>
  );
}
