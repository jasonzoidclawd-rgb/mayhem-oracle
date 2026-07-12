import { describe, expect, test } from "vitest";
import entityData from "../../../public/data/entity-presentation.json";
import { buildEntityIndex, resolveEntityRef } from "@/lib/entities/catalog";
import { formatEntityStatValue } from "@/components/entities/EntityStats";
import type { EntityPresentationData } from "@/lib/entities/types";

const data = entityData as EntityPresentationData;

describe("entity presentation catalog", () => {
  test("resolves canonical ID, localized name, icon, and route for all entity types", () => {
    const cases = [
      ["champion", "1", "annie", "/champions/annie"],
      ["augment", "ARAM_ADAPt", "adapt", "/augments/adapt"],
      ["item", "1001", "boots", "/items/boots"],
    ] as const;
    for (const [type, canonicalId, slug, href] of cases) {
      const ref = resolveEntityRef(data, type, { canonicalId }, "en");
      expect(ref).toMatchObject({ type, canonicalId, slug, href });
      expect(ref?.icon).toBeTruthy();
      expect(ref?.name).toBeTruthy();
    }
    expect(resolveEntityRef(data, "champion", { canonicalId: "missing" }, "en")).toBeNull();
  });

  test("supports all five locale name paths without changing the canonical route", () => {
    const names = ["Annie", "安妮", "黑暗之女", "アニー", "애니"];
    for (const [locale, expected] of [["en", names[0]], ["zh-TW", names[1]], ["zh-CN", names[2]], ["ja", names[3]], ["ko", names[4]]] as const) {
      const ref = resolveEntityRef(data, "champion", { canonicalId: "1" }, locale);
      expect(ref?.name).toBe(expected);
      expect(ref?.href).toBe("/champions/annie");
    }
  });

  test("duplicate canonical IDs fail closed in the runtime index", () => {
    const duplicate = {
      ...data,
      entities: [...data.entities, { ...data.entities[0] }],
    };
    expect(() => buildEntityIndex(duplicate)).toThrow("duplicate entity canonical ID");
  });

  test("formats units and before/after values without parsing prose", () => {
    expect(formatEntityStatValue(10, "percent")).toBe("10%");
    expect(formatEntityStatValue(8, "flat")).toBe("8");
    expect(formatEntityStatValue(8, "gold")).toBe("8g");
    expect(formatEntityStatValue([10, 12], "percent")).toBe("10% / 12%");
    expect(formatEntityStatValue("gold", "label")).toBe("gold");
  });
});
