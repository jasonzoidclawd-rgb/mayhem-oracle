import { patchNoteSectionHref } from "@/lib/patch-notes/seo";
import type {
  PatchChange,
  PatchLocale,
  PatchNote,
  PatchNotesData,
  PatchSection,
} from "@/lib/types";

export interface PatchNoteSearchItem {
  kind: "patch-note";
  name: string;
  patch: string;
  href: string;
  snippet: string;
  searchText: string;
}

const PATCH_LOCALE_CHAIN: Record<string, PatchLocale[]> = {
  en: ["en"],
  "zh-CN": ["zh-cn", "en"],
  "zh-TW": ["zh-tw", "zh-cn", "en"],
  ja: ["ja-jp", "en"],
  ko: ["ko-kr", "en"],
};

function localeChain(locale: string): PatchLocale[] {
  return PATCH_LOCALE_CHAIN[locale] ?? ["en"];
}

function pickLocalizedText(
  field: PatchChange["text"] | PatchChange["subject"],
  chain: PatchLocale[],
): string {
  for (const locale of chain) {
    const value = field[locale];
    if (value) return value;
  }
  return field.en ?? "";
}

export function buildPatchNoteSearchItems(
  data: PatchNotesData | null | undefined,
  locale: string,
  options: { patchLabel: (patch: string) => string },
): PatchNoteSearchItem[] {
  if (!data?.patches?.length) return [];
  const chain = localeChain(locale);

  return data.patches.flatMap((patch) =>
    patch.sections
      .filter((section) => section.changes.length > 0)
      .map((section) => buildSectionSearchItem(patch, section, chain, options)),
  );
}

function buildSectionSearchItem(
  patch: PatchNote,
  section: PatchSection,
  chain: PatchLocale[],
  options: { patchLabel: (patch: string) => string },
): PatchNoteSearchItem {
  const snippets = section.changes
    .slice(0, 4)
    .map((change) => {
      const subject = pickLocalizedText(change.subject, chain);
      const text = pickLocalizedText(change.text, chain);
      return subject ? `${subject}: ${text}` : text;
    })
    .filter(Boolean);
  const kindTokens = Array.from(
    new Set(section.changes.map((change) => change.kind).filter(Boolean)),
  );
  const name = `${options.patchLabel(patch.version)} · ${section.title}`;
  const snippet = snippets.join(" ").slice(0, 220);

  return {
    kind: "patch-note",
    name,
    patch: patch.version,
    href: patchNoteSectionHref(patch.version, section.id),
    snippet,
    searchText: [
      name,
      patch.version,
      section.title,
      kindTokens.join(" "),
      snippet,
    ]
      .filter(Boolean)
      .join(" "),
  };
}
