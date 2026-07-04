"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { MembershipGate } from "@/components/membership/MembershipGate";
import { gradeToken } from "@/lib/membership/grade-tokens";
import { requestDecision } from "@/lib/membership/decision-client";
import type {
  AugmentRarity,
  AugmentRound,
  DecisionResult,
} from "@/lib/contracts/decision";

export interface CompanionChampionOption {
  slug: string;
  name: string;
  searchName?: string;
}

export interface CompanionAugmentOption {
  slug: string;
  displayName: string;
  searchName?: string;
  rarity: AugmentRarity;
}

interface CompanionClientProps {
  champions: CompanionChampionOption[];
  augments: CompanionAugmentOption[];
  initialAccess: { active: boolean; signedIn: boolean };
  locale: string;
}

type SheetState = "idle" | "pending" | "ok" | "locked" | "limited" | "error";
type Stance = DecisionResult["reroll"]["stance"];

const STORAGE_KEY = "mo.companion.championSlug";
const RARITIES: AugmentRarity[] = ["silver", "gold", "prismatic"];
const AUTO_FIRE_DELAY_MS = 250;
const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const GRADE_LETTERS = ["S", "A", "B", "C", "D"];

const STANCE_GLYPH: Record<Stance, string> = {
  keep: "✓",
  consider: "~",
  reroll: "↻",
  "golden-reroll": "★",
};

const STANCE_COLOR: Record<Stance, string> = {
  keep: "border-emerald-400/50 text-emerald-300",
  consider: "border-sky-400/50 text-sky-300",
  reroll: "border-rose-400/50 text-rose-300",
  "golden-reroll": "border-amber-400/50 text-amber-300",
};

const STANCE_LABEL_KEY: Record<Stance, string> = {
  keep: "advStanceKeep",
  consider: "advStanceConsider",
  reroll: "advStanceReroll",
  "golden-reroll": "advStanceGolden",
};

const RARITY_LABEL_KEY: Record<AugmentRarity, string> = {
  silver: "advRaritySilver",
  gold: "advRarityGold",
  prismatic: "advRarityPrismatic",
};

const RARITY_TAB_CLASS: Record<AugmentRarity, string> = {
  silver: "rarity-silver",
  gold: "rarity-gold",
  prismatic: "rarity-prismatic",
};

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function initials(name: string): string {
  const letters = name
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || name.slice(0, 2).toUpperCase();
}

