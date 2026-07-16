import { describe, expect, it } from "vitest";
import { developmentSurfaceVisible } from "./productionSurfaces";

describe("production overlay surface gate", () => {
  it("renders no fixture, calibration, OCR, or raw-focus surface in production", () => {
    expect(developmentSurfaceVisible(false)).toBe(false);
  });

  it("permits development diagnostics only in a development build", () => {
    expect(developmentSurfaceVisible(true)).toBe(true);
  });
});
