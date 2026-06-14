export interface LocalizedNameRecord {
  name: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
}

/**
 * Pick the localized display name for a champion/item/augment record, falling
 * back to the English `name`. Localized fields are populated by the augments
 * pipeline and enrich_locale_names.py (Data Dragon).
 */
export function localizedName(record: LocalizedNameRecord, locale: string): string {
  switch (locale) {
    case "zh-TW":
      return record.name_zh_TW || record.name;
    case "zh-CN":
      return record.name_zh_CN || record.name;
    case "ja":
      return record.name_ja || record.name;
    case "ko":
      return record.name_ko || record.name;
    default:
      return record.name;
  }
}
