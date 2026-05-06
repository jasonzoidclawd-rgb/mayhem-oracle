import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { readFile } from "fs/promises";
import path from "path";
import { notFound } from "next/navigation";
import { computeOracleScore, type ScoredAugment, type ComboTier } from "@/lib/scoring/oracle-score";
import type { AbilityProfile, AbilityEntry, AbilityStats, ChampionBaseStats, ChampionTag, PoolRules } from "@/lib/types";
import { Tooltip } from "@/components/ui/Tooltip";
import { buildPoolProfile } from "@/lib/scoring/augment-tailoring";
import { getChampionAugmentPool } from "@/lib/scoring/pool-orchestrator";
import { analyzeInteractions, type MechanicalInteraction, type AugmentMechanic } from "@/lib/scoring/augment-interactions";
import { normalizeAugmentSet } from "@/lib/data/augment-set";
import { buildComboTierLookup, resolveChampionCombos } from "@/lib/data/combo-lookup";
import { routing } from "@/i18n/routing";
import {
  PoolConstructionSection,
  type PoolLayer,
  type PoolProfileChip,
  type PoolRaritySummary,
  type TailoredHighlight,
} from "@/components/champions/PoolConstructionSection";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChampionData {
  slug: string;
  name: string;
  title?: string;
  tier: string;
  rank: number | null;
  win_rate: number | null;
  pick_rate: number | null;
  tags: string[];
  classes?: string[];
  last_changed?: string;
  icon: string;
  baseStats?: ChampionBaseStats;
  kit_tags?: ChampionTag[];
}

interface AugmentData extends ScoredAugment {
  slug: string;
  name: string;
  rarity: "prismatic" | "gold" | "silver";
  win_rate: number | null;
  icon: string;
  set?: string;
  wikiSet?: string;
  wikiDescription?: string;
  kit_tags?: ChampionTag[];
}

interface ComboData {
  champion: string;
  augment: string;
  tier: string;
  ref: string;
}

type PillLabels = {
  set: string;
  combo: string;
  trap: string;
  rarity: string;
  dmgType: string;
  atkType: string;
  cc: string;
  mismatch: string;
};

// ─── Static params for all 172 champions ─────────────────────────────────────

export const dynamicParams = false;

