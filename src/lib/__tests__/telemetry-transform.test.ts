import { describe, expect, test } from "vitest";
import type { SafeMatchExport } from "../contracts/telemetry";
import { transformBatch } from "../telemetry/transform";

function match(overrides: Partial<SafeMatchExport> = {}): SafeMatchExport {
  return {
    schemaVersion: 1,
    gameHash: "game-abcdef",
    patch: "26.12",
    queueId: 2400,
    durationSeconds: 1200,
    collectedAt: "2026-06-13T12:00:00Z",
    source: "owned-history",
    participants: Array.from({ length: 10 }, (_, i) => ({
      slot: `s${i}`,
      team: i < 5 ? (100 as const) : (200 as const),
      championSlug: "brand",
      augmentSlugs: ["chain-reaction"],
      itemIds: ["3020"],
      won: i < 5,
      stats: { kills: 1, deaths: 2, assists: 3, damageToChampions: 1000 },
    })),
    ...overrides,
  };
}

const opts = { currentPatch: "26.12", rawRef: "batches/u1/123.json", ingestedAt: "2026-06-13T18:00:00Z" };

describe("transformBatch quarantine rules", () => {
  test("projects a clean match into matches + 10 participants", () => {
    const result = transformBatch([match()], opts);
    expect(result.matches).toHaveLength(1);
    expect(result.participants).toHaveLength(10);
    expect(result.quarantine).toHaveLength(0);
    expect(result.participants[0].champion_slug).toBe("brand");
    expect(result.participants[0].patch).toBe("26.12");
  });

  test("quarantines matches under eight minutes", () => {
    const result = transformBatch([match({ durationSeconds: 300 })], opts);
    expect(result.matches).toHaveLength(0);
    expect(result.participants).toHaveLength(0);
    expect(result.quarantine).toEqual([
      expect.objectContaining({ reason: "short_match", game_hash: "game-abcdef" }),
    ]);
  });

  test("quarantines a patch mismatch", () => {
    const result = transformBatch([match({ patch: "26.11" })], opts);
    expect(result.quarantine[0].reason).toBe("invalid_patch");
    expect(result.matches).toHaveLength(0);
  });

  test("keeps a confident contributor round and quarantines an ambiguous one", () => {
    const withRounds = match({
      contributorRounds: [
        { round: 1, offeredAugmentSlugs: ["a", "b", "c"], selectedAugmentSlug: "b", ocrConfidence: 0.95 },
        { round: 2, offeredAugmentSlugs: ["d", "e", "f"], selectedAugmentSlug: "e", ocrConfidence: 0.3 },
        { round: 3, offeredAugmentSlugs: ["g", "h", "i"], ocrConfidence: 0.9 },
      ],
    });
    const result = transformBatch([withRounds], opts);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].selected_augment_slug).toBe("b");
    // round 2 (low confidence) and round 3 (no selection) → quarantine
    const ocr = result.quarantine.filter((q) => q.reason === "ambiguous_ocr");
    expect(ocr).toHaveLength(2);
  });

  test("the match still loads even when its rounds are ambiguous", () => {
    const withBadRounds = match({
      contributorRounds: [
        { round: 1, offeredAugmentSlugs: ["a", "b"], ocrConfidence: 0.1 },
      ],
    });
    const result = transformBatch([withBadRounds], opts);
    expect(result.matches).toHaveLength(1);
    expect(result.rounds).toHaveLength(0);
    expect(result.quarantine.some((q) => q.reason === "ambiguous_ocr")).toBe(true);
  });

  test("partitions a mixed batch correctly", () => {
    const result = transformBatch(
      [match({ gameHash: "good-1" }), match({ gameHash: "short-1", durationSeconds: 60 }), match({ gameHash: "good-2" })],
      opts,
    );
    expect(result.matches.map((m) => m.game_hash)).toEqual(["good-1", "good-2"]);
    expect(result.quarantine.map((q) => q.game_hash)).toEqual(["short-1"]);
    expect(result.participants).toHaveLength(20);
  });
});
