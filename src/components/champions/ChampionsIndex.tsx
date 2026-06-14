"use client";

import { useState, useMemo } from "react";
import { useLocale } from "next-intl";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import type { ChampionEntry } from "@/app/[locale]/champions/page";
import { localizedName } from "@/lib/i18n/localized-name";

// ─── Constants ───────────────────────────────────────────────────────────────

type SortKey = "winrate" | "name" | "tier" | "hp" | "ad" | "as" | "range" | "ms";
type ViewMode = "grid" | "table";

const TIER_COLOR: Record<string, string> = {
  "S+": "text-red-400",
  S: "text-orange-400",
  A: "text-yellow-400",
  B: "text-green-400",
  C: "text-blue-400",
  D: "text-slate-400",
};

const TIER_BG: Record<string, string> = {
  "S+": "bg-red-500/15 border-red-400/30",
  S: "bg-orange-500/15 border-orange-400/30",
  A: "bg-yellow-500/10 border-yellow-400/30",
  B: "bg-green-500/10 border-green-400/30",
  C: "bg-blue-500/10 border-blue-400/30",
  D: "bg-slate-500/10 border-slate-400/30",
};

const CLASS_COLOR: Record<string, string> = {
  Juggernaut: "text-red-300 bg-red-500/10 border-red-400/20",
  Diver: "text-orange-300 bg-orange-500/10 border-orange-400/20",
  Assassin: "text-purple-300 bg-purple-500/10 border-purple-400/20",
  Skirmisher: "text-amber-300 bg-amber-500/10 border-amber-400/20",
  Marksman: "text-green-300 bg-green-500/10 border-green-400/20",
  Burst: "text-blue-300 bg-blue-500/10 border-blue-400/20",
  Battlemage: "text-indigo-300 bg-indigo-500/10 border-indigo-400/20",
  Artillery: "text-cyan-300 bg-cyan-500/10 border-cyan-400/20",
  Enchanter: "text-pink-300 bg-pink-500/10 border-pink-400/20",
  Catcher: "text-teal-300 bg-teal-500/10 border-teal-400/20",
  Vanguard: "text-yellow-300 bg-yellow-500/10 border-yellow-400/20",
  Warden: "text-slate-300 bg-slate-500/10 border-slate-400/20",
  Specialist: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
};

