import { mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const overlayRoot = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(overlayRoot, "..", "public", "data");
const targetRoot = path.resolve(overlayRoot, "public", "data");
const abilityTargetRoot = path.join(targetRoot, "abilities");

function readJson(filename) {
  return JSON.parse(readFileSync(path.join(sourceRoot, filename), "utf-8"));
}

function compactChampion(champion) {
  return {
    slug: champion.slug,
    name: champion.name,
    name_zh_TW: champion.name_zh_TW,
    name_zh_CN: champion.name_zh_CN,
    name_ja: champion.name_ja,
    name_ko: champion.name_ko,
    win_rate: champion.win_rate,
    tags: champion.tags,
    kit_tags: champion.kit_tags,
    baseStats: champion.baseStats,
  };
}

function compactAugment(augment) {
  return {
    slug: augment.slug,
    name: augment.name,
    name_zh_TW: augment.name_zh_TW,
    rarity: augment.rarity,
    win_rate: augment.win_rate,
    wikiDescription: augment.wikiDescription,
    set: augment.set,
    kit_tags: augment.kit_tags,
  };
}

function compactCombo(combo) {
  return {
    champion: combo.champion,
    augment: combo.augment,
    tier: combo.tier,
  };
}

async function main() {
  const champions = readJson("champions.json").champions ?? [];
  const augments = readJson("augments.json").augments ?? [];
  const combos = readJson("combos.json").combos ?? [];
  const abilities = readJson("abilities.json").profiles ?? {};
  const poolRules = readJson("pool-rules.json");

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(abilityTargetRoot, { recursive: true });

  await Promise.all([
    writeFile(
      path.join(targetRoot, "champions.json"),
      JSON.stringify({ champions: champions.map(compactChampion) }),
    ),
    writeFile(
      path.join(targetRoot, "augments.json"),
      JSON.stringify({ augments: augments.map(compactAugment) }),
    ),
    writeFile(
      path.join(targetRoot, "combos.json"),
      JSON.stringify({ combos: combos.map(compactCombo) }),
    ),
    writeFile(
      path.join(targetRoot, "pool-rules.json"),
      JSON.stringify(poolRules),
    ),
  ]);

  await Promise.all(
    Object.entries(abilities).map(([slug, profile]) =>
      writeFile(path.join(abilityTargetRoot, `${slug}.json`), JSON.stringify(profile)),
    ),
  );
}

await main();
