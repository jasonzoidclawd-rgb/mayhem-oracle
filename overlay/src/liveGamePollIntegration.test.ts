import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live game poll integration", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

  it("preserves current game ownership when the bounded policy accepts a transient miss", () => {
    expect(app).toContain("resolveLiveDataPoll({");
    expect(app).toContain('if (liveDataDecision.action === "preserve") return;');
    expect(app).toContain('emitNativeDiagnostic("[game-poll]"');
    expect(app.indexOf("if (data && gameflowCaptureAllowedRef.current) {")).toBeLessThan(
      app.indexOf("setActiveGame(true);"),
    );
  });

  // REGRESSION GUARD (death-triggered augment badges): a non-null gameflow at the
  // resolveLiveDataPoll call site is a FRESH live-match confirmation (a confirmed
  // non-live phase already returned via shouldClearOcrStateForGameflow). Feeding
  // it to gameflowConfirmedLive is what preserves the game through an arbitrarily
  // long port-2999 outage (death/respawn) instead of clearing after grace —
  // clearing sets activeGame=false, which skips the geometry probe
  // ("not-active-game") so phase never returns to augment_selection and the R2/R3/R4
  // badges never render. Do not drop this signal.
  it("feeds fresh LCU gameflow confirmation into the live-data policy", () => {
    expect(app).toContain("gameflowConfirmedLive: gameflow != null,");
  });
});
