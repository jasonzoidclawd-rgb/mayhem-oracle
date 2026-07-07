import { describe, expect, test } from "vitest";
import {
  canRunOcr,
  createOcrAvailability,
  isRecoverableOcrUnavailable,
  ocrAvailabilityFromError,
  OCR_UNAVAILABLE_REASON,
  shouldBlockOverlayDataLoad,
  userFacingOcrStatus,
} from "./ocrAvailability";

describe("OCR availability", () => {
  test("treats unavailable system OCR as recoverable OCR-unavailable state", () => {
    const availability = createOcrAvailability(false);

    expect(availability).toEqual({
      available: false,
      reason: OCR_UNAVAILABLE_REASON,
    });
    expect(isRecoverableOcrUnavailable(availability)).toBe(true);
    expect(canRunOcr(availability)).toBe(false);
  });

  test("does not turn OCR unavailability into an overlay data load failure", () => {
    const availability = createOcrAvailability(false);

    expect(shouldBlockOverlayDataLoad(availability)).toBe(false);
    expect(userFacingOcrStatus(availability)).toBe(
      `OCR unavailable: ${OCR_UNAVAILABLE_REASON}`,
    );
  });

  test("maps native backend OCR-unavailable errors to recoverable availability", () => {
    const availability = ocrAvailabilityFromError(
      new Error("OCR unavailable: no Windows OCR language pack installed"),
    );

    expect(availability).toEqual({
      available: false,
      reason: OCR_UNAVAILABLE_REASON,
    });
  });

  test("ignores non-availability OCR errors", () => {
    expect(ocrAvailabilityFromError(new Error("OCR failed: PNG encode"))).toBeNull();
  });

  test("allows OCR-dependent features when system OCR is available", () => {
    const availability = createOcrAvailability(true);

    expect(availability).toEqual({ available: true });
    expect(isRecoverableOcrUnavailable(availability)).toBe(false);
    expect(canRunOcr(availability)).toBe(true);
    expect(userFacingOcrStatus(availability)).toBeNull();
  });
});
