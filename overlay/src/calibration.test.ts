import { describe, expect, test } from "vitest";
import {
  BADGE_ANCHORS,
  CARD_NAME_REGIONS,
  cssPointFromNormalizedAnchor,
  cssRectFromPhysicalRect,
  physicalPointFromCssPoint,
  physicalRectForNormalizedRegion,
  selectOverlayViewport,
} from "./calibration";

describe("overlay calibration", () => {
  test("uses monitor bounds for a 1920x1080 borderless League window", () => {
    const calibration = selectOverlayViewport(
      { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 },
      { x: 0, y: 0, width: 1920, height: 1080 },
    );

    expect(calibration.mode).toBe("borderless-monitor-fallback");
    expect(calibration.viewport).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(calibration.warnings).toEqual([]);
  });

  test("supports 2560x1080 ultrawide borderless without clipping card regions", () => {
    const viewport = { x: 0, y: 0, width: 2560, height: 1080 };

    const rects = CARD_NAME_REGIONS.map((region) =>
      physicalRectForNormalizedRegion(region, viewport),
    );

    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(2560);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1080);
    }
  });

  test("converts physical calibration bounds to logical CSS pixels using scale factor", () => {
    const cssRect = cssRectFromPhysicalRect(
      { x: 0, y: 0, width: 2560, height: 1440 },
      1.25,
    );

    expect(cssRect).toEqual({ x: 0, y: 0, width: 2048, height: 1152 });
    expect(physicalPointFromCssPoint({ x: 1024, y: 576 }, 1.25)).toEqual({
      x: 1280,
      y: 720,
    });
  });

  test("falls back to the monitor when the League window is unavailable", () => {
    const calibration = selectOverlayViewport(
      { x: 0, y: 0, width: 2560, height: 1080, scaleFactor: 1 },
      null,
    );

    expect(calibration.mode).toBe("monitor-fallback");
    expect(calibration.viewport).toEqual({ x: 0, y: 0, width: 2560, height: 1080 });
    expect(calibration.warnings).toContain("League window not detected; using monitor bounds.");
  });

  test("positions rendered badges in logical CSS pixels from normalized anchors", () => {
    const middle = cssPointFromNormalizedAnchor(
      BADGE_ANCHORS[1],
      { x: 0, y: 0, width: 2560, height: 1440 },
      1.25,
    );

    expect(middle).toEqual({ left: "1024px", top: "714px" });
  });
});
