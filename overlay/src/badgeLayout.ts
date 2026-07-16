import { cssRectFromPhysicalRect, type PhysicalRect } from "./calibration";

export interface BadgeSize {
  width: number;
  height: number;
}

export interface BadgePlacement {
  left: string;
  top: string;
  rect: PhysicalRect;
}

export const COMPACT_BADGE_SIZE: BadgeSize = {
  width: 104,
  height: 86,
};

const BADGE_GAP = 6;

function right(rect: PhysicalRect): number {
  return rect.x + rect.width;
}

function bottom(rect: PhysicalRect): number {
  return rect.y + rect.height;
}

function overlaps(left: PhysicalRect, rightRect: PhysicalRect): boolean {
  return !(
    right(left) <= rightRect.x ||
    right(rightRect) <= left.x ||
    bottom(left) <= rightRect.y ||
    bottom(rightRect) <= left.y
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * Reserve only fixed UI controls. Badge positions themselves always come from
 * the native card rectangle returned with the current OCR scan.
 */
export function overlayAvoidRects(
  viewport: PhysicalRect,
  scaleFactor: number,
): PhysicalRect[] {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  return [
    // Status dot/startup HUD band.
    { x: viewport.x, y: viewport.y, width: viewport.width, height: 44 * scale },
    // Development calibration panel. It is absent from production, but badges
    // must also remain safe while diagnostics are enabled.
    {
      x: viewport.x + Math.max(0, viewport.width - 360 * scale),
      y: viewport.y + 24 * scale,
      width: 360 * scale,
      height: 150 * scale,
    },
    // Reroll and central upgrade controls at the lower center of the offer.
    {
      x: viewport.x + viewport.width / 2 - 120 * scale,
      y: viewport.y + viewport.height - 132 * scale,
      width: 240 * scale,
      height: 112 * scale,
    },
    {
      x: viewport.x + viewport.width / 2 - 110 * scale,
      y: viewport.y + viewport.height * 0.64,
      width: 220 * scale,
      height: 104 * scale,
    },
  ];
}

/**
 * Place a compact badge immediately above a detected card rectangle. Candidate
 * positions are clamped to the viewport and shifted horizontally/vertically
 * only when a reserved HUD, diagnostic panel, or game control would overlap.
 */
export function placeBadgeAboveCard({
  cardRect,
  viewport,
  scaleFactor,
  avoidRects = [],
  size = COMPACT_BADGE_SIZE,
}: {
  cardRect: PhysicalRect;
  viewport: PhysicalRect;
  scaleFactor: number;
  avoidRects?: PhysicalRect[];
  size?: BadgeSize;
}): BadgePlacement | null {
  const divisor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const cssViewport: PhysicalRect = {
    x: 0,
    y: 0,
    width: viewport.width / divisor,
    height: viewport.height / divisor,
  };
  const cssCard = cssRectFromPhysicalRect(cardRect, divisor, viewport);
  const cssAvoidRects = avoidRects.map((rect) => cssRectFromPhysicalRect(rect, divisor, viewport));
  const idealX = cssCard.x + (cssCard.width - size.width) / 2;
  const idealY = cssCard.y - size.height - BADGE_GAP;
  const xCandidates = [
    idealX,
    cssCard.x,
    cssCard.x + cssCard.width - size.width,
  ];
  const yCandidates = [
    idealY,
    ...cssAvoidRects.map((rect) => rect.y - size.height - BADGE_GAP),
    idealY - 12,
    cssViewport.y,
  ];

  for (const rawY of yCandidates) {
    const y = clamp(rawY, cssViewport.y, bottom(cssViewport) - size.height);
    if (y + size.height + BADGE_GAP > cssCard.y) continue;
    for (const rawX of xCandidates) {
      const x = clamp(rawX, cssViewport.x, right(cssViewport) - size.width);
      const candidate = { x, y, width: size.width, height: size.height };
      if (cssAvoidRects.every((rect) => !overlaps(candidate, rect))) {
        return {
          left: `${Math.round(x)}px`,
          top: `${Math.round(y)}px`,
          rect: candidate,
        };
      }
    }
  }

  // Do not render a badge if the viewport cannot provide a safe position. A
  // missing recommendation is safer than covering a game control or HUD.
  return null;
}
