import type { ComboTier } from "@/lib/scoring/oracle-score";

type PoolLayer = {
  key: string;
  label: string;
  detail: string;
  kept: number;
  removed: number;
};

type PoolProfileChip = {
  label: string;
  value: string;
};

type PoolRaritySummary = {
  key: "silver" | "gold" | "prismatic";
  label: string;
  count: number;
};

type TailoredHighlight = {
  aug: { slug: string; name: string; icon: string; rarity: "silver" | "gold" | "prismatic" };
  score: number;
  comboTier?: ComboTier;
};

interface Props {
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
}

const RARITY_COLOR: Record<string, string> = {
  silver:   "bg-[var(--color-silver,#94a3b8)]",
  gold:     "bg-[var(--color-gold,#eab308)]",
  prismatic: "bg-[var(--color-prismatic,#a855f7)]",
};

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
}: Props) {
  const maxKept = totalAugments || 1;

  return (
    <section className="glass-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold border-l-2 border-[var(--color-neon-primary)] pl-2">{title}</h2>
        <p className="text-[10px] text-[var(--color-text-muted)] pl-3 mt-0.5">{subtitle}</p>
      </div>

      {/* Profile chips */}
      <div className="flex flex-wrap gap-1.5 pl-1">
        {profileChips.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
          >
            <span className="text-[var(--color-text-muted)]">{chip.label}</span>
            <span className="font-medium text-[var(--color-text-primary)]">{chip.value}</span>
          </span>
        ))}
      </div>

      {/* Rarity mix */}
      <div>
        <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">{rarityTitle}</p>
        <div className="flex gap-2">
          {raritySummary.map((r) => (
            <div key={r.key} className="flex items-center gap-1 text-[10px]">
              <span className={`inline-block w-2 h-2 rounded-sm ${RARITY_COLOR[r.key] ?? "bg-gray-400"}`} />
              <span className="text-[var(--color-text-secondary)]">{r.label}</span>
              <span className="font-bold text-[var(--color-text-primary)]">{r.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter funnel */}
      <div>
        <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">{filterTitle}</p>
        <div className="space-y-1">
          {layers.map((layer) => {
            const pct = Math.round((layer.kept / maxKept) * 100);
            return (
              <div key={layer.key} className="flex items-center gap-2 text-[10px]">
                <div className="w-28 shrink-0">
                  <div className="relative h-3 rounded-sm overflow-hidden bg-[var(--color-bg-secondary)]">
                    <div
                      className="absolute inset-y-0 left-0 bg-[var(--color-neon-primary)] opacity-60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="text-[var(--color-text-muted)] w-16 shrink-0">{layer.label}</span>
                <span className="text-[var(--color-text-primary)]">{keptLabel(layer.kept)}</span>
                {layer.removed > 0 && (
                  <span className="text-[var(--color-text-muted)] opacity-60">−{removedLabel(layer.removed)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top tailored highlights */}
      {highlights.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">{highlightsTitle}</p>
          <div className="flex flex-wrap gap-1.5">
            {highlights.map(({ aug, score }) => (
              <div
                key={aug.slug}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[10px]"
              >
                {aug.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={aug.icon} alt="" className="w-4 h-4 rounded-sm object-cover" />
                )}
                <span className="text-[var(--color-text-primary)] font-medium">{aug.name}</span>
                <span className="text-[var(--color-text-muted)]">{Math.round(score)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
