import { afterEach, describe, expect, test } from "vitest";
import { patchFromMetaJson, resolveCurrentPatch } from "../../../scripts/telemetry/load_bigquery";

const ORIGINAL_PATCH = process.env.CURRENT_PATCH;

afterEach(() => {
  if (ORIGINAL_PATCH === undefined) {
    delete process.env.CURRENT_PATCH;
  } else {
    process.env.CURRENT_PATCH = ORIGINAL_PATCH;
  }
});

describe("telemetry patch resolution", () => {
  test("reads the patch from public metadata", () => {
    expect(patchFromMetaJson(JSON.stringify({ patch: "26.13" }))).toBe("26.13");
  });

  test("rejects missing or malformed metadata patches", () => {
    expect(() => patchFromMetaJson(JSON.stringify({}))).toThrow(/malformed telemetry patch/);
    expect(() => patchFromMetaJson(JSON.stringify({ patch: "latest" }))).toThrow(/malformed telemetry patch/);
  });

  test("keeps CURRENT_PATCH as a validated override", async () => {
    process.env.CURRENT_PATCH = "26.14";
    await expect(resolveCurrentPatch("/does/not/matter.json")).resolves.toBe("26.14");
  });
});
