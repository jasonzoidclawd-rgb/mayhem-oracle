const TAG_RE = /<[^>]+>/g;
const TOKEN_RE = /@[^@]+@|%[^%]+%/g;

/** Turn CDragon markup/template strings into readable public change text. */
export function formatPbeValue(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value) ?? "";
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(TAG_RE, " ")
    .replace(TOKEN_RE, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
