import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { routing, type Locale } from "@/i18n/routing";
import { localizedDescription, localizedName } from "@/lib/i18n/localized-name";
import { languageAlternates, localizedUrl } from "@/lib/site";
import { buildAugmentDetailJsonLd } from "@/lib/seo/augment-detail";
import { buildPatchSummary } from "@/lib/seo/patch-summary";
import {
  readAugmentsFile,
  readChampionsFile,
  readCombosFile,
  readEntityPresentationFile,
} from "@/lib/data/read-public-file";
import {
  normalizeLookupKey,
  resolveAugmentChampions,
  type ComboLookupEntry,
} from "@/lib/data/combo-lookup";
import type { AugmentRarity, AugmentType } from "@/lib/types";
import { resolveEntityRef, unknownEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";
import { EntityRecordStats, EntitySectionHeading, EntityTag } from "@/components/entities/EntityPresentation";
import { buildEntityRouteSets } from "@/lib/entities/routes";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AugmentRecord {
  augmentId?: string;
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

interface AugmentsData {
  patch?: string;
  augments: AugmentRecord[];
}

interface ChampionRecord {
  slug: string;
  name: string;
  icon?: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadAugmentsData(): Promise<AugmentsData> {
  return readAugmentsFile<AugmentsData>();
}

async function loadAugments(): Promise<AugmentRecord[]> {
  const data = await loadAugmentsData();
  return data.augments;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const RARITY_BADGE: Record<AugmentRarity, string> = {
  prismatic: "rarity-prismatic border-current",
  gold: "rarity-gold border-current",
  silver: "rarity-silver border-current",
};

// ─── Static params ────────────────────────────────────────────────────────────

export const dynamicParams = false;

export async function generateStaticParams() {
  // No try/catch: with dynamicParams=false a data read failure must fail the
  // build loudly instead of publishing a site with zero augment pages.
  const augments = await loadAugments();
  const routes = buildEntityRouteSets({
    champions: [],
    augments,
    items: { items: [], mayhemExclusive: [] },
  });
  return routing.locales.flatMap((locale) =>
    [...routes.augment].map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "augments" });
  const tChamp = await getTranslations({ locale, namespace: "champion" });
  const augmentsData = await loadAugmentsData();
  const augments = augmentsData.augments;
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
  const te = await getTranslations("entities");

  const augmentsData = await loadAugmentsData();
  const augments = augmentsData.augments;
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

  // "Strong on champions": reverse-lookup the public combo teaser, then resolve
  // each champion slug to a real champions.json record so we only link to pages
  // that exist.
  const [combosData, championsData, entityPresentation] = await Promise.all([
    readCombosFile<{ combos: ComboLookupEntry[] }>(),
    readChampionsFile<{ champions: ChampionRecord[] }>(),
    readEntityPresentationFile<EntityPresentationData>(),
  ]);
  const entityRef = resolveEntityRef(
    entityPresentation,
    "augment",
    { canonicalId: augment.augmentId, slug },
    locale,
  ) ?? unknownEntityRef("augment", {
    id: augment.augmentId,
    slug,
    name: augmentName,
    iconUrl: augment.icon,
  });
  const entityRecord = entityRef
    ? entityPresentation.entities.find(
        (record) => record.type === "augment" && record.canonical_id === entityRef.canonicalId,
      )
    : null;
  const isRemoved = entityRecord
    ? entityRecord.lifecycle.state === "removed"
    : augment.flags?.lifecycle === "removed";
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
  const route = `/augments/${augment.slug}`;
  const pageUrl = localizedUrl(route, locale as Locale);
  const augmentJsonLd = buildAugmentDetailJsonLd(augment, locale, {
    url: pageUrl,
    homeUrl: localizedUrl("/", locale as Locale),
    name: augmentName,
    description:
      augment.wikiDescription ??
      t("metaDetailDescription", {
        name: augmentName,
        rarity: rarityLabel[augment.rarity],
      }),
    augmentsUrl: localizedUrl("/augments", locale as Locale),
    augmentsLabel: t("title"),
    rarityLabel: rarityLabel[augment.rarity],
  });
  const patchSummary = buildPatchSummary(
    {
      patch: augmentsData.patch,
      lifecycleState: augment.flags?.lifecycle,
      lifecyclePatch: augment.flags?.lifecycle_patch,
    },
    {
      title: t("patchSummaryTitle"),
      body: ({ patch }) => t("patchSummaryBody", { name: augmentName, patch }),
      removed: ({ patch }) => t("patchSummaryRemoved", { name: augmentName, patch }),
    },
  );

  return (
    <>
      <JsonLd data={augmentJsonLd} />
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
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              {entityRef ? (
                <h1><EntityLink entity={entityRef} variant="hero" className="font-bold" /></h1>
              ) : (
                <h1 className="text-3xl font-bold">{augmentName}</h1>
              )}
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
              {!isRemoved && entityRef.lifecycle === "active" ? <EntityTag tone="cyan">{te("activeLabel")}</EntityTag> : null}
            </div>

            {augment.kit_tags && augment.kit_tags.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-[var(--color-text-muted)] mb-1.5">
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

        {entityRecord ? (
          <EntityRecordStats
            record={entityRecord}
            heading={te("statsHeading")}
            labelFor={(key) => te(key)}
            previewLabel={te("previewLabel")}
            liveLabel={te("liveLabel")}
            landedLabel={te("landedLabel")}
            hotfixLabel={te("hotfixLabel")}
            directionFor={(direction) => te(`direction.${direction}`)}
          />
        ) : null}

        {patchSummary && (
          <section className="glass-card p-4 mb-6" aria-labelledby="patch-summary-heading">
            <h2 id="patch-summary-heading" className="text-sm font-semibold mb-2">
              {patchSummary.title}
            </h2>
            <div className="space-y-1.5">
              {patchSummary.lines.map((line, index) => (
                <p key={index} className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  {line}
                </p>
              ))}
            </div>
          </section>
        )}

        {(localizedDescription(augment, locale) || augment.wikiDescription) && (
          <section className="glass-card p-5 mb-6" aria-labelledby="augment-description-heading">
            <EntitySectionHeading><span id="augment-description-heading">{t("descriptionHeading")}</span></EntitySectionHeading>
            <p className="text-[var(--color-text-secondary)] leading-relaxed">{localizedDescription(augment, locale) || augment.wikiDescription}</p>
          </section>
        )}

        {/* ─── Strong on champions ─── */}
        {strongOn.length > 0 && (
          <section className="glass-card p-5">
            <h2 className="text-lg font-semibold mb-3">{t("detailStrongOn")}</h2>
            <div className="flex flex-wrap gap-2">
              {strongOn.map(({ record, tier }) => (
                <span key={record!.slug} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-sm transition-colors">
                  <EntityLink
                    entity={resolveEntityRef(entityPresentation, "champion", { slug: record!.slug }, locale) ?? unknownEntityRef("champion", {
                      slug: record!.slug,
                      name: localizedName(record!, locale),
                      iconUrl: record!.icon,
                    })}
                    variant="compact"
                  />
                  <EntityTag tone={tier === "S" ? "green" : tier === "C" ? "red" : "amber"}>
                    {tier === "S" ? t("strongOnTierStrong") : tier === "C" ? t("strongOnTierAvoid") : t("strongOnTierRelated")}
                  </EntityTag>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