const WR_COLOR = (wr: number | null) => {
  if (wr == null) return "text-slate-500";
  if (wr >= 54) return "text-red-400";
  if (wr >= 52) return "text-orange-400";
  if (wr >= 50) return "text-green-400";
  if (wr >= 48) return "text-blue-400";
  return "text-slate-400";
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statAtLevel(base: number, growth: number, level: number): number {
  return base + growth * (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChampionsIndex({
  champions,
}: {
  champions: ChampionEntry[];
}) {
  const locale = useLocale();
  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [activeClass, setActiveClass] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("winrate");
  const [level, setLevel] = useState(11);

  // Collect unique classes
  const allClasses = useMemo(() => {
    const set = new Set<string>();
    for (const c of champions) {
      for (const cl of c.classes ?? []) set.add(cl);
    }
    return ["all", ...Array.from(set).sort()];
  }, [champions]);

  // Filter
  const filtered = useMemo(() => {
    return champions.filter((c) => {
      const q = search.toLowerCase();
      const nameMatch =
        !search ||
        c.name.toLowerCase().includes(q) ||
        localizedName(c, locale).toLowerCase().includes(q) ||
        (c.title ?? "").toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        (c.classes ?? []).some((cl) => cl.toLowerCase().includes(q));
      const classMatch =
        activeClass === "all" || (c.classes ?? []).includes(activeClass);
      return nameMatch && classMatch;
    });
  }, [champions, search, activeClass, locale]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "winrate":
          return (b.win_rate ?? 0) - (a.win_rate ?? 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "tier":
          return (a.rank ?? 999) - (b.rank ?? 999);
        case "hp":
          return (
            statAtLevel(b.baseStats?.baseHP ?? 0, b.baseStats?.hpGrowth ?? 0, level) -
            statAtLevel(a.baseStats?.baseHP ?? 0, a.baseStats?.hpGrowth ?? 0, level)
          );
        case "ad":
          return (
            statAtLevel(b.baseStats?.baseAD ?? 0, b.baseStats?.adGrowth ?? 0, level) -
            statAtLevel(a.baseStats?.baseAD ?? 0, a.baseStats?.adGrowth ?? 0, level)
          );
        case "as":
          return (b.baseStats?.baseAS ?? 0) - (a.baseStats?.baseAS ?? 0);
        case "range":
          return (b.baseStats?.attackRange ?? 0) - (a.baseStats?.attackRange ?? 0);
        case "ms":
          return (b.baseStats?.moveSpeed ?? 0) - (a.baseStats?.moveSpeed ?? 0);
        default:
          return 0;
      }
    });
  }, [filtered, sortBy, level]);

  // Class counts
  const classCounts = useMemo(() => {
    const counts: Record<string, number> = { all: champions.length };
    for (const c of champions) {
      for (const cl of c.classes ?? []) {
        counts[cl] = (counts[cl] ?? 0) + 1;
      }
    }
    return counts;
  }, [champions]);

  return (
    <div>
      {/* ─── Controls ─── */}
      <div className="space-y-3 mb-6">
        {/* Row 1: View toggle + search + sort */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setView("grid")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              view === "grid"
                ? "bg-[var(--color-neon-primary)]/15 text-[var(--color-neon-primary)] border-[var(--color-neon-primary)]/40"
                : "bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] border-[var(--color-border-default)]"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setView("table")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              view === "table"
                ? "bg-[var(--color-neon-primary)]/15 text-[var(--color-neon-primary)] border-[var(--color-neon-primary)]/40"
                : "bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] border-[var(--color-border-default)]"
            }`}
          >
            Stats Table
          </button>
          <span className="w-px h-6 bg-[var(--color-border-default)] mx-1" />
          <input
            type="search"
            placeholder="Search name, title, class..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-0 sm:min-w-[180px] sm:max-w-xs px-3 py-1.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] text-sm focus:outline-none focus:border-[var(--color-neon-primary)]/50"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] text-sm"
          >
            <option value="winrate">Win Rate</option>
            <option value="tier">Tier</option>
            <option value="name">Name</option>
            <option value="hp">HP @ Lv{level}</option>
            <option value="ad">AD @ Lv{level}</option>
            <option value="as">Base AS</option>
            <option value="range">Range</option>
            <option value="ms">Move Speed</option>
          </select>
          {(sortBy === "hp" || sortBy === "ad") && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <span>Lv</span>
              <input
                type="range"
                min={1}
                max={18}
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                className="w-20 accent-[var(--color-neon-primary)]"
              />
              <span className="w-5 text-center font-mono">{level}</span>
            </div>
          )}
        </div>

        {/* Row 2: Class filters */}
        <div className="flex flex-wrap gap-1.5">
          {allClasses.map((cl) => (
            <button
              key={cl}
              onClick={() => setActiveClass(cl)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                activeClass === cl
                  ? cl === "all"
                    ? "bg-[var(--color-neon-primary)]/15 text-[var(--color-neon-primary)] border-[var(--color-neon-primary)]/40"
                    : CLASS_COLOR[cl] ?? "bg-white/10 text-white border-white/20"
                  : "bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border-[var(--color-border-default)]"
              }`}
            >
              {cl === "all" ? "All" : cl}
              <span className="ml-1 opacity-50">{classCounts[cl] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Grid View ─── */}
      {view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
          {sorted.map((c) => (
            <ChampionCard key={c.slug} champion={c} />
          ))}
        </div>
      ) : (
        /* ─── Table View ─── */
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border-default)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-card)]/80">
                {[
                  { h: "#", hide: false },
                  { h: "Champion", hide: false },
                  { h: "Class", hide: "mobile" as const },
                  { h: "Tier", hide: false },
                  { h: "WR%", hide: false },
                  { h: "Pick%", hide: "mobile" as const },
                  { h: `HP@${level}`, hide: "mobile" as const },
                  { h: `AD@${level}`, hide: "mobile" as const },
                  { h: "AS", hide: "tablet" as const },
                  { h: "Range", hide: "tablet" as const },
                  { h: "MS", hide: "tablet" as const },
                  { h: "Armor", hide: "tablet" as const },
                  { h: "MR", hide: "tablet" as const },
                ].map(({ h, hide }) => (
                  <th
                    key={h}
                    className={`px-2 py-2.5 text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold ${
                      h === "Champion" || h === "Class" ? "text-left" : "text-right"
                    } ${h === "#" ? "w-8 text-center" : ""} ${
                      hide === "mobile" ? "hidden sm:table-cell" : hide === "tablet" ? "hidden md:table-cell" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => {
                const bs = c.baseStats;
                const hp = bs ? statAtLevel(bs.baseHP, bs.hpGrowth, level) : 0;
                const ad = bs ? statAtLevel(bs.baseAD, bs.adGrowth, level) : 0;
                const armor = bs ? statAtLevel(bs.baseArmor, bs.armorGrowth, level) : 0;
                const mr = bs ? statAtLevel(bs.baseMR, bs.mrGrowth, level) : 0;
                return (
                  <tr
                    key={c.slug}
                    className={`border-b border-[var(--color-border-default)] hover:bg-[var(--color-bg-card)]/40 transition-colors ${
                      i % 2 ? "bg-[var(--color-bg-card)]/20" : ""
                    }`}
                  >
                    <td className="px-2 py-2 text-center text-[var(--color-text-muted)] text-xs tabular-nums">
                      {c.rank ?? i + 1}
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/champions/${c.slug}`}
                        className="flex items-center gap-2 hover:text-[var(--color-neon-primary)] transition-colors"
                      >
                        <Image
                          src={c.icon}
                          alt={localizedName(c, locale)}
                          width={28}
                          height={28}
                          className="rounded shrink-0"
                          unoptimized
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{localizedName(c, locale)}</div>
                          {c.title && (
                            <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                              {c.title}
                            </div>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-left hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(c.classes ?? c.tags).map((cl) => (
                          <span
                            key={cl}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              CLASS_COLOR[cl] ?? "text-slate-300 bg-slate-500/10 border-slate-400/20"
                            }`}
                          >
                            {cl}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span
                        className={`text-xs font-bold px-1.5 py-0.5 rounded border ${
                          TIER_BG[c.tier] ?? ""
                        } ${TIER_COLOR[c.tier] ?? "text-slate-400"}`}
                      >
                        {c.tier}
                      </span>
                    </td>
                    <NumCell className={WR_COLOR(c.win_rate)}>
                      {c.win_rate?.toFixed(1) ?? "—"}
                    </NumCell>
                    <NumCell className="text-[var(--color-text-muted)] hidden sm:table-cell">
                      {c.pick_rate?.toFixed(1) ?? "—"}
                    </NumCell>
                    <NumCell className="hidden sm:table-cell">{hp.toFixed(0)}</NumCell>
                    <NumCell className="hidden sm:table-cell">{ad.toFixed(1)}</NumCell>
                    <NumCell className="hidden md:table-cell">{bs?.baseAS.toFixed(3) ?? "—"}</NumCell>
                    <NumCell className="hidden md:table-cell">{bs?.attackRange ?? "—"}</NumCell>
                    <NumCell className="hidden md:table-cell">{bs?.moveSpeed ?? "—"}</NumCell>
                    <NumCell className="hidden md:table-cell">{armor.toFixed(0)}</NumCell>
                    <NumCell className="hidden md:table-cell">{mr.toFixed(0)}</NumCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--color-text-muted)] mt-6 text-center">
        {sorted.length} / {champions.length} champions ·
        Stats source: wiki.leagueoflegends.com · Level scaling uses official growth formula
      </p>
    </div>
  );
}

// ─── Grid Card ───────────────────────────────────────────────────────────────

function ChampionCard({
  champion: c,
}: {
  champion: ChampionEntry;
}) {
  const locale = useLocale();
  const name = localizedName(c, locale);
  return (
    <Link
      href={`/champions/${c.slug}`}
      className="glass-card p-3 flex flex-col items-center gap-2 border border-[var(--color-border-default)] transition-all group hover:scale-[1.03] hover:border-[var(--color-neon-primary)]/40 hover:shadow-lg"
    >
      <div className="relative">
        <Image
          src={c.icon}
          alt={name}
          width={56}
          height={56}
          className="rounded-lg border border-[var(--color-border-default)] group-hover:border-[var(--color-neon-primary)]/50 transition-colors"
          unoptimized
        />
        <span
          className={`absolute -top-1.5 -right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
            TIER_BG[c.tier] ?? ""
          } ${TIER_COLOR[c.tier] ?? ""}`}
        >
          {c.tier}
        </span>
      </div>

      <div className="text-center w-full min-w-0">
        <div className="text-xs font-bold truncate group-hover:text-[var(--color-text-primary)] transition-colors">
          {name}
        </div>
        {c.title && (
          <div className="text-[9px] text-[var(--color-text-muted)] truncate leading-tight">
            {c.title}
          </div>
        )}
      </div>

      {/* Classes */}
      <div className="flex flex-wrap justify-center gap-1">
        {(c.classes ?? c.tags).slice(0, 2).map((cl) => (
          <span
            key={cl}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${
              CLASS_COLOR[cl] ?? "text-slate-300 bg-slate-500/10 border-slate-400/20"
            }`}
          >
            {cl}
          </span>
        ))}
      </div>

      {/* WR + Pick */}
      <div className="flex justify-between w-full text-[10px] mt-auto">
        <span className={`font-bold ${WR_COLOR(c.win_rate)}`}>
          {c.win_rate != null ? `${c.win_rate.toFixed(1)}%` : "—"}
        </span>
        <span className="text-[var(--color-text-muted)]">
          {c.pick_rate != null ? `${c.pick_rate.toFixed(1)}%` : ""}
        </span>
      </div>

      {/* Key stats */}
      {c.baseStats && (
        <div className="grid grid-cols-3 gap-x-2 w-full text-[9px] text-[var(--color-text-muted)] border-t border-[var(--color-border-default)] pt-1.5 mt-0.5">
          <StatMini label="HP" value={c.baseStats.baseHP.toString()} />
          <StatMini label="AD" value={c.baseStats.baseAD.toString()} />
          <StatMini label="AS" value={c.baseStats.baseAS.toFixed(2)} />
        </div>
      )}
    </Link>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[var(--color-text-muted)]/60">{label}</div>
      <div className="text-[var(--color-text-secondary)] font-medium tabular-nums">{value}</div>
    </div>
  );
}

function NumCell({
  children,
  className = "text-[var(--color-text-secondary)]",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-2 py-2 text-right tabular-nums text-xs ${className}`}>
      {children}
    </td>
  );
}
