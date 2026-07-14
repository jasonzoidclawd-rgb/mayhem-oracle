"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ChampionMatrixClient } from "@/components/champions/ChampionMatrixClient";
import {
  PoolConstructionSection,
  type PoolLayer,
  type PoolProfileChip,
  type PoolRaritySummary,
} from "@/components/champions/PoolConstructionSection";
import { MembershipGate } from "@/components/membership/MembershipGate";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  ChampionMemberInteraction,
  ChampionMemberRanking,
  ChampionMemberViewPayload,
} from "@/lib/champions/member-view-contract";
import {
  requestChampionMemberView,
  type ChampionMemberViewState,
} from "@/lib/champions/member-view-client";
import type { DecisionGrade } from "@/lib/contracts/decision";
import type { AugmentMechanic } from "@/lib/scoring/augment-interactions";

type ChampionMemberIslandProps = {
  championSlug: string;
  championName: string;
  locale: string;
  publicPatch: string;
  publicProfileChips: PoolProfileChip[];
  publicRaritySummary: PoolRaritySummary[];
  publicLayers: PoolLayer[];
  publicAugmentCount: number;
};

export function ChampionMemberIsland({
  championSlug,
  championName,
  locale,
  publicPatch,
  publicProfileChips,
  publicRaritySummary,
  publicLayers,
  publicAugmentCount,
}: ChampionMemberIslandProps) {
  const t = useTranslations("champion");
  const enabled = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const [state, setState] = useState<ChampionMemberViewState>(
    enabled ? { kind: "loading" } : { kind: "anonymous" },
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    requestChampionMemberView(championSlug, locale, publicPatch).then((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
    };
  }, [championSlug, enabled, locale, publicPatch]);

  if (state.kind === "member") {
    return (
      <MemberContent
        championName={championName}
        payload={state.payload}
      />
    );
  }

  const isSignedIn = state.kind === "non-member";
  const showFailure = state.kind === "error" || state.kind === "not-found";
  return (
    <div className="min-h-[42rem]" aria-busy={state.kind === "loading"}>
      {state.kind === "patch-mismatch" ? (
        <p
          className="glass-card mb-3 border border-amber-400/40 p-3 text-sm text-amber-200"
          role="alert"
        >
          {t("memberPatchMismatch", {
            publicPatch: state.publicPatch,
            memberPatch: state.memberPatch,
          })}
        </p>
      ) : null}
      {showFailure ? (
        <p
          className="glass-card mb-3 border border-rose-400/30 p-3 text-sm text-rose-200"
          role="alert"
        >
          {t("memberUnavailable")}
        </p>
      ) : null}
      <LockedContent
        championSlug={championSlug}
        championName={championName}
        isSignedIn={isSignedIn}
        profileChips={publicProfileChips}
        raritySummary={publicRaritySummary}
        layers={publicLayers}
        totalAugments={publicAugmentCount}
      />
    </div>
  );
}

function LockedContent({
  championSlug,
  championName,
  isSignedIn,
  profileChips,
  raritySummary,
  layers,
  totalAugments,
}: {
  championSlug: string;
  championName: string;
  isSignedIn: boolean;
  profileChips: PoolProfileChip[];
  raritySummary: PoolRaritySummary[];
  layers: PoolLayer[];
  totalAugments: number;
}) {
  const t = useTranslations("champion");
  const tm = useTranslations("membership");
  return (
    <>
      <PoolConstructionSection
        title={t("poolConstruction")}
        subtitle={t("poolConstructionSubtitle", {
          name: championName,
          kept: totalAugments,
          total: totalAugments,
        })}
        rarityTitle={t("poolRarityMix")}
        filterTitle={t("poolFilterStack")}
        highlightsTitle={t("poolTopTailored")}
        keptLabel={(count) => t("poolKept", { count })}
        removedLabel={(count) => t("poolRemoved", { count })}
        profileChips={profileChips}
        raritySummary={raritySummary}
        layers={layers}
        highlights={[]}
        totalAugments={totalAugments}
        gated
        signInUrl="/account"
        signInNextPath={isSignedIn ? undefined : `/champions/${championSlug}`}
        gateCopy={isSignedIn ? {
          title: tm("lockedTitle"),
          description: tm("lockedBody"),
          signIn: tm("lockedCta"),
        } : {
          title: t("poolGateTitle"),
          description: t("poolGateDescription"),
          signIn: t("poolGateSignIn"),
        }}
      />
      <section className="glass-card p-4">
        <MembershipGate
          title={tm("lockedTitle")}
          body={tm("lockedBody")}
          cta={tm("lockedCta")}
        />
      </section>
      <section className="glass-card p-4">
        <h2 className="mb-1 border-l-2 border-[var(--color-neon-primary)] pl-2 text-sm font-bold">
          {t("augments")} — {t("oracleRanked")}
        </h2>
        <div className="mt-3">
          <MembershipGate
            title={tm("lockedTitle")}
            body={tm("lockedBody")}
            cta={tm("lockedCta")}
          />
        </div>
      </section>
    </>
  );
}

