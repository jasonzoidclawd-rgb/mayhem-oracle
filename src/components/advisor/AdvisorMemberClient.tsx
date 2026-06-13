"use client";

import { GradeBadge } from "@/components/membership/GradeBadge";
import { MembershipGate } from "@/components/membership/MembershipGate";
import type {
  AugmentRarity,
  AugmentRound,
  DecisionGrade,
  DecisionMode,
  DecisionResult,
} from "@/lib/contracts/decision";
import { requestDecision } from "@/lib/membership/decision-client";
import { useMemo, useState } from "react";

export interface AdvisorChampionOption {
  slug: string;
  name: string;
  icon?: string;
}

export interface AdvisorAugmentOption {
  slug: string;
  displayName: string;
  rarity: AugmentRarity;
  icon?: string;
}

export interface AdvisorCopy {
  title: string;
  subtitle: string;
  champion: string;
  championPlaceholder: string;
  mode: string;
  modeCompetitive: string;
  modeExploration: string;
  round: string;
  rarity: string;
  raritySilver: string;
  rarityGold: string;
  rarityPrismatic: string;
  offered: string;
  offeredHelp: string;
  rerolls: string;
  goldenReroll: string;
  evaluate: string;
  evaluating: string;
  results: string;
  poolSize: string;
  probability: string;
  confidence: string;
  confHigh: string;
  confMedium: string;
  confLow: string;
  warnings: string;
  reasons: string;
  rerollStance: string;
  stanceKeep: string;
  stanceConsider: string;
  stanceReroll: string;
  stanceGolden: string;
  needOffers: string;
  signIn: string;
  gradeLabels: Record<DecisionGrade, string>;
  lockedTitle: string;
  lockedBody: string;
  lockedCta: string;
}

const RARITY_KEYS: Array<{ value: AugmentRarity; key: "raritySilver" | "rarityGold" | "rarityPrismatic" }> = [
  { value: "silver", key: "raritySilver" },
  { value: "gold", key: "rarityGold" },
  { value: "prismatic", key: "rarityPrismatic" },
];

