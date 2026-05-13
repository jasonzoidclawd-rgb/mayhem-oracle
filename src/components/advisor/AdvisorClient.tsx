"use client";

import { rankOfferedAugments } from "@/lib/scoring/offered-ranking";
import type {
  AugmentDamageContext,
  ComboMetadataEntry,
  RankingAugment,
  RankingChampion,
  ScoreBand,
} from "@/lib/scoring/offered-ranking";
import { computeChampionBaseline } from "@/lib/scoring/damage-context";
import { useMemo, useState } from "react";

type AdvisorChampion = RankingChampion & {
  slug: string;
  name: string;
  icon?: string;
  tier?: string;
};

type AdvisorAugment = RankingAugment & {
  displayName: string;
};

type AdvisorCopy = {
  title: string;
  description: string;
  championSelectorTitle: string;
  championSearchLabel: string;
  championSearchPlaceholder: string;
  championSelectLabel: string;
  championSelectPlaceholder: string;
  ownedAugmentsTitle: string;
  ownedAugmentsLabel: string;
  ownedAugmentsHelp: string;
  offeredAugmentsTitle: string;
  offeredAugmentLabel: string;
  offeredAugmentPlaceholder: string;
  duplicateOfferedWarning: string;
  rerollTitle: string;
  normalRerollsLabel: string;
  goldenRerollLabel: string;
  seenRerollsLabel: string;
  seenRerollsPlaceholder: string;
  shopTimingTitle: string;
  shopTimingLabel: string;
  shopAvailableNow: string;
  shopDelayedUntilShop: string;
  shopCheatingRecall: string;
  shopQueued: string;
  selectionRoundTitle: string;
  selectionRoundLabel: string;
  selectionRoundLevel3: string;
  selectionRoundLevel7: string;
  selectionRoundLevel11: string;
  selectionRoundLevel15: string;
  screenTierLabel: string;
  tierSilver: string;
  tierGold: string;
  tierPrismatic: string;
  resultsTitle: string;
  resultsIncomplete: string;
  rankLabel: string;
  scoreLabel: string;
  scoreBandLabel: string;
  reasonsLabel: string;
  noReasons: string;
  rerollEvLabel: string;
  rerollStanceLabel: string;
  rerollFactorLabel: string;
  confidenceLabel: string;
  shopTimingStatusLabel: string;
  statusOpen: string;
  statusClosed: string;
  statusUnknown: string;
  reasonStrongCombo: string;
  reasonTrapCombo: string;
  reasonTrapPenalty: string;
  reasonAbilityTypeSynergy: string;
  reasonAttackTypeSynergy: string;
  reasonCrowdControlSynergy: string;
  reasonTagMismatch: string;
  reasonSameSetProgress: string;
  reasonChampionModeOverride: string;
  reasonChampionModeTrap: string;
  reasonTextInferredCrowdControl: string;
  reasonOracleScoreBand: string;
  reasonAugmentWinRateAvailable: string;
  reasonAugmentWinRateMissing: string;
  factorGoldenUpgrade: string;
  factorSameTierReroll: string;
  factorIncompletePoolData: string;
  factorNoNormalRerolls: string;
  factorLateSelectionRound: string;
  factorSeenRerolledOffers: string;
  stanceSameTierSearch: string;
  stanceUpgradeOpportunity: string;
  stanceHoldCurrent: string;
  bandExcellent: string;
  bandGood: string;
  bandAverage: string;
  bandWeak: string;
  confidenceHigh: string;
  confidenceMedium: string;
  confidenceLow: string;
  summaryTitle: string;
  noSelection: string;
  selectedChampionLabel: string;
  selectedOwnedLabel: string;
  selectedOffersLabel: string;
  selectedRerollsLabel: string;
  selectedShopLabel: string;
  dataSummary: string;
  baselineLabel: string;
  baselineNote: string;
  dpsDeltaLabel: string;
};

