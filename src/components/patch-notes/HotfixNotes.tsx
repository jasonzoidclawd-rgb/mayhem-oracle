import { getTranslations } from "next-intl/server";
import { readFile } from "fs/promises";
import path from "path";
import { ChangeBadge } from "./ChangeBadge";
import { formatPatchDate } from "@/lib/patch-notes/chrome";
import type { ChangeKind } from "@/lib/types";

type HotfixType = "added" | "removed" | "rarity" | "effect" | "mechanism";

interface HotfixChange {
  slug: string;
  names: Record<string, string>;
  rarity?: string | null;
  type: HotfixType;
  fromRarity?: string | null;
  toRarity?: string | null;
}

export interface HotfixEvent {
  date: string;
  patch: string;
  changes: HotfixChange[];
}

// Hotfix type → ChangeBadge color semantics (reused from regular patch notes).
const TYPE_KIND: Record<HotfixType, ChangeKind> = {
  added: "added",
  removed: "removed",
  rarity: "changed",
  effect: "changed",
  mechanism: "mechanism",
};

export async function loadHotfixes(): Promise<HotfixEvent[]> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "public", "data", "mayhem-hotfixes.json"),
      "utf-8",
    );
    return (JSON.parse(raw) as { events?: HotfixEvent[] }).events ?? [];
  } catch {
    return [];
  }
}

export async function HotfixNotes({
  locale,
  events,
}: {
  locale: string;
  events?: HotfixEvent[];
}) {
  const t = await getTranslations("patchNotes");
  const hotfixEvents = events ?? await loadHotfixes();
  if (!hotfixEvents.length) return null;

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-[var(--color-accent)]">
          {t("hotfix.title")}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {t("hotfix.subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        {hotfixEvents.map((event) => (
          <article key={event.date} className="glass-card overflow-hidden">
            <header className="border-b border-[var(--color-border)] px-5 py-3">
              <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                {t("patchLabel", { patch: event.patch })} ·{" "}
                {t("hotfix.detected", {
                  date: formatPatchDate(event.date, locale),
                })}
              </span>
            </header>
            <ul className="space-y-2 px-5 py-4">
              {event.changes.map((c, idx) => {
                const name = c.names[locale] ?? c.names.en ?? c.slug;
                const detail =
                  c.type === "rarity"
                    ? t("hotfix.rarity")
                    : t(`hotfix.${c.type}` as "hotfix.added");
                return (
                  <li
                    key={`${c.slug}-${idx}`}
                    className="flex items-start gap-3 rounded-md border border-[var(--color-border)]/50 bg-[var(--color-bg-card)]/40 px-3 py-2"
                  >
                    <ChangeBadge
                      kind={TYPE_KIND[c.type]}
                      label={t(`hotfix.${c.type}` as "hotfix.added")}
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {name}
                      </div>
                      <div className="text-[var(--color-text-secondary)]">
                        {detail}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
