import { describe, expect, it } from "vitest";
import {
  extractMatchContext,
  findRiotFieldPaths,
  summarizeRiotMatchSchema,
} from "@/lib/riot/transform";
import { defaultMatchRegionalRoute } from "@/lib/riot/routing";

const match = {
  metadata: {
    matchId: "NA1_123",
    participants: ["secret-puuid"],
  },
  info: {
    gameCreation: 1,
    gameDuration: 1200,
    gameEndTimestamp: 2,
    gameId: 123,
    gameMode: "CHERRY",
    gameName: "teambuilder-match-123",
    gameStartTimestamp: 1,
    gameType: "MATCHED_GAME",
    gameVersion: "16.13.1",
    mapId: 30,
    queueId: 2400,
    participants: [
      {
        puuid: "secret-puuid",
        riotIdGameName: "Do Not Persist",
        riotIdTagline: "NA1",
        summonerName: "Do Not Persist",
        participantId: 1,
        participantIndex: 0,
        championId: 222,
        championName: "Jinx",
        teamId: 100,
        win: true,
        item0: 1001,
        item1: 2003,
        item2: 0,
        item3: 0,
        item4: 0,
        item5: 0,
        item6: 0,
        summoner1Id: 4,
        summoner2Id: 7,
        playerAugment1: 12345,
        playerAugment2: 23456,
        playerAugment3: 0,
        playerAugment4: 34567,
        perks: {
          styles: [{ selections: [{ perk: 8112 }] }],
        },
      },
    ],
  },
};

const zeroAugmentMatch = {
  ...match,
  info: {
    ...match.info,
    participants: [
      {
        ...match.info.participants[0],
        playerAugment1: 0,
        playerAugment2: 0,
        playerAugment3: 0,
        playerAugment4: 0,
        playerAugment5: 0,
        playerAugment6: 0,
      },
    ],
  },
};

describe("Riot Match-V5 transform", () => {
  it("summarizes match context without identity-bearing fields", () => {
    const context = extractMatchContext(match);

    expect(context.matchId).toBe("NA1_123");
    expect(context.queueId).toBe(2400);
    expect(context.gameMode).toBe("CHERRY");
    expect(context.mapId).toBe(30);
    expect(context.participants).toEqual([
      {
        participantId: 1,
        participantIndex: 0,
        championId: 222,
        championName: "Jinx",
        teamId: 100,
        win: true,
        items: [1001, 2003, 0, 0, 0, 0, 0],
        summonerSpellIds: [4, 7],
        selectedAugmentCandidates: [
          { path: "info.participants[0].playerAugment1", value: 12345 },
          { path: "info.participants[0].playerAugment2", value: 23456 },
          { path: "info.participants[0].playerAugment4", value: 34567 },
        ],
      },
    ]);
    expect(JSON.stringify(context)).not.toContain("secret-puuid");
    expect(JSON.stringify(context)).not.toContain("Do Not Persist");
  });

  it("finds candidate augment and mode-specific field paths", () => {
    expect(findRiotFieldPaths(match, ["augment", "cherry"]).map((entry) => entry.path))
      .toEqual([
        "info.gameMode",
        "info.participants[0].playerAugment1",
        "info.participants[0].playerAugment2",
        "info.participants[0].playerAugment3",
        "info.participants[0].playerAugment4",
      ]);
  });

  it("summarizes selected augment candidates separately from normal perks", () => {
    const summary = summarizeRiotMatchSchema(match);

    expect(summary.selectedAugmentFieldPaths).toEqual([
      "info.participants[0].playerAugment1",
      "info.participants[0].playerAugment2",
      "info.participants[0].playerAugment3",
      "info.participants[0].playerAugment4",
    ]);
    expect(summary.perkFieldPaths).toEqual([
      "info.participants[0].perks",
      "info.participants[0].perks.styles[0].selections[0].perk",
    ]);
  });

  it("distinguishes selected augment fields from selected augment values", () => {
    const context = extractMatchContext(zeroAugmentMatch);
    const summary = summarizeRiotMatchSchema(zeroAugmentMatch);

    expect(context.participants[0].selectedAugmentCandidates).toEqual([]);
    expect(summary.selectedAugmentFieldPaths).toEqual([
      "info.participants[0].playerAugment1",
      "info.participants[0].playerAugment2",
      "info.participants[0].playerAugment3",
      "info.participants[0].playerAugment4",
      "info.participants[0].playerAugment5",
      "info.participants[0].playerAugment6",
    ]);
    expect(summary.hasSelectedAugmentFieldPaths).toBe(true);
    expect(summary.hasSelectedAugmentValues).toBe(false);
  });

  it("reports selected augment values only when candidate values are nonzero", () => {
    const summary = summarizeRiotMatchSchema({
      ...zeroAugmentMatch,
      info: {
        ...zeroAugmentMatch.info,
        participants: [
          {
            ...zeroAugmentMatch.info.participants[0],
            playerAugment1: 45678,
          },
        ],
      },
    });

    expect(summary.hasSelectedAugmentFieldPaths).toBe(true);
    expect(summary.hasSelectedAugmentValues).toBe(true);
  });

  it("keeps mission evidence out of selected augment fields", () => {
    const summary = summarizeRiotMatchSchema({
      ...zeroAugmentMatch,
      info: {
        ...zeroAugmentMatch.info,
        participants: [
          {
            ...zeroAugmentMatch.info.participants[0],
            missions: { playerScore0: 12 },
            playerMissionStat: 99,
          },
        ],
      },
    });

    expect(summary.selectedAugmentFieldPaths).not.toContain("info.participants[0].missions");
    expect(summary.selectedAugmentFieldPaths).not.toContain(
      "info.participants[0].playerMissionStat",
    );
    expect(summary.modeSpecificFieldPaths).toContain("info.participants[0].missions");
    expect(summary.modeSpecificFieldPaths).toContain("info.participants[0].playerMissionStat");
  });
});

describe("Riot route defaults", () => {
  it("uses the sea regional route for SEA platform match-v5 probes", () => {
    expect(defaultMatchRegionalRoute("tw2")).toBe("sea");
    expect(defaultMatchRegionalRoute("sg2")).toBe("sea");
    expect(defaultMatchRegionalRoute("vn2")).toBe("sea");
    expect(defaultMatchRegionalRoute("na1")).toBe("americas");
  });
});