type ShopTiming = "available-now" | "delayed-until-shop" | "cheating-recall" | "queued";
type SelectionRound = "level-3" | "level-7" | "level-11" | "level-15";
type ScreenTier = "silver" | "gold" | "prismatic";

const shopTimingKeys: ShopTiming[] = [
  "available-now",
  "delayed-until-shop",
  "cheating-recall",
  "queued",
];
const selectionRoundKeys: SelectionRound[] = ["level-3", "level-7", "level-11", "level-15"];
const screenTierKeys: ScreenTier[] = ["silver", "gold", "prismatic"];

function readableCode(code: string): string {
  return code.replace(/-/g, " ");
}

function ChampionBaselineRow({
  baseStats,
  abilityProfile,
  copy,
}: {
  baseStats: NonNullable<RankingChampion["baseStats"]>;
  abilityProfile: NonNullable<RankingChampion["abilityProfile"]>;
  copy: Pick<AdvisorCopy, "baselineLabel" | "baselineNote">;
}) {
  const baseline = useMemo(
    () => computeChampionBaseline(baseStats, abilityProfile),
    [baseStats, abilityProfile],
  );
  return (
    <div className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
      {copy.baselineLabel} —{" "}
      <span className="text-[var(--color-text-secondary)]">
        {baseline.dps.toFixed(0)} DPS · {baseline.totalAD.toFixed(0)} AD · {baseline.attackSpeed.toFixed(2)} AS
      </span>
      <span className="ml-2 opacity-60">({copy.baselineNote.replace("{armor}", "100")})</span>
    </div>
  );
}

function DamageContextBadge({
  ctx,
  dpsDeltaLabel,
}: {
  ctx: AugmentDamageContext;
  dpsDeltaLabel: string;
}) {
  if (!ctx.hasParsableStats || ctx.dpsDeltaPct === 0) return null;

  const positive = ctx.dpsDeltaPct > 0;
  const badgeClass = positive
    ? "text-green-400 bg-green-900/30"
    : "text-red-400 bg-red-900/30";
  const statPills = Object.entries(ctx.parsedStats)
    .filter(([, v]) => v !== undefined && v !== 0)
    .map(([k, v]) => {
      const pct = ["attackSpeed", "critChance", "critDamage", "armorPenPct"].includes(k);
      const val = pct ? `${((v as number) * 100).toFixed(0)}%` : String(Math.round(v as number));
      const label = k === "attackDamage" ? "AD" : k === "attackSpeed" ? "AS" : k === "critChance" ? "Crit" : k === "critDamage" ? "CritDmg" : k === "lethality" ? "Leth" : "ArmPen";
      return `+${val} ${label}`;
    });

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>
        {positive ? "+" : ""}{ctx.dpsDeltaPct.toFixed(0)}% {dpsDeltaLabel}
      </span>
      {statPills.map((pill) => (
        <span
          key={pill}
          className="rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]"
        >
          {pill}
        </span>
      ))}
    </div>
  );
}

function shopStatus(timing: ShopTiming): "open" | "closed" | "unknown" {
  if (timing === "available-now" || timing === "cheating-recall") return "open";
  if (timing === "delayed-until-shop" || timing === "queued") return "closed";
  return "unknown";
}

