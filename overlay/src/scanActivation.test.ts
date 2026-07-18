import { describe, expect, it } from "vitest";
import { activationSource, resolveScanActivation } from "./scanActivation";
import { resolveRoundDelivery } from "./roundDelivery";

describe("scan activation", () => {
  it("activates the fast loop while a selection is open and the game is foreground", () => {
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "augment_selection",
        scanMode: "fast",
        selectionCompleted: false,
      }),
    ).toBe("fast-loop");
  });

  it("runs the ambient probe when a delivery window is pending", () => {
    const decision = resolveRoundDelivery({
      playerLevel: 3,
      isDead: false,
      completedRounds: 0,
      offerLatched: false,
    });
    expect(decision.scanMode).toBe("ambient");
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "in_game",
        scanMode: decision.scanMode,
        selectionCompleted: false,
      }),
    ).toBe("ambient-probe");
  });

  it("NEVER lets telemetry veto scanning: scanMode 'off' still probes in-game", () => {
    // The 01:52 death-triggered offer: round bookkeeping said nothing was
    // pending (scanMode 'off'), yet a real three-card surface was on screen.
    // Foreground + in-game must always at least probe so that surface latches.
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "in_game",
        scanMode: "off",
        selectionCompleted: false,
      }),
    ).toBe("ambient-probe");
  });

  it("never scans while another app is foreground", () => {
    for (const scanMode of ["fast", "ambient", "off"] as const) {
      expect(
        resolveScanActivation({
          gameWindowForeground: false,
          phase: "in_game",
          scanMode,
          selectionCompleted: false,
        }),
      ).toBe("none");
    }
  });

  it("restores scanning after game → Terminal → game with no stale state", () => {
    const base = {
      phase: "in_game" as const,
      scanMode: "off" as const,
      selectionCompleted: false,
    };
    const sequence = [true, false, true].map((gameWindowForeground) =>
      resolveScanActivation({ ...base, gameWindowForeground }),
    );
    // Even with scanMode 'off', the game being in front always probes.
    expect(sequence).toEqual(["ambient-probe", "none", "ambient-probe"]);
  });

  it("stops the fast loop only through selection completion, never level", () => {
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "augment_selection",
        scanMode: "ambient",
        selectionCompleted: true,
      }),
    ).toBe("none");
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "augment_selection",
        scanMode: "off",
        selectionCompleted: false,
      }),
    ).toBe("fast-loop");
  });
});

describe("activation source (dev diagnostics)", () => {
  it("labels how the tick reached its activation", () => {
    expect(activationSource("none", "in_game", "off")).toBe("none");
    expect(activationSource("fast-loop", "in_game", "fast")).toBe("telemetry-fast");
    expect(activationSource("ambient-probe", "in_game", "off")).toBe("visual-ambient");
    expect(activationSource("fast-loop", "augment_selection", "off")).toBe("selection-open");
  });
});
