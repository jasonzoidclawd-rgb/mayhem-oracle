"use client";

import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { localizedName } from "@/lib/i18n/localized-name";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tier = "S+" | "S" | "A" | "B" | "C";
type Role = "all" | "assassin" | "fighter" | "mage" | "marksman" | "support" | "tank";

export interface ChampionData {
  slug: string;
  name: string;
  tier: Tier;
  rank: number | null;
  win_rate: number | null;
  pick_rate: number | null;
  tags: string[];
  icon: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIER_ORDER: Tier[] = ["S+", "S", "A", "B", "C"];

// Maps tier letter → tierList.tiers translation key
const TIER_KEY: Record<Tier, string> = {
  "S+": "god",
  S:    "strong",
  A:    "good",
  B:    "average",
  C:    "weak",
};

const TIER_COLORS: Record<Tier, string> = {
  "S+": "tier-god",
  S:    "tier-strong",
  A:    "tier-good",
  B:    "tier-avg",
  C:    "tier-weak",
};

const ROLE_ICONS: Record<Role, string> = {
  all:       "★",
  assassin:  "🗡️",
  fighter:   "⚔️",
  mage:      "🔮",
  marksman:  "🏹",
  support:   "💚",
  tank:      "🛡️",
};

const ALL_ROLES: Role[] = ["all", "assassin", "fighter", "mage", "marksman", "support", "tank"];

// ─── Component ───────────────────────────────────────────────────────────────

export function TierListClient({ champions }: { champions: ChampionData[] }) {
  const t = useTranslations("tierList");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [activeRole, setActiveRole] = useState<Role>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return champions.filter((c) => {
      const roleMatch = activeRole === "all" || c.tags.includes(activeRole);
      const searchMatch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        localizedName(c, locale).toLowerCase().includes(q);
      return roleMatch && searchMatch;
    });
  }, [champions, activeRole, search, locale]);

  const grouped = useMemo(() => {
    const groups: Partial<Record<Tier, ChampionData[]>> = {};
    for (const champ of filtered) {
      (groups[champ.tier] ??= []).push(champ);
    }
    return groups;
  }, [filtered]);

  return (
    <div>
      {/* ─── Search ─── */}
      <input
        type="search"
        placeholder={tCommon("search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm mb-4 px-4 py-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] text-sm focus:outline-none focus:border-[var(--color-neon-primary)]/50"
      />

      {/* ─── Role filter tabs ─── */}
      <div className="segmented mb-8">
        {ALL_ROLES.map((role) => (
          <button
            key={role}
            onClick={() => setActiveRole(role)}
            aria-pressed={activeRole === role}
            className={`seg-item ${activeRole === role ? "seg-item-active" : ""}`}
          >
            <span className="mr-1.5">{ROLE_ICONS[role]}</span>
            {t(`filters.${role}`)}
          </button>
        ))}
      </div>

      {/* ─── Tier groups ─── */}
      {TIER_ORDER.map((tier) => {
        const champs = grouped[tier];
        if (!champs?.length) return null;

        return (
          <section key={tier} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span
                className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wide border ${TIER_COLORS[tier]}`}
              >
                {t(`tiers.${TIER_KEY[tier]}`)}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                ({champs.length})
              </span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
              {champs.map((champ) => (
                <ChampionCard key={champ.slug} champion={champ} />
              ))}
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <p className="text-center text-[var(--color-text-muted)] py-16">
          {t("noResults")}
        </p>
      )}
    </div>
  );
}

// ─── Champion Card ────────────────────────────────────────────────────────────

function ChampionCard({ champion }: { champion: ChampionData }) {
  const locale = useLocale();
  const name = localizedName(champion, locale);
  const wr = champion.win_rate ?? 0;
  const wrColor =
    wr >= 53
      ? "var(--color-wr-high)"
      : wr >= 50
        ? "var(--color-wr-mid)"
        : "var(--color-wr-low)";

  return (
    <Link href={`/champions/${champion.slug}`}>
      <div className="glass-card p-2 flex flex-col items-center gap-1.5 cursor-pointer group transition-all hover:scale-[1.04] hover:border-[var(--color-neon-primary)]/40 hover:shadow-lg">
        <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-[var(--color-border-default)] group-hover:border-[var(--color-neon-primary)]/50 transition-colors">
          <Image
            src={champion.icon}
            alt={name}
            fill
            className="object-cover"
            sizes="56px"
          />
        </div>

        <span className="text-xs font-bold" style={{ color: wrColor }}>
          {wr.toFixed(1)}%
        </span>

        <span className="text-[10px] text-[var(--color-text-secondary)] text-center leading-tight w-full truncate group-hover:text-[var(--color-text-primary)] transition-colors">
          {name}
        </span>
      </div>
    </Link>
  );
}
