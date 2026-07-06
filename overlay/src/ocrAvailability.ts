export const OCR_UNAVAILABLE_REASON =
  "Tesseract OCR is not installed or not available on PATH.";

export type OcrAvailability =
  | { available: true }
  | { available: false; reason: string };

export function createOcrAvailability(available: boolean): OcrAvailability {
  return available
    ? { available: true }
    : { available: false, reason: OCR_UNAVAILABLE_REASON };
}

export function canRunOcr(availability: OcrAvailability): boolean {
  return availability.available;
}

export function isRecoverableOcrUnavailable(
  availability: OcrAvailability,
): boolean {
  return !availability.available;
}

export function shouldBlockOverlayDataLoad(
  _availability: OcrAvailability,
): boolean {
  return false;
}

export function userFacingOcrStatus(
  availability: OcrAvailability,
): string | null {
  if (availability.available) return null;
  return `OCR unavailable: ${availability.reason}`;
}

export function ocrAvailabilityFromError(
  error: unknown,
): OcrAvailability | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/tesseract/i.test(message)) return null;
  return createOcrAvailability(false);
}
