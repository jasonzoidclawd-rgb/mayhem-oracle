import { describe, expect, it, vi } from "vitest";
import type { CollectorSnapshot } from "./CollectorStatus";

const windowMocks = vi.hoisted(() => ({
  close: vi.fn(),
  getByLabel: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class MockWebviewWindow {
    static getByLabel(...args: unknown[]) {
      return windowMocks.getByLabel(...args);
    }
  },
  getCurrentWebviewWindow: () => ({
    close: windowMocks.close,
    label: "overlay",
  }),
}));

import {
  COLLECTOR_CONTROLS_WINDOW_OPTIONS,
  CONSENT_WINDOW_OPTIONS,
  closeWindow,
  overlayShouldIgnoreMouseEvents,
  resolveCollectorWindowVisibility,
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
  it("hides a native collector window before closing it", async () => {
    const calls: string[] = [];
    windowMocks.hide.mockImplementation(async () => calls.push("hide"));
    windowMocks.close.mockImplementation(async () => calls.push("close"));
    windowMocks.getByLabel.mockResolvedValue({
      close: windowMocks.close,
      hide: windowMocks.hide,
    });

    await closeWindow("collector-controls");

    expect(calls).toEqual(["hide", "close"]);
  });

  it("routes pending consent to the bounded consent window only", () => {
    const pending = status("pending");

    expect(shouldShowConsentWindow(pending)).toBe(true);
    expect(shouldShowCollectorControlsWindow(pending)).toBe(false);
  });

  it("never shows collector controls after accepted or declined consent", () => {
    expect(shouldShowConsentWindow(status("accepted"))).toBe(false);
    expect(shouldShowCollectorControlsWindow(status("accepted"))).toBe(false);

    expect(shouldShowConsentWindow(status("declined"))).toBe(false);
    expect(shouldShowCollectorControlsWindow(status("declined"))).toBe(false);
  });

  it.each([
    { collectorStatus: null, controlsVisible: false },
    { collectorStatus: null, controlsVisible: true },
    { collectorStatus: status("pending"), controlsVisible: false },
    { collectorStatus: status("pending"), controlsVisible: true },
    { collectorStatus: status("accepted"), controlsVisible: false },
    { collectorStatus: status("accepted"), controlsVisible: true },
    { collectorStatus: status("declined"), controlsVisible: false },
    { collectorStatus: status("declined"), controlsVisible: true },
  ])(
    "never shows collector controls for status $collectorStatus.consent with controlsVisible=$controlsVisible",
    ({ collectorStatus, controlsVisible }) => {
      expect(resolveCollectorWindowVisibility({
        status: collectorStatus,
        controlsVisible,
      })).toEqual({
        consentWindow: collectorStatus?.consent === "pending" && controlsVisible,
        collectorControlsWindow: false,
      });
    },
  );

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