function MemberContent({
  championName,
  payload,
}: {
  championName: string;
  payload: ChampionMemberViewPayload;
}) {
  const t = useTranslations("champion");
  const tm = useTranslations("membership");
  const tg = useTranslations("grades");
  const profileChips: PoolProfileChip[] = [
    {
      label: t("poolChipResource"),
      value: payload.profile.resource === "none"
        ? t("resourceNone")
        : payload.profile.resource === "energy"
          ? t("resourceEnergy")
          : t("resourceMana"),
    },
    {
      label: t("attackType"),
      value: payload.profile.attackType === "unknown"
        ? payload.profile.attackType
        : t(payload.profile.attackType),
    },
    {
      label: t("damageType"),
      value: payload.profile.damageType === "magic"
        ? t("magicDamage")
        : payload.profile.damageType === "physical"
          ? t("physicalDamage")
          : t("mixedDamage"),
    },
    {
      label: t("poolChipTags"),
      value: payload.profile.kitTags.length > 0
        ? payload.profile.kitTags.join(", ")
        : t("poolUniversal"),
    },
  ];
  const layerCopy = {
    source: [t("poolStepSource"), t("poolStepSourceDetail")],
    lifecycle: [t("poolStepLifecycle"), t("poolStepLifecycleDetail")],
    hard: [t("poolStepHard"), t("poolStepHardDetail")],
    tags: [t("poolStepTags"), t("poolStepTagsDetail")],
    items: [t("poolStepItems"), t("poolStepItemsDetail")],
  } as const;
  const layers: PoolLayer[] = payload.pool.layers.map((layer) => ({
    ...layer,
    label: layerCopy[layer.key][0],
    detail: layerCopy[layer.key][1],
  }));
  const raritySummary: PoolRaritySummary[] = payload.pool.raritySummary.map((rarity) => ({
    ...rarity,
    label: t(rarity.key),
  }));

  return (
    <div className="min-h-[42rem]">
      <InteractionSection interactions={payload.interactions} />
      <PoolConstructionSection
        title={t("poolConstruction")}
        subtitle={t("poolConstructionSubtitle", {
          name: championName,
          kept: payload.pool.total,
          total: payload.pool.totalAugments,
        })}
        rarityTitle={t("poolRarityMix")}
        filterTitle={t("poolFilterStack")}
        highlightsTitle={t("poolTopTailored")}
        keptLabel={(count) => t("poolKept", { count })}
        removedLabel={(count) => t("poolRemoved", { count })}
        profileChips={profileChips}
        raritySummary={raritySummary}
        layers={layers}
        highlights={payload.pool.highlights.map((ranking) => ({
          aug: {
            slug: ranking.augment.slug,
            name: ranking.augment.name,
            icon: ranking.augment.icon,
            rarity: ranking.augment.rarity,
            description: ranking.augment.description,
            wikiDescription: ranking.augment.description,
            kit_tags: ranking.augment.kitTags,
          },
          score: ranking.score,
          comboTier: ranking.comboTier,
        }))}
        totalAugments={payload.pool.totalAugments}
      />
      <section className="glass-card p-4">
        <ChampionMatrixClient
          championSlug={payload.championSlug}
          augmentNames={payload.matrixAugmentNames}
          copy={{
            title: tm("matrixTitle"),
            subtitle: tm("matrixSubtitle"),
            loading: tm("matrixLoading"),
            error: tm("matrixError"),
            round: tm("matrixRoundN"),
            topPick: tm("matrixTopPick"),
            modeCompetitive: tm("advModeCompetitive"),
            modeExploration: tm("advModeExploration"),
            raritySilver: tm("advRaritySilver"),
            rarityGold: tm("advRarityGold"),
            rarityPrismatic: tm("advRarityPrismatic"),
            gradeLabels: {
              hot: tg("hot"),
              strong: tg("strong"),
              steady: tg("steady"),
              average: tg("average"),
              weak: tg("weak"),
            } as Record<DecisionGrade, string>,
            lockedTitle: tm("lockedTitle"),
            lockedBody: tm("lockedBody"),
            lockedCta: tm("lockedCta"),
          }}
        />
      </section>
      <RankingSection payload={payload} />
    </div>
  );
}

