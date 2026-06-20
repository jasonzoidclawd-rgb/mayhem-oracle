import abilitiesData from "../../../public/data/abilities.json";
import augmentsData from "../../../public/data/augments.json";
import championsData from "../../../public/data/champions.json";
import combosData from "../../../public/data/combos.json";
import itemsData from "../../../public/data/items.json";
import metaData from "../../../public/data/meta.json";
import patchNotesData from "../../../public/data/patch-notes.json";
import poolRulesData from "../../../public/data/pool-rules.json";

const PUBLIC_DATA_BY_FILE = {
  "abilities.json": abilitiesData,
  "augments.json": augmentsData,
  "champions.json": championsData,
  "combos.json": combosData,
  "items.json": itemsData,
  "meta.json": metaData,
  "patch-notes.json": patchNotesData,
  "pool-rules.json": poolRulesData,
} as const;

export type PublicDataFile = keyof typeof PUBLIC_DATA_BY_FILE;

export function loadPublicJson<T>(filename: PublicDataFile): T {
  return PUBLIC_DATA_BY_FILE[filename] as unknown as T;
}
