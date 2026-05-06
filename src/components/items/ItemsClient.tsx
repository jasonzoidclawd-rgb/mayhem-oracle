"use client";

import Image from "next/image";
import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Item } from "@/lib/types";
import { Tooltip } from "@/components/ui/Tooltip";

const MAYHEM_TAG_STYLES: Record<string, string> = {
  exclusive:      "rarity-prismatic",
  modified:       "text-blue-300 bg-blue-400/15 border-blue-400/30",
  "quest-reward": "rarity-gold",
};

// Internal category ID → translation key in items namespace (for filter chips)
const CATEGORY_LABEL_KEY: Record<string, string> = {
  Damage:      "catDamage",
  SpellDamage: "catSpellDamage",
  Health:      "catHealth",
  Armor:       "catArmor",
  MagicResist: "catMagicResist",
  AttackSpeed: "catAttackSpeed",
  Mana:        "catMana",
  LifeSteal:   "catLifeSteal",
  Boots:       "catBoots",
};

// Friendly display names for all raw Riot API category IDs
export const CATEGORY_DISPLAY_NAME: Record<string, string> = {
  Damage:            "Attack Damage",
  SpellDamage:       "Ability Power",
  Health:            "Health",
  Armor:             "Armor",
  MagicResist:       "Magic Resist",
  SpellBlock:        "Magic Resist",   // legacy API alias
  AttackSpeed:       "Attack Speed",
  Mana:              "Mana",
  LifeSteal:         "Life Steal",
  Boots:             "Boots",
  CriticalStrike:    "Crit Strike",
  AbilityHaste:      "Ability Haste",
  CooldownReduction: "Ability Haste",  // legacy API alias
  HealthRegen:       "Health Regen",
  ManaRegen:         "Mana Regen",
  MagicPenetration:  "Magic Pen",
  ArmorPenetration:  "Armor Pen",
  NonbootsMovement:  "Move Speed",
  SpellVamp:         "Omnivamp",
  OnHit:             "On-Hit",
  Active:            "Active",
  Aura:              "Aura",
  GoldPer:           "Gold Income",
  Tenacity:          "Tenacity",
  Slow:              "Slow",
  Vision:            "Vision",
  Stealth:           "Stealth",
  Bilgewater:        "Bilgewater",
  Consumable:        "Consumable",
  Trinket:           "Trinket",
  Jungle:            "Jungle",
  Lane:              "Lane",
};

// Some filters cover multiple legacy API names (SpellBlock = MagicResist, etc.)
const FILTER_ALIASES: Record<string, string[]> = {
  MagicResist: ["MagicResist", "SpellBlock"],
  AttackSpeed: ["AttackSpeed"],
};

// Summoner's Rift support-quest items (World Atlas → Wardstone evolution chain)
const SR_SUPPORT_QUEST_IDS = new Set([
  3865, 3869, 3870, 3871, 3876, 3877,   // World Atlas and evolutions
  4638, 4643,                            // Watchful / Vigilant Wardstone
]);

// Arena mode (2v2v2v2) exclusive items — not available in ARAM Mayhem
const ARENA_ITEM_IDS = new Set([4012, 4013, 4015, 4016, 4017]);

// Shop-mechanic "items" — in-client UI elements, not real equipment.
// The selection consumables (Prismatic Item, Legendary Fighter Item, etc.) are
// all in the 220 000–221 999 range AND carry a "Consumable" category.
// Real Mayhem-modified components (e.g. 221 038 B. F. Sword) share the same
// ID range but are NOT consumables, so we gate on both conditions.
function isShopMechanic(item: Item): boolean {
  const id = item.id ?? 0;
  return (
    id >= 220_000 &&
    id < 222_000 &&
    (item.categories?.includes("Consumable") ?? false)
  );
}

// Specific non-Mayhem items by ID
const NON_MAYHEM_IDS = new Set([
  // SR only
  2055,               // Control Ward
  // Event consumables
  2161, 2162, 2163,   // Bandle Juice
  2142, 2143, 2144,   // Juice of Power/Vitality/Haste
  222141,             // Cappa Juice
  // Test/placeholder items
  6032, 550007,
  // Removed-from-game base items
  3128,               // Deathfire Grasp (removed patch 5.11)
  2020,               // The Brutalizer (removed, merged into Black Cleaver)
  2019,               // Steel Sigil (Arena item)
  2021,               // Tunneler (Arena item)
  // Arena-modified items that slipped through cost check
  663064,             // Veigar's Talisman of Ascension (modified Arena item, $900)
  226676,             // Duplicate Collector entry ($2500 Arena price, deduped by page.tsx)
  220007,             // Prismatic Item shop UI (also caught by isShopMechanic)
  994403,             // "Golden Spatula" — duplicate of "The Golden Spatula" in mayhemExclusive
]);

