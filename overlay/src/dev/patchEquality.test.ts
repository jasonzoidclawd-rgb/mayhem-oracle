/**
 * BUG-2 regression: a failed patch resolution must never satisfy patch equality.
 *
 * `aramggSource.ts` used the literal string "unknown" when the ARAMGG changelog
 * did not parse. That value flowed into the champion-dataset ownership guard,
 * where two INDEPENDENT failures compared equal:
 *
 *     "unknown" === "unknown"  ->  true
 *
 * so a champion dataset fetched under one unresolved patch could satisfy the
 * guard for a different unresolved patch, admitting cross-patch statistics onto
 * a badge. The same hole exists for `null`, which the ownership token already
 * allowed on both sides.
 *
 * A sentinel that equals itself is not a fail-closed sentinel.
 */
import { describe, expect, it } from "vitest";
import { championOwnershipCurrent, patchesMatch, type ChampionOwnershipToken } from "./championDataset";

const token = (patch: string | null): ChampionOwnershipToken => ({
  gameEpoch: 1,
  championGeneration: 4,
  championId: "142",
  requestId: 7,
  patch,
});

describe("patchesMatch", () => {
  it("matches two identical resolved patches", () => {
    expect(patchesMatch("16.13", "16.13")).toBe(true);
  });

  it("rejects two different resolved patches", () => {
    expect(patchesMatch("16.13", "16.14")).toBe(false);
  });

  it("never lets an unresolved patch match anything, including itself", () => {
    expect(patchesMatch(null, null)).toBe(false);
    expect(patchesMatch(null, "16.13")).toBe(false);
    expect(patchesMatch("16.13", null)).toBe(false);
  });
});

describe("championOwnershipCurrent — unresolved patch cannot publish", () => {
  it("still accepts a fully-matching token with a resolved patch", () => {
    expect(championOwnershipCurrent(token("16.13"), token("16.13"))).toBe(true);
  });

  it("rejects when both sides failed to resolve a patch", () => {
    // Previously true: null === null. Cross-patch data could publish.
    expect(championOwnershipCurrent(token(null), token(null))).toBe(false);
  });

  it("rejects when only one side resolved", () => {
    expect(championOwnershipCurrent(token(null), token("16.13"))).toBe(false);
    expect(championOwnershipCurrent(token("16.13"), token(null))).toBe(false);
  });
});
