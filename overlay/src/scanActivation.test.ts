import { describe, expect, it } from "vitest";
import { resolveScanActivation } from "./scanActivation";
import { resolveRoundDelivery } from "./roundDelivery";

describe("scan activation", () => {
  it("activates capture when the game is foreground with a validated card screen open", () => {
    // GameClient foreground + latched offer surface → the fast loop runs.
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "augment_selection",
        scanMode: "fast",
        selectionCompleted: false,
      }),
    ).toBe("fast-loop");
  });

  it("runs the ambient probe when rounds are pending and the game is foreground", () => {
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
    // Activation is a pure function of FRESH inputs: the tick where Terminal
    // was front cannot leave anything behind that suppresses the tick where
    // the game is front again.
    const base = {
      phase: "in_game" as const,
      scanMode: "ambient" as const,
      selectionCompleted: false,
    };
    const sequence = [true, false, true].map((gameWindowForeground) =>
      resolveScanActivation({ ...base, gameWindowForeground }),
    );
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
    // scanMode is irrelevant while a selection is open — the latched offer
    // owns the loop.
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
