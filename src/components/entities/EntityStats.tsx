import { getTranslations } from "next-intl/server";
import type { EntityPresentationRecord, EntityStat, EntityStatChange } from "@/lib/entities/types";

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatEntityStatValue(value: unknown, unit: EntityStat["unit"]): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatEntityStatValue(entry, unit)).join(" / ");
  }
  if (typeof value === "number") {
    const number = formatNumber(value);
    if (unit === "percent") return `${number}%`;
    if (unit === "multiplier") return `${number}×`;
    if (unit === "per5") return `${number}/5 sec`;
    if (unit === "gold") return `${number}g`;
    if (unit === "seconds") return `${number} sec`;
    if (unit === "units") return `${number} units`;
    return number;
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatEntityStatValue(entry, unit)}`)
      .join(", ");
  }
  return "—";
}

function directionClass(direction: EntityStatChange["direction"]): string {
  if (direction === "buff") return "text-emerald-300";
  if (direction === "nerf") return "text-rose-300";
  return "text-amber-200";
}

function directionGlyph(direction: EntityStatChange["direction"]): string {
  if (direction === "buff") return "+";
  if (direction === "nerf") return "−";
  return "~";
}

export async function EntityStats({
  record,
  locale,
  showCurrentStats = true,
}: {
  record: EntityPresentationRecord;
  locale: string;
  showCurrentStats?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "entities" });
  const currentStats = record.stats;
  const changes = record.patch_changes;
  const liveChanges = changes.filter((change) => change.lane === "live");
  const previewChanges = changes.filter((change) => change.lane === "preview");
  if ((!showCurrentStats || !currentStats.length) && !changes.length) return null;

  const renderChanges = (entries: EntityStatChange[], heading: string) => (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {heading}
      </h3>
      {entries.map((change) => {
        const label = `${t(change.label_key)}${change.context ? ` · ${change.context}` : ""}`;
        const stateLabel = change.lifecycle === "preview"
          ? t("previewLabel")
          : change.lifecycle === "landed"
            ? t("landedLabel")
            : change.is_hotfix
              ? t("hotfixLabel")
              : t("liveLabel");
        return (
          <div key={`${change.key}-${change.patch}-${change.lane}-${String(change.after)}`} className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/40 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-[var(--color-text-primary)]">{label}</span>
              <span className={`font-bold ${directionClass(change.direction)}`} aria-label={t(`direction.${change.direction}`)}>
                {directionGlyph(change.direction)} {t(`direction.${change.direction}`)}
              </span>
              <span className="rounded-full border border-[var(--color-border-default)] px-2 py-0.5 text-[var(--color-text-muted)]">
                {stateLabel}
              </span>
            </div>
            <div className="mt-1 text-sm tabular-nums text-[var(--color-text-secondary)]">
              {formatEntityStatValue(change.before, change.unit)}
              <span className="mx-2 text-[var(--color-text-muted)]">→</span>
              {formatEntityStatValue(change.after, change.unit)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {change.patch} · {change.source_version}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="space-y-4" aria-labelledby="entity-stats-heading">
      <h2 id="entity-stats-heading" className="text-sm font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
        {t("statsHeading")}
      </h2>
      {showCurrentStats && currentStats.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {currentStats.map((stat) => (
            <div key={`${stat.key}-${stat.source_path}`} className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-card)]/60 px-3 py-2">
              <div className="text-xs text-[var(--color-text-muted)]">{t(stat.label_key)}{stat.context ? ` · ${stat.context}` : ""}</div>
              <div className="mt-1 text-base font-semibold tabular-nums text-[var(--color-accent)]">
                {formatEntityStatValue(stat.value, stat.unit)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {changes.length ? (
        <div className="space-y-4" aria-label={t("changesHeading")}>
          {liveChanges.length ? renderChanges(liveChanges, t("liveChangesHeading")) : null}
          {previewChanges.length ? renderChanges(previewChanges, t("previewChangesHeading")) : null}
        </div>
      ) : null}
    </section>
  );
}
