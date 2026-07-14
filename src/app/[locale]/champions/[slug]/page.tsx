import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { AbilityProfile, AbilityEntry, AbilityStats, ChampionBaseStats } from "@/lib/types";
import { Tooltip } from "@/components/ui/Tooltip";
import { buildPoolProfile } from "@/lib/scoring/augment-tailoring";
import { localizedDescription, localizedName } from "@/lib/i18n/localized-name";
import { resolveChampionCombos } from "@/lib/data/combo-lookup";
import { readChampionsFile } from "@/lib/data/read-public-file";
import { routing, type Locale } from "@/i18n/routing";
import { ChampionMemberIsland } from "@/components/champions/ChampionMemberIsland";
import {
  loadChampionDetailData,
  type ChampionDetailAugment,
  type ChampionDetailChampion,
} from "@/lib/champions/detail-data";
import { buildChampionDetailJsonLd } from "@/lib/seo/champion-detail";
import {
  type PoolLayer,
  type PoolProfileChip,
  type PoolRaritySummary,
} from "@/components/champions/PoolConstructionSection";
import { JsonLd } from "@/components/seo/JsonLd";
import { languageAlternates, localizedUrl } from "@/lib/site";

type ChampionData = ChampionDetailChampion;
type AugmentData = ChampionDetailAugment;

type AbilityStatLabels = {
  damage: string;
  ap: string;
  bonusAd: string;
  totalAd: string;
  health: string;
  cooldown: string;
  cost: string;
  range: string;
  dot: string;
  aoe: string;
  onHit: string;
  radius: string;
  width: string;
  speed: string;
  cast: string;
};

// ─── Static params for all current-patch champions ───────────────────────────

export const dynamicParams = false;

