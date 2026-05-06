import { getTranslations } from "next-intl/server";
import type { PatchNotesData } from "@/lib/types";
import { PatchCard } from "./PatchCard";

const RECENT_COUNT = 3;

export async function PatchNotesView({
  data,
  locale,
}: {
  data: PatchNotesData;
  locale: string;
}) {
  const t = await getTranslations("patchNotes");

  if (!data.patches.length) {
    return (
      <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">
        {t("noData")}
      </div>
    );
  }

  const [first, ...rest] = data.patches;
  const recent = rest.slice(0, RECENT_COUNT - 1);
  const older = rest.slice(RECENT_COUNT - 1);

  return (
    <div className="space-y-6">
      <PatchCard patch={first} locale={locale} isCurrent />
      {recent.map((patch) => (
        <PatchCard key={patch.version} patch={patch} locale={locale} />
      ))}
      {older.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-card)]">
            <span className="group-open:hidden">{t("showOlder")}</span>
            <span className="hidden group-open:inline">{t("hideOlder")}</span>
          </summary>
          <div className="mt-4 space-y-6">
            {older.map((patch) => (
              <PatchCard key={patch.version} patch={patch} locale={locale} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
