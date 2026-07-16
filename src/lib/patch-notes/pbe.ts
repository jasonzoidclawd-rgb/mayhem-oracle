const TAG_RE = /<[^>]+>/g;
// CDragon calculation placeholders are prefixed with `@` or with a `%` plus
// an identifier (`%i:cooldown%`). Do not treat ordinary prose percentages as
// tokens; descriptions commonly contain adjacent values such as `35%` and
// `25%`.
const TOKEN_RE = /@[^@]+@|%[A-Za-z][A-Za-z0-9_:.*-]*%|\{\{[^{}]+\}\}/g;

export interface FormattedPbeChange {
  before: string;
  after: string;
}

/** Turn CDragon markup/template strings into readable public change text. */
export function formatPbeValue(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value) ?? "";
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(TAG_RE, " ")
    // CDragon's unresolved calculation tokens are not public values. Keep a
    // visible neutral marker instead of silently dropping them (or implying
    // an authoritative question-mark value).
    .replace(TOKEN_RE, " — ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keep long prose changes readable without repeating the unchanged sentence
 * twice. This is a presentation-only word diff; it never interprets numbers
 * or derives balancing semantics from prose.
 */
export function formatPbeChange(before: unknown, after: unknown): FormattedPbeChange {
  const oldText = formatPbeValue(before);
  const newText = formatPbeValue(after);
  if (oldText === newText || !oldText || !newText) {
    return { before: oldText, after: newText };
  }

  const oldWords = oldText.split(/\s+/);
  const newWords = newText.split(/\s+/);
  const maxWords = 12;
  if (oldWords.length <= maxWords && newWords.length <= maxWords) {
    return { before: oldText, after: newText };
  }

  let prefix = 0;
  while (
    prefix < oldWords.length &&
    prefix < newWords.length &&
    oldWords[prefix] === newWords[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldWords.length - prefix &&
    suffix < newWords.length - prefix &&
    oldWords[oldWords.length - 1 - suffix] === newWords[newWords.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // If the strings have little shared context, truncation would hide too
  // much of the actual change. Preserve the sanitized values instead.
  if (prefix === 0 && suffix === 0) {
    return { before: oldText, after: newText };
  }

  const context = 8;
  const oldStart = Math.max(0, prefix - context);
  const newStart = Math.max(0, prefix - context);
  const oldEnd = Math.min(oldWords.length, oldWords.length - suffix + context);
  const newEnd = Math.min(newWords.length, newWords.length - suffix + context);
  const render = (words: string[], start: number, end: number): string => {
    const parts: string[] = [];
    if (start > 0) parts.push("…");
    parts.push(words.slice(start, end).join(" "));
    if (end < words.length) parts.push("…");
    return parts.join(" ").trim();
  };

  return {
    before: render(oldWords, oldStart, oldEnd),
    after: render(newWords, newStart, newEnd),
  };
}