export function CompanionClient({
  champions,
  augments,
  initialAccess,
  locale,
}: CompanionClientProps) {
  const t = useTranslations("companion");
  const tm = useTranslations("membership");
  const tg = useTranslations("grades");

  const [championSlug, setChampionSlug] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [championQuery, setChampionQuery] = useState("");
  const [rarity, setRarity] = useState<AugmentRarity>("silver");
  const [round, setRound] = useState<AugmentRound>(1);
  const [rerolls, setRerolls] = useState(1);
  const [golden, setGolden] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [state, setState] = useState<SheetState>("idle");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeUnsupported, setWakeUnsupported] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  const fireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && champions.some((c) => c.slug === stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client hydration from localStorage, must run post-mount to avoid SSR mismatch
      setChampionSlug(stored);
    } else {
      setPickerOpen(true);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (championSlug) window.localStorage.setItem(STORAGE_KEY, championSlug);
  }, [championSlug]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(""), 1400);
    return () => clearTimeout(id);
  }, [toastMsg]);

  useEffect(() => {
    if (state !== "limited" || retryAfter <= 0) return;
    const id = setTimeout(() => setRetryAfter((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [state, retryAfter]);

  useEffect(() => {
    if (!wakeOn) return;
    const reacquire = async () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        } catch {
          /* best-effort re-acquire */
        }
      }
    };
    document.addEventListener("visibilitychange", reacquire);
    return () => document.removeEventListener("visibilitychange", reacquire);
  }, [wakeOn]);

  const nameBySlug = useMemo(
    () => new Map(augments.map((a) => [a.slug, a.displayName])),
    [augments],
  );
  const championName = champions.find((c) => c.slug === championSlug)?.name ?? "";

  const offerable = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return augments.filter(
      (a) =>
        a.rarity === rarity &&
        (!needle ||
          a.displayName.toLowerCase().includes(needle) ||
          (a.searchName?.toLowerCase().includes(needle) ?? false)),
    );
  }, [augments, rarity, query]);

  const filteredChampions = useMemo(() => {
    const needle = championQuery.trim().toLowerCase();
    if (!needle) return champions;
    return champions.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.searchName?.toLowerCase().includes(needle) ?? false),
    );
  }, [champions, championQuery]);

  function toast(message: string) {
    setToastMsg(message);
  }

  function pickChampion(slug: string) {
    setChampionSlug(slug);
    setPickerOpen(false);
    setChampionQuery("");
    setSelected([]);
    setRound(1);
    setSheetOpen(false);
    setState("idle");
  }

  async function toggleWakeLock() {
    if (wakeOn) {
      await wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
      setWakeOn(false);
      return;
    }
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setWakeUnsupported(true);
      toast(t("wakeLockUnsupported"));
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeOn(true);
      wakeLockRef.current.addEventListener("release", () => setWakeOn(false));
    } catch {
      setWakeOn(false);
    }
  }

  async function fire(offered: string[]) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSheetOpen(true);
    setState("pending");

    if (!initialAccess.active) {
      setState("locked");
      return;
    }

    const response = await requestDecision(
      {
        championSlug,
        round,
        screenRarity: rarity,
        mode: "competitive",
        ownedAugmentSlugs: [],
        currentItemIds: [],
        plannedItemIds: [],
        offeredAugmentSlugs: offered,
        rerollsRemaining: rerolls,
        goldenRerollAvailable: golden,
      },
      { signal: controller.signal },
    );

    if (abortRef.current !== controller) return;

    if (response.ok) {
      setResult(response.result);
      setState("ok");
    } else if (response.status === 401 || response.status === 403) {
      setState("locked");
    } else if (response.status === 429) {
      setRetryAfter(response.retryAfterSeconds ?? 5);
      setState("limited");
    } else {
      setErrorMsg(response.error);
      setState("error");
    }
  }

  function toggleAugment(slug: string) {
    setSelected((current) => {
      if (current.includes(slug)) {
        if (fireTimer.current) {
          clearTimeout(fireTimer.current);
          fireTimer.current = null;
        }
        return current.filter((s) => s !== slug);
      }
      if (current.length >= 3) {
        toast(t("alreadyThree"));
        return current;
      }
      const next = [...current, slug];
      if (next.length === 3) {
        fireTimer.current = setTimeout(() => {
          void fire(next);
        }, AUTO_FIRE_DELAY_MS);
      }
      return next;
    });
  }

  function changeRarity(next: AugmentRarity) {
    if (next === rarity) return;
    setRarity(next);
    setSelected([]);
    if (fireTimer.current) {
      clearTimeout(fireTimer.current);
      fireTimer.current = null;
    }
  }

  function undo() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSheetOpen(false);
    setState("idle");
    setSelected((s) => s.slice(0, -1));
  }

  function nextRound() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSheetOpen(false);
    setState("idle");
    setResult(null);
    setSelected([]);
    setRound((r) => (r >= 4 ? 1 : ((r + 1) as AugmentRound)));
    toast(t("roundAdvanced", { round: round >= 4 ? 1 : round + 1 }));
  }

  function retry() {
    if (selected.length === 3) void fire(selected);
  }

  const rankedCandidates = useMemo(() => {
    if (!result) return [];
    return [...result.candidates].sort(
      (a, b) => gradeToken(a.grade).order - gradeToken(b.grade).order,
    );
  }, [result]);

  if (!hydrated) return null;

  return (
    <div className="relative mx-auto max-w-md pb-6">
      {toastMsg ? (
        <div className="fixed inset-x-0 top-24 z-[70] flex justify-center px-4">
          <div className="rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-4 py-2 text-xs text-[var(--color-text-secondary)] shadow-lg">
            {toastMsg}
          </div>
        </div>
      ) : null}

      <h1 className="sr-only">{t("title")}</h1>

      {/* Sticky control cluster: champion header, chips, rarity tabs, search */}
      <div className="sticky top-20 z-30 -mx-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-primary)]/95 px-4 pb-3 pt-3 backdrop-blur-md">
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={t("changeChampion")}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: `hsl(${hashHue(championSlug || "?")}, 60%, 38%)` }}
            >
              {championSlug ? initials(championName) : "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[var(--color-text-primary)]">
                {championName || t("pickerTitle")}
              </span>
              <span className="block truncate text-xs text-[var(--color-text-muted)]">
                {t("stickyHint")}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={wakeOn ? t("wakeLockOn") : t("wakeLockOff")}
            onClick={() => void toggleWakeLock()}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-base ${
              wakeOn
                ? "border-[var(--color-neon-primary)] text-[var(--color-neon-primary)]"
                : "border-[var(--color-border-default)] text-[var(--color-text-muted)]"
            } ${wakeUnsupported ? "opacity-40" : ""}`}
          >
            {wakeOn ? "◉" : "○"}
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto">
          <Chip label={t("roundLabel")} value={String(round)} />
          <Chip label={t("modeLabel")} value={t("modeCompetitive")} />
          <Chip
            label={tm("advRerolls")}
            value={String(rerolls)}
            onClick={() => setRerolls((r) => (r >= 2 ? 0 : r + 1))}
          />
          <Chip
            label={tm("advGoldenReroll")}
            value={golden ? t("goldenYes") : t("goldenNo")}
            onClick={() => setGolden((g) => !g)}
          />
        </div>

        <div className="mt-3 flex gap-2">
          {RARITIES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => changeRarity(r)}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-lg border px-2 text-xs font-semibold transition ${
                rarity === r
                  ? RARITY_TAB_CLASS[r]
                  : "border-[var(--color-border-default)] text-[var(--color-text-muted)]"
              }`}
            >
              {tm(RARITY_LABEL_KEY[r])}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="mt-3 w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-neon-primary)]"
        />

        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {t("promptOffered")} · {selected.length}/3
        </p>
      </div>

      {/* Augment grid */}
      {offerable.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">
          {t("emptyGrid")}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 py-3">
          {offerable.map((augment) => {
            const isSelected = selected.includes(augment.slug);
            const hue = hashHue(augment.slug);
            return (
              <button
                key={augment.slug}
                type="button"
                onClick={() => toggleAugment(augment.slug)}
                aria-pressed={isSelected}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${
                  isSelected
                    ? "border-[var(--color-neon-primary)] bg-[var(--color-neon-primary)]/10"
                    : "border-[var(--color-border-default)] bg-[var(--color-bg-card)]"
                } ${selected.length >= 3 && !isSelected ? "opacity-40" : ""}`}
              >
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: `hsl(${hue}, 65%, 40%)` }}
                >
                  {initials(augment.displayName)}
                </span>
                <span className="line-clamp-2 text-[11px] leading-tight text-[var(--color-text-secondary)]">
                  {augment.displayName}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Champion picker overlay */}
      {pickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("pickerTitle")}
          className="fixed inset-0 z-[80] flex flex-col bg-[var(--color-bg-primary)] pt-[calc(1rem+env(safe-area-inset-top))]"
        >
          <div className="flex items-center gap-3 px-4 pb-3">
            <input
              type="text"
              autoFocus
              value={championQuery}
              onChange={(e) => setChampionQuery(e.target.value)}
              placeholder={t("pickerPlaceholder")}
              className="flex-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-neon-primary)]"
            />
            {championSlug ? (
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  setChampionQuery("");
                }}
                className="shrink-0 text-sm text-[var(--color-text-muted)]"
              >
                {t("pickerCancel")}
              </button>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {filteredChampions.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                {t("pickerEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {filteredChampions.map((c) => (
                  <li key={c.slug}>
                    <button
                      type="button"
                      onClick={() => pickChampion(c.slug)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--color-bg-card)]"
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: `hsl(${hashHue(c.slug)}, 60%, 38%)` }}
                      >
                        {initials(c.name)}
                      </span>
                      <span className="text-sm text-[var(--color-text-primary)]">{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Verdict sheet */}
      {sheetOpen ? (
        <>
          <div className="fixed inset-0 z-[59] bg-black/60" />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl"
          >
            <p className="mb-4 text-center text-xs text-[var(--color-text-muted)]">
              {championName} · R{round} · {tm(RARITY_LABEL_KEY[rarity])}
            </p>

            {state === "pending" ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-neon-primary)] border-t-transparent" />
                <p className="text-sm text-[var(--color-text-secondary)]">{tm("advEvaluating")}</p>
              </div>
            ) : null}

            {state === "locked" ? (
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="flex gap-3 pointer-events-none">
                  {selected.map((slug) => (
                    <div key={slug} className="flex flex-col items-center gap-1 opacity-50 blur-[2px]">
                      <svg width="48" height="48" viewBox="0 0 48 48">
                        <circle
                          cx="24"
                          cy="24"
                          r={RING_RADIUS}
                          fill="none"
                          stroke="var(--color-border-default)"
                          strokeWidth="4"
                          strokeDasharray="4 4"
                        />
                      </svg>
                      <span className="max-w-[64px] truncate text-[10px] text-[var(--color-text-muted)]">
                        {nameBySlug.get(slug) ?? slug}
                      </span>
                    </div>
                  ))}
                </div>
                <MembershipGate
                  title={tm("lockedTitle")}
                  body={tm("lockedBody")}
                  cta={tm("lockedCta")}
                />
                {!initialAccess.signedIn ? (
                  <GoogleSignInButton
                    next={`/${locale}/companion`}
                    label={tm("signInCta")}
                    size="medium"
                  />
                ) : null}
              </div>
            ) : null}

            {state === "limited" ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {t("limitedTitle")}
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t("limitedBody", { seconds: retryAfter })}
                </p>
                {retryAfter <= 0 ? (
                  <button
                    type="button"
                    onClick={retry}
                    className="rounded-lg bg-[var(--color-neon-primary)] px-5 py-2.5 text-sm font-semibold text-black"
                  >
                    {t("limitedRetry")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {state === "error" ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-rose-300">{errorMsg}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-lg bg-[var(--color-neon-primary)] px-5 py-2.5 text-sm font-semibold text-black"
                >
                  {t("errorRetry")}
                </button>
              </div>
            ) : null}

            {state === "ok" && result ? (
              <div className="flex flex-col gap-4">
                <div className="flex justify-center gap-4">
                  {rankedCandidates.map((candidate) => {
                    const token = gradeToken(candidate.grade);
                    const offset = RING_CIRCUMFERENCE * (1 - token.intensity);
                    return (
                      <div key={candidate.augmentSlug} className="flex flex-col items-center gap-1">
                        <svg width="56" height="56" viewBox="0 0 48 48" className="-rotate-90">
                          <circle
                            cx="24"
                            cy="24"
                            r={RING_RADIUS}
                            fill="none"
                            stroke="var(--color-border-default)"
                            strokeWidth="4"
                          />
                          <circle
                            cx="24"
                            cy="24"
                            r={RING_RADIUS}
                            fill="none"
                            stroke={token.accent}
                            strokeWidth="4"
                            strokeDasharray={RING_CIRCUMFERENCE}
                            strokeDashoffset={offset}
                            strokeLinecap="round"
                          />
                          <text
                            x="24"
                            y="24"
                            textAnchor="middle"
                            dominantBaseline="central"
                            className="rotate-90"
                            style={{ transformOrigin: "24px 24px", fill: token.accent, fontSize: "16px", fontWeight: 700 }}
                          >
                            {GRADE_LETTERS[token.order] ?? "?"}
                          </text>
                        </svg>
                        <span className="max-w-[64px] truncate text-center text-[10px] text-[var(--color-text-secondary)]">
                          {nameBySlug.get(candidate.augmentSlug) ?? candidate.augmentSlug}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {tg(candidate.grade)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div
                  className={`mx-auto rounded-full border-2 px-4 py-1.5 text-sm font-semibold ${STANCE_COLOR[result.reroll.stance]}`}
                >
                  {STANCE_GLYPH[result.reroll.stance]} {tm(STANCE_LABEL_KEY[result.reroll.stance])}
                </div>

                <details className="text-sm text-[var(--color-text-secondary)]">
                  <summary className="cursor-pointer text-center text-xs text-[var(--color-text-muted)]">
                    {t("reasonsToggle")}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {rankedCandidates.map((candidate) => (
                      <li key={candidate.augmentSlug}>
                        <p className="font-semibold text-[var(--color-text-primary)]">
                          {nameBySlug.get(candidate.augmentSlug) ?? candidate.augmentSlug}
                        </p>
                        {candidate.warnings.length > 0 ? (
                          <p className="text-rose-300">{candidate.warnings.join(" · ")}</p>
                        ) : null}
                        {candidate.reasons.length > 0 ? (
                          <p>{candidate.reasons.join(" · ")}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={undo}
                className="flex-1 rounded-lg border border-[var(--color-border-default)] py-2.5 text-sm font-semibold text-[var(--color-text-secondary)]"
              >
                {t("undo")}
              </button>
              {state !== "pending" ? (
                <button
                  type="button"
                  onClick={nextRound}
                  className="flex-1 rounded-lg bg-[var(--color-neon-primary)] py-2.5 text-sm font-semibold text-black"
                >
                  {t("nextRound")}
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const className =
    "flex shrink-0 flex-col items-center rounded-lg bg-[var(--color-bg-card)] px-3 py-1.5 text-center";
  const content = (
    <>
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{value}</span>
    </>
  );
  if (!onClick) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} border border-dashed border-[var(--color-text-muted)]/40`}
    >
      {content}
    </button>
  );
}
