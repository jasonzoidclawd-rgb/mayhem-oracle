import { getTranslations } from "next-intl/server";
import type {
  ChangeKind,
  PatchNote,
  PatchSection,
  PatchChange,
} from "@/lib/types";
import { ChangeBadge } from "./ChangeBadge";

type DataLocale = "en" | "zh-tw" | "zh-cn" | "ja-jp" | "ko-kr";

// Lookup chain per UI locale. The source site has no dedicated zh-TW
// patch-notes page, but augment subjects are back-filled with Traditional
// names from CommunityDragon, so zh-TW prefers that field before falling
// back to Simplified body text.
const LOCALE_CHAIN: Record<string, DataLocale[]> = {
  en: ["en"],
  "zh-CN": ["zh-cn", "en"],
  "zh-TW": ["zh-tw", "zh-cn", "en"],
  ja: ["ja-jp", "en"],
  ko: ["ko-kr", "en"],
};

function pickLocaleText(
  field: PatchChange["text"] | PatchChange["subject"],
  chain: DataLocale[],
): string {
  for (const loc of chain) {
    const v = field[loc];
    if (v) return v;
  }
  return field.en ?? "";
}

export async function PatchCard({
  patch,
  locale,
  isCurrent = false,
}: {
  patch: PatchNote;
  locale: string;
  isCurrent?: boolean;
}) {
  const t = await getTranslations("patchNotes");
  const chain: DataLocale[] = LOCALE_CHAIN[locale] ?? ["en"];

  return (
    <article className="glass-card overflow-hidden">
      <header className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">
            {t("patchLabel", { patch: patch.version })}
          </h2>
          <div className="flex items-center gap-1.5">
            {isCurrent && !patch.released ? (
              <span className="inline-flex items-center rounded-full border border-purple-400/40 bg-purple-400/15 px-2 py-0.5 text-xs font-medium text-purple-300">
                {t("previewBadge")}
              </span>
            ) : null}
            {isCurrent ? (
              <span className="inline-flex items-center rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                {t("currentBadge")}
              </span>
            ) : null}
          </div>
        </div>
        {patch.released ? (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {patch.released}
          </p>
        ) : null}
      </header>

      <div className="space-y-6 px-5 py-5">
        {patch.sections.map((section) => (
          <Section key={section.id} section={section} chain={chain} />
        ))}
      </div>
    </article>
  );
}

async function Section({
  section,
  chain,
}: {
  section: PatchSection;
  chain: DataLocale[];
}) {
  const t = await getTranslations("patchNotes");
  const sectionTitle =
    typeof section.id === "string" && section.id in SECTION_KEYS
      ? t(`sections.${section.id as SectionKey}`)
      : section.title;

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-accent)]">
        {sectionTitle}
      </h3>
      <ul className="space-y-2">
        {section.changes.map((change, idx) => (
          <ChangeRow key={idx} change={change} chain={chain} />
        ))}
      </ul>
    </section>
  );
}

const SECTION_KEYS = {
  highlights: true,
  general: true,
  new_items: true,
  augments: true,
  champions: true,
  bugfixes: true,
} as const;

type SectionKey = keyof typeof SECTION_KEYS;

async function ChangeRow({
  change,
  chain,
}: {
  change: PatchChange;
  chain: DataLocale[];
}) {
  const t = await getTranslations("patchNotes");
  const subject = pickLocaleText(change.subject, chain);
  const text = pickLocaleText(change.text, chain);
  const kindLabel = t(`kinds.${change.kind as ChangeKind}`);

  return (
    <li className="flex items-start gap-3 rounded-md border border-[var(--color-border)]/50 bg-[var(--color-bg-card)]/40 px-3 py-2">
      <ChangeBadge kind={change.kind} label={kindLabel} />
      <div className="min-w-0 flex-1 text-sm">
        {subject ? (
          <div className="font-medium text-[var(--color-text-primary)]">
            {subject}
          </div>
        ) : null}
        <div className="text-[var(--color-text-secondary)]">{text}</div>
      </div>
    </li>
  );
}
