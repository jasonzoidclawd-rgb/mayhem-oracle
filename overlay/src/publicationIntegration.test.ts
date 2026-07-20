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
  });

  it("guards live champion data by both champion id and patch", () => {
    expect(championHook).toContain("championDataset.championId === championKey");
    expect(championHook).toContain("championDataset.patch === source?.patch");
    expect(championHook).toContain("championRequestIdRef.current !== requestId");
  });
});
