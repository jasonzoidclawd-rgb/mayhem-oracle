import type { PatchNote } from "@/lib/types";

export interface PatchHeroChrome {
  heading: string;
  intro: string;
  originalArticle: {
    title: string;
    intro: string;
  } | null;
}

export function formatPatchDate(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function buildPatchHeroChrome(
  patch: PatchNote,
  locale: string,
  localizedHeading: string,
): PatchHeroChrome {
  const sourceTitle = patch.title ?? "";
  const title = sourceTitle || localizedHeading;
  const intro = patch.intro ?? "";
  if (locale === "en") {
    return {
      heading: title,
      intro,
      originalArticle: null,
    };
  }

  return {
    heading: localizedHeading,
    intro: "",
    originalArticle:
      sourceTitle || intro
        ? {
            title: sourceTitle,
            intro,
          }
        : null,
  };
}
