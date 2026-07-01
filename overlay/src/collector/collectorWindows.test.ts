import { describe, expect, it } from "vitest";
import type { CollectorSnapshot } from "./CollectorStatus";
import {
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
});
