import type { ReactNode } from "react";
import type { AugmentQualityTier, EntityPresentationRecord, EntityStat, EntityStatChange, StatDirection } from "@/lib/entities/types";
import { EntityLink } from "./EntityLink";
import type { EntityRef } from "@/lib/entities/types";
import { formatEntityStatValue } from "@/lib/entities/format";

/** The small, ability-card language used by every public entity surface. */
export function EntitySectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
      <span aria-hidden="true" className="h-5 w-0.5 shrink-0 bg-[var(--color-neon-primary)]" />
      <span>{children}</span>
    </h2>
  );
}

export function EntityTag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "cyan" | "purple" | "amber" | "green" | "red";
}) {
  const styles = {
    neutral: "border-[var(--color-border-default)] text-[var(--color-text-secondary)]",
    cyan: "border-cyan-400/35 bg-cyan-400/5 text-cyan-200",
    purple: "border-violet-400/35 bg-violet-400/5 text-violet-200",
    amber: "border-amber-400/35 bg-amber-400/5 text-amber-200",
    green: "border-emerald-400/35 bg-emerald-400/5 text-emerald-200",
    red: "border-rose-400/35 bg-rose-400/5 text-rose-200",
  }[tone];
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${styles}`}>{children}</span>;
}

export function SegmentedMeter({
  label,
  value,
  max = 3,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const bounded = Math.max(0, Math.min(max, value));
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label={`${label}: ${bounded} of ${max}`}>
      <span className="truncate text-[10px] text-[var(--color-text-muted)]">{label}</span>
      <span className="flex shrink-0 gap-0.5" aria-hidden="true">
        {Array.from({ length: max }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 w-3 rounded-sm ${index < bounded ? "bg-[var(--color-neon-primary)]" : "bg-[var(--color-border-default)]"}`}
          />
        ))}
      </span>
    </div>
  );
}

export function EntityStatLine({
  label,
  value,
  unit,
  previous,
  accent = false,
}: {
  label: string;
  value: unknown;
  unit: EntityStat["unit"];
  previous?: unknown;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      {previous !== undefined ? (
        <span className="tabular-nums text-[var(--color-text-secondary)]">
          {formatEntityStatValue(previous, unit)} <span className="px-1 text-[var(--color-text-muted)]">→</span>
          <span className={accent ? "font-semibold text-[var(--color-neon-primary)]" : "font-semibold text-[var(--color-text-primary)]"}>
            {formatEntityStatValue(value, unit)}
          </span>
        </span>
      ) : (
        <span className={`tabular-nums font-semibold ${accent ? "text-[var(--color-neon-primary)]" : "text-[var(--color-text-primary)]"}`}>
          {formatEntityStatValue(value, unit)}
        </span>
      )}
    </div>
  );
}

function directionClass(direction: StatDirection): string {
  if (direction === "buff") return "text-emerald-300";
  if (direction === "nerf") return "text-rose-300";
  return "text-amber-200";
}

function directionLabel(direction: StatDirection): string {
  if (direction === "buff") return "Buff";
  if (direction === "nerf") return "Nerf";
  return "Changed";
}

export function EntityPatchChanges({
  changes,
  labelFor,
  previewLabel,
  liveLabel,
  landedLabel = "Landed",
  hotfixLabel = "Hotfix",
  directionFor = directionLabel,
}: {
  changes: EntityStatChange[];
  labelFor: (key: string) => string;
  previewLabel: string;
  liveLabel: string;
  landedLabel?: string;
  hotfixLabel?: string;
  directionFor?: (direction: StatDirection) => string;
}) {
  if (!changes.length) return null;
  return (
    <div className="space-y-2" aria-label={`${liveLabel} / ${previewLabel}`}>
      {changes.map((change) => {
        const laneLabel = change.lifecycle === "preview" ? previewLabel : change.lifecycle === "landed" ? landedLabel : liveLabel;
        return (
          <div key={`${change.key}-${change.patch}-${change.lane}-${String(change.after)}`} className="border-l-2 border-[var(--color-neon-primary)]/50 bg-[var(--color-bg-card)]/40 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <EntityStatLine label={labelFor(change.label_key)} value={change.after} previous={change.before} unit={change.unit} />
              <span className={`text-[10px] font-semibold ${directionClass(change.direction)}`} aria-label={directionLabel(change.direction)}>
                {change.direction === "buff" ? "↑" : change.direction === "nerf" ? "↓" : "→"} {directionFor(change.direction)}
              </span>
              <EntityTag tone={change.lifecycle === "preview" ? "purple" : change.is_hotfix ? "amber" : "cyan"}>
                {laneLabel}{change.is_hotfix ? ` · ${hotfixLabel}` : ""}
              </EntityTag>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EntityCard({
  entity,
  kindLabel,
  stat,
  chips = [],
  description,
  qualityTier,
  rarity,
}: {
  entity: EntityRef;
  kindLabel?: string;
  stat?: { label: string; value: unknown; unit: EntityStat["unit"] };
  chips?: string[];
  description?: string;
  qualityTier?: AugmentQualityTier | null;
  rarity?: string;
}) {
  return (
    <article className="border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/45 p-3" data-entity-card={entity.type}>
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <EntityLink entity={entity} variant="standard" qualityTier={qualityTier} rarity={rarity} className="font-semibold" />
          {kindLabel ? <div className="mt-1 text-center text-[10px] text-[var(--color-text-muted)]">{kindLabel}</div> : null}
        </div>
        <div className="min-w-0 flex-1">
          {stat ? <EntityStatLine label={stat.label} value={stat.value} unit={stat.unit} accent /> : null}
          {chips.length ? (
            <div className="mt-2 flex flex-wrap gap-1">{chips.map((chip) => <EntityTag key={chip}>{chip}</EntityTag>)}</div>
          ) : null}
          {description ? <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{description}</p> : null}
        </div>
      </div>
    </article>
  );
}

export function EntityStatsInline({
  record,
  labelFor,
}: {
  record: EntityPresentationRecord;
  labelFor: (key: string) => string;
}) {
  if (!record.stats.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-l-2 border-[var(--color-neon-primary)]/50 pl-3" data-entity-stats-inline>
      {record.stats.map((stat) => <EntityStatLine key={`${stat.key}-${stat.source_path}`} label={labelFor(stat.label_key)} value={stat.value} unit={stat.unit} accent />)}
    </div>
  );
}

export function EntityRecordStats({
  record,
  heading,
  labelFor,
  previewLabel,
  liveLabel,
  landedLabel,
  hotfixLabel,
  directionFor,
}: {
  record: EntityPresentationRecord;
  heading: string;
  labelFor: (key: string) => string;
  previewLabel: string;
  liveLabel: string;
  landedLabel?: string;
  hotfixLabel?: string;
  directionFor?: (direction: StatDirection) => string;
}) {
  if (!record.stats.length && !record.patch_changes.length) return null;
  return (
    <section className="space-y-3" aria-labelledby="entity-structured-stats-heading">
      <EntitySectionHeading><span id="entity-structured-stats-heading">{heading}</span></EntitySectionHeading>
      <EntityStatsInline record={record} labelFor={labelFor} />
      <EntityPatchChanges
        changes={record.patch_changes}
        labelFor={labelFor}
        previewLabel={previewLabel}
        liveLabel={liveLabel}
        landedLabel={landedLabel}
        hotfixLabel={hotfixLabel}
        directionFor={directionFor}
      />
    </section>
  );
}
