import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { localizedName } from "@/lib/i18n/localized-name";
import { languageAlternates, localizedUrl } from "@/lib/site";
import {
  readAugmentsFile,
  readChampionsFile,
  readCombosFile,
} from "@/lib/data/read-public-file";
import {
  normalizeLookupKey,
  resolveAugmentChampions,
  type ComboLookupEntry,
} from "@/lib/data/combo-lookup";
import type { AugmentRarity, AugmentType } from "@/lib/types";
import type { ComboTier } from "@/lib/scoring/oracle-score";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AugmentRecord {
  slug: string;
  name: string;
  rarity: AugmentRarity;
  type?: AugmentType;
  icon?: string;
  wikiDescription?: string;
  kit_tags?: string[];
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  flags?: {
    lifecycle?: string;
    lifecycle_patch?: string;
  };
}

interface ChampionRecord {
  slug: string;
  name: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadAugments(): Promise<AugmentRecord[]> {
  const data = await readAugmentsFile<{ augments: AugmentRecord[] }>();
  return data.augments;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const RARITY_BADGE: Record<AugmentRarity, string> = {
  prismatic: "rarity-prismatic border-current",
  gold: "rarity-gold border-current",
  silver: "rarity-silver border-current",
};

const TIER_BADGE: Record<ComboTier, string> = {
  S: "text-rose-300 bg-rose-400/15 border-rose-400/30",
  A: "text-amber-300 bg-amber-400/15 border-amber-400/30",
  B: "text-sky-300 bg-sky-400/15 border-sky-400/30",
  C: "text-slate-300 bg-slate-400/10 border-slate-400/20",
};

// ─── Static params ────────────────────────────────────────────────────────────

export const dynamicParams = false;

export async function generateStaticParams() {
  try {
    const augments = await loadAugments();
    return routing.locales.flatMap((locale) =>
      augments.map((augment) => ({ locale, slug: augment.slug })),
    );
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "augments" });
  const tChamp = await getTranslations({ locale, namespace: "champion" });
  const augments = await loadAugments();
  const augment = augments.find((a) => a.slug === slug);
  if (!augment) notFound();

  const name = localizedName(augment, locale);
  const rarity = {
    prismatic: tChamp("prismatic"),
    gold: tChamp("gold"),
    silver: tChamp("silver"),
  }[augment.rarity];
  const route = `/augments/${augment.slug}`;
  const title = t("metaDetailTitle", { name, rarity });
  const description = t("metaDetailDescription", { name, rarity });
  const url = localizedUrl(route, locale as Locale);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(route),
    },
    openGraph: { title, description, url, locale },
    twitter: { card: "summary_large_image", title, description },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AugmentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("augments");
  const tChamp = await getTranslations("champion");

  const augments = await loadAugments();
  const augment = augments.find((a) => a.slug === slug);
  if (!augment) notFound();

  const augmentName = localizedName(augment, locale);
  const rarityLabel: Record<AugmentRarity, string> = {
    prismatic: tChamp("prismatic"),
    gold: tChamp("gold"),
    silver: tChamp("silver"),
  };

  const typeBadgeKey =
    augment.type === "ability"
      ? "badgeAbility"
      : augment.type === "quest"
        ? "badgeQuest"
        : null;

  const isRemoved = augment.flags?.lifecycle === "removed";

  // "Strong on champions": reverse-lookup the public combo teaser, then resolve
  // each champion slug to a real champions.json record so we only link to pages
  // that exist.
  const [combosData, championsData] = await Promise.all([
    readCombosFile<{ combos: ComboLookupEntry[] }>(),
    readChampionsFile<{ champions: ChampionRecord[] }>(),
  ]);
  const championByKey = new Map(
    championsData.champions.map((c) => [normalizeLookupKey(c.slug), c]),
  );
  const strongOn = resolveAugmentChampions(slug, combosData.combos, augments)
    .map((combo) => ({
      ...combo,
      record: championByKey.get(normalizeLookupKey(combo.champion)),
    }))
    .filter((entry) => entry.record);

  const wikiUrl = `https://wiki.leagueoflegends.com/en-us/${encodeURIComponent(
    augment.name.replace(/ /g, "_"),
  )}`;

  return (
    <div className="py-8 max-w-3xl">
      {/* Back link + wiki link */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/augments"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {t("detailBack")}
        </Link>
        <a
          href={wikiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          LoL Wiki
        </a>
      </div>

      {/* ─── Header ─── */}
      <div className="flex items-start gap-6 mb-8">
        {augment.icon && (
          <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-[var(--color-border-hover)] shrink-0 bg-[var(--color-bg-card)]">
            <Image
              src={augment.icon}
              alt={augmentName}
              fill
              className="object-contain p-1"
              sizes="80px"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{augmentName}</h1>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${RARITY_BADGE[augment.rarity]}`}
            >
              {rarityLabel[augment.rarity]}
            </span>
            {typeBadgeKey && (
              <span className="text-xs font-medium px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                {t(typeBadgeKey)}
              </span>
            )}
            {isRemoved && (
              <span className="text-xs font-medium px-2 py-0.5 rounded border border-rose-400/30 bg-rose-400/10 text-rose-300">
                {augment.flags?.lifecycle_patch
                  ? t("detailRemovedIn", { patch: augment.flags.lifecycle_patch })
                  : t("badgeRemoved")}
              </span>
            )}
          </div>

          {augment.wikiDescription && (
            <p className="mt-3 text-[var(--color-text-secondary)] leading-relaxed">
              {augment.wikiDescription}
            </p>
          )}

          {augment.kit_tags && augment.kit_tags.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                {t("detailKitSynergy")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {augment.kit_tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] px-2 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Strong on champions ─── */}
      {strongOn.length > 0 && (
        <section className="glass-card p-5">
          <h2 className="text-lg font-semibold mb-3">{t("detailStrongOn")}</h2>
          <div className="flex flex-wrap gap-2">
            {strongOn.map(({ record, tier }) => (
              <Link
                key={record!.slug}
                href={`/champions/${record!.slug}`}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-sm hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
              >
                <span>{localizedName(record!, locale)}</span>
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${TIER_BADGE[tier]}`}>
                  {tier}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
