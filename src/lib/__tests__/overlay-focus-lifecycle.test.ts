import { describe, expect, test } from "vitest";
import { shouldAcceptOcrResult } from "../../../overlay/src/overlay-state";

describe("overlay focus lifecycle", () => {
  test("rejects OCR results after focus loss or OCR stop invalidates the run", () => {
    expect(
      shouldAcceptOcrResult({
        startedRunId: 4,
        currentRunId: 5,
        ocrActive: false,
        leagueFocused: false,
      }),
    ).toBe(false);

    expect(
      shouldAcceptOcrResult({
        startedRunId: 4,
        currentRunId: 4,
        ocrActive: true,
        leagueFocused: true,
      }),
    ).toBe(true);
  });
});
