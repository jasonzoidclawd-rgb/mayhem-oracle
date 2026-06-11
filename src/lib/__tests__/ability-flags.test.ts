import { describe, expect, test } from "vitest";
import abilitiesData from "../../../public/data/abilities.json";

type FlaggedStats = {
  projectile?: boolean;
  knockup?: boolean;
  knockback?: boolean;
  recast?: boolean;
  heal?: boolean;
  shield?: boolean;
  dash?: boolean;
  longRange?: boolean;
};

type AbilityRow = { key: string; stats?: FlaggedStats };

const ability = (slug: string, key: string): AbilityRow | undefined => {
  const profiles = (
    abilitiesData as unknown as {
      profiles: Record<string, { abilities: AbilityRow[] }>;
    }
  ).profiles;
  return profiles[slug]?.abilities.find((a) => a.key === key);
};

describe("ability flags (26.12 ability-augment fit inputs)", () => {
  test("jinx Q and W are projectile abilities", () => {
    expect(Boolean(ability("jinx", "Q")?.stats?.projectile)).toBe(true);
    expect(Boolean(ability("jinx", "W")?.stats?.projectile)).toBe(true);
  });

  test("alistar Q is a knockup", () => {
    expect(Boolean(ability("alistar", "Q")?.stats?.knockup)).toBe(true);
  });

  test("lux Q is a projectile", () => {
    expect(Boolean(ability("lux", "Q")?.stats?.projectile)).toBe(true);
  });

  test("garen E is not a projectile", () => {
    expect(Boolean(ability("garen", "E")?.stats?.projectile)).toBe(false);
  });
});
