import type { DecisionGrade } from "../contracts/decision";

const GRADE_LABELS: Record<string, Record<DecisionGrade, string>> = {
  en: {
    hot: "Hot",
    strong: "Strong",
    steady: "Steady",
    average: "Average",
    weak: "Warning",
  },
  "zh-TW": {
    hot: "極佳",
    strong: "強勢",
    steady: "穩定",
    average: "普通",
    weak: "警示",
  },
  "zh-CN": {
    hot: "极佳",
    strong: "强势",
    steady: "稳定",
    average: "普通",
    weak: "警示",
  },
  ja: {
    hot: "最適",
    strong: "強力",
    steady: "安定",
    average: "平均",
    weak: "警告",
  },
  ko: {
    hot: "최상",
    strong: "강력",
    steady: "안정",
    average: "보통",
    weak: "경고",
  },
};

function supportedLocale(locale: string): keyof typeof GRADE_LABELS {
  if (locale.toLowerCase().startsWith("zh-tw")) return "zh-TW";
  if (locale.toLowerCase().startsWith("zh-cn")) return "zh-CN";
  if (locale.toLowerCase().startsWith("ja")) return "ja";
  if (locale.toLowerCase().startsWith("ko")) return "ko";
  return "en";
}

export function localizedGrade(grade: DecisionGrade, locale: string): string {
  return GRADE_LABELS[supportedLocale(locale)][grade];
}

export function confirmPickedAugment(
  pickedAugments: string[],
  offeredAugmentSlugs: string[],
  regionIndex: number,
): string[] {
  const selected = offeredAugmentSlugs[regionIndex];
  if (!selected || pickedAugments.includes(selected)) return pickedAugments;
  return [...pickedAugments, selected];
}