const RARITY_DOT: Record<string, string> = {
  prismatic: "bg-purple-400",
  gold: "bg-yellow-400",
  silver: "bg-slate-400",
};

function scoreColor(score: number): string {
  if (score >= 80) return "text-amber-300";
  if (score >= 70) return "text-yellow-400";
  if (score >= 60) return "text-green-400";
  return "text-slate-400";
}

function RankingSection({ payload }: { payload: ChampionMemberViewPayload }) {
  const t = useTranslations("champion");
  return (
    <section className="glass-card p-4">
      <h2 className="mb-1 border-l-2 border-[var(--color-neon-primary)] pl-2 text-sm font-bold">
        {t("augments")} — {t("oracleRanked")}
      </h2>
      <p className="mb-3 pl-3 text-[10px] text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text-primary)]">N={payload.pool.total}</span>
        <span> / {payload.pool.totalAugments} total</span>
        {payload.profile.resource !== "mana" ? (
          <span>
            {" · "}
            {payload.profile.resource === "none" ? t("resourceNone") : t("resourceEnergy")}
          </span>
        ) : null}
        <span>
          {" · "}
          {payload.profile.attackType === "unknown"
            ? payload.profile.attackType
            : t(payload.profile.attackType)}
        </span>
      </p>
      <div className="space-y-1.5">
        {payload.rankings.map((ranking, index) => (
          <AugmentRow key={ranking.augment.slug} rank={index + 1} ranking={ranking} />
        ))}
      </div>
    </section>
  );
}