export async function generateStaticParams() {
  const { champions } = await readChampionsFile<{ champions: ChampionData[] }>();

  return routing.locales.flatMap((locale) =>
    champions.map((c) => ({ locale, slug: c.slug }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "champion" });
  const data = await loadChampionDetailData("public");
  const champ = data.champions.find((c) => c.slug === slug);
  if (!champ) notFound();

  const name = localizedName(champ, locale);
  const route = `/champions/${champ.slug}`;
  const tierLabel = champ.tier ?? t("statisticsUnavailableShort");
  const title = t("metaDetailTitle", { name, tier: tierLabel, patch: data.patch });
  const description = t("metaDetailDescription", { name, tier: tierLabel, patch: data.patch });
  const url = localizedUrl(route, locale as Locale);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(route),
    },
    openGraph: { title, description, url, locale },
    twitter: { card: "summary_large_image", title, description },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ChampionPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("champion");

  const publicData = await loadChampionDetailData("public");
  const { champions, augments, combos, abilities, patch } = publicData;

  const champ = champions.find((c) => c.slug === slug);
  if (!champ) notFound();
  const champName = localizedName(champ, locale);
  const localizedAugmentDescription = (augment: AugmentData): string =>
    localizedDescription(augment, locale) || augment.wikiDescription || augment.description || "";
  const championStatisticsAvailable =
    typeof champ.win_rate === "number" &&
    typeof champ.pick_rate === "number";
  const abilityProfile: AbilityProfile | undefined = abilities[slug];

  // Build combo lookup for this champion: augment-slug → tier
  const champCombos = resolveChampionCombos(slug, combos, augments);
  const augmentBySlug = new Map(augments.map((augment) => [augment.slug, augment]));

  const poolProfile = buildPoolProfile(slug, abilityProfile, champ.baseStats);
  const poolLayers: PoolLayer[] = [
    {
      key: "source",
      label: t("poolStepSource"),
      detail: t("poolStepSourceDetail"),
      kept: augments.length,
      removed: 0,
    },
  ];

  // Pre-compute translated damage/attack type labels
  const damageTypeLabel: Record<string, string> = {
    magic:    t("magicDamage"),
    physical: t("physicalDamage"),
    mixed:    t("mixedDamage"),
  };
  const attackTypeLabel: Record<string, string> = {
    ranged: t("ranged"),
    melee:  t("melee"),
  };

  const poolProfileChips: PoolProfileChip[] = [
    {
      label: t("poolChipResource"),
      value:
        poolProfile.resource === "none"
          ? t("resourceNone")
          : poolProfile.resource === "energy"
            ? t("resourceEnergy")
            : t("resourceMana"),
    },
    {
      label: t("attackType"),
      value: attackTypeLabel[poolProfile.attackType] ?? poolProfile.attackType,
    },
    {
      label: t("damageType"),
      value: damageTypeLabel[poolProfile.damageType] ?? poolProfile.damageType,
    },
    {
      label: t("poolChipTags"),
      value: (champ.kit_tags ?? []).length > 0 ? (champ.kit_tags ?? []).join(", ") : t("poolUniversal"),
    },
  ];

  const poolRaritySummary: PoolRaritySummary[] = [
    {
      key: "silver",
      label: t("silver"),
      count: augments.filter((augment) => augment.rarity === "silver").length,
    },
    {
      key: "gold",
      label: t("gold"),
      count: augments.filter((augment) => augment.rarity === "gold").length,
    },
    {
      key: "prismatic",
      label: t("prismatic"),
      count: augments.filter((augment) => augment.rarity === "prismatic").length,
    },
  ];

  const strongCombos = champCombos.filter((c) => c.tier === "S");
  const avoidCombos = champCombos.filter((c) => c.tier === "C");

  // Pre-compute translated playstyle labels
  const playstyleItems: Array<[keyof AbilityProfile["playstyle"], string]> = [
    ["damage",       t("playstyleDamage")],
    ["durability",   t("playstyleDurability")],
    ["crowdControl", t("playstyleCrowdControl")],
    ["mobility",     t("playstyleMobility")],
    ["utility",      t("playstyleUtility")],
  ];
  const baseStatsCopy = {
    title: t("baseStatsTitle"),
    stat: t("baseStatsStat"),
    base: t("baseStatsBase"),
    growth: t("baseStatsGrowth"),
    at18: t("baseStatsAt18"),
    rows: {
      health: t("statHealth"),
      mana: t("statMana"),
      hpRegen: t("statHpRegen"),
      mpRegen: t("statMpRegen"),
      armor: t("statArmor"),
      magicResist: t("statMagicResist"),
      attackDamage: t("statAttackDamage"),
      attackSpeed: t("statAttackSpeed"),
      attackSpeedGrowth: t("statAttackSpeedGrowth"),
      attackRange: t("statAttackRange"),
      moveSpeed: t("statMoveSpeed"),
      missileSpeed: t("statMissileSpeed"),
    },
  };
  const abilityStatLabels: AbilityStatLabels = {
    damage: t("abilityStatDamage"),
    ap: t("abilityStatAp"),
    bonusAd: t("abilityStatBonusAd"),
    totalAd: t("abilityStatTotalAd"),
    health: t("abilityStatHealth"),
    cooldown: t("abilityStatCooldown"),
    cost: t("abilityStatCost"),
    range: t("abilityStatRange"),
    dot: t("abilityStatDot"),
    aoe: t("abilityStatAoe"),
    onHit: t("abilityStatOnHit"),
    radius: t("abilityStatRadius"),
    width: t("abilityStatWidth"),
    speed: t("abilityStatSpeed"),
    cast: t("abilityStatCast"),
  };

  const championRoute = `/champions/${champ.slug}`;
  const championJsonLd = buildChampionDetailJsonLd(champ, locale, {
    url: localizedUrl(championRoute, locale as Locale),
    homeUrl: localizedUrl("/", locale as Locale),
    championsUrl: localizedUrl("/champions", locale as Locale),
    championsLabel: t("indexTitle"),
    name: champName,
    patch,
    tierLabel: champ.tier ?? t("statisticsUnavailableShort"),
    tagLabels: champ.tags,
    classLabels: champ.classes,
    kitTagLabels: champ.kit_tags,
  });

  return (
    <div className="py-4 sm:py-8 max-w-4xl">
      <JsonLd data={championJsonLd} />
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3 sm:gap-5 mb-4 sm:mb-6">
        <div className="relative w-14 h-14 sm:w-20 sm:h-20 rounded-full overflow-hidden border-2 border-[var(--color-neon-primary)]/40 shrink-0">
          <Image
            src={champ.icon}
            alt={champName}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 56px, 80px"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-3xl font-bold truncate">{champName}</h1>
            {champ.rank && (
              <span className="text-sm sm:text-base text-[var(--color-text-muted)] font-medium shrink-0">
                {champ.rank}/{champions.length}
              </span>
            )}
            {champ.tier ? (
              <TierBadge tier={champ.tier} />
            ) : (
              <span className="text-xs font-semibold text-[var(--color-text-muted)]">
                {t("statisticsUnavailableShort")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-[var(--color-text-secondary)]">
            {championStatisticsAvailable ? (
              <>
                <span className="font-bold text-[var(--color-wr-high)]">
                  {champ.win_rate!.toFixed(1)}% {t("winRateAbbr")}
                </span>
                <span className="text-xs">
                  {champ.pick_rate!.toFixed(1)}% {t("pickRateAbbr")}
                </span>
              </>
            ) : (
              <span className="font-medium text-amber-300">
                {t("statisticsUnavailable")}
              </span>
            )}
            <span className="text-[10px] text-[var(--color-text-muted)]">{t("patchLabel", { patch })}</span>
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {(champ.classes ?? champ.tags).map((cl) => (
              <span
                key={cl}
                className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] capitalize"
              >
                {cl}
              </span>
            ))}
          </div>
          {(champ.kit_tags ?? []).length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {(champ.kit_tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-[var(--color-neon-primary)]/30 bg-[var(--color-neon-primary)]/5 text-[var(--color-neon-primary)]/70"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Neon divider */}
      <div className="h-0.5 mb-4 rounded-full bg-gradient-to-r from-[var(--color-neon-primary)] to-[var(--color-neon-secondary)]" />

      {/* ─── Strong combos + Traps ─── */}
      {(strongCombos.length > 0 || avoidCombos.length > 0) && (
        <section className="glass-card p-4 mb-3 sm:mb-6">
          {strongCombos.length > 0 && (
            <div className={avoidCombos.length > 0 ? "mb-4" : ""}>
              <h2 className="text-sm font-bold mb-2 text-green-400 border-l-2 border-green-400 pl-2">
                {t("strongCombos")}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {strongCombos.map((c) => {
                  const aug = augmentBySlug.get(c.augmentSlug);
                  const augName = aug ? localizedName(aug, locale) : c.augment;
                  const augDescription = aug ? localizedAugmentDescription(aug) : undefined;
                  return (
                    <Tooltip key={`${c.champion}-${c.augmentSlug}-${c.tier}`} content={augDescription}>
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-green-400/30 bg-green-400/5 cursor-default">
                        {aug && (
                          <Image
                            src={aug.icon}
                            alt={augName}
                            width={24}
                            height={24}
                            className="rounded"
                            unoptimized
                          />
                        )}
                        <span className="text-xs font-medium text-green-300">
                          {augName}
                        </span>
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-green-400/20 text-green-400">
                          S
                        </span>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}

          {avoidCombos.length > 0 && (
            <div>
              <h2 className="text-sm font-bold mb-2 text-red-400 border-l-2 border-red-400 pl-2">
                {t("trapsAvoid")}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {avoidCombos.map((c) => {
                  const aug = augmentBySlug.get(c.augmentSlug);
                  const augName = aug ? localizedName(aug, locale) : c.augment;
                  const augDescription = aug ? localizedAugmentDescription(aug) : undefined;
                  return (
                    <Tooltip key={`${c.champion}-${c.augmentSlug}-${c.tier}`} content={augDescription}>
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-red-400/30 bg-red-400/5 cursor-default">
                        {aug && (
                          <Image
                            src={aug.icon}
                            alt={augName}
                            width={24}
                            height={24}
                            className="rounded"
                            unoptimized
                          />
                        )}
                        <span className="text-xs font-medium text-red-300">
                          {augName}
                        </span>
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-400/20 text-red-400">
                          C
                        </span>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── Base Stats ─── */}
      {champ.baseStats && (
        <BaseStatsTable stats={champ.baseStats} copy={baseStatsCopy} />
      )}

      {/* ─── Abilities ─── */}
      {abilityProfile && (
        <section className="glass-card p-4 mb-3 sm:mb-6">
          <h2 className="text-sm font-bold mb-3 border-l-2 border-[var(--color-neon-primary)] pl-2">{t("skillOrder")}</h2>

          {/* Damage type + attack type badges + playstyle bars inline */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <DamageTypeBadge
              type={abilityProfile.damageType}
              label={damageTypeLabel[abilityProfile.damageType] ?? abilityProfile.damageType}
            />
            <AttackTypeBadge
              type={abilityProfile.attackType}
              label={attackTypeLabel[abilityProfile.attackType] ?? abilityProfile.attackType}
            />
          </div>

          {/* Playstyle bars — compact row */}
          <div className="grid grid-cols-5 gap-2 mb-4 px-2 py-2.5 rounded-lg bg-[var(--color-bg-card)]/60">
            {playstyleItems.map(([key, label]) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5">
                  {[1, 2, 3].map((pip) => (
                    <div
                      key={pip}
                      className={`w-3 sm:w-4 h-1.5 rounded-full ${
                        pip <= abilityProfile.playstyle[key]
                          ? "bg-[var(--color-neon-primary)]"
                          : "bg-[var(--color-border-default)]"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[8px] sm:text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide text-center leading-tight">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Ability list — compact cards */}
          <div className="space-y-2">
            {abilityProfile.abilities.map((ability) => {
              const abilityName = localizedName(ability, locale);
              // Prefer a real localized description; for English (or when no
              // translation exists) fall back to the richer wiki text.
              const localizedDesc = localizedDescription(ability, locale);
              const abilityDescription =
                localizedDesc !== ability.description
                  ? localizedDesc
                  : ability.wikiDescription ?? ability.description;

              return (
                <div key={ability.key} className="flex items-start gap-2.5 px-2 py-2 rounded-lg border border-[var(--color-border-default)]/50 bg-[var(--color-bg-card)]/30">
                  <div className="shrink-0 flex flex-col items-center gap-0.5">
                    <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden border border-[var(--color-border-default)]">
                      <Image
                        src={ability.icon}
                        alt={abilityName}
                        fill
                        className="object-contain"
                        sizes="(max-width: 640px) 32px, 40px"
                        unoptimized
                      />
                    </div>
                    <span className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase">
                      {ability.key}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs sm:text-sm font-semibold">{abilityName}</span>
                    <WikiAbilityStats ability={ability} labels={abilityStatLabels} />
                    {!ability.cooldown && ability.stats && <AbilityStatLine stats={ability.stats} labels={abilityStatLabels} />}
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed line-clamp-2 sm:line-clamp-none">
                      {abilityDescription}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <ChampionMemberIsland
        championSlug={champ.slug}
        championName={champName}
        locale={locale}
        publicPatch={patch}
        publicProfileChips={poolProfileChips}
        publicRaritySummary={poolRaritySummary}
        publicLayers={poolLayers}
        publicAugmentCount={augments.length}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TIER_BADGE_STYLES: Record<string, string> = {
  "S+": "text-amber-300 border-amber-300/50 bg-amber-300/10",
  S:    "text-yellow-400 border-yellow-400/50 bg-yellow-400/10",
  A:    "text-green-400 border-green-400/50 bg-green-400/10",
  B:    "text-blue-400 border-blue-400/50 bg-blue-400/10",
  C:    "text-slate-400 border-slate-400/50 bg-slate-400/10",
};

function TierBadge({ tier }: { tier: string }) {
  const styles = TIER_BADGE_STYLES[tier] ?? TIER_BADGE_STYLES.C;
  return (
    <span className={`px-2.5 py-0.5 rounded-md text-sm font-bold border ${styles}`}>
      {tier}
    </span>
  );
}

const DAMAGE_TYPE_STYLES: Record<string, string> = {
  magic:    "text-blue-300 border-blue-400/40 bg-blue-400/10",
  physical: "text-orange-300 border-orange-400/40 bg-orange-400/10",
  mixed:    "text-violet-300 border-violet-400/40 bg-violet-400/10",
};

function DamageTypeBadge({ type, label }: { type: string; label: string }) {
  const style = DAMAGE_TYPE_STYLES[type] ?? DAMAGE_TYPE_STYLES.mixed;
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${style}`}>
      {label}
    </span>
  );
}

function AttackTypeBadge({ type, label }: { type: string; label: string }) {
  const style = type === "ranged"
    ? "text-cyan-300 border-cyan-400/40 bg-cyan-400/10"
    : "text-rose-300 border-rose-400/40 bg-rose-400/10";
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${style}`}>
      {label}
    </span>
  );
}

// ─── Ability Stat Line ────────────────────────────────────────────────────────

const DMG_TYPE_COLOR: Record<string, string> = {
  magic: "text-blue-300",
  physical: "text-orange-300",
  true: "text-white",
};

function AbilityStatLine({ stats, labels }: { stats: AbilityStats; labels: AbilityStatLabels }) {
  const parts: Array<{ label: string; value: string; color?: string }> = [];

  if (stats.baseDamage?.length) {
    const dmg = stats.baseDamage;
    parts.push({
      label: labels.damage,
      value: dmg.length > 1 ? `${dmg[0]}–${dmg[dmg.length - 1]}` : `${dmg[0]}`,
      color: DMG_TYPE_COLOR[stats.damageType ?? ""] ?? "text-[var(--color-text-secondary)]",
    });
  }

  if (stats.apRatio) {
    parts.push({ label: labels.ap, value: `${(stats.apRatio * 100).toFixed(0)}%`, color: "text-blue-300" });
  }
  if (stats.adRatio) {
    parts.push({ label: labels.bonusAd, value: `${(stats.adRatio * 100).toFixed(0)}%`, color: "text-orange-300" });
  }
  if (stats.totalAdRatio) {
    parts.push({ label: labels.totalAd, value: `${(stats.totalAdRatio * 100).toFixed(0)}%`, color: "text-orange-300" });
  }
  if (stats.hpRatio) {
    parts.push({ label: labels.health, value: `${(stats.hpRatio * 100).toFixed(0)}%`, color: "text-green-300" });
  }

  if (stats.cooldown?.length) {
    const cd = stats.cooldown;
    parts.push({
      label: labels.cooldown,
      value: cd.length > 1 && cd[0] !== cd[cd.length - 1] ? `${cd[0]}–${cd[cd.length - 1]}s` : `${cd[0]}s`,
    });
  }

  if (stats.manaCost?.length) {
    const cost = stats.manaCost;
    parts.push({
      label: labels.cost,
      value: cost.length > 1 && cost[0] !== cost[cost.length - 1] ? `${cost[0]}–${cost[cost.length - 1]}` : `${cost[0]}`,
      color: "text-cyan-300",
    });
  }

  if (stats.ccType) {
    parts.push({
      label: stats.ccType,
      value: stats.ccDuration ? `${stats.ccDuration}s` : "",
      color: "text-yellow-300",
    });
  }

  if (stats.range) {
    parts.push({ label: labels.range, value: `${stats.range}` });
  }

  const flags: string[] = [];
  if (stats.isDot) flags.push(labels.dot);
  if (stats.isAoe) flags.push(labels.aoe);
  if (stats.isOnHit) flags.push(labels.onHit);

  if (parts.length === 0 && flags.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-1">
      {parts.map((p, i) => (
        <span key={i} className={`text-[10px] ${p.color ?? "text-[var(--color-text-muted)]"}`}>
          {p.label}{p.value ? ` ${p.value}` : ""}
        </span>
      ))}
      {flags.map((f) => (
        <span key={f} className="text-[10px] px-1 py-0.5 rounded bg-[var(--color-border-default)]/50 text-[var(--color-text-muted)]">
          {f}
        </span>
      ))}
    </div>
  );
}

// ─── Wiki Ability Stats ─────────────────────────────────────────────────────

function WikiAbilityStats({ ability, labels }: { ability: AbilityEntry; labels: AbilityStatLabels }) {
  const pills: Array<{ label: string; value: string; color?: string }> = [];

  if (ability.cooldown) {
    pills.push({ label: labels.cooldown, value: ability.cooldown });
  }
  if (ability.cost) {
    pills.push({ label: labels.cost, value: ability.cost, color: "text-cyan-300" });
  }
  if (ability.range) {
    pills.push({ label: labels.range, value: ability.range });
  }
  if (ability.effectRadius) {
    pills.push({ label: labels.radius, value: ability.effectRadius });
  }
  if (ability.width) {
    pills.push({ label: labels.width, value: ability.width });
  }
  if (ability.speed) {
    pills.push({ label: labels.speed, value: ability.speed });
  }
  if (ability.castTime) {
    pills.push({ label: labels.cast, value: `${ability.castTime}s` });
  }
  if (ability.damageFormula) {
    pills.push({ label: labels.damage, value: ability.damageFormula, color: "text-purple-300" });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-1">
      {pills.map((p, i) => (
        <span key={i} className={`text-[10px] ${p.color ?? "text-[var(--color-text-muted)]"}`}>
          <span className="opacity-60">{p.label}</span> {p.value}
        </span>
      ))}
    </div>
  );
}

// ─── Base Stats Table ────────────────────────────────────────────────────────

function statAtLevel(base: number, growth: number, level: number): number {
  return base + growth * (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

type StatRow = {
  label: keyof BaseStatsCopy["rows"];
  base: keyof ChampionBaseStats;
  growth?: keyof ChampionBaseStats;
  decimals?: number;
  isPercent?: boolean;
  flat?: boolean; // no growth formula, just show base
};

type BaseStatsCopy = {
  title: string;
  stat: string;
  base: string;
  growth: string;
  at18: string;
  rows: {
    health: string;
    mana: string;
    hpRegen: string;
    mpRegen: string;
    armor: string;
    magicResist: string;
    attackDamage: string;
    attackSpeed: string;
    attackSpeedGrowth: string;
    attackRange: string;
    moveSpeed: string;
    missileSpeed: string;
  };
};

const STAT_ROWS: StatRow[] = [
  { label: "health", base: "baseHP", growth: "hpGrowth" },
  { label: "mana", base: "baseMP", growth: "mpGrowth" },
  { label: "hpRegen", base: "baseHPRegen", growth: "hpRegenGrowth", decimals: 1 },
  { label: "mpRegen", base: "baseMPRegen", growth: "mpRegenGrowth", decimals: 1 },
  { label: "armor", base: "baseArmor", growth: "armorGrowth", decimals: 1 },
  { label: "magicResist", base: "baseMR", growth: "mrGrowth", decimals: 1 },
  { label: "attackDamage", base: "baseAD", growth: "adGrowth", decimals: 1 },
  { label: "attackSpeed", base: "baseAS", decimals: 3 },
  { label: "attackSpeedGrowth", base: "asGrowth", decimals: 1, isPercent: true, flat: true },
  { label: "attackRange", base: "attackRange", flat: true },
  { label: "moveSpeed", base: "moveSpeed", flat: true },
  { label: "missileSpeed", base: "missileSpeed", flat: true },
];

function BaseStatsTable({
  stats,
  copy,
}: {
  stats: ChampionBaseStats;
  copy: BaseStatsCopy;
}) {
  const rows = STAT_ROWS.filter((row) => {
    const val = stats[row.base];
    return val != null && val !== 0;
  });

  return (
    <section className="glass-card p-4 mb-3 sm:mb-6">
      <h2 className="text-sm font-bold mb-3 border-l-2 border-[var(--color-neon-primary)] pl-2">
        {copy.title}
      </h2>
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-default)]">
              <th className="text-left text-[9px] sm:text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-2 sm:px-3 py-1.5">{copy.stat}</th>
              <th className="text-right text-[9px] sm:text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-2 sm:px-3 py-1.5">{copy.base}</th>
              <th className="text-right text-[9px] sm:text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-2 sm:px-3 py-1.5">{copy.growth}</th>
              <th className="text-right text-[9px] sm:text-[10px] font-medium text-[var(--color-neon-primary)]/70 uppercase tracking-wide px-2 sm:px-3 py-1.5">{copy.at18}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const base = stats[row.base] as number;
              const growth = row.growth ? (stats[row.growth] as number | undefined) : undefined;
              const dec = row.decimals ?? 0;

              let at18: number | undefined;
              if (!row.flat && !row.isPercent && growth != null) {
                at18 = statAtLevel(base, growth, 18);
              }

              return (
                <tr
                  key={row.label}
                  className="border-b border-[var(--color-border-default)]/30 last:border-0"
                >
                  <td className="px-2 sm:px-3 py-1 text-[11px] sm:text-xs text-[var(--color-text-secondary)]">{copy.rows[row.label]}</td>
                  <td className="px-2 sm:px-3 py-1 text-right tabular-nums font-medium">
                    {base.toFixed(dec)}{row.isPercent ? "%" : ""}
                  </td>
                  <td className="px-2 sm:px-3 py-1 text-right tabular-nums text-[var(--color-text-muted)] text-[11px]">
                    {growth != null && growth > 0 ? `+${growth}` : "—"}
                  </td>
                  <td className="px-2 sm:px-3 py-1 text-right tabular-nums text-[var(--color-neon-primary)] font-medium">
                    {at18 != null ? at18.toFixed(dec) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
