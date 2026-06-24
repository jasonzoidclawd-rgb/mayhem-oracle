import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ChangeKind, PatchNote, PatchNotesData } from "@/lib/types";
import { PatchCard } from "./PatchCard";

const RECENT_COUNT = 2;

export interface RemovedPatchAugment {
  slug: string;
  name: string;
  rarity: string;
  icon?: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  flags?: {
    lifecycle?: string;
    lifecycle_patch?: string;
  };
}

export async function PatchNotesView({
  data,
  locale,
  removedAugments,
}: {
  data: PatchNotesData;
  locale: string;
  removedAugments: RemovedPatchAugment[];
}) {
  const t = await getTranslations("patchNotes");

  if (!data.patches.length) {
    return (
      <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">
        {t("noData")}
      </div>
    );
  }

  const [current, ...rest] = data.patches;
  const recent = rest.slice(0, RECENT_COUNT);
  const older = rest.slice(RECENT_COUNT);

  return (
    <div className="space-y-6">
      <PatchHero patch={current} sourceUrl={data.sourceUrl || current.sourceUrl} />
      <PatchSummary patch={current} />
      <PatchCard patch={current} locale={locale} isCurrent />
      <RemovedAugmentsTable augments={removedAugments} locale={locale} />

      {recent.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t("recentTitle")}
          </h2>
          {recent.map((patch) => (
            <PatchCard key={patch.version} patch={patch} locale={locale} compact />
          ))}
        </section>
      ) : null}

      {older.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-card)]">
            <span className="group-open:hidden">{t("showOlder")}</span>
            <span className="hidden group-open:inline">{t("hideOlder")}</span>
          </summary>
          <div className="mt-4 space-y-4">
            {older.map((patch) => (
              <PatchCard key={patch.version} patch={patch} locale={locale} compact />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

async function PatchHero({
  patch,
  sourceUrl,
}: {
  patch: PatchNote;
  sourceUrl?: string;
}) {
  const t = await getTranslations("patchNotes");
  const authors = patch.authors?.length ? patch.authors.join(", ") : null;

  return (
    <section className="glass-card overflow-hidden border border-[var(--color-border-hover)]">
      <div className="bg-gradient-to-br from-cyan-500/15 via-purple-500/10 to-transparent px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            {t("officialSource")}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {patch.publishedAt || patch.released}
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-bold text-[var(--color-text-primary)] sm:text-3xl">
          {patch.title || t("patchLabel", { patch: patch.version })}
        </h2>
        {authors ? (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {t("articleByline", { authors })}
          </p>
        ) : null}
        {patch.intro ? (
          <p className="mt-4 max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
            {patch.intro}
          </p>
        ) : null}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-[var(--color-border-hover)] px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {t("viewRiotSource")} →
          </a>
        ) : null}
      </div>
    </section>
  );
}

async function PatchSummary({ patch }: { patch: PatchNote }) {
  const t = await getTranslations("patchNotes");
  const summary = patch.summary;
  if (!summary) return null;

  const cards = [
    ["summaryTotal", summary.totalChanges],
    ["summaryDamage", summary.damageRelevant],
    ["summaryChampions", summary.byEntityType.champion ?? 0],
    ["summaryAugments", summary.byEntityType.augment ?? 0],
    ["summaryItems", summary.byEntityType.item ?? 0],
  ] as const;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {cards.map(([key, value]) => (
        <div key={key} className="glass-card p-4">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {value}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
            {t(key)}
          </div>
        </div>
      ))}
    </section>
  );
}

async function RemovedAugmentsTable({
  augments,
  locale,
}: {
  augments: RemovedPatchAugment[];
  locale: string;
}) {
  const t = await getTranslations("patchNotes");
  if (!augments.length) return null;

  return (
    <section className="glass-card overflow-hidden">
      <header className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {t("removedTitle")}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {t("removedSubtitle", { count: augments.length })}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--color-bg-card)]/60 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
            <tr>
              <th className="px-5 py-3 font-medium">{t("removedName")}</th>
              <th className="px-5 py-3 font-medium">{t("removedRarity")}</th>
              <th className="px-5 py-3 font-medium">{t("removedVersion")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {augments.slice(0, 64).map((augment) => (
              <tr key={augment.slug} className="hover:bg-[var(--color-bg-card)]/35">
                <td className="px-5 py-3">
                  <Link
                    href={`/augments/${augment.slug}`}
                    className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)]"
                  >
                    {localizedAugmentName(augment, locale)}
                  </Link>
                </td>
                <td className="px-5 py-3 capitalize text-[var(--color-text-secondary)]">
                  {augment.rarity}
                </td>
                <td className="px-5 py-3 text-[var(--color-text-muted)]">
                  {augment.flags?.lifecycle_patch ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function localizedAugmentName(augment: RemovedPatchAugment, locale: string): string {
  if (locale === "zh-TW") return augment.name_zh_TW || augment.name;
  if (locale === "zh-CN") return augment.name_zh_CN || augment.name;
  if (locale === "ja") return augment.name_ja || augment.name;
  if (locale === "ko") return augment.name_ko || augment.name;
  return augment.name;
}

export function kindCount(patch: PatchNote, kind: ChangeKind): number {
  return patch.summary?.byKind[kind] ?? 0;
}