function AugmentRow({
  rank,
  ranking,
}: {
  rank: number;
  ranking: ChampionMemberRanking;
}) {
  const t = useTranslations("champion");
  const isStrong = ranking.comboTier === "S";
  const isTrap = ranking.comboTier === "C";
  const breakdown = ranking.breakdown;
  const pills = [
    ["pillTier", breakdown.tierBonus, ""],
    ["pillCombo", breakdown.comboBonus, "positive"],
    ["pillTrap", breakdown.trapPenalty, "negative"],
    ["pillRarity", breakdown.rarityBonus, ""],
    ["pillDmgType", breakdown.abilityTypeSynergy, "positive"],
    ["pillAtkType", breakdown.attackTypeSynergy, "positive"],
    ["pillCC", breakdown.ccSynergy, "positive"],
    ["pillMismatch", breakdown.tagMismatch, "negative"],
  ] as const;

  return (
    <Tooltip content={ranking.augment.description}>
      <div className={`flex cursor-default items-center gap-2 rounded-lg border px-2 py-2 transition-colors sm:gap-3 sm:px-3 ${
        isStrong
          ? "border-green-400/30 bg-green-400/5"
          : isTrap
            ? "border-red-400/20 bg-red-400/5"
            : "border-[var(--color-border-default)]/50"
      }`}>
        <span className="w-4 shrink-0 text-right text-[10px] text-[var(--color-text-muted)]">{rank}</span>
        <div className="relative h-7 w-7 shrink-0 rounded sm:h-8 sm:w-8">
          <Image
            src={ranking.augment.icon}
            alt={ranking.augment.name}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 28px, 32px"
            unoptimized
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium sm:text-sm">{ranking.augment.name}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RARITY_DOT[ranking.augment.rarity]}`} />
            {ranking.comboTier ? (
              <span className={`shrink-0 rounded px-1 text-[9px] font-bold ${
                isStrong ? "bg-green-400/20 text-green-400" : "bg-red-400/20 text-red-400"
              }`}>
                {ranking.comboTier}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 hidden flex-wrap gap-1.5 sm:flex">
            {pills.filter(([, value]) => value !== 0).map(([label, value, tone]) => (
              <span
                key={label}
                className={`text-[9px] ${
                  tone === "negative"
                    ? "text-red-400/80"
                    : tone === "positive"
                      ? "text-green-400/80"
                      : "text-[var(--color-text-muted)]"
                }`}
              >
                {t(label)}:{value > 0 ? "+" : ""}{value}
              </span>
            ))}
          </div>
        </div>
        <span className="hidden shrink-0 text-xs text-[var(--color-text-muted)] sm:inline">
          {ranking.augment.winRate === null ? "—" : `${ranking.augment.winRate.toFixed(1)}%`}
        </span>
        <span className={`w-10 shrink-0 text-right text-sm font-bold sm:w-12 sm:text-base ${scoreColor(ranking.score)}`}>
          {Math.round(ranking.score)}
        </span>
      </div>
    </Tooltip>
  );
}

function InteractionSection({
  interactions,
}: {
  interactions: ChampionMemberViewPayload["interactions"];
}) {
  const t = useTranslations("champion");
  if (interactions.synergies.length === 0 && interactions.traps.length === 0) return null;
  return (
    <section className="glass-card mb-3 p-4 sm:mb-6">
      <h2 className="mb-1 border-l-2 border-[var(--color-neon-primary)] pl-2 text-sm font-bold">
        {t("mechanicalAnalysis")}
      </h2>
      <p className="mb-3 pl-3 text-[10px] text-[var(--color-text-muted)]">
        {t("mechanicalCounts", {
          synergies: interactions.synergies.length,
          traps: interactions.traps.length,
        })}
      </p>
      <InteractionGroup title={t("mechanicalSynergies")} interactions={interactions.synergies} />
      <InteractionGroup title={t("mechanicalTraps")} interactions={interactions.traps} trap />
    </section>
  );
}

function InteractionGroup({
  title,
  interactions,
  trap = false,
}: {
  title: string;
  interactions: ChampionMemberInteraction[];
  trap?: boolean;
}) {
  if (interactions.length === 0) return null;
  return (
    <div className={trap ? "" : "mb-3"}>
      <h3 className={`mb-1.5 border-l-2 pl-2 text-xs font-semibold ${
        trap ? "border-red-400/50 text-red-400" : "border-green-400/50 text-green-400"
      }`}>
        {title}
      </h3>
      <div className="space-y-1">
        {interactions.map((interaction) => (
          <InteractionRow
            key={`${interaction.augmentSlug}-${interaction.mechanic}`}
            interaction={interaction}
          />
        ))}
      </div>
    </div>
  );
}

function InteractionRow({ interaction }: { interaction: ChampionMemberInteraction }) {
  const t = useTranslations("champion");
  const mechanicLabels: Record<AugmentMechanic, string> = {
    ABILITY_CRIT: t("mechanicAbilityCrit"),
    ON_HIT: t("mechanicOnHit"),
    ATTACK_SPEED: t("mechanicAttackSpeed"),
    DOT_SYNERGY: t("mechanicDotSynergy"),
    ULT_POWER: t("mechanicUltPower"),
    ULT_SEALED: t("mechanicUltSealed"),
    ABILITY_HASTE: t("mechanicAbilityHaste"),
    ON_CAST: t("mechanicOnCast"),
    DASH_SYNERGY: t("mechanicDash"),
    EXECUTE: t("mechanicExecute"),
    LIFESTEAL: t("mechanicLifesteal"),
    TRUE_DAMAGE: t("mechanicTrueDamage"),
    MANA_SCALING: t("mechanicManaScaling"),
    SIZE_CHANGE: t("mechanicSizeChange"),
    SHIELD: t("mechanicShield"),
    SUMMON_REPLACE: t("mechanicSummoner"),
    MELEE_CONVERT: t("mechanicMeleeConvert"),
    AD_SCALING: t("mechanicAdScaling"),
    AP_SCALING: t("mechanicApScaling"),
    IMMOBILIZE_TRIGGER: t("mechanicImmobilize"),
  };
  const trap = interaction.type === "trap";
  return (
    <Tooltip content={interaction.reason}>
      <div className={`flex cursor-default items-center gap-2 rounded-lg border px-2 py-1.5 ${
        trap ? "border-red-400/20 bg-red-400/5" : "border-green-400/20 bg-green-400/5"
      }`}>
        <div className="relative h-6 w-6 shrink-0 rounded">
          <Image
            src={interaction.augment.icon}
            alt={interaction.augment.name}
            fill
            className="object-contain"
            sizes="24px"
            unoptimized
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium">{interaction.augment.name}</span>
            <span className="ml-1 inline-flex gap-0.5">
              {[1, 2, 3].map((value) => (
                <span
                  key={value}
                  className={`h-1.5 w-1.5 rounded-full ${
                    value <= interaction.strength
                      ? trap ? "bg-red-400" : "bg-green-400"
                      : trap ? "bg-red-400/20" : "bg-green-400/20"
                  }`}
                />
              ))}
            </span>
            <span className={`rounded border px-1 py-0.5 text-[9px] font-semibold ${
              trap
                ? "border-red-400/30 bg-red-400/10 text-red-300"
                : "border-green-400/30 bg-green-400/10 text-green-300"
            }`}>
              {mechanicLabels[interaction.mechanic]}
            </span>
            {interaction.abilities.length > 0 ? (
              <span className="text-[9px] text-[var(--color-text-muted)]">
                {interaction.abilities.join(", ")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 hidden line-clamp-1 text-[10px] text-[var(--color-text-muted)] sm:block">
            {interaction.reason}
          </p>
        </div>
      </div>
    </Tooltip>
  );
}