export function AdvisorClient({
  champions,
  augments,
  combosByChampion,
  copy,
}: {
  champions: AdvisorChampion[];
  augments: AdvisorAugment[];
  combosByChampion: Record<string, Record<string, ComboMetadataEntry>>;
  copy: AdvisorCopy;
}) {
  const [championQuery, setChampionQuery] = useState("");
  const [selectedChampionSlug, setSelectedChampionSlug] = useState("");
  const [ownedAugmentSlugs, setOwnedAugmentSlugs] = useState<string[]>([]);
  const [offeredAugmentSlugs, setOfferedAugmentSlugs] = useState(["", "", ""]);
  const [normalRerolls, setNormalRerolls] = useState(0);
  const [goldenRerollAvailable, setGoldenRerollAvailable] = useState(false);
  const [seenRerolledOffers, setSeenRerolledOffers] = useState("");
  const [shopTiming, setShopTiming] = useState<ShopTiming>("available-now");
  const [selectionRound, setSelectionRound] = useState<SelectionRound>("level-3");
  const [screenTier, setScreenTier] = useState<ScreenTier>("gold");

  const filteredChampions = useMemo(() => {
    const normalizedQuery = championQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return champions;
    }

    return champions.filter((champion) =>
      champion.name.toLowerCase().includes(normalizedQuery),
    );
  }, [champions, championQuery]);

  const augmentsBySlug = useMemo(
    () => new Map(augments.map((augment) => [augment.slug, augment])),
    [augments],
  );

  const selectedChampion = champions.find(
    (champion) => champion.slug === selectedChampionSlug,
  );
  const selectedOwnedAugments = ownedAugmentSlugs
    .map((slug) => augmentsBySlug.get(slug)?.displayName)
    .filter(Boolean)
    .join(", ");
  const selectedOfferedAugments = offeredAugmentSlugs
    .map((slug) => augmentsBySlug.get(slug)?.displayName)
    .filter(Boolean)
    .join(", ");
  const hasDuplicateOfferedAugments =
    new Set(offeredAugmentSlugs.filter(Boolean)).size !==
    offeredAugmentSlugs.filter(Boolean).length;

  const shopTimingLabels: Record<ShopTiming, string> = {
    "available-now": copy.shopAvailableNow,
    "delayed-until-shop": copy.shopDelayedUntilShop,
    "cheating-recall": copy.shopCheatingRecall,
    queued: copy.shopQueued,
  };
  const selectionRoundLabels: Record<SelectionRound, string> = {
    "level-3": copy.selectionRoundLevel3,
    "level-7": copy.selectionRoundLevel7,
    "level-11": copy.selectionRoundLevel11,
    "level-15": copy.selectionRoundLevel15,
  };
  const screenTierLabels: Record<ScreenTier, string> = {
    silver: copy.tierSilver,
    gold: copy.tierGold,
    prismatic: copy.tierPrismatic,
  };
  const scoreBandLabels: Record<ScoreBand, string> = {
    excellent: copy.bandExcellent,
    good: copy.bandGood,
    average: copy.bandAverage,
    weak: copy.bandWeak,
  };
  const confidenceLabels = {
    high: copy.confidenceHigh,
    medium: copy.confidenceMedium,
    low: copy.confidenceLow,
  };
  const reasonLabels: Record<string, string> = {
    "strong-combo": copy.reasonStrongCombo,
    "trap-combo": copy.reasonTrapCombo,
    "trap-penalty": copy.reasonTrapPenalty,
    "ability-type-synergy": copy.reasonAbilityTypeSynergy,
    "attack-type-synergy": copy.reasonAttackTypeSynergy,
    "crowd-control-synergy": copy.reasonCrowdControlSynergy,
    "tag-mismatch": copy.reasonTagMismatch,
    "same-set-2-piece-progress": copy.reasonSameSetProgress,
    "champion-mode-override": copy.reasonChampionModeOverride,
    "champion-mode-trap": copy.reasonChampionModeTrap,
    "text-inferred-crowd-control-synergy": copy.reasonTextInferredCrowdControl,
    "oracle-score-band": copy.reasonOracleScoreBand,
    "augment-win-rate-available": copy.reasonAugmentWinRateAvailable,
    "augment-win-rate-missing": copy.reasonAugmentWinRateMissing,
  };
  const factorLabels: Record<string, string> = {
    "golden-reroll-upgrade-opportunity": copy.factorGoldenUpgrade,
    "same-tier-reroll": copy.factorSameTierReroll,
    "incomplete-pool-data": copy.factorIncompletePoolData,
    "no-normal-rerolls-remaining": copy.factorNoNormalRerolls,
    "late-selection-round": copy.factorLateSelectionRound,
    "seen-rerolled-offers": copy.factorSeenRerolledOffers,
  };
  const stanceLabels: Record<string, string> = {
    "same-tier-search": copy.stanceSameTierSearch,
    "upgrade-opportunity": copy.stanceUpgradeOpportunity,
    "hold-current": copy.stanceHoldCurrent,
  };
  const selectedOfferedAugmentObjects = offeredAugmentSlugs
    .map((slug) => augmentsBySlug.get(slug))
    .filter((augment): augment is AdvisorAugment => Boolean(augment));
  const selectedOwnedAugmentObjects = ownedAugmentSlugs
    .map((slug) => augmentsBySlug.get(slug))
    .filter((augment): augment is AdvisorAugment => Boolean(augment));
  const canRank = Boolean(selectedChampion) && selectedOfferedAugmentObjects.length === 3;
  const rankingResult = useMemo(() => {
    if (!selectedChampion || selectedOfferedAugmentObjects.length !== 3) return undefined;

    return rankOfferedAugments({
      champion: selectedChampion,
      offeredAugments: selectedOfferedAugmentObjects,
      ownedAugments: selectedOwnedAugmentObjects,
      comboMetadata: combosByChampion[selectedChampion.slug],
      modeRules: { inferFromText: true },
      rerollContext: {
        screenTier,
        rerollType: goldenRerollAvailable ? "golden" : "normal",
        selectionRound,
        normalRerollsRemaining: normalRerolls,
        seenRerolledOfferSlugs: seenRerolledOffers
          .split(/[\n,]+/)
          .map((slug) => slug.trim())
          .filter(Boolean),
        poolDataComplete: false,
      },
      shopAvailability: { status: shopStatus(shopTiming) },
    });
  }, [
    combosByChampion,
    goldenRerollAvailable,
    screenTier,
    selectedChampion,
    normalRerolls,
    selectedOfferedAugmentObjects,
    selectedOwnedAugmentObjects,
    seenRerolledOffers,
    selectionRound,
    shopTiming,
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold mb-2">{copy.title}</h1>
        <p className="max-w-3xl text-[var(--color-text-secondary)]">
          {copy.description}
        </p>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          {copy.dataSummary}
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="font-semibold mb-4">{copy.championSelectorTitle}</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="champion-search">
                {copy.championSearchLabel}
              </label>
              <input
                id="champion-search"
                type="search"
                value={championQuery}
                onChange={(event) => setChampionQuery(event.target.value)}
                placeholder={copy.championSearchPlaceholder}
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="champion-select">
                {copy.championSelectLabel}
              </label>
              <select
                id="champion-select"
                value={selectedChampionSlug}
                onChange={(event) => setSelectedChampionSlug(event.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
              >
                <option value="">{copy.championSelectPlaceholder}</option>
                {filteredChampions.map((champion) => (
                  <option key={champion.slug} value={champion.slug}>
                    {champion.name}
                    {champion.tier ? ` · ${champion.tier}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-4">{copy.ownedAugmentsTitle}</h2>
          <label className="mb-2 block text-sm font-medium" htmlFor="owned-augments">
            {copy.ownedAugmentsLabel}
          </label>
          <select
            id="owned-augments"
            multiple
            size={8}
            value={ownedAugmentSlugs}
            onChange={(event) =>
              setOwnedAugmentSlugs(
                Array.from(event.target.selectedOptions, (option) => option.value),
              )
            }
            className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
          >
            {augments.map((augment) => (
              <option key={augment.slug} value={augment.slug}>
                {augment.displayName} · {augment.rarity ?? "—"}
                {augment.set ? ` · ${augment.set}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {copy.ownedAugmentsHelp}
          </p>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-4">{copy.offeredAugmentsTitle}</h2>
          <div className="space-y-3">
            {offeredAugmentSlugs.map((selectedSlug, slotIndex) => {
              const selectedInOtherSlots = new Set(
                offeredAugmentSlugs.filter((slug, index) => slug && index !== slotIndex),
              );

              return (
                <div key={slotIndex}>
                  <label
                    className="mb-2 block text-sm font-medium"
                    htmlFor={`offered-augment-${slotIndex}`}
                  >
                    {copy.offeredAugmentLabel.replace("{number}", String(slotIndex + 1))}
                  </label>
                  <select
                    id={`offered-augment-${slotIndex}`}
                    value={selectedSlug}
                    onChange={(event) => {
                      const next = [...offeredAugmentSlugs];
                      next[slotIndex] = event.target.value;
                      setOfferedAugmentSlugs(next);
                    }}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
                  >
                    <option value="">{copy.offeredAugmentPlaceholder}</option>
                    {augments.map((augment) => (
                      <option
                        key={augment.slug}
                        value={augment.slug}
                        disabled={selectedInOtherSlots.has(augment.slug)}
                      >
                        {augment.displayName} · {augment.rarity ?? "—"}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {hasDuplicateOfferedAugments ? (
            <p className="mt-3 text-sm text-amber-400">{copy.duplicateOfferedWarning}</p>
          ) : null}
        </div>
      </section>

      {selectedChampion?.baseStats && selectedChampion.abilityProfile ? (
        <ChampionBaselineRow
          baseStats={selectedChampion.baseStats}
          abilityProfile={selectedChampion.abilityProfile}
          copy={copy}
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <h2 className="font-semibold mb-4">{copy.rerollTitle}</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="normal-rerolls">
                {copy.normalRerollsLabel}
              </label>
              <input
                id="normal-rerolls"
                type="number"
                min={0}
                max={99}
                value={normalRerolls}
                onChange={(event) =>
                  setNormalRerolls(Math.max(0, Number(event.target.value) || 0))
                }
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
              />
            </div>
            <label className="flex items-center gap-3 text-sm" htmlFor="golden-reroll">
              <input
                id="golden-reroll"
                type="checkbox"
                checked={goldenRerollAvailable}
                onChange={(event) => setGoldenRerollAvailable(event.target.checked)}
                className="h-4 w-4"
              />
              {copy.goldenRerollLabel}
            </label>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="seen-rerolled-offers">
                {copy.seenRerollsLabel}
              </label>
              <textarea
                id="seen-rerolled-offers"
                value={seenRerolledOffers}
                onChange={(event) => setSeenRerolledOffers(event.target.value)}
                placeholder={copy.seenRerollsPlaceholder}
                rows={3}
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
              />
            </div>
          </div>
        </div>

        <fieldset className="card p-5">
          <legend className="font-semibold mb-4">{copy.selectionRoundTitle}</legend>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="selection-round">
                {copy.selectionRoundLabel}
              </label>
              <select
                id="selection-round"
                value={selectionRound}
                onChange={(event) => setSelectionRound(event.target.value as SelectionRound)}
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
              >
                {selectionRoundKeys.map((round) => (
                  <option key={round} value={round}>
                    {selectionRoundLabels[round]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="screen-tier">
                {copy.screenTierLabel}
              </label>
              <select
                id="screen-tier"
                value={screenTier}
                onChange={(event) => setScreenTier(event.target.value as ScreenTier)}
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm"
              >
                {screenTierKeys.map((tier) => (
                  <option key={tier} value={tier}>
                    {screenTierLabels[tier]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="card p-5">
          <legend className="font-semibold mb-4">{copy.shopTimingTitle}</legend>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            {copy.shopTimingLabel}
          </p>
          <div className="space-y-3">
            {shopTimingKeys.map((timing) => (
              <label key={timing} className="flex items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="shop-timing"
                  value={timing}
                  checked={shopTiming === timing}
                  onChange={(event) => setShopTiming(event.target.value as ShopTiming)}
                  className="h-4 w-4"
                />
                {shopTimingLabels[timing]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">{copy.resultsTitle}</h2>
        <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          <p className="font-medium text-[var(--color-text-primary)]">{copy.summaryTitle}</p>
          <dl className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {copy.selectedChampionLabel}
              </dt>
              <dd>{selectedChampion?.name ?? copy.noSelection}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {copy.selectedOwnedLabel}
              </dt>
              <dd>{selectedOwnedAugments || copy.noSelection}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {copy.selectedOffersLabel}
              </dt>
              <dd>{selectedOfferedAugments || copy.noSelection}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {copy.selectedRerollsLabel}
              </dt>
              <dd>
                {normalRerolls}
                {goldenRerollAvailable ? ` + ${copy.goldenRerollLabel}` : ""}
                {seenRerolledOffers.trim() ? ` · ${seenRerolledOffers.trim()}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {copy.selectedShopLabel}
              </dt>
              <dd>{shopTimingLabels[shopTiming]}</dd>
            </div>
          </dl>
        </div>

        {!canRank || !rankingResult ? (
          <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            {copy.resultsIncomplete}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {rankingResult.rerollEv ? (
              <div className="mb-4 rounded-md border border-[var(--color-border-default)] p-3 text-xs">
                <p className="font-semibold text-[var(--color-text-primary)]">{copy.rerollEvLabel}</p>
                <p className="mt-1">
                  {copy.rerollStanceLabel}: {stanceLabels[rankingResult.rerollEv.stance] ?? readableCode(rankingResult.rerollEv.stance)}
                </p>
                <p>
                  {copy.confidenceLabel}: {confidenceLabels[rankingResult.rerollEv.confidence]}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>
                    {copy.selectedRerollsLabel}: {normalRerolls}
                    {goldenRerollAvailable ? ` + ${copy.goldenRerollLabel}` : ""}
                  </li>
                  {rankingResult.rerollEv.factors.map((factor) => (
                    <li key={factor}>
                      {copy.rerollFactorLabel}: {factorLabels[factor] ?? readableCode(factor)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {rankingResult.rankings.map((ranking) => (
              <article
                key={`${ranking.rank}-${ranking.augment.slug}`}
                className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                      {copy.rankLabel.replace("{rank}", String(ranking.rank))}
                    </p>
                    <h3 className="mt-1 font-semibold text-[var(--color-text-primary)]">
                      {ranking.augment.name}
                    </h3>
                    {ranking.damageContext ? (
                      <DamageContextBadge ctx={ranking.damageContext} dpsDeltaLabel={copy.dpsDeltaLabel} />
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-[var(--color-text-muted)]">
                    <div>
                      {copy.scoreLabel}: {ranking.score}
                    </div>
                    <div>
                      {copy.scoreBandLabel}: {scoreBandLabels[ranking.scoreBand]}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {copy.reasonsLabel}
                  </p>
                  {ranking.reasons.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                      {ranking.reasons.map((reason, index) => (
                        <li key={`${reason.code}-${index}`}>
                          {reasonLabels[reason.code] ?? readableCode(reason.code)}
                          <span className="text-[var(--color-text-muted)]">
                            {` · ${copy.confidenceLabel}: ${confidenceLabels[reason.confidence]}`}
                            {reason.ref ? ` · ${reason.ref}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]">{copy.noReasons}</p>
                  )}
                </div>

                {ranking.shopTiming ? (
                  <div className="mt-4 rounded-md border border-[var(--color-border-default)] p-3 text-xs">
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      {copy.shopTimingStatusLabel}: {ranking.shopTiming.status === "open"
                        ? copy.statusOpen
                        : ranking.shopTiming.status === "closed"
                          ? copy.statusClosed
                          : copy.statusUnknown}
                    </p>
                    <p className="mt-1">{shopTimingLabels[shopTiming]}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
