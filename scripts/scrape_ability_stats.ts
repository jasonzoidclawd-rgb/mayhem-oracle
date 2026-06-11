/**
 * Mayhem Oracle — Ability Stats Scraper
 * ======================================
 * Fetches detailed ability data (ratios, cooldowns, costs, damage types, CC)
 * from CommunityDragon champion .bin.json files and enriches abilities.json.
 *
 * Usage:
 *   npx tsx scripts/scrape_ability_stats.ts
 *
 * Source: https://raw.communitydragon.org/latest/game/data/characters/{id}/{id}.bin.json
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(__dirname, "..", "public", "data");
const ABILITIES_PATH = join(DATA_DIR, "abilities.json");
const CHAMPIONS_PATH = join(DATA_DIR, "champions.json");

const CDRAGON_BASE =
  "https://raw.communitydragon.org/latest/game/data/characters";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AbilityStats {
  baseDamage?: number[]; // per rank [rank1..rank5]
  apRatio?: number;
  adRatio?: number; // bonus AD ratio
  totalAdRatio?: number;
  hpRatio?: number;
  cooldown?: number[]; // per rank
  manaCost?: number[]; // per rank
  range?: number;
  ccType?: string; // stun, root, slow, knockup, etc
  ccDuration?: number;
  damageType?: "magic" | "physical" | "true";
  isAoe?: boolean;
  isDot?: boolean;
  isOnHit?: boolean;
  maxRank?: number;
  tags?: string[]; // e.g. Trait_ImmobilizingCCSpell, Trait_Ultimate
  // 26.12 ability-augment fit flags (set only when true)
  projectile?: boolean;
  knockback?: boolean;
  knockup?: boolean;
  recast?: boolean;
  heal?: boolean;
  shield?: boolean;
  dash?: boolean;
  longRange?: boolean;
}

interface SpellCalcPart {
  __type: string;
  mCoefficient?: number;
  mStatIndex?: number;
  mDataValue?: string;
  mStat?: number | string;
}

interface SpellDataValue {
  name: string;
  values: number[];
  __type: string;
}

interface SpellData {
  ObjectName?: string;
  mSpell?: {
    mSpellTags?: string[];
    mEffectAmount?: Array<{ value?: number[]; __type: string }>;
    DataValues?: SpellDataValue[];
    mSpellCalculations?: Record<
      string,
      { mFormulaParts?: SpellCalcPart[]; __type: string }
    >;
    mCoefficient?: number;
    mCoefficient2?: number;
    cooldownTime?: number[];
    mana?: number[];
    castRange?: number[];
    castRangeDisplayOverride?: number[];
    castRadius?: number[];
    missileSpeed?: number;
    mLineWidth?: number;
  };
}

interface CharacterRecordBinEntry {
  __type: "CharacterRecord";
  spellNames?: string[];
  mCharacterPassiveSpell?: string;
}

interface DDragonChampionData {
  data: Record<
    string,
    {
      passive?: { description?: string };
      spells?: Array<{ description?: string; tooltip?: string }>;
    }
  >;
}

interface AbilitiesFile {
  profiles: Record<
    string,
    {
      abilities?: Array<{
        key: string;
        description?: string;
        stats?: AbilityStats;
      }>;
    }
  >;
}

type ChampionBin = Record<string, SpellData | CharacterRecordBinEntry | unknown>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dedup(arr: number[]): number[] {
  // Remove trailing duplicates of last value and leading duplicates of first
  // Return values for ranks 1-5 (indices 1-5 in 7-element arrays)
  if (arr.length >= 7) return arr.slice(1, 6);
  if (arr.length >= 5) return arr.slice(0, 5);
  return arr;
}

function uniqueCosts(arr: number[]): number[] {
  const vals = dedup(arr);
  // If all same, return single value
  if (vals.every((v) => v === vals[0])) return [vals[0]];
  return vals;
}

function extractRatios(
  spell: SpellData["mSpell"],
): { apRatio: number; adRatio: number; totalAdRatio: number; hpRatio: number } {
  let apRatio = 0;
  let adRatio = 0;
  let totalAdRatio = 0;
  let hpRatio = 0;

  if (!spell) return { apRatio, adRatio, totalAdRatio, hpRatio };

  const calcs = spell.mSpellCalculations ?? {};
  // Look for the primary damage calculation (TotalDamage, EDamageCalc, etc)
  const damageCalcKey = Object.keys(calcs).find(
    (k) =>
      /total.*damage|damage.*calc|^damage$/i.test(k) ||
      k === "TotalDamage" ||
      k.endsWith("DamageCalc"),
  ) ?? Object.keys(calcs)[0];

  if (damageCalcKey) {
    const calc = calcs[damageCalcKey];
    const parts = calc.mFormulaParts ?? [];
    const dvMap = new Map(
      (spell.DataValues ?? [])
        .filter((d) => d.values)
        .map((d) => [d.name, d.values]),
    );

    for (const part of parts) {
      if (part.__type === "StatByCoefficientCalculationPart") {
        // mStat enum: undefined/0 = AP, 1 = bonus AD, 2 = total AD, 9 = crit
        const stat = part.mStat ?? part.mStatIndex;
        if (stat === undefined || stat === 0) {
          apRatio += part.mCoefficient ?? 0;
        } else if (stat === 1) {
          // Bonus AD
          adRatio += part.mCoefficient ?? 0;
        } else if (stat === 2) {
          // Total AD
          totalAdRatio += part.mCoefficient ?? 0;
        }
        // stat 9 = crit damage, skip
      } else if (part.__type === "StatByNamedDataValueCalculationPart") {
        // Ratio stored in DataValues
        const dvName = part.mDataValue ?? "";
        const vals = dvMap.get(dvName);
        const ratio = vals ? vals[1] ?? vals[0] : 0;
        const nameLower = dvName.toLowerCase();
        if (nameLower.includes("ap")) {
          apRatio += ratio;
        } else if (nameLower.includes("totalad")) {
          totalAdRatio += ratio;
        } else if (
          nameLower.includes("ad") ||
          nameLower.includes("bonusad")
        ) {
          adRatio += ratio;
        } else if (nameLower.includes("hp") || nameLower.includes("health")) {
          hpRatio += ratio;
        }
      }
    }
  }

  // Fallback: top-level mCoefficient is AP ratio — but ONLY if the spell
  // has a damage calculation or base damage (otherwise it's often a slow/buff multiplier)
  const hasDamageCalc = Object.keys(calcs).some(k => /damage/i.test(k));
  const hasBaseDamage = (spell.DataValues ?? []).some(d => /base.*damage|spell.*base/i.test(d.name));
  const hasEffectDamage = (spell.mEffectAmount ?? []).some(e => e.value && e.value.some(v => v > 0));
  if (apRatio === 0 && adRatio === 0 && totalAdRatio === 0 && spell.mCoefficient &&
      (hasDamageCalc || hasBaseDamage || hasEffectDamage)) {
    apRatio = spell.mCoefficient;
  }

  return {
    apRatio: round(apRatio),
    adRatio: round(adRatio),
    totalAdRatio: round(totalAdRatio),
    hpRatio: round(hpRatio),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function extractBaseDamage(spell: SpellData["mSpell"]): number[] | undefined {
  if (!spell) return undefined;

  // Look in DataValues for BaseDamage / SpellBaseDamage
  const dv = (spell.DataValues ?? []).find((d) =>
    /base.*damage|spell.*base.*damage/i.test(d.name),
  );
  if (dv?.values) return dedup(dv.values);

  // Fallback: first mEffectAmount with values
  const eff = (spell.mEffectAmount ?? []).find(
    (e) => e.value && e.value.some((v) => v > 0),
  );
  if (eff?.value) return dedup(eff.value);

  return undefined;
}

function detectCC(
  tags: string[],
  dvs: SpellDataValue[],
  desc: string,
): { ccType?: string; ccDuration?: number } {
  const tagStr = tags.join(" ").toLowerCase();
  const descLower = desc.toLowerCase();
  let ccType: string | undefined;

  if (tagStr.includes("immobilizing")) {
    // Determine specific type from DataValues or description
    if (descLower.includes("stun")) ccType = "stun";
    else if (descLower.includes("root") || descLower.includes("snare"))
      ccType = "root";
    else if (descLower.includes("knock")) ccType = "knockup";
    else if (descLower.includes("charm")) ccType = "charm";
    else if (descLower.includes("suppress")) ccType = "suppress";
    else if (descLower.includes("taunt")) ccType = "taunt";
    else if (descLower.includes("fear")) ccType = "fear";
    else ccType = "immobilize";
  } else if (descLower.includes("slow")) {
    ccType = "slow";
  } else if (descLower.includes("ground")) {
    ccType = "ground";
  } else if (descLower.includes("silence")) {
    ccType = "silence";
  }

  let ccDuration: number | undefined;
  const durDV = dvs.find((d) =>
    /stun.*dur|root.*dur|cc.*dur|charm.*dur|snare.*dur|knock.*dur|fear.*dur|taunt.*dur/i.test(
      d.name,
    ),
  );
  if (durDV?.values) {
    ccDuration = durDV.values[1] ?? durDV.values[0];
  }
  // Also check slow duration
  if (!ccDuration) {
    const slowDur = dvs.find((d) => /slow.*dur/i.test(d.name));
    if (slowDur?.values) ccDuration = slowDur.values[1] ?? slowDur.values[0];
  }

  return { ccType, ccDuration };
}

function detectDamageType(
  spell: SpellData["mSpell"],
  ratios: ReturnType<typeof extractRatios>,
  desc: string,
): "magic" | "physical" | "true" | undefined {
  const d = desc.toLowerCase();
  if (d.includes("true damage")) return "true";
  if (d.includes("physical damage")) return "physical";
  if (d.includes("magic damage")) return "magic";

  // Infer from ratios
  if (ratios.apRatio > 0 && ratios.adRatio === 0 && ratios.totalAdRatio === 0)
    return "magic";
  if (ratios.adRatio > 0 || ratios.totalAdRatio > 0) return "physical";
  return undefined;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function fetchChampionBin(
  champId: string,
): Promise<ChampionBin | null> {
  const url = `${CDRAGON_BASE}/${champId}/${champId}.bin.json`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.log(`  ✗ ${champId}: HTTP ${resp.status}`);
      return null;
    }
    return (await resp.json()) as ChampionBin;
  } catch {
    console.log(`  ✗ ${champId}: fetch error`);
    return null;
  }
}

async function fetchDDragonVersion(): Promise<string> {
  const resp = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
  if (!resp.ok) throw new Error(`Failed to fetch DDragon version list: ${resp.status}`);
  const versions = await resp.json() as string[];
  if (!versions.length) throw new Error("DDragon version list is empty");
  return versions[0];
}

// DDragon for ability descriptions (has tooltip with readable text)
async function fetchDDragonSpells(
  champKey: string,
  version: string,
): Promise<{
  passive: { description: string };
  spells: Array<{ description: string; tooltip: string }>;
} | null> {
  try {
    const resp = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${champKey}.json`,
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as DDragonChampionData;
    return data.data[champKey];
  } catch {
    return null;
  }
}

async function main() {
  const champions = JSON.parse(readFileSync(CHAMPIONS_PATH, "utf-8")).champions;
  const abilities = JSON.parse(
    readFileSync(ABILITIES_PATH, "utf-8"),
  ) as AbilitiesFile;
  const profiles = abilities.profiles;

  const ddVersion = await fetchDDragonVersion();
  console.log(`Using DDragon version: ${ddVersion}`);

  // DDragon champion list for key mapping (e.g. "FiddleSticks" vs "Fiddlesticks")
  const ddResp = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/champion.json`,
  );
  const ddData = (await ddResp.json()) as DDragonChampionData;
  const ddChamps = ddData.data as Record<
    string,
    { id?: string; key?: string; name?: string }
  >;
  // Build slug → DDragon key map
  const slugToDDKey = new Map<string, string>();
  for (const [key] of Object.entries(ddChamps)) {
    const slug = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    slugToDDKey.set(slug, key);
  }

  let enriched = 0;
  let failed = 0;

  for (const champ of champions) {
    const slug = champ.slug as string;
    const cdId = slug.replace(/-/g, "");
    const profile = profiles[slug];
    if (!profile) {
      console.log(`  skip ${slug}: no ability profile`);
      continue;
    }

    const bin = await fetchChampionBin(cdId);
    if (!bin) {
      failed++;
      continue;
    }

    // Find CharacterRecord for spell mapping
    let spellNames: string[] = [];
    let passivePath = "";
    for (const v of Object.values(bin)) {
      if (
        typeof v === "object" &&
        v !== null &&
        "__type" in v &&
        v.__type === "CharacterRecord"
      ) {
        const record = v as CharacterRecordBinEntry;
        spellNames = record.spellNames ?? [];
        passivePath = record.mCharacterPassiveSpell ?? "";
        break;
      }
    }

    if (spellNames.length < 4) {
      console.log(`  skip ${slug}: no spell mapping`);
      failed++;
      continue;
    }

    // Get DDragon descriptions for damage type detection
    const ddKey = slugToDDKey.get(cdId);
    const ddSpells = ddKey ? await fetchDDragonSpells(ddKey, ddVersion) : null;
    const ddDescs = [
      ddSpells?.passive?.description ?? "",
      ...(ddSpells?.spells ?? []).map((s) => s.description ?? ""),
    ];

    // Map: P, Q, W, E, R
    // Normalize paths — CDragon paths use exact casing from bin keys
    const abilityKeys = ["passive", "Q", "W", "E", "R"];

    for (let i = 0; i < 5; i++) {
      const key = abilityKeys[i];
      const existingAbility = profile.abilities?.find(
        (a) => a.key === key,
      );
      if (!existingAbility) continue;

      // Find the spell data in the bin
      let spellData: SpellData | null = null;

      if (i === 0) {
        // Passive — find by path
        spellData = bin[passivePath] as SpellData | null;
      } else {
        // Q/W/E/R — spellNames[i-1] is like "BrandQAbility/BrandQ"
        const spellName = spellNames[i - 1];
        // Try exact path
        const pathPrefix = `Characters/${cdId[0].toUpperCase() + cdId.slice(1)}/Spells/`;
        const fullPath = pathPrefix + spellName;
        spellData = bin[fullPath] as SpellData | null;

        // If not found, search by ObjectName suffix
        if (!spellData) {
          const suffix = spellName.split("/").pop() ?? "";
          for (const [k, v] of Object.entries(bin)) {
            if (
              k &&
              typeof v === "object" &&
              v !== null &&
              "ObjectName" in v &&
              (v as SpellData).ObjectName === suffix
            ) {
              spellData = v as SpellData;
              break;
            }
          }
        }
      }

      const spell = spellData?.mSpell;
      if (!spell && i > 0) {
        // Try alternate casing for path
        continue;
      }

      const stats: AbilityStats = {};
      const desc = ddDescs[i] || existingAbility.description || "";

      if (spell) {
        // Base damage
        const baseDmg = extractBaseDamage(spell);
        if (baseDmg && baseDmg.some((v) => v > 0)) stats.baseDamage = baseDmg;

        // Ratios
        const ratios = extractRatios(spell);
        if (ratios.apRatio > 0) stats.apRatio = ratios.apRatio;
        if (ratios.adRatio > 0) stats.adRatio = ratios.adRatio;
        if (ratios.totalAdRatio > 0) stats.totalAdRatio = ratios.totalAdRatio;
        if (ratios.hpRatio > 0) stats.hpRatio = ratios.hpRatio;

        // Cooldown
        if (spell.cooldownTime) {
          const cd = dedup(spell.cooldownTime).filter((v) => v > 0);
          if (cd.length > 0) stats.cooldown = cd;
        }

        // Mana cost
        if (spell.mana) {
          const cost = uniqueCosts(spell.mana).filter((v) => v > 0);
          if (cost.length > 0) stats.manaCost = cost;
        }

        // Range
        const range =
          spell.castRangeDisplayOverride?.[1] ?? spell.castRange?.[1];
        if (range && range > 0 && range < 10000) stats.range = range;

        // CC
        const ccInfo = detectCC(
          spell.mSpellTags ?? [],
          spell.DataValues ?? [],
          desc,
        );
        if (ccInfo.ccType) stats.ccType = ccInfo.ccType;
        if (ccInfo.ccDuration) stats.ccDuration = round(ccInfo.ccDuration);

        // Damage type
        const dmgType = detectDamageType(spell, extractRatios(spell), desc);
        if (dmgType) stats.damageType = dmgType;

        // Tags
        if (spell.mSpellTags?.length) stats.tags = spell.mSpellTags;

        // Detect DoT from DataValues or description
        if (
          (spell.DataValues ?? []).some((d) =>
            /burn|bleed|dot|tick|poison/i.test(d.name),
          ) ||
          /over\s+\d+\s+seconds?|per\s+second|burn|bleed|poison/i.test(desc)
        ) {
          stats.isDot = true;
        }

        // Detect AoE
        if (
          (spell.castRadius?.[1] ?? 0) > 0 ||
          /area|enemies?\s+(?:near|around|within|hit)|all\s+(?:nearby|surrounding)/i.test(
            desc,
          )
        ) {
          stats.isAoe = true;
        }

        // Detect on-hit
        if (
          /on[- ]?hit|basic\s+attack|auto[- ]?attack|next\s+attack/i.test(desc)
        ) {
          stats.isOnHit = true;
        }
      }

      // 26.12 ability-augment fit flags — bin spell traits first (high precision),
      // narrow description fallback second. missileSpeed is NOT a signal: internal
      // vfx missiles exist on non-skillshots (garen E/R, alistar Q).
      const tagStr = (spell?.mSpellTags ?? []).join(" ");
      if (
        tagStr.includes("Trait_Ranged_StopsFirstHit") ||
        tagStr.includes("Trait_Ranged_Piercing") ||
        ((spell?.missileSpeed ?? 0) > 0 &&
          (spell?.mLineWidth ?? 0) > 0 &&
          (stats.range ?? 0) >= 450) ||
        /\b(skillshot|projectile|missile|rocket|arrow|bolt)\b/i.test(desc)
      ) {
        stats.projectile = true;
      }
      if (
        stats.ccType === "knockup" ||
        /knock(?:s|ed)?[- ]?up|airborne|into the air/i.test(desc)
      ) {
        stats.knockup = true;
      }
      if (
        tagStr.includes("Trait_KnockBack") ||
        /knock(?:s|ed|ing)?[- ]?(?:back|away|aside)/i.test(desc)
      ) {
        stats.knockback = true;
      }
      if (
        tagStr.includes("Trait_RecastOrReplaceSpell") ||
        /recast|reactivat/i.test(desc)
      ) {
        stats.recast = true;
      }
      if (
        tagStr.includes("Trait_ActiveHeal") ||
        /\bheals?\b|\bhealing\b|restor(?:e|es|ing)\s+(?:\d|health)|regenerat/i.test(desc)
      ) {
        stats.heal = true;
      }
      if (tagStr.includes("Trait_Shield") || /\bshields?\b|\bshielding\b/i.test(desc)) {
        stats.shield = true;
      }
      if (
        tagStr.includes("Trait_PlayerSelectedDashDirection") ||
        /\b(dash(?:es)?|leaps?|lunges?|blinks?|vaults?)\b/i.test(desc)
      ) {
        stats.dash = true;
      }
      if ((stats.range ?? 0) >= 900) {
        stats.longRange = true;
      }

      // Merge stats into existing ability
      existingAbility.stats = stats;
    }

    enriched++;
    if (enriched % 20 === 0) console.log(`  ${enriched} champions enriched...`);
  }

  // Write back
  abilities.scraped_at = new Date().toISOString();
  writeFileSync(ABILITIES_PATH, JSON.stringify(abilities, null, 2) + "\n", "utf-8");
  console.log(`\nDone: ${enriched} enriched, ${failed} failed`);
  console.log(`Wrote ${ABILITIES_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
