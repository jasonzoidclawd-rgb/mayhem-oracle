"use client";

import { GradeBadge } from "@/components/membership/GradeBadge";
import { MembershipGate } from "@/components/membership/MembershipGate";
import type { DecisionGrade, DecisionMode } from "@/lib/contracts/decision";
import { requestChampionMatrix, type ChampionMatrix } from "@/lib/membership/decision-client";
import { useEffect, useState } from "react";

export interface ChampionMatrixCopy {
  title: string;
  subtitle: string;
  loading: string;
  error: string;
  round: string;
  topPick: string;
  modeCompetitive: string;
  modeExploration: string;
  raritySilver: string;
  rarityGold: string;
  rarityPrismatic: string;
  gradeLabels: Record<DecisionGrade, string>;
  lockedTitle: string;
  lockedBody: string;
  lockedCta: string;
}

const RARITIES = ["silver", "gold", "prismatic"] as const;

export function ChampionMatrixClient({
  championSlug,
  augmentNames,
  copy,
}: {
  championSlug: string;
  augmentNames: Record<string, string>;
  copy: ChampionMatrixCopy;
}) {
  const [mode, setMode] = useState<DecisionMode>("competitive");
  const [matrix, setMatrix] = useState<ChampionMatrix | null>(null);
  const [status, setStatus] = useState<"pending" | "ok" | "locked" | "error">("pending");

  useEffect(() => {
    let active = true;
    requestChampionMatrix(championSlug, mode).then((response) => {
      if (!active) return;
      if (response.ok) {
        setMatrix(response.matrix);
        setStatus("ok");
      } else if (response.status === 401 || response.status === 403) {
        setStatus("locked");
      } else {
        setStatus("error");
      }
    });
    return () => {
      active = false;
    };
  }, [championSlug, mode]);

  // Derive loading instead of a synchronous setState in the effect: a stale
  // matrix (mode changed, new fetch in flight) still reads as loading.
  const showMatrix = status === "ok" && matrix?.mode === mode;
  const state = status === "locked" ? "locked" : status === "error" ? "error" : showMatrix ? "ok" : "loading";

  if (state === "locked") {
    return <MembershipGate title={copy.lockedTitle} body={copy.lockedBody} cta={copy.lockedCta} />;
  }

  const rarityLabel: Record<(typeof RARITIES)[number], string> = {
    silver: copy.raritySilver,
    gold: copy.rarityGold,
    prismatic: copy.rarityPrismatic,
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <p className="text-sm text-white/60">{copy.subtitle}</p>
        </div>
        <div className="flex gap-1.5">
          {(["competitive", "exploration"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
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

      {state === "loading" ? <p className="text-sm text-white/50">{copy.loading}</p> : null}
      {state === "error" ? <p className="text-sm text-rose-300">{copy.error}</p> : null}

      {state === "ok" && matrix ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-xs uppercase tracking-wide text-white/40">
                  {copy.round}
                </th>
                {RARITIES.map((rarity) => (
                  <th key={rarity} className="px-2 py-1 text-left text-xs uppercase tracking-wide text-white/40">
                    {rarityLabel[rarity]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rounds.map((round) => (
                <tr key={round.round}>
                  <td className="px-2 py-2 font-semibold text-white/70">{round.round}</td>
                  {round.rarities.map((cell) => {
                    const top = cell.candidates[0];
                    return (
                      <td key={cell.rarity} className="rounded-lg bg-white/[0.03] px-2 py-2 align-top">
                        {top ? (
                          <div className="flex flex-col gap-1">
                            <GradeBadge grade={top.grade} label={copy.gradeLabels[top.grade]} size="sm" />
                            <span className="text-xs text-white/70">
                              {augmentNames[top.augmentSlug] ?? top.augmentSlug}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-white/30">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
