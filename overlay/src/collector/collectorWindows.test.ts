import { describe, expect, it } from "vitest";
import type { CollectorSnapshot } from "./CollectorStatus";
import {
  COLLECTOR_CONTROLS_WINDOW_OPTIONS,
  CONSENT_WINDOW_OPTIONS,
  overlayShouldIgnoreMouseEvents,
  shouldShowCollectorControlsWindow,
  shouldShowConsentWindow,
} from "./collectorWindows";

function status(consent: CollectorSnapshot["consent"]): CollectorSnapshot {
  return {
    consent,
    paused: false,
    activeGame: false,
    exportedToday: 0,
    dailyLimit: 100,
    queuedBatches: 0,
  };
}

describe("collector window routing", () => {
  it("routes pending consent to the bounded consent window only", () => {
    const pending = status("pending");

    expect(shouldShowConsentWindow(pending)).toBe(true);
    expect(shouldShowCollectorControlsWindow(pending)).toBe(false);
  });

  it("routes accepted and declined choices to bounded collector controls", () => {
    expect(shouldShowConsentWindow(status("accepted"))).toBe(false);
    expect(shouldShowCollectorControlsWindow(status("accepted"))).toBe(true);

    expect(shouldShowConsentWindow(status("declined"))).toBe(false);
    expect(shouldShowCollectorControlsWindow(status("declined"))).toBe(true);
  });

  it("keeps the full-screen overlay click-through unless controls are explicitly open", () => {
    expect(overlayShouldIgnoreMouseEvents({ coachOpen: false })).toBe(true);
    expect(overlayShouldIgnoreMouseEvents({ coachOpen: true })).toBe(false);
  });

  it("keeps consent in a normal bounded focusable window", () => {
    expect(CONSENT_WINDOW_OPTIONS.fullscreen).toBe(false);
    expect(CONSENT_WINDOW_OPTIONS.transparent).toBe(false);
    expect(CONSENT_WINDOW_OPTIONS.decorations).toBe(true);
    expect(CONSENT_WINDOW_OPTIONS.alwaysOnTop).toBe(false);
    expect(CONSENT_WINDOW_OPTIONS.focus).toBe(true);
    expect(CONSENT_WINDOW_OPTIONS.focusable).toBe(true);
  });

  it("keeps collector controls bounded and explicit", () => {
    expect(COLLECTOR_CONTROLS_WINDOW_OPTIONS.fullscreen).toBe(false);
    expect(COLLECTOR_CONTROLS_WINDOW_OPTIONS.width).toBeLessThanOrEqual(320);
    expect(COLLECTOR_CONTROLS_WINDOW_OPTIONS.height).toBeLessThanOrEqual(220);
    expect(COLLECTOR_CONTROLS_WINDOW_OPTIONS.focus).toBe(false);
    expect(COLLECTOR_CONTROLS_WINDOW_OPTIONS.focusable).toBe(true);
  });
});
