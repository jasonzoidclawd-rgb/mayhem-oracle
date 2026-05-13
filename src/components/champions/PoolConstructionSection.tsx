import Image from "next/image";
import type { ComboTier } from "@/lib/scoring/oracle-score";
import { Tooltip } from "@/components/ui/Tooltip";

export type PoolLayer = {
  key: string;
  label: string;
  detail: string;
  kept: number;
  removed: number;
};

export type PoolProfileChip = {
  label: string;
  value: string;
};

export type PoolRaritySummary = {
  key: "silver" | "gold" | "prismatic";
  label: string;
  count: number;
};

export type TailoredHighlight = {
  aug: {
    slug: string;
    name: string;
    icon: string;
    rarity: "silver" | "gold" | "prismatic";
    description?: string;
    wikiDescription?: string;
    kit_tags?: string[];
  };
  score: number;
  comboTier?: ComboTier;
};

type GateCopy = {
  title: string;
  description: string;
  signIn: string;
};

type PoolConstructionSectionProps = {
  title: string;
  subtitle: string;
  rarityTitle: string;
  filterTitle: string;
  highlightsTitle: string;
  keptLabel: (count: number) => string;
  removedLabel: (count: number) => string;
  profileChips: PoolProfileChip[];
  raritySummary: PoolRaritySummary[];
  layers: PoolLayer[];
  highlights: TailoredHighlight[];
  totalAugments: number;
  gated?: boolean;
  signInUrl?: string;
  gateCopy?: GateCopy;
};

const RARITY_BAR_STYLES: Record<PoolRaritySummary["key"], string> = {
  prismatic: "bg-purple-400",
  gold:      "bg-yellow-400",
  silver:    "bg-slate-400",
};

const RARITY_DOT_STYLES: Record<PoolRaritySummary["key"], string> = {
  prismatic: "bg-purple-400",
  gold:      "bg-yellow-400",
  silver:    "bg-slate-400",
};

function scoreColor(score: number) {
  if (score >= 80) return "text-amber-300";
  if (score >= 70) return "text-yellow-400";
  if (score >= 60) return "text-green-400";
  return "text-slate-400";
}

export function PoolConstructionSection({
  title,
  subtitle,
  rarityTitle,
  filterTitle,
  highlightsTitle,
  keptLabel,
  removedLabel,
  profileChips,
  raritySummary,
  layers,
  highlights,
  totalAugments,
  gated = false,
  signInUrl = "/api/auth/signin",
  gateCopy,
}: PoolConstructionSectionProps) {
  return (
    <section className="glass-card p-4 mb-3 sm:mb-6">
      <h2 className="text-sm font-bold mb-1 border-l-2 border-[var(--color-neon-primary)] pl-2">
        {title}
      </h2>
      <p className="text-[10px] text-[var(--color-text-muted)] mb-3 pl-3">
        {subtitle}
      </p>

      {/* Profile chips — always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {profileChips.map((chip) => (
          <div key={chip.label} className="min-w-0 rounded-lg border border-[var(--color-border-default)]/60 px-2 py-2 bg-[var(--color-bg-card)]/40">
            <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">
              {chip.label}
            </div>
            <div className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
              {chip.value}
            </div>
          </div>
        ))}
      </div>

      {/* Rarity summary — always visible; filter + highlights gated */}
      {gated ? (
        <div>
          {/* Rarity bars teaser */}
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
            {rarityTitle}
          </h3>
          <div className="space-y-2 mb-4">
            {raritySummary.map((rarity) => {
              const pct = totalAugments > 0 ? Math.round((rarity.count / totalAugments) * 100) : 0;
              return (
                <div key={rarity.key}>
                  <div className="flex items-center justify-between gap-2 mb-1 text-[10px]">
                    <span className="text-[var(--color-text-secondary)]">{rarity.label}</span>
                    <span className="font-semibold text-[var(--color-text-primary)]">{rarity.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-border-default)]/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${RARITY_BAR_STYLES[rarity.key]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gate overlay covering filter stack + highlights */}
          <div className="relative rounded-lg overflow-hidden">
            <div className="blur-sm pointer-events-none select-none opacity-40" aria-hidden>
              <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr] mb-4">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">{filterTitle}</h3>
                  <div className="space-y-1">
                    {layers.map((layer) => (
                      <div key={layer.key} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-default)]/50 px-2 py-1.5 h-8" />
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">{highlightsTitle}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="h-8 rounded-lg border border-[var(--color-border-default)]/50" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--color-bg-card)]/70 backdrop-blur-[2px] rounded-lg p-6 text-center">
              <svg className="w-5 h-5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              {gateCopy && (
                <>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{gateCopy.title}</p>
                  <p className="text-xs text-[var(--color-text-muted)] max-w-xs">{gateCopy.description}</p>
                  <a
                    href={signInUrl}
                    className="mt-1 inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] px-4 py-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {gateCopy.signIn}
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
        <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr] mb-4">
        <div>
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
            {rarityTitle}
          </h3>
          <div className="space-y-2">
            {raritySummary.map((rarity) => {
              const pct = totalAugments > 0 ? Math.round((rarity.count / totalAugments) * 100) : 0;
              return (
                <div key={rarity.key}>
                  <div className="flex items-center justify-between gap-2 mb-1 text-[10px]">
                    <span className="text-[var(--color-text-secondary)]">{rarity.label}</span>
                    <span className="font-semibold text-[var(--color-text-primary)]">{rarity.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-border-default)]/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${RARITY_BAR_STYLES[rarity.key]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
            {filterTitle}
          </h3>
          <div className="space-y-1">
            {layers.map((layer) => (
              <div key={layer.key} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-default)]/50 px-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                    {layer.label}
                  </div>
                  <div className="text-[9px] text-[var(--color-text-muted)] truncate">
                    {layer.detail}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-semibold text-[var(--color-text-primary)]">
                    {keptLabel(layer.kept)}
                  </div>
                  <div className="text-[9px] text-red-300/80">
                    {removedLabel(layer.removed)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {highlights.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
            {highlightsTitle}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {highlights.map(({ aug, score, comboTier }) => (
              <Tooltip key={aug.slug} content={aug.wikiDescription ?? aug.description}>
                <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-default)]/50 px-2 py-1.5 cursor-default">
                  <div className="relative w-6 h-6 rounded shrink-0">
                    <Image
                      src={aug.icon}
                      alt={aug.name}
                      fill
                      className="object-contain"
                      sizes="24px"
                      unoptimized
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{aug.name}</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RARITY_DOT_STYLES[aug.rarity]}`} />
                      {comboTier && (
                        <span
                          className={`text-[9px] font-bold px-1 rounded shrink-0
                            ${comboTier === "C" ? "text-red-400 bg-red-400/20" : "text-green-400 bg-green-400/20"}`}
                        >
                          {comboTier}
                        </span>
                      )}
                    </div>
                    {(aug.kit_tags ?? []).length > 0 && (
                      <div className="text-[9px] text-[var(--color-text-muted)] truncate">
                        {(aug.kit_tags ?? []).join(", ")}
                      </div>
                    )}
                  </div>
                  <span className={`text-sm font-bold w-10 text-right shrink-0 ${scoreColor(score)}`}>
                    {Math.round(score)}
                  </span>
                </div>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
}
