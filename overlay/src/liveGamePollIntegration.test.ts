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

  it("uses deadline ownership and stale-publication guards instead of bare booleans", () => {
    for (const required of [
      "new LiveGamePollOwnerRegistry()",
      "gamePollOwnersRef.current.claim(performance.now())",
      "gamePollOwnersRef.current.isCurrent(owner.runId)",
      "gamePollOwnersRef.current.release(owner.runId)",
      'emitNativeDiagnostic("[game-poll-stage]"',
    ]) expect(app).toContain(required);
    expect(app).not.toContain("pollInFlightRef");
    expect(app).not.toContain("pollPendingRef");
    expect(app.match(/pollOwnerIsCurrent\(\)/g)?.length).toBeGreaterThanOrEqual(7);
    expect(app.match(/emitPollStage\("stale-reject"/g)?.length).toBeGreaterThanOrEqual(7);
    expect(app).toContain('if (release === "restart")');
  });
});
