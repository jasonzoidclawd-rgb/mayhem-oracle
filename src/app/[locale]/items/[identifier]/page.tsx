import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { routing, type Locale } from "@/i18n/routing";
import type { Item } from "@/lib/types";
import { localizedName } from "@/lib/i18n/localized-name";
import { buildItemDetailJsonLd } from "@/lib/seo/item-detail";
import { buildPatchSummary } from "@/lib/seo/patch-summary";
import { readItemsFile, readMetaFile } from "@/lib/data/read-public-file";
import { readEntityPresentationFile } from "@/lib/data/read-public-file";
import { languageAlternates, localizedUrl } from "@/lib/site";
import { resolveEntityRef, unknownEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData } from "@/lib/entities/types";
import { EntityLink } from "@/components/entities/EntityLink";
import { EntityRecordStats, EntitySectionHeading, EntityTag } from "@/components/entities/EntityPresentation";
import { buildEntityRouteSets } from "@/lib/entities/routes";

// Raw Riot API category identifier → translation key in items namespace.
const CATEGORY_LABEL_KEY: Record<string, string> = {
  Damage:            "catDamage",
  SpellDamage:       "catSpellDamage",
  Health:            "catHealth",
  Armor:             "catArmor",
  MagicResist:       "catMagicResist",
  SpellBlock:        "catMagicResist",
  AttackSpeed:       "catAttackSpeed",
  Mana:              "catMana",
  LifeSteal:         "catLifeSteal",
  Boots:             "catBoots",
  CriticalStrike:    "catCriticalStrike",
  AbilityHaste:      "catAbilityHaste",
  CooldownReduction: "catAbilityHaste",
  HealthRegen:       "catHealthRegen",
  ManaRegen:         "catManaRegen",
  MagicPenetration:  "catMagicPenetration",
  ArmorPenetration:  "catArmorPenetration",
  NonbootsMovement:  "catNonbootsMovement",
  SpellVamp:         "catSpellVamp",
  OnHit:             "catOnHit",
  Active:            "catActive",
  Aura:              "catAura",
  GoldPer:           "catGoldPer",
  Tenacity:          "catTenacity",
  Slow:              "catSlow",
  Vision:            "catVision",
  Stealth:           "catStealth",
  Bilgewater:        "catBilgewater",
  Consumable:        "catConsumable",
  Trinket:           "catTrinket",
  Jungle:            "catJungle",
  Lane:              "catLane",
};

const HIDDEN_CATEGORY_IDS = new Set(["Lane", "Bilgewater", "Trinket", "Consumable", "Jungle"]);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ItemsData {
  mayhemExclusive: Item[];
  items: Item[];
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadItemsData(): Promise<ItemsData> {
  return readItemsFile<ItemsData>();
}

function findItem(data: ItemsData, identifier: string): Item | undefined {
  const mayhemItem = data.mayhemExclusive.find((i) => i.slug === identifier);
  if (mayhemItem) return mayhemItem;
  const id = parseInt(identifier, 10);
  if (!isNaN(id)) return data.items.find((i) => i.id === id);
  return undefined;
}

/** For a Mayhem-modified item (id >= 200 000), find the base item (id - 220 000). */
function findBaseItem(data: ItemsData, item: Item): Item | undefined {
  if (item.id == null || item.id < 200_000) return undefined;
  const baseId = item.id - 220_000;
  return data.items.find((i) => i.id === baseId);
}

/**
 * Build a name → Item lookup for linking recipe components.
 * When multiple items share a name (base id + Mayhem id), prefer the
 * Mayhem-modified version (higher id) so links go to the Mayhem page.
 */
function buildNameToItemMap(items: Item[]): Map<string, Item> {
  const map = new Map<string, Item>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const prev = map.get(key);
    if (!prev || (item.id ?? 0) > (prev.id ?? 0)) {
      map.set(key, item);
    }
  }
  return map;
}

// ─── Static params ────────────────────────────────────────────────────────────

export const dynamicParams = false;

