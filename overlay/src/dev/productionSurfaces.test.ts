import { describe, expect, it } from "vitest";
import { developmentSurfaceVisible, devPanelsVisible } from "./productionSurfaces";
import { gameOverlayVisible } from "../overlayVisibility";
import { resolveOverlayFixtureMode } from "./fixtureMode";

const devPanelsVisibleWithOptIn = devPanelsVisible as (input: {
  devBuild: boolean;
  gameOverlayIsVisible: boolean;
  diagnosticsOptIn: boolean;
}) => boolean;

describe("production overlay surface gate", () => {
  it("renders no fixture, calibration, OCR, or raw-focus surface in production", () => {
    expect(developmentSurfaceVisible(false)).toBe(false);
  });

  it("permits development diagnostics only in a development build", () => {
    expect(developmentSurfaceVisible(true)).toBe(true);
  });
});

describe("development panel gate", () => {
  it("may render dev panels while the GameClient is topmost", () => {
    expect(
      devPanelsVisibleWithOptIn({
        devBuild: true,
        gameOverlayIsVisible: true,
        diagnosticsOptIn: true,
      }),
    ).toBe(true);
  });

  it("hides every dev panel while another app is topmost", () => {
    // The 18:53:36 leak: calibration + fixture panels over Terminal. The
    // canonical predicate is false there, so the gate must be false too —
    // regardless of dev build or any fixture flag.
    expect(
      devPanelsVisibleWithOptIn({
        devBuild: true,
        gameOverlayIsVisible: false,
        diagnosticsOptIn: true,
      }),
    ).toBe(false);
  });

  it("never renders dev panels in a production build", () => {
    expect(
      devPanelsVisibleWithOptIn({
        devBuild: false,
        gameOverlayIsVisible: true,
        diagnosticsOptIn: true,
      }),
    ).toBe(false);
    expect(
      devPanelsVisibleWithOptIn({
        devBuild: false,
        gameOverlayIsVisible: false,
        diagnosticsOptIn: true,
      }),
    ).toBe(false);
  });

  it("tier-fixture flag alone does not bypass foreground gating", () => {
    // MAYHEM_OVERLAY_TIER_FIXTURE=1 without the explicit preview flag resolves
    // to "hidden" while another app is topmost…
    const mode = resolveOverlayFixtureMode({
      tierFixtureOn: true,
      previewOn: false,
      gameWindowForeground: false,
      phase: "idle",
      offerActive: false,
      aramggReady: true,
    });
    expect(mode.kind).toBe("hidden");
    // …and visibility still flows through the canonical predicate, which
    // stays false while Terminal is topmost.
    const visible = gameOverlayVisible({
      gameWindowForeground: false,
      previewMode: mode.kind === "preview",
    });
    expect(visible).toBe(false);
    expect(devPanelsVisibleWithOptIn({
      devBuild: true,
      gameOverlayIsVisible: visible,
      diagnosticsOptIn: true,
    })).toBe(false);
  });

  it("requires an explicit diagnostics opt-in even in a visible development overlay", () => {
    expect(devPanelsVisibleWithOptIn({
      devBuild: true,
      gameOverlayIsVisible: true,
      diagnosticsOptIn: false,
    })).toBe(false);
  });
});
