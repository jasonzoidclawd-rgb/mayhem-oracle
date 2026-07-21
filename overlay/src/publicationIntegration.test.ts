import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live publication integration", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const championHook = readFileSync(
    new URL("./dev/useAramggTierFixture.ts", import.meta.url),
    "utf8",
  );

  it("uses shared reconciliation, OCR ownership and offer-state helpers", () => {
    expect(app).toContain("reconcileSlotIdentity(");
    expect(app).toContain("ownerCurrent(");
    expect(app).toContain("advanceOfferSurface(");
    expect(app).not.toContain("const prevVerified");
    // Champion-only: statScope has no "global" member and is never read straight
    // from an unnarrowed provenance.
    expect(app).toContain('statScope: "champion" | null');
    expect(app).not.toContain('statScope: "champion" | "global" | null');
    expect(app).toContain('staged.stat.provenance === "champion"');
    expect(app).toContain("statProvenance: stat?.provenance ?? null");
    expect(app).toContain('logOverlayDiagnostic("[slot-publication]"');
    // A global-sourced statistic reaching a badge is an explicit violation.
    expect(app).toContain('logOverlayDiagnostic("[slot-publication-violation]"');
  });

  it("guards live champion data by both champion id and patch", () => {
    expect(championHook).toContain("championDataset.championId === championKey");
    expect(championHook).toContain("championDataset.patch === source?.patch");
    expect(championHook).toContain("championRequestIdRef.current !== requestId");
  });

  it("has no global-fallback statistics selection in the champion hook", () => {
    // The overlay must never read the global stats map for a badge value.
    expect(championHook).not.toContain("statsById.get");
    expect(championHook).not.toContain("allowGlobalFallback");
  });
});