/** Items that don't belong in the ARAM Mayhem pool. */
function isOtherModeItem(item: Item): boolean {
  const id = item.id ?? 0;
  if (id >= 5000 && id < 6000) return true;                              // URF items
  if (SR_SUPPORT_QUEST_IDS.has(id)) return true;                        // SR/Wardstone items
  if (ARENA_ITEM_IDS.has(id)) return true;                              // Arena (4xxx) items
  if (isShopMechanic(item)) return true;                                 // in-shop UI consumables
  if (NON_MAYHEM_IDS.has(id)) return true;                              // specific non-Mayhem items

  // Mayhem-modified Arena Prismatic items: base id is 440 000–449 999 (Arena range),
  // giving ids 663xxx/664xxx/667xxx with mayhemTag="modified".
  // "exclusive"-tagged siblings (e.g. 667 666 The Collector) have no Arena base → kept.
  if (id >= 660_000 && item.mayhemTag === "modified") return true;

  // All id >= 200 000 items priced at exactly $1 000 are Arena or removed items.
  // Confirmed Mayhem-modified items cost $1 300+ (e.g. B.F. Sword $1 300, boots $500).
  if (id >= 200_000 && item.cost === 1000) return true;

  if (
    item.categories?.includes("Jungle") &&
    !item.categories?.includes("Consumable")
  ) return true;                                                          // SR Jungle items
  return false;
}

// Category filter values must exactly match the keys in item.categories[]
const CATEGORY_FILTERS = [
  "All",
  "Damage",
  "SpellDamage",
  "Health",
  "Armor",
  "MagicResist",
  "AttackSpeed",
  "Mana",
  "LifeSteal",
  "Boots",
];

/** Returns the URL identifier for an item: slug for mayhem items, numeric id otherwise */
function itemIdentifier(item: Item): string | null {
  if (item.mayhemTag && item.slug) return item.slug;
  if (item.id != null) return String(item.id);
  return null;
}

