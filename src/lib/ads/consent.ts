export type AdConsent = "granted" | "denied" | null;

export const CONSENT_STORAGE_KEY = "mayhem-ads-consent";

/** Ads render only when the build flag is on AND the user granted consent. */
export function shouldLoadAds(enabledFlag: string | undefined, consent: AdConsent): boolean {
  return enabledFlag === "true" && consent === "granted";
}

/** Whether the consent banner should appear: ads built-in, no decision yet. */
export function shouldPromptConsent(enabledFlag: string | undefined, consent: AdConsent): boolean {
  return enabledFlag === "true" && consent === null;
}

export function parseStoredConsent(value: string | null): AdConsent {
  return value === "granted" || value === "denied" ? value : null;
}
