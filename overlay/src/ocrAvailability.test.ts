import { describe, expect, test } from "vitest";
import {
  canRunOcr,
  createOcrAvailability,
  isRecoverableOcrUnavailable,
  shouldBlockOverlayDataLoad,
  userFacingOcrStatus,
} from "./ocrAvailability";

describe("OCR availability", () => {
  test("treats missing Tesseract as recoverable OCR-unavailable state", () => {
    const availability = createOcrAvailability(false);

    expect(availability).toEqual({
      available: false,
      reason: "Tesseract OCR is not installed or not available on PATH.",
    });
    expect(isRecoverableOcrUnavailable(availability)).toBe(true);
    expect(canRunOcr(availability)).toBe(false);
  });

  test("does not turn OCR unavailability into an overlay data load failure", () => {
    const availability = createOcrAvailability(false);

    expect(shouldBlockOverlayDataLoad(availability)).toBe(false);
    expect(userFacingOcrStatus(availability)).toBe(
      "OCR unavailable: Tesseract OCR is not installed or not available on PATH.",
    );
  });

  test("allows OCR-dependent features when Tesseract is available", () => {
    const availability = createOcrAvailability(true);

    expect(availability).toEqual({ available: true });
    expect(isRecoverableOcrUnavailable(availability)).toBe(false);
    expect(canRunOcr(availability)).toBe(true);
    expect(userFacingOcrStatus(availability)).toBeNull();
  });
});
