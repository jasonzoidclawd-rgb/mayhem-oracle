import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live publication integration", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const championHook = readFileSync(
    new URL("./dev/useAramggTierFixture.ts", import.meta.url),
    "utf8",
  );
  // The SlotChip shape lives with the badge layer that renders it.
  const badgeLayer = readFileSync(
    new URL("./BadgeChipLayer.tsx", import.meta.url),
    "utf8",
  );
  // THE single authority for what a chip shows — both the renderer and the
  // publication diagnostic must read it rather than deriving their own.
  const presentation = readFileSync(
    new URL("./slotStatPresentation.ts", import.meta.url),
    "utf8",
  );
  // THE single decision behind `activeChampionDataset`, extracted so the reason
  // a resolved dataset is withheld is observable in the log.
  const championGate = readFileSync(
    new URL("./dev/championDatasetTrace.ts", import.meta.url),
    "utf8",
  );

  it("uses shared reconciliation, OCR ownership and offer-state helpers", () => {
    expect(app).toContain("reconcileSlotIdentity(");
    expect(app).toContain("ownerCurrent(");
    expect(app).toContain("advanceOfferSurface(");
    expect(app).not.toContain("const prevVerified");
    // Champion-only: statScope has no "global" member and is never read straight
    // from an unnarrowed provenance.
    expect(badgeLayer).toContain('statScope: "champion" | null');
    expect(badgeLayer).not.toContain('statScope: "champion" | "global" | null');
    expect(app).not.toContain('statScope: "champion" | "global" | null');
    expect(presentation).toContain('staged.stat.provenance === "champion"');
    expect(app).toContain("statProvenance: stat?.provenance ?? null");
    expect(app).toContain('logOverlayDiagnostic("[slot-publication]"');
    // A global-sourced statistic reaching a badge is an explicit violation.
    expect(app).toContain('logOverlayDiagnostic("[slot-publication-violation]"');
  });

  it("derives the rendered chip and its trace from ONE authority", () => {
    // The live run of 2026-08-30 logged 38 `displayedStatText` percentages the
    // screen never painted, because the diagnostic recomputed them from
    // `pool.win_rate` while the renderer was in champion-loading. Both sides
    // must now read the same derived presentation.
    expect(app).toContain("deriveSlotStatPresentation({");
    expect(app).toContain("displayedStatText: presentation.winRateText");
    expect(app).toContain("statKind: presentation.statKind");
    expect(app).toContain("renderedProvenance: presentation.provenance");
    expect(app).toContain("winRateText: presentation.winRateText");

    // No independent "displayed" value may be recomputed from the catalog.
    expect(app).not.toContain(
      "displayedStatText: compactWinRateFromPercent(pool?.win_rate ?? null)",
    );
    // The catalog value survives only under an explicit candidate/input name.
    expect(app).toContain("candidateCatalogWinRate: pool?.win_rate ?? null");
    expect(app).not.toContain("statValue: pool?.win_rate ?? null");

    // Every non-matched ARAMGG stage renders no percentage at all.
    for (const kind of ["no-data", "loading", "error"]) {
      expect(presentation).toContain(`staged.kind === "${kind}"`);
    }
    expect(presentation).toContain("winRateText: null");
  });

  it("guards live champion data by both champion id and patch", () => {
    // The gate moved into `resolveActiveChampionDataset` so each withholding
    // reason is nameable; the guard itself is unchanged.
    expect(championGate).toContain("dataset.championId !== championKey");
    expect(championGate).toContain('reason: "champion-changed"');
    // Updated deliberately with the BUG-2 fix: a raw === treated two
    // unresolved patches as the same patch. patchesMatch fails closed on null.
    expect(championGate).not.toContain("dataset.patch === sourcePatch");
    expect(championGate).toContain("patchesMatch(dataset.patch, sourcePatch)");
    expect(championGate).toContain('reason: "patch-mismatch"');
    expect(championHook).toContain("resolveActiveChampionDataset({");
    expect(championHook).toContain("championRequestIdRef.current !== requestId");
  });

  it("makes the champion-dataset load/publish seam observable", () => {
    // The 2026-08-30 run could not say whether the loader resolved at all, so
    // "never loaded" and "loaded then discarded" were indistinguishable.
    for (const event of [
      "request-start",
      "loader-resolved",
      "publish-attempt",
      "published",
      "discarded-stale",
      "loader-failed",
    ]) {
      expect(championHook).toContain(`event: "${event}"`);
    }
    // The discard must name WHICH ownership check rejected it.
    expect(championHook).toContain('reason: cancelled ? "effect-cancelled" : "superseded-request"');
    // `loader-resolved` is emitted BEFORE the ownership check, or a discarded
    // dataset would look like one that never arrived.
    expect(championHook.indexOf('event: "loader-resolved"')).toBeLessThan(
      championHook.indexOf("championRequestIdRef.current !== requestId"),
    );
  });

  it("reports the dataset source that was actually used, never a fixed endpoint", () => {
    // The previous publication hardcoded `champion-augments-file` through a
    // whole session that issued no such request.
    expect(app).not.toContain('endpointKind: "champion-augments-file"');
    expect(app).toContain("datasetSourceKind: meta.sourceKind");
    expect(championHook).toContain(
      "championDatasetSourceKind: championDatasetSourceKind(activeChampionDataset?.source)",
    );
    // Path B reports the local artifact; nothing reports a path it did not take.
    expect(championGate).toContain('return "local-artifact"');
  });

  it("has no global-fallback statistics selection in the champion hook", () => {
    // The overlay must never read the global stats map for a badge value.
    expect(championHook).not.toContain("statsById.get");
    expect(championHook).not.toContain("allowGlobalFallback");
  });

  it("refreshes and republishes the existing geometry frame when champion data completes", () => {
    const effectStart = app.indexOf("// Champion-data completion");
    const effectEnd = app.indexOf("// ─── TRACK 1: geometry probe", effectStart);
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    const effect = app.slice(effectStart, effectEnd);

    expect(effect).toContain("refreshSameOfferData(");
    expect(effect).toContain("identityStoreRef.current");
    expect(effect).toContain("offerStateRef.current");
    expect(effect).toContain("publishOffer(");
    expect(effect).toContain("republishGeometryFrame(geometrySeqRef.current)");
    expect(effect).not.toContain("runIdentityProbe");
    expect(effect).not.toContain("applyScanToOffer");
    expect(effect).not.toMatch(/(?:offer|geometry)GenerationRef\.current\s*\+=/);
  });

  it("wires accepted-offer round ownership through publication, close, confirm, diagnostics, and reset", () => {
    expect(app).toContain('from "./offerRoundOwnership"');
    expect(app).toContain("offerRoundOwnershipRef");

    const geometryStart = app.indexOf("const runGeometryProbe = useCallback");
    const geometryEnd = app.indexOf("// ─── TRACK 2", geometryStart);
    expect(geometryStart).toBeGreaterThan(-1);
    expect(geometryEnd).toBeGreaterThan(geometryStart);
    const geometryPath = app.slice(geometryStart, geometryEnd);
    expect(geometryPath).toContain("reduceOfferRoundOwnership(");
    expect(geometryPath).toContain('type: "accepted-offer"');
    expect(geometryPath).toContain("offerGeneration:");
    // Visual acceptance must own the ordinal directly. Merely translating
    // detectedNewOffer into telemetry completion preserves the round-1 defect.
    expect(geometryPath).not.toMatch(
      /if\s*\(detectedNewOffer[^)]*\)[\s\S]{0,160}recordRoundCompleted\(\)/,
    );

    const noOfferStart = geometryPath.indexOf(
      'nextOfferSurface.state === "NO_OFFER"',
    );
    const noOfferEnd = geometryPath.indexOf(
      '} else if (nextOfferSurface.state === "OCCLUDED")',
      noOfferStart,
    );
    expect(noOfferStart).toBeGreaterThan(-1);
    expect(noOfferEnd).toBeGreaterThan(noOfferStart);
    const noOfferPath = geometryPath.slice(noOfferStart, noOfferEnd);
    expect(noOfferPath).toContain("reduceOfferRoundOwnership(");
    expect(noOfferPath).toContain('type: "offer-closed"');
    expect(noOfferPath).toContain(
      "offerGeneration: priorOfferSurface.offerGeneration",
    );

    const clearStart = app.indexOf("const clearSurface = useCallback");
    const clearEnd = app.indexOf("const stopOcr", clearStart);
    const clearPath = app.slice(clearStart, clearEnd);
    expect(clearPath).toContain("reduceOfferRoundOwnership(");
    expect(clearPath).toContain('type: "presentation-cleared"');
    expect(clearPath).not.toContain('type: "offer-closed"');
    expect(clearPath).toContain(
      "offerGeneration: offerSurfaceRef.current.offerGeneration",
    );

    const keyboardStart = app.indexOf("const onKeyDown = (event: KeyboardEvent)");
    const keyboardEnd = app.indexOf("window.addEventListener", keyboardStart);
    const keyboardPath = app.slice(keyboardStart, keyboardEnd);
    expect(keyboardStart).toBeGreaterThan(-1);
    expect(keyboardEnd).toBeGreaterThan(keyboardStart);
    expect(keyboardPath).toContain("reduceOfferRoundOwnership(");
    expect(keyboardPath).toContain('type: "pick-confirmed"');
    expect(keyboardPath).toContain("offerGeneration:");

    const diagnosticStart = app.indexOf('emitNativeDiagnostic("[offer-session]"');
    const diagnosticEnd = app.indexOf("});", diagnosticStart);
    const diagnosticPath = app.slice(diagnosticStart, diagnosticEnd);
    expect(diagnosticPath).toContain("offerRoundOwnershipRef.current.activeOwner?.round");
    expect(diagnosticPath).not.toContain("roundDeliveryRef.current?.activeOfferRound");

    const resetStart = app.indexOf("const beginNewGameEpoch = useCallback");
    const resetEnd = app.indexOf("}, []);", resetStart);
    const resetPath = app.slice(resetStart, resetEnd);
    expect(resetPath).toContain("createOfferRoundOwnership()");
  });

  it("extends offer-session at stale and current classification rejection boundaries", () => {
    expect(app).toContain("describeOfferAcquisitionDiagnostic(");
    expect(app).toContain("describeLiveClientStatusTransition(");

    const geometryStart = app.indexOf("const runGeometryProbe = useCallback");
    const geometryEnd = app.indexOf("// ─── TRACK 2", geometryStart);
    const geometryPath = app.slice(geometryStart, geometryEnd);
    const staleReject = geometryPath.indexOf("stale: true");
    const surfaceAdvance = geometryPath.indexOf("advanceGeometrySurface(");
    const newOfferDecision = geometryPath.indexOf("newOfferDetected(");

    expect(staleReject).toBeGreaterThan(-1);
    expect(surfaceAdvance).toBeGreaterThan(staleReject);
    expect(newOfferDecision).toBeGreaterThan(surfaceAdvance);
    const stalePath = geometryPath.slice(staleReject, surfaceAdvance);
    const currentPath = geometryPath.slice(surfaceAdvance);
    expect(stalePath).toContain("describeOfferAcquisitionDiagnostic(");
    expect(stalePath).toContain("stale: true");
    expect(stalePath).toContain("geometryAction: null");
    expect(stalePath).toContain('emitNativeDiagnostic("[offer-session]"');
    expect(stalePath).not.toContain("failureCategory:");
    expect(currentPath).toContain("describeOfferAcquisitionDiagnostic(");
    expect(currentPath).toContain("surfaceClassification:");
    expect(currentPath).toContain("offerState:");
    expect(currentPath).toContain("geometryAction:");
    expect(currentPath).toContain("fingerprintChangeCount:");
    expect(currentPath).toContain("confirmedRerollCount:");
    expect(currentPath).toContain("baselineSettling:");
    expect(currentPath).toContain("newOfferDetected:");
    expect(currentPath).toContain('emitNativeDiagnostic("[offer-session]"');
    expect(currentPath).not.toContain("failureCategory:");
    expect(app).not.toContain('emitNativeDiagnostic("[offer-acquisition]"');

    const gamePollPath = app.slice(
      app.indexOf("describeLiveClientStatusTransition("),
      app.indexOf("describeLiveClientStatusTransition(") + 1_200,
    );
    expect(gamePollPath).toContain("previousStatus:");
    expect(gamePollPath).toContain("nextStatus:");
    expect(gamePollPath).toContain('emitNativeDiagnostic("[game-poll]"');
  });
});
