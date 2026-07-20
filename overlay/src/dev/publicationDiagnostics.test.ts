import { describe, expect, it, vi } from "vitest";
import { boundedDiagnosticHash, logOverlayDiagnostic } from "./publicationDiagnostics";

describe("privacy-bounded overlay diagnostics", () => {
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
});
