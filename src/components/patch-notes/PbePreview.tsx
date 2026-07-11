import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { describeFreshness } from "@/lib/patch-notes/freshness";

type PreviewEvent = {
  entity_type: "augment" | "champion" | "item";
  canonical_id: string;
  slug: string;
  names: Record<string, string>;
  change_kind: string;
  fields_changed: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  detected_at: string;
  known?: boolean;
  href?: string;
};

export type PbePreviewData = {
  status?: "fresh" | "stale" | "unavailable" | "not_yet_confirmed";
  source_patch_label?: string;
  observed_at?: string;
  events?: PreviewEvent[];
};

const localeKeys: Record<string, string[]> = {
  en: ["en"],
  "zh-TW": ["zh-TW", "zh-tw", "en"],
  "zh-CN": ["zh-CN", "zh-cn", "en"],
  ja: ["ja", "ja-jp", "en"],
  ko: ["ko", "ko-kr", "en"],
};

function eventName(event: PreviewEvent, locale: string): string {
  for (const key of localeKeys[locale] ?? ["en"]) {
    if (event.names[key]) return event.names[key];
  }
  return event.slug;
}

function eventText(
  event: PreviewEvent,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (event.change_kind === "added") return t("pbeAdded");
  if (event.change_kind === "removed") return t("pbeRemoved");
  return event.fields_changed.map((field) =>
    t("pbeFieldChange", {
      field,
      before: JSON.stringify(event.before[field]) ?? "",
      after: JSON.stringify(event.after[field]) ?? "",
    }),
  ).join("; ");
}

export async function PbePreview({ data, locale }: { data: PbePreviewData | null; locale: string }) {
  const t = await getTranslations("patchNotes");
  const freshness = describeFreshness(data?.status, data?.observed_at);
  const events = data?.events ?? [];

  return (
    <section className="glass-card overflow-hidden border border-cyan-400/20">
      <header className="border-b border-cyan-400/15 bg-cyan-400/5 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t("pbeTitle")}</h2>
              <span className="rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2 py-0.5 text-xs font-medium text-cyan-200">
                {t("previewBadge")}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t("pbeSubtitle")}</p>
          </div>
          <span className="text-xs text-[var(--color-text-muted)]">
            {freshness.state === "today"
              ? t("freshnessToday")
              : freshness.state === "days"
                ? t("freshnessDays", { days: freshness.days ?? 0 })
                : freshness.state === "stale"
                  ? t("freshnessStale")
                  : t("freshnessUnavailable")}
          </span>
        </div>
      </header>
      {freshness.state === "unavailable" ? (
        <p className="px-5 py-5 text-sm text-[var(--color-text-muted)]">{t("pbeUnavailable")}</p>
      ) : (
        <>
          {freshness.state === "stale" ? (
            <p className="border-b border-amber-400/20 bg-amber-400/5 px-5 py-3 text-sm text-amber-100">
              {t("pbeStale")}
            </p>
          ) : null}
          {!events.length ? (
            <p className="px-5 py-5 text-sm text-[var(--color-text-muted)]">{t("pbeNoChanges")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {events.map((event) => (
                <li key={`${event.entity_type}-${event.canonical_id}-${event.fields_changed.join("-")}`} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-cyan-400/30 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-cyan-200">
                      {t(`objectTypes.${event.entity_type}`)}
                    </span>
                    {event.href && event.known ? (
                      <Link href={event.href} className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)]">
                        {eventName(event, locale)}
                      </Link>
                    ) : (
                      <span className="font-medium text-[var(--color-text-primary)]">{eventName(event, locale)}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{eventText(event, t)}</p>
                  <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                    {describeFreshness("fresh", event.detected_at).state === "today"
                      ? t("freshnessToday")
                      : t("freshnessDays", { days: describeFreshness("fresh", event.detected_at).days ?? 0 })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
