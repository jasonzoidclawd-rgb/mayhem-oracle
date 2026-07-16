import { describe, expect, test } from "vitest";
import { collapseDuplicateLocalePrefix, routing } from "@/i18n/routing";

describe("collapseDuplicateLocalePrefix", () => {
  test("collapses a doubled prefix for every prefixed locale", () => {
    for (const locale of routing.locales) {
      expect(collapseDuplicateLocalePrefix(`/${locale}/${locale}/account`)).toBe(
        `/${locale}/account`,
      );
      expect(collapseDuplicateLocalePrefix(`/${locale}/${locale}`)).toBe(`/${locale}`);
    }
  });

  test("collapses repeated duplication down to a single prefix", () => {
    expect(collapseDuplicateLocalePrefix("/zh-TW/zh-TW/zh-TW/account")).toBe(
      "/zh-TW/account",
    );
  });

  test("leaves well-formed localized paths alone", () => {
    expect(collapseDuplicateLocalePrefix("/zh-TW/account")).toBeNull();
    expect(collapseDuplicateLocalePrefix("/ko/patch-notes/26.13")).toBeNull();
    expect(collapseDuplicateLocalePrefix("/account")).toBeNull();
    expect(collapseDuplicateLocalePrefix("/")).toBeNull();
  });

  test("does not touch mixed or partial prefixes", () => {
    expect(collapseDuplicateLocalePrefix("/zh-TW/zh-CN/account")).toBeNull();
    expect(collapseDuplicateLocalePrefix("/zh-TW/zh-TW-something/account")).toBeNull();
  });

  test("never rewrites patch-note routes", () => {
    expect(collapseDuplicateLocalePrefix("/patch-notes/26.13")).toBeNull();
    expect(collapseDuplicateLocalePrefix("/zh-TW/patch-notes/26.13")).toBeNull();
    expect(collapseDuplicateLocalePrefix("/zh-TW/zh-TW/patch-notes/26.13")).toBe(
      "/zh-TW/patch-notes/26.13",
    );
  });

  test("english uses the same doubled-prefix rescue as every locale", () => {
    expect(collapseDuplicateLocalePrefix("/en/en/account")).toBe("/en/account");
  });
});
