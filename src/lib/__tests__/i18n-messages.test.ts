import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const locales = ["en", "zh-TW", "zh-CN", "ja", "ko"] as const;

const requiredKeys = [
  "nav.champions",
  "nav.toggleMenu",
  "common.patchLabel",
  "items.goldUnit",
  "items.catCriticalStrike",
  "items.catAbilityHaste",
  "items.catHealthRegen",
  "items.catMagicPenetration",
  "items.catArmorPenetration",
  "items.catNonbootsMovement",
  "items.catOnHit",
  "items.catActive",
  "damageSim.title",
  "damageSim.subtitle",
  "damageSim.buildCalculator",
  "damageSim.formulaReference",
  "damageSim.augmentInteractionsTitle",
  "damageSim.attacker",
  "damageSim.target",
  "damageSim.selectChampionPlaceholder",
  "damageSim.searchItemPlaceholder",
  "damageSim.selectParticipantsPrompt",
  "damageSim.physicalDamage",
  "damageSim.magicDamage",
  "damageSim.sustainUtility",
  "damageSim.abilities",
  "damageSim.itemBuild",
  "damageSim.noSustainStats",
  "membership.statusActiveOverlayTester",
  "membership.downloadsTitle",
  "membership.downloadWindows",
  "membership.downloadMac",
  "membership.downloadUnavailable",
  "membership.downloadExpires",
  "membership.redeemTestCode",
  "membership.redeemInvalidExpired",
  "membership.alphaWarningTitle",
  "membership.alphaWarningUnsigned",
  "membership.alphaWarningSmartScreen",
  "membership.alphaWarningTesterOnly",
  "membership.alphaWarningSensitiveLogs",
] as const;

function readMessages(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"),
  );
}

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function getByPath(messages: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, messages);
}

describe("i18n messages", () => {
  test("all supported locales expose the same message keys", () => {
    const expectedKeys = flattenKeys(readMessages("en")).sort();

    for (const locale of locales) {
      expect(flattenKeys(readMessages(locale)).sort(), locale).toEqual(expectedKeys);
    }
  });

  test("all page/tab UI namespaces have required localized labels", () => {
    for (const locale of locales) {
      const messages = readMessages(locale);
      for (const key of requiredKeys) {
        expect(getByPath(messages, key), `${locale}:${key}`).toEqual(expect.any(String));
        expect(getByPath(messages, key), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  test("damage amplification stacking formula is not the section label", () => {
    for (const locale of locales) {
      const messages = readMessages(locale);
      const label = getByPath(messages, "damageSim.stackingRule");
      const formula = getByPath(messages, "damageSim.stackingRuleFormula");

      expect(formula, `${locale}:damageSim.stackingRuleFormula`).toEqual(expect.any(String));
      expect(formula, `${locale}:damageSim.stackingRuleFormula`).not.toBe("");
      expect(formula, `${locale}:damageSim.stackingRuleFormula`).not.toBe(label);
    }
  });
});
