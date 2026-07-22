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
});
