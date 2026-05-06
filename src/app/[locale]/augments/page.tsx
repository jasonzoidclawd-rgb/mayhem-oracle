import { getTranslations, setRequestLocale } from "next-intl/server";
import { AugmentsClient } from "@/components/augments/AugmentsClient";
import { normalizeAugmentSet } from "@/lib/data/augment-set";
import { readFile } from "fs/promises";
import path from "path";
import { evaluateAllSetSynergies, type SetSynergyResult } from "@/lib/scoring/set-synergy";
import type { ScoredAugment } from "@/lib/scoring/oracle-score";
import type { AbilityProfile, ChampionBaseStats } from "@/lib/types";

export default async function AugmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("augments");

  const dataDir = path.join(process.cwd(), "public", "data");
  const [augRaw, champRaw, abilRaw] = await Promise.all([
    readFile(path.join(dataDir, "augments.json"), "utf-8"),
    readFile(path.join(dataDir, "champions.json"), "utf-8"),
    readFile(path.join(dataDir, "abilities.json"), "utf-8"),
  ]);

  const { augments, patch } = JSON.parse(augRaw);
  const { champions } = JSON.parse(champRaw);
  const { profiles } = JSON.parse(abilRaw) as { profiles: Record<string, AbilityProfile> };
  const normalizedAugments = (augments as Array<ScoredAugment & { wikiSet?: string | null }>).map((augment) => ({
    ...augment,
    set: normalizeAugmentSet(augment.set, augment.wikiSet),
  }));

  // Compute set-champion synergies
  const champInputs = (champions as {
    slug: string; name: string; icon: string;
    tags: string[]; baseStats: ChampionBaseStats;
  }[]).filter((c) => c.baseStats && profiles[c.slug]);

  const setSynergies: SetSynergyResult[] = evaluateAllSetSynergies(champInputs, profiles);

  return (
    <div className="py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{t("title")}</h1>
        <p className="text-[var(--color-text-secondary)]">
          {t("subtitle", { count: augments.length, patch })}
        </p>
      </header>
      <AugmentsClient
        augments={normalizedAugments}
        locale={locale}
        setSynergies={setSynergies}
      />
    </div>
  );
}
