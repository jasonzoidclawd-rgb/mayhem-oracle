import { describe, expect, it } from "vitest";
import {
  COMPACT_BADGE_SIZE,
  overlayAvoidRects,
  placeBadgeAboveCard,
} from "./badgeLayout";
import type { PhysicalRect } from "./calibration";

function overlaps(left: PhysicalRect, right: PhysicalRect): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

describe("detected-card badge layout", () => {
  for (const [label, viewport, scaleFactor, cards] of [
    [
      "1280x720",
      { x: 0, y: 0, width: 1280, height: 720 },
      1,
      [
        { x: 280, y: 250, width: 220, height: 60 },
        { x: 530, y: 250, width: 220, height: 60 },
        { x: 780, y: 250, width: 220, height: 60 },
      ],
    ],
    [
      "2560x1440 Retina",
      { x: 0, y: 0, width: 2560, height: 1440 },
      2,
      [
        { x: 560, y: 500, width: 440, height: 120 },
        { x: 1060, y: 500, width: 440, height: 120 },
        { x: 1560, y: 500, width: 440, height: 120 },
      ],
    ],
  ] as const) {
    it(`places compact badges above detected cards at ${label}`, () => {
      const avoidRects = overlayAvoidRects(viewport, scaleFactor);
      const placements = cards.map((cardRect) =>
        placeBadgeAboveCard({ cardRect, viewport, scaleFactor, avoidRects }),
      );

      for (const [index, placement] of placements.entries()) {
        expect(placement).not.toBeNull();
        if (!placement) throw new Error("expected a safe badge placement");
        const card = cards[index];
        expect(placement.rect.y + placement.rect.height).toBeLessThanOrEqual(card.y / scaleFactor - 6);
        expect(placement.rect.x).toBeGreaterThanOrEqual(0);
        expect(placement.rect.y).toBeGreaterThanOrEqual(0);
        expect(placement.rect.x + placement.rect.width).toBeLessThanOrEqual(
          viewport.width / scaleFactor,
        );
        expect(placement.rect.y + placement.rect.height).toBeLessThanOrEqual(
          viewport.height / scaleFactor,
        );
        expect(avoidRects.map((rect) => ({
          x: rect.x / scaleFactor,
          y: rect.y / scaleFactor,
          width: rect.width / scaleFactor,
          height: rect.height / scaleFactor,
        })).every((rect) => !overlaps(placement.rect, rect))).toBe(true);
      }

      expect(COMPACT_BADGE_SIZE.width).toBeLessThan(120);
      const firstPlacement = placements[0];
      expect(firstPlacement).not.toBeNull();
      if (!firstPlacement) throw new Error("expected a first badge placement");
      expect(firstPlacement.left).not.toContain("%");
    });
  }

  it("uses the detected rectangle rather than a fixed below-card anchor", () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 720 };
    const first = placeBadgeAboveCard({
      cardRect: { x: 280, y: 250, width: 220, height: 60 },
      viewport,
      scaleFactor: 1,
      avoidRects: overlayAvoidRects(viewport, 1),
    });
    const shifted = placeBadgeAboveCard({
      cardRect: { x: 280, y: 310, width: 220, height: 60 },
      viewport,
      scaleFactor: 1,
      avoidRects: overlayAvoidRects(viewport, 1),
    });

    expect(first).not.toBeNull();
    expect(shifted).not.toBeNull();
    if (!first || !shifted) throw new Error("expected safe badge placements");
    expect(shifted.rect.y).toBeGreaterThan(first.rect.y);
    expect(first.rect.y + first.rect.height).toBeLessThan(250);
  });
});
