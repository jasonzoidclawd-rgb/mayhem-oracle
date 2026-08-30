import { describe, expect, it } from "vitest";
import * as overlayVisibility from "./overlayVisibility";
import {
  gameOverlayVisible,
  unknownForegroundState,
  type ForegroundState,
} from "./overlayVisibility";

type OverlayChromeVisible = (input: {
  gameOverlayIsVisible: boolean;
  badgeLayerVisible: boolean;
  phase: string;
}) => boolean;

const overlayChromeVisible: OverlayChromeVisible =
  "overlayChromeVisible" in overlayVisibility
    ? (overlayVisibility as typeof overlayVisibility & {
        overlayChromeVisible: OverlayChromeVisible;
      }).overlayChromeVisible
    : ({ gameOverlayIsVisible }) => gameOverlayIsVisible;

function foreground(overrides: Partial<ForegroundState>): ForegroundState {
  return {
    ...unknownForegroundState(),
    ...overrides,
  };
}

describe("game overlay visibility", () => {
  it("allows in-game surfaces for the actual League game foreground", () => {
    expect(
      gameOverlayVisible({
        gameWindowForeground: foreground({
          gameWindowForeground: true,
          foregroundBundleIdentifier: "com.riotgames.LeagueofLegends.GameClient",
        }).gameWindowForeground,
        previewMode: false,
      }),
    ).toBe(true);
  });

  it("rejects Riot Client even while the game process is still running", () => {
    expect(
      gameOverlayVisible({
        gameWindowForeground: foreground({
          gameRunning: true,
          riotClientForeground: true,
          foregroundBundleIdentifier: "com.riotgames.RiotGames.RiotClient",
        }).gameWindowForeground,
        previewMode: false,
      }),
    ).toBe(false);
  });

  it("rejects Finder and Safari-equivalent unfocused states", () => {
    expect(
      gameOverlayVisible({
        gameWindowForeground: foreground({
          gameRunning: true,
          foregroundAppName: "Finder",
          foregroundBundleIdentifier: "com.apple.finder",
        }).gameWindowForeground,
        previewMode: false,
      }),
    ).toBe(false);
  });

  it("allows only explicit geometry preview outside the game", () => {
    expect(gameOverlayVisible({ gameWindowForeground: false, previewMode: true })).toBe(true);
    // MAYHEM_OVERLAY_TIER_FIXTURE=1 is not part of this predicate and cannot
    // authorize pixels by itself.
    expect(gameOverlayVisible({ gameWindowForeground: false, previewMode: false })).toBe(false);
  });

  it("starts fail-closed before native foreground state is known", () => {
    expect(unknownForegroundState().gameWindowForeground).toBe(false);
  });
});

describe("overlay chrome visibility", () => {
  it("hides chrome when the game overlay is not visible", () => {
    expect(overlayChromeVisible({
      gameOverlayIsVisible: false,
      badgeLayerVisible: true,
      phase: "augment_selection",
    })).toBe(false);
  });

  it.each(["idle", "client_found"])(
    "hides chrome during %s when no badge presentation is visible",
    (phase) => {
      expect(overlayChromeVisible({
        gameOverlayIsVisible: true,
        badgeLayerVisible: false,
        phase,
      })).toBe(false);
    },
  );

  it.each(["idle", "client_found", "in_game", "augment_selection"])(
    "keeps a valid badge presentation visible during %s",
    (phase) => {
      expect(overlayChromeVisible({
        gameOverlayIsVisible: true,
        badgeLayerVisible: true,
        phase,
      })).toBe(true);
    },
  );

  it("shows chrome during augment selection without requiring a badge", () => {
    expect(overlayChromeVisible({
      gameOverlayIsVisible: true,
      badgeLayerVisible: false,
      phase: "augment_selection",
    })).toBe(true);
  });
});
