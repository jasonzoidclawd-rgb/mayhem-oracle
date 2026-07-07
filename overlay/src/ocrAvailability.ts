export const OCR_UNAVAILABLE_REASON =
  "System OCR is not available on this device. On Windows, install an OCR language pack (Settings > Time & Language > Language & Region).";

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
  availability: OcrAvailability,
): boolean {
  void availability;
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
  if (!/ocr unavailable/i.test(message)) return null;
  return createOcrAvailability(false);
}