export async function generateStaticParams() {
  const dataPath = path.join(process.cwd(), "public", "data", "champions.json");
  const raw = await readFile(dataPath, "utf-8");
  const { champions } = JSON.parse(raw) as { champions: ChampionData[] };

  return routing.locales.flatMap((locale) =>
    champions.map((c) => ({ locale, slug: c.slug }))
  );
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const base = path.join(process.cwd(), "public", "data");
  const [champsRaw, augsRaw, combosRaw, poolRulesRaw] = await Promise.all([
    readFile(path.join(base, "champions.json"), "utf-8"),
    readFile(path.join(base, "augments.json"), "utf-8"),
    readFile(path.join(base, "combos.json"), "utf-8"),
    readFile(path.join(base, "pool-rules.json"), "utf-8"),
  ]);

  let abilitiesData: Record<string, AbilityProfile> = {};
  try {
    const abilitiesRaw = await readFile(path.join(base, "abilities.json"), "utf-8");
    abilitiesData = JSON.parse(abilitiesRaw).profiles ?? {};
  } catch {
    // abilities.json not yet generated — ability section will be hidden
  }

  return {
    champions: JSON.parse(champsRaw).champions as ChampionData[],
    augments: (JSON.parse(augsRaw).augments as AugmentData[]).map((augment) => ({
      ...augment,
      set: normalizeAugmentSet(augment.set, augment.wikiSet),
    })),
    combos: JSON.parse(combosRaw).combos as ComboData[],
    poolRules: JSON.parse(poolRulesRaw) as PoolRules,
    patch: JSON.parse(champsRaw).patch as string,
    abilities: abilitiesData,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ChampionPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("champion");

  const { champions, augments, combos, poolRules, patch, abilities } = await loadData();

  const champ = champions.find((c) => c.slug === slug);
  if (!champ) notFound();

  const champWr = champ.win_rate ?? 50;
  const abilityProfile: AbilityProfile | undefined = abilities[slug];

  // Build combo lookup for this champion: augment-slug → tier
  const champCombos = resolveChampionCombos(slug, combos, augments);
  const comboBySlug = buildComboTierLookup(slug, combos, augments);
  const augmentBySlug = new Map(augments.map((augment) => [augment.slug, augment]));

  // ── Smart Tailoring: filter augment pool ──
  const poolProfile = buildPoolProfile(slug, abilityProfile, champ.baseStats);
  const pool = getChampionAugmentPool({
    championSlug: slug,
    augments,
    abilityProfile,
    baseStats: champ.baseStats,
    championKitTags: champ.kit_tags ?? [],
    poolRules,
  });
  const poolAugments = [...pool.silver, ...pool.gold, ...pool.prismatic];

  // Score filtered augments for this champion
  const scoredAugments = poolAugments.map((aug) => {
    const comboTier = comboBySlug.get(aug.slug);
    const result = computeOracleScore({
      augment: aug,
      championWinRate: champWr,
      comboTier,
      abilityProfile,
      isSystemBreaker: aug.flags?.system_breaker === true,
    });
    return { aug, score: result.total, breakdown: result.breakdown, comboTier };
  });

  // Sort by Oracle Score descending
  scoredAugments.sort((a, b) => b.score - a.score);

  const excludedByReason = pool.excluded.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.reason] = (accumulator[entry.reason] ?? 0) + 1;
    return accumulator;
  }, {});
  const countExcluded = (...reasons: string[]) =>
    reasons.reduce((total, reason) => total + (excludedByReason[reason] ?? 0), 0);

  let poolLayerRemainder = augments.length;
  const poolLayers: PoolLayer[] = [
    {
      key: "source",
      label: t("poolStepSource"),
      detail: t("poolStepSourceDetail"),
      kept: poolLayerRemainder,
      removed: 0,
    },
  ];
  const appendPoolLayer = (key: string, label: string, detail: string, removed: number) => {
    poolLayerRemainder -= removed;
    poolLayers.push({ key, label, detail, kept: poolLayerRemainder, removed });
  };

  appendPoolLayer(
    "lifecycle",
    t("poolStepLifecycle"),
    t("poolStepLifecycleDetail"),
    countExcluded("disabled", "removed"),
  );
  appendPoolLayer(
    "hard",
    t("poolStepHard"),
    t("poolStepHardDetail"),
    countExcluded("hard-exclusion"),
  );
  appendPoolLayer(
    "tags",
    t("poolStepTags"),
    t("poolStepTagsDetail"),
    countExcluded("tag-mismatch"),
  );
  appendPoolLayer(
    "items",
    t("poolStepItems"),
    t("poolStepItemsDetail"),
    countExcluded("item-exclusion"),
  );

  // Pre-compute translated damage/attack type labels
  const damageTypeLabel: Record<string, string> = {
    magic:    t("magicDamage"),
    physical: t("physicalDamage"),
    mixed:    t("mixedDamage"),
  };
  const attackTypeLabel: Record<string, string> = {
    ranged: t("ranged"),
    melee:  t("melee"),
  };

  const poolProfileChips: PoolProfileChip[] = [
    {
      label: t("poolChipResource"),
      value:
        poolProfile.resource === "none"
          ? t("resourceNone")
          : poolProfile.resource === "energy"
            ? t("resourceEnergy")
            : t("resourceMana"),
    },
    {
      label: t("attackType"),
      value: attackTypeLabel[poolProfile.attackType] ?? poolProfile.attackType,
    },
    {
      label: t("damageType"),
      value: damageTypeLabel[poolProfile.damageType] ?? poolProfile.damageType,
    },
    {
      label: t("poolChipTags"),
      value: (champ.kit_tags ?? []).length > 0 ? (champ.kit_tags ?? []).join(", ") : t("poolUniversal"),
    },
  ];

  const poolRaritySummary: PoolRaritySummary[] = [
    { key: "silver", label: t("silver"), count: pool.silver.length },
    { key: "gold", label: t("gold"), count: pool.gold.length },
    { key: "prismatic", label: t("prismatic"), count: pool.prismatic.length },
  ];

  const tailoredHighlights: TailoredHighlight[] = scoredAugments.slice(0, 6).map(({ aug, score, comboTier }) => ({
    aug,
    score,
    comboTier,
  }));

  const strongCombos = champCombos.filter((c) => c.tier === "S");
  const avoidCombos = champCombos.filter((c) => c.tier === "C");

  // ── Mechanical Interaction Analysis ──
  let mechanicalSynergies: MechanicalInteraction[] = [];
  let mechanicalTraps: MechanicalInteraction[] = [];

  if (abilityProfile && champ.baseStats) {
    const allInteractions = analyzeInteractions(
      {
        name: champ.name,
        slug: champ.slug,
        baseStats: champ.baseStats,
        abilityProfile,
      },
      poolAugments.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description ?? "",
        wikiDescription: a.wikiDescription,
      })),
    );
    // Show strength 3 always, top strength 2 (capped at 8 each), skip strength 1
    const synAll = allInteractions.filter((i) => i.type === "synergy");
    const trapAll = allInteractions.filter((i) => i.type === "trap");
    const pickTop = (arr: MechanicalInteraction[], limit: number) => {
      const s3 = arr.filter((i) => i.strength === 3);
      const s2 = arr.filter((i) => i.strength === 2);
      return [...s3, ...s2].slice(0, limit);
    };
    mechanicalSynergies = pickTop(synAll, 12);
    mechanicalTraps = pickTop(trapAll, 8);
  }

  // Top augments — show top 20 from filtered pool
  const topAugments = scoredAugments.slice(0, 20);

  // Pre-compute translated pill labels
  const pillLabels: PillLabels = {
    set:      t("pillSet"),
    combo:    t("pillCombo"),
    trap:     t("pillTrap"),
    rarity:   t("pillRarity"),
    dmgType:  t("pillDmgType"),
    atkType:  t("pillAtkType"),
    cc:       t("pillCC"),
    mismatch: t("pillMismatch"),
  };

  // Pre-compute translated playstyle labels
  const playstyleItems: Array<[keyof AbilityProfile["playstyle"], string]> = [
    ["damage",       t("playstyleDamage")],
    ["durability",   t("playstyleDurability")],
    ["crowdControl", t("playstyleCrowdControl")],
    ["mobility",     t("playstyleMobility")],
    ["utility",      t("playstyleUtility")],
  ];

  return (
    <div className="py-4 sm:py-8 max-w-4xl">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3 sm:gap-5 mb-4 sm:mb-6">
        <div className="relative w-14 h-14 sm:w-20 sm:h-20 rounded-full overflow-hidden border-2 border-[var(--color-neon-primary)]/40 shrink-0">
          <Image
            src={champ.icon}
            alt={champ.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 56px, 80px"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-3xl font-bold truncate">{champ.name}</h1>
            {champ.rank && (
              <span className="text-sm sm:text-base text-[var(--color-text-muted)] font-medium shrink-0">
                {champ.rank}/{champions.length}
              </span>
            )}
            <TierBadge tier={champ.tier} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-[var(--color-text-secondary)]">
            <span className="font-bold text-[var(--color-wr-high)]">
              {champWr.toFixed(1)}% WR
            </span>
            {champ.pick_rate && (
              <span className="text-xs">{champ.pick_rate.toFixed(1)}% PR</span>
            )}
            <span className="text-[10px] text-[var(--color-text-muted)]">{t("patchLabel", { patch })}</span>
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {(champ.classes ?? champ.tags).map((cl) => (
              <span
                key={cl}
                className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] capitalize"
              >
                {cl}
              </span>
            ))}
          </div>
          {(champ.kit_tags ?? []).length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {(champ.kit_tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-[var(--color-neon-primary)]/30 bg-[var(--color-neon-primary)]/5 text-[var(--color-neon-primary)]/70"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Neon divider */}
      <div className="h-0.5 mb-4 rounded-full bg-gradient-to-r from-[var(--color-neon-primary)] to-[var(--color-neon-secondary)]" />

      {/* ─── Strong combos + Traps ─── */}
      {(strongCombos.length > 0 || avoidCombos.length > 0) && (
        <section className="glass-card p-4 mb-3 sm:mb-6">
          {strongCombos.length > 0 && (
            <div className={avoidCombos.length > 0 ? "mb-4" : ""}>
              <h2 className="text-sm font-bold mb-2 text-green-400 border-l-2 border-green-400 pl-2">
                {t("strongCombos")}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {strongCombos.map((c) => {
                  const aug = augmentBySlug.get(c.augmentSlug);
                  return (
                    <Tooltip key={`${c.champion}-${c.augmentSlug}-${c.tier}`} content={aug?.wikiDescription ?? aug?.description}>
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-green-400/30 bg-green-400/5 cursor-default">
                        {aug && (
                          <Image
                            src={aug.icon}
                            alt={aug.name}
                            width={24}
                            height={24}
                            className="rounded"
                            unoptimized
                          />
                        )}
                        <span className="text-xs font-medium text-green-300">
                          {aug?.name ?? c.augment}
                        </span>
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-green-400/20 text-green-400">
                          S
                        </span>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}

          {avoidCombos.length > 0 && (
            <div>
              <h2 className="text-sm font-bold mb-2 text-red-400 border-l-2 border-red-400 pl-2">
                {t("trapsAvoid")}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {avoidCombos.map((c) => {
                  const aug = augmentBySlug.get(c.augmentSlug);
                  return (
                    <Tooltip key={`${c.champion}-${c.augmentSlug}-${c.tier}`} content={aug?.wikiDescription ?? aug?.description}>
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-red-400/30 bg-red-400/5 cursor-default">
                        {aug && (
                          <Image
                            src={aug.icon}
                            alt={aug.name}
                            width={24}
                            height={24}
                            className="rounded"
                            unoptimized
                          />
                        )}
                        <span className="text-xs font-medium text-red-300">
                          {aug?.name ?? c.augment}
                        </span>
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-400/20 text-red-400">
                          C
                        </span>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── Base Stats ─── */}
      {champ.baseStats && (
        <BaseStatsTable stats={champ.baseStats} />
      )}

      {/* ─── Mechanical Interactions ─── */}
      {(mechanicalSynergies.length > 0 || mechanicalTraps.length > 0) && (
        <section className="glass-card p-4 mb-3 sm:mb-6">
          <h2 className="text-sm font-bold mb-1 border-l-2 border-[var(--color-neon-primary)] pl-2">Mechanical Analysis</h2>
          <p className="text-[10px] text-[var(--color-text-muted)] mb-3 pl-3">
            {mechanicalSynergies.length} synergies · {mechanicalTraps.length} traps
          </p>

          {mechanicalSynergies.length > 0 && (
            <div className="mb-3">
              <h3 className="text-xs font-semibold text-green-400 mb-1.5 border-l-2 border-green-400/50 pl-2">
                Synergies
              </h3>
              <div className="space-y-1">
                {mechanicalSynergies.map((ix, i) => (
                  <InteractionRow key={`syn-${i}`} ix={ix} augments={augments} />
                ))}
              </div>
            </div>
          )}

          {mechanicalTraps.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-red-400 mb-1.5 border-l-2 border-red-400/50 pl-2">
                Traps
              </h3>
              <div className="space-y-1">
                {mechanicalTraps.map((ix, i) => (
                  <InteractionRow key={`trap-${i}`} ix={ix} augments={augments} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── Abilities ─── */}
      {abilityProfile && (
        <section className="glass-card p-4 mb-3 sm:mb-6">
          <h2 className="text-sm font-bold mb-3 border-l-2 border-[var(--color-neon-primary)] pl-2">{t("skillOrder")}</h2>

          {/* Damage type + attack type badges + playstyle bars inline */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <DamageTypeBadge
              type={abilityProfile.damageType}
              label={damageTypeLabel[abilityProfile.damageType] ?? abilityProfile.damageType}
            />
            <AttackTypeBadge
              type={abilityProfile.attackType}
              label={attackTypeLabel[abilityProfile.attackType] ?? abilityProfile.attackType}
            />
          </div>

          {/* Playstyle bars — compact row */}
          <div className="grid grid-cols-5 gap-2 mb-4 px-2 py-2.5 rounded-lg bg-[var(--color-bg-card)]/60">
            {playstyleItems.map(([key, label]) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5">
                  {[1, 2, 3].map((pip) => (
                    <div
                      key={pip}
                      className={`w-3 sm:w-4 h-1.5 rounded-full ${
                        pip <= abilityProfile.playstyle[key]
                          ? "bg-[var(--color-neon-primary)]"
                          : "bg-[var(--color-border-default)]"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[8px] sm:text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide text-center leading-tight">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Ability list — compact cards */}
          <div className="space-y-2">
            {abilityProfile.abilities.map((ability) => (
              <div key={ability.key} className="flex items-start gap-2.5 px-2 py-2 rounded-lg border border-[var(--color-border-default)]/50 bg-[var(--color-bg-card)]/30">
                <div className="shrink-0 flex flex-col items-center gap-0.5">
                  <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden border border-[var(--color-border-default)]">
                    <Image
                      src={ability.icon}
                      alt={ability.name}
                      fill
                      className="object-contain"
                      sizes="(max-width: 640px) 32px, 40px"
                      unoptimized
                    />
                  </div>
                  <span className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase">
                    {ability.key}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs sm:text-sm font-semibold">{ability.name}</span>
                  <WikiAbilityStats ability={ability} />
                  {!ability.cooldown && ability.stats && <AbilityStatLine stats={ability.stats} />}
                  <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed line-clamp-2 sm:line-clamp-none">
                    {ability.wikiDescription ?? ability.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <PoolConstructionSection
        title={t("poolConstruction")}
        subtitle={t("poolConstructionSubtitle", {
          name: champ.name,
          kept: pool.total,
          total: augments.length,
        })}
        rarityTitle={t("poolRarityMix")}
        filterTitle={t("poolFilterStack")}
        highlightsTitle={t("poolTopTailored")}
        keptLabel={(count: number) => t("poolKept", { count })}
        removedLabel={(count: number) => t("poolRemoved", { count })}
        profileChips={poolProfileChips}
        raritySummary={poolRaritySummary}
        layers={poolLayers}
        highlights={tailoredHighlights}
        totalAugments={augments.length}
      />

      {/* ─── Augment Rankings ─── */}
      <section className="glass-card p-4">
        <h2 className="text-sm font-bold mb-1 border-l-2 border-[var(--color-neon-primary)] pl-2">
          {t("augments")} — {t("oracleRanked")}
        </h2>
        <p className="text-[10px] text-[var(--color-text-muted)] mb-3 pl-3">
          <span className="font-medium text-[var(--color-text-primary)]">N={pool.total}</span>
          <span> / {augments.length} total</span>
          {poolProfile.resource !== "mana" && <span> · {poolProfile.resource === "none" ? "manaless" : poolProfile.resource}</span>}
          {abilityProfile && <span> · {abilityProfile.attackType}</span>}
        </p>

        <div className="space-y-1.5">
          {topAugments.map(({ aug, score, breakdown, comboTier }, i) => (
            <AugmentRow
              key={aug.slug}
              rank={i + 1}
              aug={aug}
              score={score}
              breakdown={breakdown}
              comboTier={comboTier}
              pillLabels={pillLabels}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TIER_BADGE_STYLES: Record<string, string> = {
  "S+": "text-amber-300 border-amber-300/50 bg-amber-300/10",
  S:    "text-yellow-400 border-yellow-400/50 bg-yellow-400/10",
  A:    "text-green-400 border-green-400/50 bg-green-400/10",
  B:    "text-blue-400 border-blue-400/50 bg-blue-400/10",
  C:    "text-slate-400 border-slate-400/50 bg-slate-400/10",
};

function TierBadge({ tier }: { tier: string }) {
  const styles = TIER_BADGE_STYLES[tier] ?? TIER_BADGE_STYLES.C;
  return (
    <span className={`px-2.5 py-0.5 rounded-md text-sm font-bold border ${styles}`}>
      {tier}
    </span>
  );
}

const RARITY_DOT: Record<string, string> = {
  prismatic: "bg-purple-400",
  gold:      "bg-yellow-400",
  silver:    "bg-slate-400",
};

const SCORE_COLOR = (score: number) => {
  if (score >= 80) return "text-amber-300";
  if (score >= 70) return "text-yellow-400";
  if (score >= 60) return "text-green-400";
  return "text-slate-400";
};

function AugmentRow({
  rank,
  aug,
  score,
  breakdown,
  comboTier,
  pillLabels,
}: {
  rank: number;
  aug: AugmentData;
  score: number;
  breakdown: ReturnType<typeof computeOracleScore>["breakdown"];
  comboTier?: ComboTier;
  pillLabels: PillLabels;
}) {
  const isStrong = comboTier === "S";
  const isTrap = comboTier === "C";

  return (
    <Tooltip content={aug.wikiDescription ?? aug.description}>
      <div
        className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg border transition-colors cursor-default
          ${isStrong ? "border-green-400/30 bg-green-400/5" : isTrap ? "border-red-400/20 bg-red-400/5" : "border-[var(--color-border-default)]/50"}`}
      >
        {/* Rank */}
        <span className="text-[10px] text-[var(--color-text-muted)] w-4 text-right shrink-0">
          {rank}
        </span>

        {/* Icon */}
        <div className="relative w-7 h-7 sm:w-8 sm:h-8 rounded shrink-0">
          <Image
            src={aug.icon}
            alt={aug.name}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 28px, 32px"
            unoptimized
          />
        </div>

        {/* Name + rarity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs sm:text-sm font-medium truncate">{aug.name}</span>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RARITY_DOT[aug.rarity] ?? ""}`} />
            {comboTier && (
              <span
                className={`text-[9px] font-bold px-1 rounded shrink-0
                  ${isStrong ? "text-green-400 bg-green-400/20" : "text-red-400 bg-red-400/20"}`}
              >
                {comboTier}
              </span>
            )}
          </div>
          {/* Score breakdown pills — hidden on mobile for compact view */}
          <div className="hidden sm:flex gap-1.5 mt-0.5 flex-wrap">
            {breakdown.setTierBonus > 0 && (
              <ScorePill label={pillLabels.set} value={breakdown.setTierBonus} />
            )}
            {breakdown.comboBonus > 0 && (
              <ScorePill label={pillLabels.combo} value={breakdown.comboBonus} positive />
            )}
            {breakdown.trapPenalty < 0 && (
              <ScorePill label={pillLabels.trap} value={breakdown.trapPenalty} negative />
            )}
            {breakdown.rarityBonus > 0 && (
              <ScorePill label={pillLabels.rarity} value={breakdown.rarityBonus} />
            )}
            {breakdown.abilityTypeSynergy > 0 && (
              <ScorePill label={pillLabels.dmgType} value={breakdown.abilityTypeSynergy} positive />
            )}
            {breakdown.attackTypeSynergy > 0 && (
              <ScorePill label={pillLabels.atkType} value={breakdown.attackTypeSynergy} positive />
            )}
            {breakdown.ccSynergy > 0 && (
              <ScorePill label={pillLabels.cc} value={breakdown.ccSynergy} positive />
            )}
            {breakdown.tagMismatch < 0 && (
              <ScorePill label={pillLabels.mismatch} value={breakdown.tagMismatch} negative />
            )}
          </div>
        </div>

        {/* Win rate — hidden on mobile */}
        <span className="hidden sm:inline text-xs text-[var(--color-text-muted)] shrink-0">
          {aug.win_rate !== null ? `${aug.win_rate.toFixed(1)}%` : "—"}
        </span>

        {/* Oracle Score */}
        <span className={`text-sm sm:text-base font-bold w-10 sm:w-12 text-right shrink-0 ${SCORE_COLOR(score)}`}>
          {Math.round(score)}
        </span>
      </div>
    </Tooltip>
  );
}

function ScorePill({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = negative
    ? "text-red-400/80"
    : positive
      ? "text-green-400/80"
      : "text-[var(--color-text-muted)]";
  return (
    <span className={`text-[9px] ${color}`}>
      {label}:{value > 0 ? "+" : ""}{value}
    </span>
  );
}

const DAMAGE_TYPE_STYLES: Record<string, string> = {
  magic:    "text-blue-300 border-blue-400/40 bg-blue-400/10",
  physical: "text-orange-300 border-orange-400/40 bg-orange-400/10",
  mixed:    "text-violet-300 border-violet-400/40 bg-violet-400/10",
};

function DamageTypeBadge({ type, label }: { type: string; label: string }) {
  const style = DAMAGE_TYPE_STYLES[type] ?? DAMAGE_TYPE_STYLES.mixed;
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${style}`}>
      {label}
    </span>
  );
}

function AttackTypeBadge({ type, label }: { type: string; label: string }) {
  const style = type === "ranged"
    ? "text-cyan-300 border-cyan-400/40 bg-cyan-400/10"
    : "text-rose-300 border-rose-400/40 bg-rose-400/10";
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${style}`}>
      {label}
    </span>
  );
}

// ─── Mechanical Interaction Components ────────────────────────────────────────

const MECHANIC_LABEL: Record<AugmentMechanic, string> = {
  ABILITY_CRIT:      "Ability Crit",
  ON_HIT:            "On-Hit",
  ATTACK_SPEED:      "Atk Speed",
  DOT_SYNERGY:       "DoT",
  ULT_POWER:         "Ult Power",
  ULT_SEALED:        "Ult Sealed",
  ABILITY_HASTE:     "Ability Haste",
  ON_CAST:           "On-Cast",
  DASH_SYNERGY:      "Dash",
  EXECUTE:           "Execute",
  LIFESTEAL:         "Lifesteal",
  TRUE_DAMAGE:       "True Dmg",
  MANA_SCALING:      "Mana Scale",
  SIZE_CHANGE:       "Size Change",
  SHIELD:            "Shield",
  SUMMON_REPLACE:    "Summoner",
  MELEE_CONVERT:     "Melee Conv",
  AD_SCALING:        "AD Scale",
  AP_SCALING:        "AP Scale",
  IMMOBILIZE_TRIGGER: "Immobilize",
};

const STRENGTH_DOTS = (strength: 1 | 2 | 3, isTrap: boolean) => {
  const color = isTrap ? "bg-red-400" : "bg-green-400";
  const dim = isTrap ? "bg-red-400/20" : "bg-green-400/20";
  return (
    <span className="inline-flex gap-0.5 ml-1">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`w-1.5 h-1.5 rounded-full ${n <= strength ? color : dim}`} />
      ))}
    </span>
  );
};

function InteractionRow({
  ix,
  augments,
}: {
  ix: MechanicalInteraction;
  augments: AugmentData[];
}) {
  const aug = augments.find((a) => a.slug === ix.augmentSlug);
  const isTrap = ix.type === "trap";
  const borderColor = isTrap ? "border-red-400/20" : "border-green-400/20";
  const bgColor = isTrap ? "bg-red-400/5" : "bg-green-400/5";

  return (
    <Tooltip content={ix.reason}>
      <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${borderColor} ${bgColor} cursor-default`}>
        {aug && (
          <div className="relative w-6 h-6 rounded shrink-0">
            <Image
              src={aug.icon}
              alt={ix.augmentName}
              fill
              className="object-contain"
              sizes="24px"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium truncate">{ix.augmentName}</span>
            {STRENGTH_DOTS(ix.strength, isTrap)}
            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded border
              ${isTrap
                ? "text-red-300 border-red-400/30 bg-red-400/10"
                : "text-green-300 border-green-400/30 bg-green-400/10"
              }`}
            >
              {MECHANIC_LABEL[ix.mechanic]}
            </span>
            {ix.abilities.length > 0 && (
              <span className="text-[9px] text-[var(--color-text-muted)]">
                {ix.abilities.join(", ")}
              </span>
            )}
          </div>
          <p className="hidden sm:block text-[10px] text-[var(--color-text-muted)] mt-0.5 line-clamp-1">
            {ix.reason}
          </p>
        </div>
      </div>
    </Tooltip>
  );
}

// ─── Ability Stat Line ────────────────────────────────────────────────────────

const DMG_TYPE_COLOR: Record<string, string> = {
  magic: "text-blue-300",
  physical: "text-orange-300",
  true: "text-white",
};

function AbilityStatLine({ stats }: { stats: AbilityStats }) {
  const parts: Array<{ label: string; value: string; color?: string }> = [];

  if (stats.baseDamage?.length) {
    const dmg = stats.baseDamage;
    parts.push({
      label: "Dmg",
      value: dmg.length > 1 ? `${dmg[0]}–${dmg[dmg.length - 1]}` : `${dmg[0]}`,
      color: DMG_TYPE_COLOR[stats.damageType ?? ""] ?? "text-[var(--color-text-secondary)]",
    });
  }

  if (stats.apRatio) {
    parts.push({ label: "AP", value: `${(stats.apRatio * 100).toFixed(0)}%`, color: "text-blue-300" });
  }
  if (stats.adRatio) {
    parts.push({ label: "bAD", value: `${(stats.adRatio * 100).toFixed(0)}%`, color: "text-orange-300" });
  }
  if (stats.totalAdRatio) {
    parts.push({ label: "tAD", value: `${(stats.totalAdRatio * 100).toFixed(0)}%`, color: "text-orange-300" });
  }
  if (stats.hpRatio) {
    parts.push({ label: "HP", value: `${(stats.hpRatio * 100).toFixed(0)}%`, color: "text-green-300" });
  }

  if (stats.cooldown?.length) {
    const cd = stats.cooldown;
    parts.push({
      label: "CD",
      value: cd.length > 1 && cd[0] !== cd[cd.length - 1] ? `${cd[0]}–${cd[cd.length - 1]}s` : `${cd[0]}s`,
    });
  }

  if (stats.manaCost?.length) {
    const cost = stats.manaCost;
    parts.push({
      label: "Cost",
      value: cost.length > 1 && cost[0] !== cost[cost.length - 1] ? `${cost[0]}–${cost[cost.length - 1]}` : `${cost[0]}`,
      color: "text-cyan-300",
    });
  }

  if (stats.ccType) {
    parts.push({
      label: stats.ccType,
      value: stats.ccDuration ? `${stats.ccDuration}s` : "",
      color: "text-yellow-300",
    });
  }

  if (stats.range) {
    parts.push({ label: "Range", value: `${stats.range}` });
  }

  const flags: string[] = [];
  if (stats.isDot) flags.push("DoT");
  if (stats.isAoe) flags.push("AoE");
  if (stats.isOnHit) flags.push("On-Hit");

  if (parts.length === 0 && flags.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-1">
      {parts.map((p, i) => (
        <span key={i} className={`text-[10px] ${p.color ?? "text-[var(--color-text-muted)]"}`}>
          {p.label}{p.value ? ` ${p.value}` : ""}
        </span>
      ))}
      {flags.map((f) => (
        <span key={f} className="text-[10px] px-1 py-0.5 rounded bg-[var(--color-border-default)]/50 text-[var(--color-text-muted)]">
          {f}
        </span>
      ))}
    </div>
  );
}

// ─── Wiki Ability Stats ─────────────────────────────────────────────────────

function WikiAbilityStats({ ability }: { ability: AbilityEntry }) {
  const pills: Array<{ label: string; value: string; color?: string }> = [];

  if (ability.cooldown) {
    pills.push({ label: "CD", value: ability.cooldown });
  }
  if (ability.cost) {
    pills.push({ label: "Cost", value: ability.cost, color: "text-cyan-300" });
  }
  if (ability.range) {
    pills.push({ label: "Range", value: ability.range });
  }
  if (ability.effectRadius) {
    pills.push({ label: "Radius", value: ability.effectRadius });
  }
  if (ability.width) {
    pills.push({ label: "Width", value: ability.width });
  }
  if (ability.speed) {
    pills.push({ label: "Speed", value: ability.speed });
  }
  if (ability.castTime) {
    pills.push({ label: "Cast", value: `${ability.castTime}s` });
  }
  if (ability.damageFormula) {
    pills.push({ label: "Dmg", value: ability.damageFormula, color: "text-purple-300" });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-1">
      {pills.map((p, i) => (
        <span key={i} className={`text-[10px] ${p.color ?? "text-[var(--color-text-muted)]"}`}>
          <span className="opacity-60">{p.label}</span> {p.value}
        </span>
      ))}
    </div>
  );
}

// ─── Base Stats Table ────────────────────────────────────────────────────────

function statAtLevel(base: number, growth: number, level: number): number {
  return base + growth * (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

type StatRow = {
  label: string;
  base: keyof ChampionBaseStats;
  growth?: keyof ChampionBaseStats;
  decimals?: number;
  isPercent?: boolean;
  flat?: boolean; // no growth formula, just show base
};

const STAT_ROWS: StatRow[] = [
  { label: "Health",        base: "baseHP",      growth: "hpGrowth" },
  { label: "Mana",          base: "baseMP",      growth: "mpGrowth" },
  { label: "HP Regen /5",   base: "baseHPRegen", growth: "hpRegenGrowth", decimals: 1 },
  { label: "MP Regen /5",   base: "baseMPRegen", growth: "mpRegenGrowth", decimals: 1 },
  { label: "Armor",         base: "baseArmor",   growth: "armorGrowth", decimals: 1 },
  { label: "Magic Resist",  base: "baseMR",      growth: "mrGrowth", decimals: 1 },
  { label: "Attack Damage",  base: "baseAD",     growth: "adGrowth", decimals: 1 },
  { label: "Attack Speed",  base: "baseAS",      decimals: 3 },
  { label: "AS Growth",     base: "asGrowth",    decimals: 1, isPercent: true, flat: true },
  { label: "Attack Range",  base: "attackRange",  flat: true },
  { label: "Move Speed",    base: "moveSpeed",    flat: true },
  { label: "Missile Speed", base: "missileSpeed", flat: true },
];

function BaseStatsTable({ stats }: { stats: ChampionBaseStats }) {
  const rows = STAT_ROWS.filter((row) => {
    const val = stats[row.base];
    return val != null && val !== 0;
  });

  return (
    <section className="glass-card p-4 mb-3 sm:mb-6">
      <h2 className="text-sm font-bold mb-3 border-l-2 border-[var(--color-neon-primary)] pl-2">
        Base Stats
      </h2>
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-default)]">
              <th className="text-left text-[9px] sm:text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-2 sm:px-3 py-1.5">Stat</th>
              <th className="text-right text-[9px] sm:text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-2 sm:px-3 py-1.5">Base</th>
              <th className="text-right text-[9px] sm:text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-2 sm:px-3 py-1.5">+/lvl</th>
              <th className="text-right text-[9px] sm:text-[10px] font-medium text-[var(--color-neon-primary)]/70 uppercase tracking-wide px-2 sm:px-3 py-1.5">@18</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const base = stats[row.base] as number;
              const growth = row.growth ? (stats[row.growth] as number | undefined) : undefined;
              const dec = row.decimals ?? 0;

              let at18: number | undefined;
              if (!row.flat && !row.isPercent && growth != null) {
                at18 = statAtLevel(base, growth, 18);
              }

              return (
                <tr
                  key={row.label}
                  className="border-b border-[var(--color-border-default)]/30 last:border-0"
                >
                  <td className="px-2 sm:px-3 py-1 text-[11px] sm:text-xs text-[var(--color-text-secondary)]">{row.label}</td>
                  <td className="px-2 sm:px-3 py-1 text-right tabular-nums font-medium">
                    {base.toFixed(dec)}{row.isPercent ? "%" : ""}
                  </td>
                  <td className="px-2 sm:px-3 py-1 text-right tabular-nums text-[var(--color-text-muted)] text-[11px]">
                    {growth != null && growth > 0 ? `+${growth}` : "—"}
                  </td>
                  <td className="px-2 sm:px-3 py-1 text-right tabular-nums text-[var(--color-neon-primary)] font-medium">
                    {at18 != null ? at18.toFixed(dec) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
