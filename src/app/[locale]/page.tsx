import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { readFile } from "fs/promises";
import path from "path";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  const dataDir = path.join(process.cwd(), "public", "data");
  const [champRaw, augRaw] = await Promise.all([
    readFile(path.join(dataDir, "champions.json"), "utf-8"),
    readFile(path.join(dataDir, "augments.json"), "utf-8"),
  ]);
  const { champions, patch } = JSON.parse(champRaw);
  const { augments } = JSON.parse(augRaw);
  const champCount = (champions as unknown[]).length;
  const augCount = (augments as unknown[]).length;
  const patchLabel = (patch as string).replace(/\.$/, "");

  return (
    <div className="flex flex-col items-center gap-12 py-12">
      {/* ─── Hero ─── */}
      <section className="text-center max-w-2xl">
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4">
          <span className="bg-gradient-to-r from-[var(--color-neon-primary)] to-[var(--color-neon-secondary)] bg-clip-text text-transparent">
            {t("hero")}
          </span>
        </h1>
        <p className="text-xl text-[var(--color-text-secondary)] mb-2">
          {t("subtitle")}
        </p>
        <p className="text-[var(--color-text-muted)]">
          {t("description")}
        </p>

        {/* CTAs */}
        <div className="flex gap-4 justify-center mt-8">
          <Link
            href="/tier-list"
            className="px-6 py-3 rounded-lg font-medium text-white
                       bg-gradient-to-r from-[var(--color-neon-primary)] to-[var(--color-neon-secondary)]
                       hover:opacity-90 transition-opacity"
          >
            {t("ctaTierList")}
          </Link>
          <Link
            href="/champions"
            className="px-6 py-3 rounded-lg font-medium neon-border
                       text-[var(--color-neon-primary)] hover:bg-[var(--color-neon-glow)]
                       transition-colors"
          >
            {t("ctaChampion")}
          </Link>
        </div>
      </section>

      {/* ─── Stats Cards ─── */}
      <section className="w-full max-w-3xl">
        <h2 className="text-lg font-medium text-[var(--color-text-secondary)] mb-4 text-center">
          {t("statsTitle")}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label={t("championsTracked")} value={String(champCount)} />
          <StatCard label={t("augmentsScored")} value={String(augCount)} />
          <StatCard label={t("patchVersion")} value={patchLabel} />
          <StatCard label={t("lastUpdated")} value={patchLabel} />
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card p-4 text-center">
      <p className="text-2xl font-bold text-[var(--color-text-primary)]">
        {value}
      </p>
      <p className="text-xs text-[var(--color-text-muted)] mt-1">{label}</p>
    </div>
  );
}
