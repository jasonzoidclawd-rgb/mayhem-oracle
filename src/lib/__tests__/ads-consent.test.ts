import { describe, expect, test } from "vitest";
import {
  parseStoredConsent,
  shouldLoadAds,
  shouldPromptConsent,
} from "../ads/consent";

describe("ad consent gating", () => {
  test("ads never load unless the build flag is explicitly 'true'", () => {
    expect(shouldLoadAds(undefined, "granted")).toBe(false);
    expect(shouldLoadAds("false", "granted")).toBe(false);
    expect(shouldLoadAds("1", "granted")).toBe(false);
    expect(shouldLoadAds("true", "granted")).toBe(true);
  });

  test("ads never load without explicit granted consent", () => {
    expect(shouldLoadAds("true", null)).toBe(false);
    expect(shouldLoadAds("true", "denied")).toBe(false);
    expect(shouldLoadAds("true", "granted")).toBe(true);
  });

  test("the consent prompt shows only when ads are enabled and undecided", () => {
    expect(shouldPromptConsent("true", null)).toBe(true);
    expect(shouldPromptConsent("true", "granted")).toBe(false);
    expect(shouldPromptConsent("true", "denied")).toBe(false);
    expect(shouldPromptConsent(undefined, null)).toBe(false);
    expect(shouldPromptConsent("false", null)).toBe(false);
  });

  test("stored consent parses only the known values", () => {
    expect(parseStoredConsent("granted")).toBe("granted");
    expect(parseStoredConsent("denied")).toBe("denied");
    expect(parseStoredConsent(null)).toBe(null);
    expect(parseStoredConsent("garbage")).toBe(null);
  });
});
