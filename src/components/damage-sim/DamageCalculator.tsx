"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ChampionBaseStats, ItemStats } from "@/lib/types";
import {
  statsAtLevel,
  combineStats,
  stackItemStats,
  type ChampionStatsAtLevel,
} from "@/lib/data/championStats";
import { computeDamageCalculation } from "@/lib/data/damage-calculations";

// ─── Serializable data from server ───────────────────────────────────────────

export interface CalcChampion {
  slug: string;
  name: string;
  icon: string;
  attackType: "melee" | "ranged";
  damageType: "physical" | "magic" | "mixed";
  playstyle: { damage: number; durability: number; crowdControl: number; mobility: number; utility: number };
  abilities: { key: string; name: string; icon: string; description: string }[];
  baseStats: ChampionBaseStats;
}

export interface CalcItem {
  id: number;
  name: string;
  icon: string;
  stats: ItemStats;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_LEVEL = 9;
const MAX_ITEMS = 6;
// ─── Color theme (wiki-inspired) ─────────────────────────────────────────────

const STAT_COLORS = {
  hp: "text-green-400",
  ad: "text-orange-300",
  armor: "text-amber-500",
  mr: "text-violet-400",
  as: "text-yellow-300",
  ap: "text-blue-300",
  ms: "text-cyan-300",
  range: "text-slate-300",
  mp: "text-blue-400",
  physical: "text-red-400",
  magic: "text-blue-300",
  true: "text-white",
} as const;

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DamageCalculator({
  champions,
  items,
}: {
  champions: CalcChampion[];
  items: CalcItem[];
}) {
  const t = useTranslations("damageSim");

  // Attacker state
  const [attackerSlug, setAttackerSlug] = useState("");
  const [attackerLevel, setAttackerLevel] = useState(DEFAULT_LEVEL);
  const [selectedItemIds, setSelectedItemIds] = useState<(number | null)[]>(
    Array(MAX_ITEMS).fill(null)
  );

  // Target state
  const [targetSlug, setTargetSlug] = useState("");
  const [targetLevel, setTargetLevel] = useState(DEFAULT_LEVEL);

  // Expand ability
  const [expandedAbility, setExpandedAbility] = useState<string | null>(null);

  const attacker = champions.find((c) => c.slug === attackerSlug);
  const target = champions.find((c) => c.slug === targetSlug);

  // Computed stats
  const attackerBaseStats = useMemo(
    () => (attacker ? statsAtLevel(attacker.baseStats, attackerLevel) : null),
    [attacker, attackerLevel]
  );

  const targetBaseStats = useMemo(
    () => (target ? statsAtLevel(target.baseStats, targetLevel) : null),
    [target, targetLevel]
  );

  const selectedItems = useMemo(
    () =>
      selectedItemIds
        .map((id) => (id != null ? items.find((it) => it.id === id) : null))
        .filter((it): it is CalcItem => it != null),
    [selectedItemIds, items]
  );

  const stackedStats = useMemo(
    () => stackItemStats(selectedItems.map((it) => it.stats)),
    [selectedItems]
  );

  const combined = useMemo(
    () => (attackerBaseStats ? combineStats(attackerBaseStats, stackedStats) : null),
    [attackerBaseStats, stackedStats]
  );

  const damage = useMemo(() => {
    if (!combined || !targetBaseStats) return null;
    return computeDamageCalculation(combined, targetBaseStats);
  }, [combined, targetBaseStats]);

  const setItem = (slot: number, id: number | null) => {
    setSelectedItemIds((prev) => {
      const next = [...prev];
      next[slot] = id;
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* ─── Champion Panels ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChampionPanel
          label={t("attacker")}
          champions={champions}
          onSelect={setAttackerSlug}
          level={attackerLevel}
          onLevelChange={setAttackerLevel}
          champion={attacker}
          stats={attackerBaseStats}
          combined={combined}
        />
        <ChampionPanel
          label={t("target")}
          champions={champions}
          onSelect={setTargetSlug}
          level={targetLevel}
          onLevelChange={setTargetLevel}
          champion={target}
          stats={targetBaseStats}
        />
      </div>

      {/* ─── Abilities ─── */}
      {attacker && attacker.abilities.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60">
            <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold">
              {t("abilities")}
            </span>
          </div>
          <div className="flex border-b border-[var(--color-border-default)]">
            {attacker.abilities.map((ab) => (
              <button
                key={ab.key}
                onClick={() =>
                  setExpandedAbility(expandedAbility === ab.key ? null : ab.key)
                }
                className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors border-r border-[var(--color-border-default)] last:border-r-0 ${
                  expandedAbility === ab.key
                    ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                <Image
                  src={ab.icon}
                  alt={ab.name}
                  width={24}
                  height={24}
                  className="rounded-sm"
                  unoptimized
                />
                <span className="hidden sm:inline font-medium">{ab.key === "passive" ? "P" : ab.key}</span>
              </button>
            ))}
          </div>
          {expandedAbility && (() => {
            const ab = attacker.abilities.find((a) => a.key === expandedAbility);
            if (!ab) return null;
            return (
              <div className="p-4">
                <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                  {ab.name}
                  <span className="ml-2 text-[10px] text-[var(--color-text-muted)] font-normal uppercase">
                    {ab.key === "passive" ? t("innate") : ab.key}
                  </span>
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {ab.description}
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── Item Build ─── */}
      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold">
            {t("itemBuild")}
          </span>
          {selectedItems.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
              {stackedStats.attackDamage ? <span className={STAT_COLORS.ad}>+{stackedStats.attackDamage} {t("itemStatAD")}</span> : null}
              {stackedStats.abilityPower ? <span className={STAT_COLORS.ap}>+{stackedStats.abilityPower} {t("itemStatAP")}</span> : null}
              {stackedStats.critChance ? <span className={STAT_COLORS.ad}>+{(stackedStats.critChance * 100).toFixed(0)}% {t("itemStatCrit")}</span> : null}
              {stackedStats.critDamage ? <span className={STAT_COLORS.ad}>+{(stackedStats.critDamage * 100).toFixed(0)}% {t("itemStatCritDmg")}</span> : null}
              {stackedStats.lethality ? <span className={STAT_COLORS.physical}>+{stackedStats.lethality} {t("itemStatLethality")}</span> : null}
              {stackedStats.armorPenPct ? <span className={STAT_COLORS.physical}>{(stackedStats.armorPenPct * 100).toFixed(0)}% {t("itemStatArmorPen")}</span> : null}
              {stackedStats.attackSpeed ? <span className={STAT_COLORS.as}>+{(stackedStats.attackSpeed * 100).toFixed(0)}% {t("itemStatAS")}</span> : null}
              {stackedStats.magicPenFlat ? <span className={STAT_COLORS.magic}>+{stackedStats.magicPenFlat} {t("itemStatMPen")}</span> : null}
              {stackedStats.magicPenPct ? <span className={STAT_COLORS.magic}>{(stackedStats.magicPenPct * 100).toFixed(0)}% {t("itemStatMPen")}</span> : null}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedItemIds.map((itemId, idx) => (
            <ItemSlot
              key={idx}
              itemId={itemId}
              items={items}
              chosenIds={selectedItemIds}
              onSelect={(id) => setItem(idx, id)}
            />
          ))}
        </div>
      </div>

      {/* ─── Damage Output ─── */}
      {combined && damage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DamageCard title={t("physicalDamage")} accent={STAT_COLORS.physical}>
            <StatLine label={t("totalAD")} value={combined.totalAD.toFixed(1)} color={STAT_COLORS.ad} />
            <StatLine
              label={`Armor ${damage.targetArmor.toFixed(0)} → ${damage.effectiveArmor.toFixed(1)}`}
              value={`${(damage.armorMult * 100).toFixed(1)}%`}
              small
            />
            <div className="border-t border-[var(--color-border-default)] my-1.5" />
            <StatLine label={t("auto")} value={damage.autoPhys.toFixed(1)} bold color={STAT_COLORS.ad} />
            {combined.critChance > 0 && (
              <>
                <StatLine
                  label={`${t("crit")} (${(damage.critMult * 100).toFixed(0)}%)`}
                  value={damage.critAutoPhys.toFixed(1)}
                  bold
                  color="text-amber-400"
                />
                <StatLine
                  label={t("avgCrit", { critChance: (combined.critChance * 100).toFixed(0) })}
                  value={damage.avgAutoPhys.toFixed(1)}
                  bold
                />
              </>
            )}
            <StatLine
              label={t("dps", { attackSpeed: combined.attackSpeed.toFixed(2) })}
              value={damage.dps.toFixed(0)}
              bold
              color="text-[var(--color-neon-primary)]"
            />
          </DamageCard>

          <DamageCard title={t("magicDamage")} accent={STAT_COLORS.magic}>
            <StatLine label={t("totalAP")} value={combined.totalAP.toFixed(1)} color={STAT_COLORS.ap} />
            <StatLine
              label={`MR ${damage.targetMR.toFixed(0)} → ${damage.effectiveMR.toFixed(1)}`}
              value={`${(damage.mrMult * 100).toFixed(1)}%`}
              small
            />
            <div className="border-t border-[var(--color-border-default)] my-1.5" />
            <StatLine
              label={t("magicMultiplier")}
              value={`×${damage.mrMult.toFixed(3)}`}
              bold
              color={STAT_COLORS.magic}
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-2">
              {t("spellDamageFormula", { multiplier: (damage.mrMult * 100).toFixed(1) })}
            </p>
          </DamageCard>

          <DamageCard title={t("sustainUtility")} accent="text-rose-300">
            {combined.lifeSteal > 0 && (
              <StatLine
                label={`${t("lifeSteal")} (${(combined.lifeSteal * 100).toFixed(0)}%)`}
                value={`${(damage.avgAutoPhys * combined.lifeSteal).toFixed(1)}${t("perAuto")}`}
                color="text-rose-300"
              />
            )}
            {combined.omnivamp > 0 && (
              <StatLine
                label={`${t("omnivamp")} (${(combined.omnivamp * 100).toFixed(0)}%)`}
                value={`${(damage.avgAutoPhys * combined.omnivamp).toFixed(1)}${t("perAuto")}`}
                color="text-rose-300"
              />
            )}
            <StatLine label={t("attackSpeed")} value={`${combined.attackSpeed.toFixed(3)}/s`} color={STAT_COLORS.as} />
            {combined.critChance > 0 && (
              <StatLine
                label={t("critChance")}
                value={`${(Math.min(1, combined.critChance) * 100).toFixed(0)}%`}
              />
            )}
            {!combined.lifeSteal && !combined.omnivamp && !combined.critChance && (
              <p className="text-xs text-[var(--color-text-muted)]">{t("noSustainStats")}</p>
            )}
          </DamageCard>
        </div>
      )}

      {!attacker && !target && (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-6">
          {t("selectParticipantsPrompt")}
        </p>
      )}
    </div>
  );
}

// ─── Champion Panel ──────────────────────────────────────────────────────────

function ChampionPanel({
  label,
  champions,
  onSelect,
  level,
  onLevelChange,
  champion,
  stats,
  combined,
}: {
  label: string;
  champions: CalcChampion[];
  onSelect: (slug: string) => void;
  level: number;
  onLevelChange: (level: number) => void;
  champion: CalcChampion | undefined;
  stats: ChampionStatsAtLevel | null;
  combined?: { totalAD: number; totalAP: number; attackSpeed: number } | null;
}) {
  const t = useTranslations("damageSim");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return champions;
    const q = search.toLowerCase();
    return champions.filter((c) => c.name.toLowerCase().includes(q));
  }, [champions, search]);

  return (
    <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold">
          {label}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
          <span>{t("levelAbbr")}</span>
          <input
            type="range"
            min={1}
            max={18}
            value={level}
            onChange={(e) => onLevelChange(Number(e.target.value))}
            className="w-20 accent-[var(--color-neon-primary)]"
          />
          <span className="w-4 text-center font-mono text-[var(--color-text-primary)]">{level}</span>
        </div>
      </div>

      {/* Champion selector + stats */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="w-16 h-16 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] flex items-center justify-center shrink-0 overflow-hidden">
            {champion ? (
              <Image
                src={champion.icon}
                alt={champion.name}
                width={64}
                height={64}
                className="rounded-lg"
                unoptimized
              />
            ) : (
              <span className="text-2xl text-[var(--color-text-muted)]">?</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Search dropdown */}
            <div className="relative" ref={ref}>
              <input
                type="text"
                value={champion && !open ? champion.name : search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOpen(true);
                  if (champion) onSelect("");
                }}
                onFocus={() => {
                  setOpen(true);
                  if (champion) {
                    setSearch("");
                    onSelect("");
                  }
                }}
                placeholder={t("selectChampionPlaceholder")}
                className="w-full px-2 py-1 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-card)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              />
              {open && (
                <div className="absolute z-30 top-full mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] shadow-xl">
                  {filtered.slice(0, 20).map((c) => (
                    <button
                      key={c.slug}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left hover:bg-[var(--color-neon-primary)]/10 text-[var(--color-text-primary)]"
                      onClick={() => {
                        onSelect(c.slug);
                        setSearch("");
                        setOpen(false);
                      }}
                    >
                      <Image
                        src={c.icon}
                        alt={c.name}
                        width={20}
                        height={20}
                        className="rounded-sm"
                        unoptimized
                      />
                      <span>{c.name}</span>
                      <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
                        {t(c.attackType)} · {t(c.damageType)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Badges */}
            {champion && (
              <div className="flex gap-1.5 mt-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  champion.damageType === "physical"
                    ? "border-red-400/30 text-red-300 bg-red-400/10"
                    : champion.damageType === "magic"
                    ? "border-blue-400/30 text-blue-300 bg-blue-400/10"
                    : "border-purple-400/30 text-purple-300 bg-purple-400/10"
                }`}>
                  {t(champion.damageType)}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border-default)] text-[var(--color-text-muted)]">
                  {t(champion.attackType)}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border-default)] text-[var(--color-text-muted)]">
                  {champion.baseStats.attackRange} {t("range")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stat grid (wiki-style) */}
        {stats && (
          <div className="grid grid-cols-4 gap-x-3 gap-y-1 mt-3 text-xs">
            <StatCell icon="♥" label="HP" value={stats.hp.toFixed(0)} color={STAT_COLORS.hp} />
            <StatCell icon="⚔" label="AD" value={(combined?.totalAD ?? stats.ad).toFixed(1)} color={STAT_COLORS.ad} highlight={!!combined && (combined.totalAD > stats.ad)} />
            <StatCell icon="🛡" label="Armor" value={stats.armor.toFixed(1)} color={STAT_COLORS.armor} />
            <StatCell icon="✦" label="MR" value={stats.mr.toFixed(1)} color={STAT_COLORS.mr} />
            <StatCell icon="⚡" label="AS" value={(combined?.attackSpeed ?? stats.attackSpeed).toFixed(3)} color={STAT_COLORS.as} highlight={!!combined && (combined.attackSpeed > stats.attackSpeed)} />
            <StatCell icon="✧" label="AP" value={(combined?.totalAP ?? 0).toFixed(0)} color={STAT_COLORS.ap} highlight={!!combined && combined.totalAP > 0} />
            <StatCell icon="→" label="MS" value={stats.moveSpeed.toFixed(0)} color={STAT_COLORS.ms} />
            <StatCell icon="◈" label="MP" value={stats.mp.toFixed(0)} color={STAT_COLORS.mp} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat Cell (wiki-style) ──────────────────────────────────────────────────

function StatCell({
  icon,
  label,
  value,
  color,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className={`text-[10px] ${color}`}>{icon}</span>
      <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
      <span className={`text-xs tabular-nums font-medium ${highlight ? color : "text-[var(--color-text-primary)]"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Item Slot ───────────────────────────────────────────────────────────────

function ItemSlot({
  itemId,
  items,
  chosenIds,
  onSelect,
}: {
  itemId: number | null;
  items: CalcItem[];
  chosenIds: (number | null)[];
  onSelect: (id: number | null) => void;
}) {
  const t = useTranslations("damageSim");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const item = itemId != null ? items.find((it) => it.id === itemId) : null;

  const filtered = useMemo(() => {
    const chosen = new Set(chosenIds.filter((id) => id != null));
    const q = search.toLowerCase();
    return items
      .filter((it) => !chosen.has(it.id) && (q === "" || it.name.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [items, chosenIds, search]);

  if (item) {
    return (
      <button
        onClick={() => onSelect(null)}
        className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60 hover:border-red-400/50 transition-colors group"
        title={item.name}
      >
        <Image src={item.icon} alt={item.name} width={24} height={24} className="rounded-sm" unoptimized />
        <span className="text-[10px] text-[var(--color-text-muted)] group-hover:text-red-400">×</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-9 h-9 rounded-lg border border-dashed border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:border-[var(--color-neon-primary)] hover:text-[var(--color-neon-primary)] transition-colors"
      >
        +
      </button>
      {open && (
        <div className="absolute z-30 top-full mt-1 left-0 w-60 max-h-52 overflow-y-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] shadow-xl">
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchItemPlaceholder")}
            className="w-full px-2 py-1.5 border-b border-[var(--color-border-default)] bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
          />
          {filtered.map((it) => (
            <button
              key={it.id}
              className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left hover:bg-[var(--color-neon-primary)]/10 text-[var(--color-text-primary)]"
              onClick={() => {
                onSelect(it.id);
                setOpen(false);
                setSearch("");
              }}
            >
              <Image src={it.icon} alt={it.name} width={18} height={18} className="rounded-sm" unoptimized />
              <span className="truncate">{it.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Damage Card ─────────────────────────────────────────────────────────────

function DamageCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60">
        <span className={`text-xs font-semibold ${accent}`}>{title}</span>
      </div>
      <div className="p-4 space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

// ─── Stat Line ───────────────────────────────────────────────────────────────

function StatLine({
  label,
  value,
  bold,
  small,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  small?: boolean;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={small ? "text-[10px] text-[var(--color-text-muted)]" : "text-xs text-[var(--color-text-secondary)]"}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          bold
            ? `font-semibold ${color ?? "text-[var(--color-text-primary)]"}`
            : small
            ? "text-[10px] text-[var(--color-text-muted)]"
            : `text-xs ${color ?? "text-[var(--color-text-secondary)]"}`
        }`}
      >
        {value}
      </span>
    </div>
  );
}
