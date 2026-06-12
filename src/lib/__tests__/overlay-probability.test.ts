import { describe, expect, test } from "vitest";
import * as probability from "../../../overlay/src/scoring/probability";

describe("overlay probability — 26.12 EV layer", () => {
  test("expectedValue is monotonic in draw probability", () => {
    expect(probability.expectedValue(80, 0.5, 1)).toBeGreaterThan(
      probability.expectedValue(80, 0.25, 1),
    );
    expect(probability.expectedValue(80, 0, 1)).toBe(0);
  });

  test("round 4 weighs heavier than round 1 (locked-in picks)", () => {
    expect(probability.ROUND_WEIGHT[4]).toBeGreaterThan(probability.ROUND_WEIGHT[1]);
    expect(probability.expectedValue(80, 0.5, 4)).toBeGreaterThan(
      probability.expectedValue(80, 0.5, 1),
    );
  });

  test("dead set-path machinery is gone", () => {
    const mod = probability as Record<string, unknown>;
    expect(mod.calculateSetPaths).toBeUndefined();
    expect(mod.parseSets).toBeUndefined();
  });
});
