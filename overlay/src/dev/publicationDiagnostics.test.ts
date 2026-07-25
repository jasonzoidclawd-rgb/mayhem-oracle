import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  boundedDiagnosticHash,
  emitNativeDiagnostic,
  logOverlayDiagnostic,
  traceForwardingEnabledFrom,
} from "./publicationDiagnostics";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

describe("privacy-bounded overlay diagnostics", () => {
  afterEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("hashes normalized OCR text without returning the original", () => {
    const raw = "  隱私敏感文字  ";
    const hash = boundedDiagnosticHash(raw);
    expect(hash).toMatch(/^h[0-9a-f]{8}$/);
    expect(hash).not.toContain(raw.trim());
    expect(boundedDiagnosticHash(raw)).toBe(hash);
  });

  it("emits only the caller's bounded structured payload in development", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logOverlayDiagnostic("[identity-start]", { runId: 7, titleHash: "h12345678" });
    expect(info).toHaveBeenCalledWith(
      "[identity-start]",
      JSON.stringify({ runId: 7, titleHash: "h12345678" }),
    );
    info.mockRestore();
  });

  // The OCR-identity lifecycle is console-only by default; a live game can't see
  // the WebView console. MAYHEM_OVERLAY_TRACE=1 forwards the same bounded lines
  // to terminal stderr so a tee'd log captures why slots fail to resolve. Off by
  // default → normal dev runs stay quiet (no behavior change).
  it("enables trace forwarding only in a dev build with the flag set", () => {
    expect(traceForwardingEnabledFrom({ dev: true, flag: "1" })).toBe(true);
    expect(traceForwardingEnabledFrom({ dev: true, flag: undefined })).toBe(false);
    expect(traceForwardingEnabledFrom({ dev: true, flag: "0" })).toBe(false);
    expect(traceForwardingEnabledFrom({ dev: false, flag: "1" })).toBe(false);
  });

  it("bridges native-forwarded diagnostics to the terminal stderr sink verbatim", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    emitNativeDiagnostic("[game-poll]", { action: "preserve", failureAgeMs: 0 });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("emit_overlay_diagnostic", {
      marker: "[game-poll]",
      payload: JSON.stringify({ action: "preserve", failureAgeMs: 0 }),
    });
    info.mockRestore();
  });

  it("keeps logOverlayDiagnostic console-only unless the trace flag opts in", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    // MAYHEM_OVERLAY_TRACE is unset in the test env → no terminal forward.
    logOverlayDiagnostic("[identity-timeout]", { runId: 1, reason: "timeout" });
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    info.mockRestore();

    // Wiring guard (env flags are not runtime-flippable in vitest): the terminal
    // forward for the console stream must stay gated on the trace predicate.
    const src = readFileSync(new URL("./publicationDiagnostics.ts", import.meta.url), "utf8");
    expect(src).toContain(
      "if (isTraceForwardingEnabled()) forwardToNativeSink(marker, serialized);",
    );
  });

  // A geometry wedge supersedes EVERY probe (the 2 s watchdog restarts the seq
  // before the slow invoke resolves), so a [geometry-timing] log placed after the
  // stale-rejection returns is silent in exactly the failure it exists to
  // diagnose. It must log BEFORE the return, and must carry nativeElapsedMs (Rust
  // probe total) alongside roundTripMs (JS invoke round-trip) — their gap is the
  // IPC/main-thread delay, which is what discriminates a slow capture from a
  // blocked main thread.
  it("logs [geometry-timing] before stale-rejection, with native vs round-trip split", () => {
    const src = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const timingAt = src.indexOf('logOverlayDiagnostic("[geometry-timing]"');
    const staleReturnAt = src.indexOf("if (stale) return;");
    expect(timingAt).toBeGreaterThan(-1);
    expect(staleReturnAt).toBeGreaterThan(-1);
    expect(timingAt).toBeLessThan(staleReturnAt);
    expect(src).toContain("nativeElapsedMs: observation.elapsedMs");
    expect(src).toContain("stale,");
  });
});