export function ItemsClient({
  mayhemExclusive,
  items,
}: {
  mayhemExclusive: Item[];
  items: Item[];
}) {
  const t = useTranslations("items");
  const [tab, setTab] = useState<"mayhem" | "all">(
    mayhemExclusive.length > 0 ? "mayhem" : "all"
  );
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const filteredItems = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((item) => item.name.toLowerCase().includes(q));
    }
    if (category !== "All") {
      const aliases = FILTER_ALIASES[category] ?? [category];
      list = list.filter((item) => item.categories?.some((c) => aliases.includes(c)));
    }
    return list;
  }, [items, search, category]);

  return (
    <div>
      {/* Tab toggle */}
      <div className="flex gap-2 mb-6">
        {(["mayhem", "all"] as const).map((tab_) => (
          <button
            key={tab_}
            onClick={() => setTab(tab_)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
              ${tab === tab_
                ? "border-[var(--color-neon-primary)] text-[var(--color-neon-primary)] bg-[var(--color-neon-primary)]/10"
                : "border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"
              }`}
          >
            {tab_ === "mayhem" ? t("mayhemExclusive") : t("allItems")}
          </button>
        ))}
      </div>

      {tab === "mayhem" ? (
        <MayhemExclusiveTab items={mayhemExclusive} />
      ) : (
        <AllItemsTab
          items={filteredItems}
          search={search}
          setSearch={setSearch}
          category={category}
          setCategory={setCategory}
        />
      )}
    </div>
  );
}

function MayhemExclusiveTab({ items }: { items: Item[] }) {
  const t = useTranslations("items");

  const groups: Record<string, Item[]> = {
    exclusive:      items.filter((i) => i.mayhemTag === "exclusive"),
    modified:       items.filter((i) => i.mayhemTag === "modified"),
    "quest-reward": items.filter((i) => i.mayhemTag === "quest-reward"),
  };

  const groupLabels: Record<string, string> = {
    exclusive:      t("modeExclusive"),
    modified:       t("modifiedItems"),
    "quest-reward": t("questRewardItems"),
  };

  const tagLabels: Record<string, string> = {
    exclusive:      t("exclusive"),
    modified:       t("modified"),
    "quest-reward": t("questReward"),
  };

  return (
    <div className="space-y-10">
      {Object.entries(groups).map(([tag, tagItems]) => {
        if (tagItems.length === 0) return null;
        return (
          <section key={tag}>
            <h2 className="text-base font-semibold mb-4 text-[var(--color-text-secondary)]">
              {groupLabels[tag]}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tagItems.map((item) => (
                <MayhemItemCard
                  key={item.slug}
                  item={item}
                  tagLabel={tagLabels[item.mayhemTag ?? "exclusive"]}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MayhemItemCard({ item, tagLabel }: { item: Item; tagLabel: string }) {
  const t = useTranslations("items");
  const tagStyle = MAYHEM_TAG_STYLES[item.mayhemTag ?? "exclusive"];
  const ident = itemIdentifier(item);

  const cardContent = (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60 hover:border-[var(--color-border-hover)] transition-colors">
      <div className="flex items-start gap-3">
        {item.icon ? (
          <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-[var(--color-border-default)]">
            <Image src={item.icon} alt={item.name} fill className="object-contain" sizes="48px" unoptimized />
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg shrink-0 bg-[var(--color-bg-card)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-muted)] text-xs">?</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm leading-tight">{item.name}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${tagStyle}`}>{tagLabel}</span>
          </div>
          {item.cost > 0 && (
            <div className="text-xs text-amber-400 mt-0.5 font-medium">
              {item.cost.toLocaleString()} {t("goldUnit")}
            </div>
          )}
        </div>
      </div>

      {item.stats && (
        <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
          <span className="text-[var(--color-text-muted)] mr-1">{t("stats")}:</span>
          {item.stats}
        </div>
      )}

      {item.recipe && item.recipe.length > 0 && (
        <div className="text-xs text-[var(--color-text-muted)]">
          <span className="mr-1">{t("recipe")}:</span>
          {item.recipe.join(" + ")}
        </div>
      )}

      {item.description && (
        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed border-t border-[var(--color-border-default)] pt-3">
          {item.description}
        </p>
      )}
    </div>
  );

  if (ident) {
    return <Link href={`/items/${ident}`}>{cardContent}</Link>;
  }
  return cardContent;
}

function AllItemsTab({
  items,
  search,
  setSearch,
  category,
  setCategory,
}: {
  items: Item[];
  search: string;
  setSearch: (s: string) => void;
  category: string;
  setCategory: (c: string) => void;
}) {
  const t = useTranslations("items");
  const [otherOpen, setOtherOpen] = useState(false);

  const mainItems  = items.filter((i) => !isOtherModeItem(i));
  const otherItems = items.filter((i) =>  isOtherModeItem(i));

  return (
    <div>
      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder={t("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--color-border-default)]
                     bg-[var(--color-bg-card)] text-[var(--color-text-primary)]
                     placeholder:text-[var(--color-text-muted)]
                     focus:outline-none focus:border-[var(--color-neon-primary)]"
        />
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 flex-wrap mb-6">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
              ${category === cat
                ? "border-[var(--color-neon-primary)] text-[var(--color-neon-primary)] bg-[var(--color-neon-primary)]/10"
                : "border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"
              }`}
          >
            {cat === "All" ? t("filterAll") : t(CATEGORY_LABEL_KEY[cat] ?? cat)}
          </button>
        ))}
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        {t("itemCount", { count: mainItems.length })}
      </p>

      {/* Main items grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {mainItems.map((item) => (
          <CatalogItemCard key={item.id ?? item.name} item={item} />
        ))}
      </div>

      {mainItems.length === 0 && otherItems.length === 0 && (
        <div className="text-center py-16 text-[var(--color-text-muted)]">
          {t("noResults")}
        </div>
      )}

      {/* ── Other Game Modes collapsible ── */}
      {otherItems.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setOtherOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 hover:border-[var(--color-border-hover)] transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                {t("otherModes")}
              </span>
              <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] px-2 py-0.5 rounded-full">
                {otherItems.length}
              </span>
            </span>
            <svg
              className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-200 ${otherOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {otherOpen && (
            <div className="mt-3">
              <p className="text-xs text-[var(--color-text-muted)] mb-3 px-1">
                {t("otherModesNote")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {otherItems.map((item) => (
                  <CatalogItemCard key={item.id ?? item.name} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CatalogItemCard({ item }: { item: Item }) {
  const ident = itemIdentifier(item);

  const tooltipContent = item.description
    ? <p>{item.description}</p>
    : undefined;

  const cardInner = (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 hover:border-[var(--color-border-hover)] transition-colors cursor-pointer">
      {item.icon ? (
        <div className="relative w-10 h-10 rounded shrink-0">
          <Image src={item.icon} alt={item.name} fill className="object-contain" sizes="40px" unoptimized />
        </div>
      ) : (
        <div className="w-10 h-10 rounded shrink-0 bg-[var(--color-bg-card)] border border-[var(--color-border-default)]" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.name}</div>
        <div className="text-xs text-amber-400/80 mt-0.5">
          {item.cost.toLocaleString()} g
        </div>
        {item.categories && item.categories.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {[...new Set(item.categories.map((c) => CATEGORY_DISPLAY_NAME[c] ?? c))].slice(0, 3).map((label) => (
              <span key={label} className="text-[9px] px-1 py-0.5 rounded border border-[var(--color-border-default)] text-[var(--color-text-muted)]">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const wrapped = ident ? <Link href={`/items/${ident}`}>{cardInner}</Link> : cardInner;

  return <Tooltip content={tooltipContent}>{wrapped}</Tooltip>;
}