export async function generateStaticParams() {
  // No try/catch: with dynamicParams=false a data read failure must fail the
  // build loudly instead of publishing a site with zero item pages.
  const data = await loadItemsData();
  const routes = buildEntityRouteSets({
    champions: [],
    augments: [],
    items: data,
  });
  return routing.locales.flatMap((locale) =>
    [...routes.item].map((identifier) => ({ locale, identifier })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; identifier: string }>;
}): Promise<Metadata> {
  const { locale, identifier } = await params;
  const t = await getTranslations({ locale, namespace: "items" });
  const data = await loadItemsData();
  const item = findItem(data, identifier);
  if (!item) notFound();

  const name = localizedName(item, locale);
  const route = `/items/${identifier}`;
  const title = t("metaDetailTitle", { name });
  const description = t("metaDetailDescription", { name });
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const MAYHEM_TAG_STYLES: Record<string, string> = {
  exclusive:      "text-purple-300 bg-purple-400/15 border-purple-400/30",
  modified:       "text-blue-300 bg-blue-400/15 border-blue-400/30",
  "quest-reward": "text-amber-300 bg-amber-400/15 border-amber-400/30",
};

const TIER_BADGE_STYLES: Record<string, string> = {
  starter:   "text-gray-300 bg-gray-400/10 border-gray-400/20",
  basic:     "text-slate-300 bg-slate-400/10 border-slate-400/20",
  epic:      "text-violet-300 bg-violet-400/10 border-violet-400/20",
  legendary: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  boots:     "text-teal-300 bg-teal-400/10 border-teal-400/20",
};

const TIER_LABEL_KEY: Record<string, string> = {
  starter: "tierStarter", basic: "tierBasic", epic: "tierEpic",
  legendary: "tierLegendary", boots: "tierBoots",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ locale: string; identifier: string }>;
}) {
  const { locale, identifier } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("items");
  const te = await getTranslations("entities");

  const [data, entityPresentation] = await Promise.all([
    loadItemsData(),
    readEntityPresentationFile<EntityPresentationData>(),
  ]);
  const item = findItem(data, identifier);
  if (!item) notFound();
  const itemName = localizedName(item, locale);
  const entityRef = resolveEntityRef(
    entityPresentation,
    "item",
    { canonicalId: item.id != null ? String(item.id) : undefined, slug: item.slug },
    locale,
  ) ?? unknownEntityRef("item", {
    id: item.id,
    slug: item.slug,
    name: itemName,
    iconUrl: item.icon,
  });
  const entityRecord = entityRef
    ? entityPresentation.entities.find(
        (record) => record.type === "item" && record.canonical_id === entityRef.canonicalId,
      )
    : null;

  const nameToItem = buildNameToItemMap(data.items);

  // For Mayhem-modified items, also load the base item for comparison
  const baseItem = findBaseItem(data, item);
  const isModified = !!baseItem;

  // Auto-detect mayhemTag if not set (items auto-tagged in the list page aren't
  // stored in JSON, so detect it here from the id for the detail page)
  const effectiveTag: Item["mayhemTag"] =
    item.mayhemTag ??
    (item.id != null && item.id >= 200_000
      ? isModified ? "modified" : "exclusive"
      : undefined);

  // Wiki stats are the STANDARD-mode values, which differ for modified items
  // (e.g. Rabadon's wiki says 130 AP; Mayhem version has 65 AP).
  // Only use wikiStats for exclusive items that don't have a modified base.
  const isVoidImmolation = item.id === 223069;
  const effectBlocks = isVoidImmolation
    ? [
        { name: t("voidImmolationImmolateLabel"), text: t("voidImmolationImmolate") },
        { name: t("voidImmolationDesolateLabel"), text: t("voidImmolationDesolate") },
      ]
    : (item.wikiPassives ?? []).map((block) => ({
        name: block.label,
        text: block.text,
      }));
  const gameplayNotes = isVoidImmolation
    ? [t("voidImmolationNote")]
    : item.wikiNotes ?? [];

  // Deduplicate category labels (SpellBlock and MagicResist both share the same localized label)
  const categoryLabels = [
    ...new Set(
      (item.categories ?? [])
        .filter((c) => !HIDDEN_CATEGORY_IDS.has(c))
        .map((c) => {
          const key = CATEGORY_LABEL_KEY[c];
          return key ? t(key) : c;
        }),
    ),
  ];

  const mayhemTagLabel: Record<string, string> = {
    exclusive:      t("exclusive"),
    modified:       t("modified"),
    "quest-reward": t("questReward"),
  };
  const tierLabel = item.tier ? t(TIER_LABEL_KEY[item.tier]) : undefined;

  // Wiki URL: spaces → underscores, apostrophes encoded
  const wikiUrl = `https://wiki.leagueoflegends.com/en-us/${encodeURIComponent(item.name.replace(/ /g, "_"))}`;
  const route = `/items/${identifier}`;
  // items.json carries no patch field; meta.json is the public patch source.
  const meta = await readMetaFile<{ patch?: string }>();
  const patchSummary = buildPatchSummary(
    { patch: meta.patch },
    {
      title: t("patchSummaryTitle"),
      body: ({ patch }) => t("patchSummaryBody", { name: itemName, patch }),
    },
  );
  const itemJsonLd = buildItemDetailJsonLd(item, locale, {
    url: localizedUrl(route, locale as Locale),
    homeUrl: localizedUrl("/", locale as Locale),
    itemsUrl: localizedUrl("/items", locale as Locale),
    itemsLabel: t("title"),
    name: itemName,
    description: t("metaDetailDescription", { name: itemName }),
    identifier,
    tierLabel,
    tagLabel: effectiveTag ? mayhemTagLabel[effectiveTag] : undefined,
    categoryLabels,
  });

  return (
    <>
      <JsonLd data={itemJsonLd} />
      <div className="py-8 max-w-3xl">
        {/* Back link + wiki link */}
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/items"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t("backToItems")}
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
              <h1 className="text-3xl font-bold">{itemName}</h1>
            )}
            {effectiveTag && (
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${MAYHEM_TAG_STYLES[effectiveTag]}`}
              >
                {mayhemTagLabel[effectiveTag]}
              </span>
            )}
            {item.tier && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${TIER_BADGE_STYLES[item.tier]}`}>
                {tierLabel}
              </span>
            )}
            {entityRef.lifecycle === "active" ? <EntityTag tone="cyan">{te("activeLabel")}</EntityTag> : null}
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {item.cost > 0 && (
              <p className="text-amber-400 font-semibold text-lg">
                {item.cost.toLocaleString()} {t("goldUnit")}
              </p>
            )}
            {isModified && baseItem && baseItem.cost !== item.cost && (
              <p className="text-[var(--color-text-muted)] text-sm line-through">
                {baseItem.cost.toLocaleString()} {t("goldUnit")}
              </p>
            )}
          </div>

          {categoryLabels.length > 0 && (
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              {categoryLabels.map((label) => (
                <span
                  key={label}
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--color-border-default)] text-[var(--color-text-muted)]"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

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

      {entityRecord ? (
        <EntityRecordStats
          record={{
            ...entityRecord,
            // Mayhem catalog values are authoritative for item identity and
            // stats; omit the generic CDragon cost projection when it would
            // contradict the route-specific record.
            stats: entityRecord.stats.filter((stat) => stat.key !== "cost"),
            patch_changes: entityRecord.patch_changes
              .filter((change) => change.key !== "cost")
              .map((change) =>
                isVoidImmolation && change.key === "semantic_passive_added_desolate"
                  ? {
                      ...change,
                      after: `${t("voidImmolationDesolateLabel")}: ${t("voidImmolationDesolate")}`,
                    }
                  : change,
              ),
          }}
          heading={te("statsHeading")}
          labelFor={(key) => te(key)}
          previewLabel={te("previewLabel")}
          liveLabel={te("liveLabel")}
          landedLabel={te("landedLabel")}
          hotfixLabel={te("hotfixLabel")}
          directionFor={(direction) => te(`direction.${direction}`)}
        />
      ) : null}

      {item.stats ? (
        <section className="mt-5" aria-labelledby="item-stats-heading">
          <EntitySectionHeading><span id="item-stats-heading">{te("statsHeading")}</span></EntitySectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {item.stats.split(",").map((stat) => stat.trim()).filter(Boolean).map((stat) => (
              <EntityTag key={stat} tone="cyan">{stat}</EntityTag>
            ))}
          </div>
        </section>
      ) : null}

      {isVoidImmolation ? (
        <section className="glass-card p-5" aria-labelledby="item-description-heading">
          <h2 id="item-description-heading" className="text-sm font-semibold mb-2">
            {t("descriptionHeading")}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{t("voidImmolationDescription")}</p>
        </section>
      ) : entityRecord?.description ? (
        <section className="glass-card p-5" aria-labelledby="item-description-heading">
          <h2 id="item-description-heading" className="text-sm font-semibold mb-2">
            {t("descriptionHeading")}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{entityRecord.description}</p>
        </section>
      ) : null}

      {/* ─── Neutral effect prose ───────────────────────────────────────────── */}
      {effectBlocks.length > 0 && (
        <section className="mb-6">
          <SectionHeading>{t("effect")}</SectionHeading>
          <div className="space-y-3">
            {effectBlocks.map((block, i) => (
              <div key={i} className="p-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40">
                <p className="text-sm font-bold text-[var(--color-neon-primary)] mb-1.5">{block.name}</p>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{block.text}</p>
              </div>
            ))}
            {isModified ? (
              <p className="text-[11px] text-[var(--color-text-muted)] pl-1">⚠ {t("passiveStandardModeNote")}</p>
            ) : null}
          </div>
        </section>
      )}

      {/* ─── Gameplay Notes (from wiki) — only shown when the item has a passive in Mayhem ─── */}
      {gameplayNotes.length > 0 && (!isModified || effectBlocks.length > 0) && (
        <section className="mb-6">
          <SectionHeading>{t("gameplayNotes")}</SectionHeading>
          <ul className="space-y-2">
            {gameplayNotes.map((note, i) => (
              <li
                key={i}
                className="flex gap-3 p-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40"
              >
                <span className="text-[var(--color-neon-primary)] shrink-0 mt-0.5">•</span>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Recipe ─── */}
      {item.recipe && item.recipe.length > 0 && (
        <section className="mb-6">
          <SectionHeading>{t("recipe")}</SectionHeading>
          <div className="flex flex-wrap items-center gap-2">
            {item.recipe.flatMap((component, i) => {
              const compItem = nameToItem.get(component.toLowerCase());
              const componentRef = compItem
                ? resolveEntityRef(entityPresentation, "item", { canonicalId: compItem.id != null ? String(compItem.id) : undefined, slug: compItem.slug }, locale)
                : null;
              const badge = (
                <EntityLink
                  entity={componentRef ?? unknownEntityRef("item", {
                    id: compItem?.id,
                    slug: compItem?.slug,
                    name: compItem ? localizedName(compItem, locale) : component,
                    iconUrl: compItem?.icon,
                  })}
                  variant="compact"
                />
              );
              const linked = componentRef
                ? <span key={`comp-${i}`} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60 px-3 py-1.5">{badge}<span className="text-amber-400/70 text-xs">{compItem?.cost.toLocaleString()}g</span></span>
                : <span key={`comp-${i}`} className="inline-flex rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60 px-3 py-1.5">{badge}</span>;
              return i === 0
                ? [linked]
                : [<span key={`plus-${i}`} className="text-[var(--color-text-muted)] select-none">+</span>, linked];
            })}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 pl-1">
            {t("recipeNote")}
          </p>
        </section>
      )}
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <EntitySectionHeading>{children}</EntitySectionHeading>;
}
