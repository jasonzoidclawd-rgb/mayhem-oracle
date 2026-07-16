export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorInfo extends PhysicalRect {
  scaleFactor: number;
}

export interface NormalizedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayCalibration {
  monitor: MonitorInfo;
  gameWindow: PhysicalRect | null;
  viewport: PhysicalRect;
  mode: "league-window" | "borderless-monitor-fallback" | "monitor-fallback";
  warnings: string[];
}

export const CARD_NAME_REGIONS: NormalizedRegion[] = [
  { x: 0.219, y: 0.347, w: 0.172, h: 0.083 },
  { x: 0.414, y: 0.347, w: 0.172, h: 0.083 },
  { x: 0.609, y: 0.347, w: 0.172, h: 0.083 },
];

const FULLSCREEN_TOLERANCE_PX = 24;
const FULLSCREEN_TOLERANCE_RATIO = 0.02;

function edgeTolerance(monitor: PhysicalRect): number {
  return Math.max(
    FULLSCREEN_TOLERANCE_PX,
    Math.round(Math.max(monitor.width, monitor.height) * FULLSCREEN_TOLERANCE_RATIO),
  );
}

function right(rect: PhysicalRect): number {
  return rect.x + rect.width;
}

function bottom(rect: PhysicalRect): number {
  return rect.y + rect.height;
}

export function rectApproximatelyMatchesMonitor(
  monitor: PhysicalRect,
  rect: PhysicalRect,
): boolean {
  const tolerance = edgeTolerance(monitor);

  return (
    Math.abs(monitor.x - rect.x) <= tolerance &&
    Math.abs(monitor.y - rect.y) <= tolerance &&
    Math.abs(right(monitor) - right(rect)) <= tolerance &&
    Math.abs(bottom(monitor) - bottom(rect)) <= tolerance
  );
}

export function selectOverlayViewport(
  monitor: MonitorInfo,
  gameWindow: PhysicalRect | null,
): OverlayCalibration {
  if (!gameWindow) {
    return {
      monitor,
      gameWindow: null,
      viewport: rectOnly(monitor),
      mode: "monitor-fallback",
      warnings: ["League window not detected; using monitor bounds."],
    };
  }

  if (rectApproximatelyMatchesMonitor(monitor, gameWindow)) {
    return {
      monitor,
      gameWindow,
      viewport: rectOnly(monitor),
      mode: "borderless-monitor-fallback",
      warnings: [],
    };
  }

  return {
    monitor,
    gameWindow,
    viewport: rectOnly(gameWindow),
    mode: "league-window",
    warnings: [],
  };
}

export function physicalRectForNormalizedRegion(
  region: NormalizedRegion,
  viewport: PhysicalRect,
): PhysicalRect {
  const x = viewport.x + Math.round(region.x * viewport.width);
  const y = viewport.y + Math.round(region.y * viewport.height);
  const width = Math.round(region.w * viewport.width);
  const height = Math.round(region.h * viewport.height);

  return {
    x,
    y,
    width: Math.max(0, Math.min(width, right(viewport) - x)),
    height: Math.max(0, Math.min(height, bottom(viewport) - y)),
  };
}

export function cssRectFromPhysicalRect(
  rect: PhysicalRect,
  scaleFactor: number,
  origin: Pick<PhysicalRect, "x" | "y"> = { x: 0, y: 0 },
): PhysicalRect {
  const divisor = safeScaleFactor(scaleFactor);

  return {
    x: Math.round((rect.x - origin.x) / divisor),
    y: Math.round((rect.y - origin.y) / divisor),
    width: Math.round(rect.width / divisor),
    height: Math.round(rect.height / divisor),
  };
}

export function physicalPointFromCssPoint(
  point: { x: number; y: number },
  scaleFactor: number,
): { x: number; y: number } {
  const multiplier = safeScaleFactor(scaleFactor);

  return {
    x: Math.round(point.x * multiplier),
    y: Math.round(point.y * multiplier),
  };
}

function rectOnly(rect: PhysicalRect): PhysicalRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function safeScaleFactor(scaleFactor: number): number {
  return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
}
