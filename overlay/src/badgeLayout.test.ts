import { describe, expect, it } from "vitest";
import {
  BADGE_CHIP_SIZE,
  cardFrameFromNameRect,
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

function toCss(rect: PhysicalRect, scaleFactor: number): PhysicalRect {
  return {
    x: rect.x / scaleFactor,
    y: rect.y / scaleFactor,
    width: rect.width / scaleFactor,
    height: rect.height / scaleFactor,
  };
}

/** Name-band rects matching CARD_NAME_REGIONS (y≈0.347, h≈0.083 of viewport). */
function nameBands(viewport: PhysicalRect): PhysicalRect[] {
  return [0.219, 0.414, 0.609].map((x) => ({
    x: Math.round(viewport.x + viewport.width * x),
    y: Math.round(viewport.y + viewport.height * 0.347),
    width: Math.round(viewport.width * 0.172),
    height: Math.round(viewport.height * 0.083),
  }));
}

describe("badge chip layout", () => {
  it("is a compact horizontal chip 28–36px tall", () => {
    expect(BADGE_CHIP_SIZE.height).toBeGreaterThanOrEqual(28);
    expect(BADGE_CHIP_SIZE.height).toBeLessThanOrEqual(36);
    expect(BADGE_CHIP_SIZE.width).toBeGreaterThan(BADGE_CHIP_SIZE.height);
  });

  it("derives a card frame that extends ABOVE the detected name band", () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 720 };
    const nameRect = { x: 280, y: 250, width: 220, height: 60 };
    const frame = cardFrameFromNameRect(nameRect, viewport);
    expect(frame.y).toBeLessThan(nameRect.y);
    expect(frame.y + frame.height).toBe(nameRect.y + nameRect.height);
    expect(frame.x).toBe(nameRect.x);
    // The frame never escapes the viewport top.
    const clipped = cardFrameFromNameRect({ ...nameRect, y: 10 }, viewport);
    expect(clipped.y).toBe(0);
  });

  for (const [label, viewport, scaleFactor] of [
    ["1280x720 @1x", { x: 0, y: 0, width: 1280, height: 720 }, 1],
    ["1920x1080 @1x", { x: 0, y: 0, width: 1920, height: 1080 }, 1],
    ["Windows 125% DPI (1280x720 css)", { x: 0, y: 0, width: 1600, height: 900 }, 1.25],
    ["Windows 150% DPI (1280x720 css)", { x: 0, y: 0, width: 1920, height: 1080 }, 1.5],
    ["2560x1440 Retina @2x", { x: 0, y: 0, width: 2560, height: 1440 }, 2],
  ] as const) {
    it(`places chips above every card frame at ${label}, clear of cards and controls`, () => {
      const avoidRects = overlayAvoidRects(viewport, scaleFactor);
      const bands = nameBands(viewport);
      const placements = bands.map((cardRect, index) =>
        placeBadgeAboveCard({
          cardRect,
          viewport,
          scaleFactor,
          avoidRects: [
            ...avoidRects,
            ...bands
              .filter((_, other) => other !== index)
              .map((rect) => cardFrameFromNameRect(rect, viewport)),
          ],
        }),
      );

      for (const [index, placement] of placements.entries()) {
        expect(placement).not.toBeNull();
        if (!placement) throw new Error("expected a safe chip placement");
        expect(placement.anchor).toBe("above");
        expect(placement.rect.width).toBe(BADGE_CHIP_SIZE.width);
        expect(placement.rect.height).toBe(BADGE_CHIP_SIZE.height);

        // Fully inside the CSS viewport.
        expect(placement.rect.x).toBeGreaterThanOrEqual(0);
        expect(placement.rect.y).toBeGreaterThanOrEqual(0);
        expect(placement.rect.x + placement.rect.width).toBeLessThanOrEqual(
          viewport.width / scaleFactor,
        );
        expect(placement.rect.y + placement.rect.height).toBeLessThanOrEqual(
          viewport.height / scaleFactor,
        );

        // OUTSIDE the card frame (art + name band), above its top edge.
        const cssFrame = toCss(cardFrameFromNameRect(bands[index], viewport), scaleFactor);
        expect(overlaps(placement.rect, cssFrame)).toBe(false);
        expect(placement.rect.y + placement.rect.height).toBeLessThan(cssFrame.y);

        // Clear of the raw name band, every reserved control (HUD, reroll,
        // central upgrade, calibration panel), and every OTHER card frame.
        expect(overlaps(placement.rect, toCss(bands[index], scaleFactor))).toBe(false);
        for (const avoid of avoidRects) {
          expect(overlaps(placement.rect, toCss(avoid, scaleFactor))).toBe(false);
        }
        for (const [other, band] of bands.entries()) {
          if (other === index) continue;
          expect(
            overlaps(placement.rect, toCss(cardFrameFromNameRect(band, viewport), scaleFactor)),
          ).toBe(false);
        }
      }

      // Chips of neighboring cards do not collide with each other.
      const rects = placements.map((placement) => placement!.rect);
      expect(overlaps(rects[0], rects[1])).toBe(false);
      expect(overlaps(rects[1], rects[2])).toBe(false);
    });
  }

  it("clamps the chip inside the viewport for a card hugging the right edge", () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 720 };
    const placement = placeBadgeAboveCard({
      cardRect: { x: 1180, y: 250, width: 100, height: 60 },
      viewport,
      scaleFactor: 1,
      avoidRects: overlayAvoidRects(viewport, 1),
    });
    expect(placement).not.toBeNull();
    if (!placement) throw new Error("expected a clamped chip placement");
    expect(placement.rect.x).toBeGreaterThanOrEqual(0);
    expect(placement.rect.x + placement.rect.width).toBeLessThanOrEqual(1280);
  });

  it("clamps the chip inside the viewport for a card hugging the left edge", () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 720 };
    const placement = placeBadgeAboveCard({
      cardRect: { x: 0, y: 250, width: 100, height: 60 },
      viewport,
      scaleFactor: 1,
      avoidRects: overlayAvoidRects(viewport, 1),
    });
    expect(placement).not.toBeNull();
    if (!placement) throw new Error("expected a clamped chip placement");
    expect(placement.rect.x).toBeGreaterThanOrEqual(0);
  });

  it("falls back to a side anchor when the top margin is too narrow", () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 720 };
    const nameRect = { x: 280, y: 70, width: 220, height: 60 };
    const placement = placeBadgeAboveCard({
      cardRect: nameRect,
      viewport,
      scaleFactor: 1,
      avoidRects: overlayAvoidRects(viewport, 1),
    });
    expect(placement).not.toBeNull();
    if (!placement) throw new Error("expected a side-anchored chip placement");
    expect(placement.anchor).toBe("side");
    const frame = cardFrameFromNameRect(nameRect, viewport);
    expect(overlaps(placement.rect, frame)).toBe(false);
  });

  it("withholds the chip entirely when no safe position exists", () => {
    // A viewport barely larger than the card leaves no safe space anywhere.
    const viewport = { x: 0, y: 0, width: 240, height: 200 };
    const placement = placeBadgeAboveCard({
      cardRect: { x: 4, y: 60, width: 232, height: 138 },
      viewport,
      scaleFactor: 1,
      avoidRects: overlayAvoidRects(viewport, 1),
    });
    expect(placement).toBeNull();
  });

  it("never intersects the reroll / central-upgrade control zones", () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 720 };
    const avoidRects = overlayAvoidRects(viewport, 1);
    // The reroll zone sits at the lower center; a low-slung card frame forces
    // the placer to negotiate around it.
    const placement = placeBadgeAboveCard({
      cardRect: { x: 530, y: 560, width: 220, height: 60 },
      viewport,
      scaleFactor: 1,
      avoidRects,
    });
    if (placement) {
      for (const avoid of avoidRects) {
        expect(overlaps(placement.rect, avoid)).toBe(false);
      }
    }
  });

  it("anchors to the detected rectangle, not a fixed position", () => {
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
    if (!first || !shifted) throw new Error("expected safe chip placements");
    expect(shifted.rect.y).toBeGreaterThan(first.rect.y);
    expect(first.left).not.toContain("%");
  });
});