export function AdvisorMemberClient({
  champions,
  augments,
  copy,
}: {
  champions: AdvisorChampionOption[];
  augments: AdvisorAugmentOption[];
  copy: AdvisorCopy;
}) {
  const [championSlug, setChampionSlug] = useState("");
  const [mode, setMode] = useState<DecisionMode>("competitive");
  const [round, setRound] = useState<AugmentRound>(1);
  const [rarity, setRarity] = useState<AugmentRarity>("silver");
  const [offered, setOffered] = useState<string[]>([]);
  const [rerollsRemaining, setRerolls] = useState(1);
  const [goldenReroll, setGolden] = useState(false);

  const [state, setState] = useState<"idle" | "pending" | "ok" | "locked" | "error">("idle");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [error, setError] = useState("");

  // Only same-rarity augments are valid offers for this screen.
  const offerable = useMemo(
    () => augments.filter((augment) => augment.rarity === rarity),
    [augments, rarity],
  );
  const nameBySlug = useMemo(
    () => new Map(augments.map((augment) => [augment.slug, augment.displayName])),
    [augments],
  );

  function toggleOffer(slug: string) {
    setOffered((current) =>
      current.includes(slug)
        ? current.filter((value) => value !== slug)
        : current.length >= 3
          ? current
          : [...current, slug],
    );
  }

  async function evaluate() {
    if (!championSlug || offered.length === 0) {
      setError(copy.needOffers);
      setState("error");
      return;
    }
    setState("pending");
    setError("");
    const response = await requestDecision({
      championSlug,
      round,
      screenRarity: rarity,
      mode,
      ownedAugmentSlugs: [],
      currentItemIds: [],
      plannedItemIds: [],
      offeredAugmentSlugs: offered,
      rerollsRemaining,
      goldenRerollAvailable: goldenReroll,
    });
    if (response.ok) {
      setResult(response.result);
      setState("ok");
    } else if (response.status === 401 || response.status === 403) {
      setState("locked");
    } else {
      setError(response.error);
      setState("error");
    }
  }

  const confidenceLabel: Record<"high" | "medium" | "low", string> = {
    high: copy.confHigh,
    medium: copy.confMedium,
    low: copy.confLow,
  };
  const stanceLabel: Record<DecisionResult["reroll"]["stance"], string> = {
    keep: copy.stanceKeep,
    consider: copy.stanceConsider,
    reroll: copy.stanceReroll,
    "golden-reroll": copy.stanceGolden,
  };

  if (state === "locked") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <MembershipGate title={copy.lockedTitle} body={copy.lockedBody} cta={copy.lockedCta} />
      </div>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">{copy.title}</h1>
        <p className="mt-1 text-sm text-white/60">{copy.subtitle}</p>
      </header>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-white/60">{copy.champion}</span>
        <select
          value={championSlug}
          onChange={(event) => setChampionSlug(event.target.value)}
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 outline-none focus:border-amber-400/60"
        >
          <option value="">{copy.championPlaceholder}</option>
          {champions.map((champion) => (
            <option key={champion.slug} value={champion.slug}>
              {champion.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-white/60">{copy.mode}</span>
        <div className="grid grid-cols-2 gap-2">
          {(["competitive", "exploration"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                mode === value
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                  : "border-white/15 hover:bg-white/5"
              }`}
            >
              {value === "competitive" ? copy.modeCompetitive : copy.modeExploration}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-white/60">{copy.round}</span>
          <div className="flex gap-1.5">
            {([1, 2, 3, 4] as const).map((value) => (
              <button
                key={value}
                onClick={() => setRound(value)}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold ${
                  round === value ? "border-amber-400/60 bg-amber-400/15 text-amber-200" : "border-white/15"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-white/60">{copy.rarity}</span>
          <select
            value={rarity}
            onChange={(event) => {
              setRarity(event.target.value as AugmentRarity);
              setOffered([]);
            }}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 outline-none focus:border-amber-400/60"
          >
            {RARITY_KEYS.map(({ value, key }) => (
              <option key={value} value={value}>
                {copy[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-white/60">{copy.offered}</span>
        <p className="text-xs text-white/40">{copy.offeredHelp}</p>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10">
          {offerable.map((augment) => (
            <button
              key={augment.slug}
              onClick={() => toggleOffer(augment.slug)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                offered.includes(augment.slug) ? "bg-amber-400/15 text-amber-100" : "hover:bg-white/5"
              }`}
            >
              <span>{augment.displayName}</span>
              {offered.includes(augment.slug) ? <span className="text-amber-300">✓</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">{copy.rerolls}</span>
          <input
            type="number"
            min={0}
            max={10}
            value={rerollsRemaining}
            onChange={(event) => setRerolls(Math.max(0, Math.min(10, Number(event.target.value))))}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 outline-none focus:border-amber-400/60"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={goldenReroll} onChange={(event) => setGolden(event.target.checked)} />
          <span className="text-white/60">{copy.goldenReroll}</span>
        </label>
      </div>

      <button
        onClick={evaluate}
        disabled={state === "pending"}
        className="rounded-xl bg-amber-400/90 px-5 py-3 font-semibold text-black transition hover:bg-amber-300 disabled:opacity-40"
      >
        {state === "pending" ? copy.evaluating : copy.evaluate}
      </button>
      {state === "error" ? <p className="text-sm text-rose-300">{error}</p> : null}

      {state === "ok" && result ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{copy.results}</h2>
            <span className="text-xs text-white/40">
              {copy.poolSize}: {result.poolSize}
            </span>
          </div>

          <ul className="flex flex-col gap-3">
            {result.candidates.map((candidate) => (
              <li
                key={candidate.augmentSlug}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {nameBySlug.get(candidate.augmentSlug) ?? candidate.augmentSlug}
                  </span>
                  <GradeBadge grade={candidate.grade} label={copy.gradeLabels[candidate.grade]} size="lg" />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
                  <span>
                    {copy.probability}: {Math.round(candidate.probability.initialThree * 100)}%
                  </span>
                  <span>
                    {copy.confidence}: {confidenceLabel[candidate.confidence]}
                  </span>
                </div>
                {candidate.warnings.length > 0 ? (
                  <p className="mt-2 text-xs text-rose-300">
                    {copy.warnings}: {candidate.warnings.join(" · ")}
                  </p>
                ) : null}
                {candidate.reasons.length > 0 ? (
                  <p className="mt-1 text-xs text-white/50">
                    {copy.reasons}: {candidate.reasons.join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm">
            <span className="text-white/50">{copy.rerollStance}: </span>
            <span className="font-medium text-amber-200">{stanceLabel[result.reroll.stance]}</span>
          </div>
        </section>
      ) : null}
    </main>
  );
}
