import { describe, expect, test } from "vitest";
import { computeOracleScore as computeWebScore, type OracleScoreInput as WebScoreInput, type ScoredAugment as WebScoredAugment } from "../scoring/oracle-score";
import { computeOracleScore as computeOverlayScore } from "../../../overlay/src/scoring/oracle-score";
import type { AbilityProfile } from "../types";

const physicalProfile: AbilityProfile = {
  damageType: "physical",
  attackType: "ranged",
  playstyle: { damage: 4, durability: 2, crowdControl: 4, mobility: 2, utility: 1 },
  abilities: [],
};

const magicProfile: AbilityProfile = {
  damageType: "magic",
  attackType: "melee",
  playstyle: { damage: 4, durability: 3, crowdControl: 2, mobility: 2, utility: 2 },
  abilities: [],
};

function expectOverlayToMatchWeb(input: WebScoreInput) {
  const web = computeWebScore(input);
  const overlay = computeOverlayScore(input as Parameters<typeof computeOverlayScore>[0]);

  expect(overlay.breakdown).toEqual(web.breakdown);
  expect(overlay.total).toBe(web.total);
}

describe("overlay oracle scoring parity", () => {
  test("matches web scoring for description-only profile text", () => {
    expectOverlayToMatchWeb({
      augment: {
        slug: "description-only",
        name: "Description Only",
        rarity: "gold",
        win_rate: 54,
        icon: "icon.png",
        description: "Gain attack damage. Ranged champions apply crowd control effects more often.",
      },
      championWinRate: 56,
      abilityProfile: physicalProfile,
      mechanicalInteraction: { type: "synergy", strength: 3 },
    });
  });

  test("matches web scoring for malformed generated-data values", () => {
    expectOverlayToMatchWeb({
      augment: {
        slug: "bad-data",
        name: "Bad Data",
        rarity: "diamond",
        win_rate: Number.NaN,
        icon: "icon.png",
        wikiDescription: "Gain attack damage.",
      } as unknown as WebScoredAugment,
      championWinRate: Number.POSITIVE_INFINITY,
      comboTier: "SS" as WebScoreInput["comboTier"],
      abilityProfile: magicProfile,
    });
  });
});
