import { cssRectFromPhysicalRect, type PhysicalRect } from "./calibration";

export interface BadgeSize {
  width: number;
  height: number;
}

export interface BadgePlacement {
  left: string;
  top: string;
  rect: PhysicalRect;
  /** "above" = centered over the card frame; "side" = compact anchor outside it. */
  anchor: "above" | "side";
}

/**
 * Compact horizontal chip (e.g. `[S · 53.3884% WR]`) rendered OUTSIDE the card
 * artwork. Height must stay within 28–36 CSS px.
 */
export const BADGE_CHIP_SIZE: BadgeSize = {
  width: 168,
  height: 32,
};

const BADGE_GAP = 6;

/**
 * The native detected rectangle is the card's NAME band (the OCR crop region,
 * normalized y ≈ 0.347 of the viewport). The card frame extends ABOVE the name
 * band — champion / ability / quest icon art — so a chip anchored to the name
 * band alone would sit inside the artwork. The icon band is a fixed fraction
 * of the viewport height in the augment-selection layout.
 */
export const CARD_ICON_BAND_VIEWPORT_RATIO = 0.08;

/**
 * Derive the card frame (name band + the icon/artwork band above it) from the
 * detected name-band rectangle, in the same physical coordinate space.
 */
export function cardFrameFromNameRect(
  nameRect: PhysicalRect,
  viewport: PhysicalRect,
): PhysicalRect {
  const iconBand = Math.round(viewport.height * CARD_ICON_BAND_VIEWPORT_RATIO);
  const top = Math.max(viewport.y, nameRect.y - iconBand);
  return {
    x: nameRect.x,
    y: top,
    width: nameRect.width,
    height: nameRect.height + (nameRect.y - top),
  };
}

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
    // Development calibration panel (bottom-left, above the HUD). It is absent
    // from production, but badges must also remain safe while diagnostics are
    // enabled. It deliberately sits below the card frames so it can never
    // contest the chip band above them.
    {
      x: viewport.x,
      y: viewport.y + Math.max(0, viewport.height - (48 + 150) * scale),
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
 * Place a compact chip immediately above the card FRAME derived from the
 * detected name-band rectangle. The chip never overlaps the card frame (art,
 * icons, name, description), reserved HUD/game controls, or any rect in
 * `avoidRects` (callers pass the other card frames there so a fallback anchor
 * cannot cover a neighboring card). When the space above the frame is too
 * narrow, a compact side anchor OUTSIDE the card is used instead; if no safe
 * position exists the chip is withheld entirely.
 */
export function placeBadgeAboveCard({
  cardRect,
  viewport,
  scaleFactor,
  avoidRects = [],
  size = BADGE_CHIP_SIZE,
}: {
  /** Native detected name-band rectangle (physical pixels). */
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
  const frame = cardFrameFromNameRect(cardRect, viewport);
  const cssFrame = cssRectFromPhysicalRect(frame, divisor, viewport);
  const cssAvoidRects = avoidRects.map((rect) => cssRectFromPhysicalRect(rect, divisor, viewport));
  const blockers = [cssFrame, ...cssAvoidRects];

  const fits = (candidate: PhysicalRect): boolean =>
    candidate.x >= cssViewport.x &&
    candidate.y >= cssViewport.y &&
    right(candidate) <= right(cssViewport) &&
    bottom(candidate) <= bottom(cssViewport) &&
    blockers.every((rect) => !overlaps(candidate, rect));

  // Preferred: horizontally centered immediately above the card frame, then
  // frame-aligned variants, then nudged upward toward the viewport top.
  const idealX = cssFrame.x + (cssFrame.width - size.width) / 2;
  const aboveXCandidates = [
    idealX,
    cssFrame.x,
    cssFrame.x + cssFrame.width - size.width,
  ].map((x) => clamp(x, cssViewport.x, right(cssViewport) - size.width));
  const idealY = cssFrame.y - size.height - BADGE_GAP;
  const aboveYCandidates = [
    idealY,
    ...cssAvoidRects.map((rect) => rect.y - size.height - BADGE_GAP),
    cssViewport.y,
  ];

  for (const rawY of aboveYCandidates) {
    const y = clamp(rawY, cssViewport.y, bottom(cssViewport) - size.height);
    // "Above" placements must keep the chip fully clear of the frame top.
    if (y + size.height + BADGE_GAP > cssFrame.y) continue;
    for (const x of aboveXCandidates) {
      const candidate = { x, y, width: size.width, height: size.height };
      if (fits(candidate)) {
        return {
          left: `${Math.round(x)}px`,
          top: `${Math.round(y)}px`,
          rect: candidate,
          anchor: "above",
        };
      }
    }
  }

  // Insufficient room above: compact side anchor OUTSIDE the card frame.
  const sideYCandidates = [
    cssFrame.y,
    cssFrame.y + (cssFrame.height - size.height) / 2,
  ];
  for (const rawY of sideYCandidates) {
    const y = clamp(rawY, cssViewport.y, bottom(cssViewport) - size.height);
    for (const x of [
      cssFrame.x - size.width - BADGE_GAP, // left of the card
      right(cssFrame) + BADGE_GAP, // right of the card
    ]) {
      const candidate = { x, y, width: size.width, height: size.height };
      if (fits(candidate)) {
        return {
          left: `${Math.round(x)}px`,
          top: `${Math.round(y)}px`,
          rect: candidate,
          anchor: "side",
        };
      }
    }
  }

  // Do not render a badge if the viewport cannot provide a safe position. A
  // missing recommendation is safer than covering the card or a game control.
  return null;
}
