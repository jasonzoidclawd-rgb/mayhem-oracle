import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { readChampionsFile, readAugmentsFile, readMetaFile } from "@/lib/data/read-public-file";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  const { champions, patch } = await readChampionsFile<{ champions: unknown[]; patch: string }>();
  const { augments } = await readAugmentsFile<{ augments: unknown[] }>();
  const { scraped_at } = await readMetaFile<{ scraped_at?: string }>();
  const champCount = (champions as unknown[]).length;
  const augCount = (augments as unknown[]).length;
  const patchLabel = (patch as string).replace(/\.$/, "");
  const lastUpdatedLabel = scraped_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(scraped_at))
    : patchLabel;

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
          <StatCard label={t("lastUpdated")} value={lastUpdatedLabel} />
        </div>
      </section>

      {/* ─── Feature Highlights ─── */}
      <section className="w-full max-w-5xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t("featuresTitle")}</h2>
          <p className="mt-2 text-[var(--color-text-muted)]">{t("featuresSubtitle")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            href="/tier-list"
            icon="🏆"
            title={t("feat1Title")}
            body={t("feat1Body")}
          />
          <FeatureCard
            href="/augments"
            icon="✨"
            title={t("feat2Title")}
            body={t("feat2Body")}
          />
          <FeatureCard
            href="/damage-sim"
            icon="🧮"
            title={t("feat3Title")}
            body={t("feat3Body")}
          />
          <FeatureCard
            href="/membership"
            icon="🔮"
            title={t("feat4Title")}
            body={t("feat4Body")}
            tag={t("feat4Tag")}
          />
        </div>
      </section>

      {/* ─── Members CTA band ─── */}
      <section className="w-full max-w-4xl">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.06] to-transparent px-6 py-10 text-center sm:px-10">
          <h2 className="text-2xl font-bold tracking-tight">{t("ctaBandTitle")}</h2>
          <p className="max-w-xl text-[var(--color-text-secondary)]">{t("ctaBandBody")}</p>
          <Link
            href="/membership"
            className="mt-2 rounded-lg bg-amber-400/90 px-6 py-3 font-semibold text-black transition hover:bg-amber-300"
          >
            {t("ctaBandButton")}
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  href,
  icon,
  title,
  body,
  tag,
}: {
  href: string;
  icon: string;
  title: string;
  body: string;
  tag?: string;
}) {
  return (
    <Link
      href={href}
      className="glass-card group flex flex-col gap-2 p-5 text-left transition hover:-translate-y-0.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">
          {icon}
        </span>
        {tag ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-amber-300">
            {tag}
          </span>
        ) : null}
      </div>
      <h3 className="font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{body}</p>
    </Link>
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
