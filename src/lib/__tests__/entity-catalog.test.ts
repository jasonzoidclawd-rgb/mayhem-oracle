import { describe, expect, test } from "vitest";
import entityData from "../../../public/data/entity-presentation.json";
import championsData from "../../../public/data/champions.json";
import augmentsData from "../../../public/data/augments.json";
import itemsData from "../../../public/data/items.json";
import { buildEntityIndex, resolveEntityRef, unknownEntityRef } from "@/lib/entities/catalog";
import { formatEntityStatValue } from "@/lib/entities/format";
import type { EntityPresentationData } from "@/lib/entities/types";
import { assertEntityRefRoutes, buildEntityRouteSets, localizedEntityHref } from "@/lib/entities/routes";

const data = entityData as EntityPresentationData;

describe("entity presentation catalog", () => {
  test("resolves canonical ID, localized name, icon, and route for all entity types", () => {
    const cases = [
      ["champion", "1", "annie", "/champions/annie"],
      ["augment", "ARAM_ADAPt", "adapt", "/augments/adapt"],
      ["item", "1001", "boots", "/items/1001"],
    ] as const;
    for (const [type, canonicalId, slug, href] of cases) {
      const ref = resolveEntityRef(data, type, { canonicalId }, "en");
      expect(ref).toMatchObject({
        type,
        id: canonicalId,
        canonicalId,
        slug,
        routeIdentifier: type === "item" ? canonicalId : slug,
        href,
        known: true,
      });
      expect(ref?.iconUrl).toBeTruthy();
      expect(ref?.localizedName).toBeTruthy();
    }
    expect(resolveEntityRef(data, "champion", { canonicalId: "missing" }, "en")).toBeNull();
  });

  test("supports all five locale name paths without changing the canonical route", () => {
    const names = ["Annie", "安妮", "黑暗之女", "アニー", "애니"];
    for (const [locale, expected] of [["en", names[0]], ["zh-TW", names[1]], ["zh-CN", names[2]], ["ja", names[3]], ["ko", names[4]]] as const) {
      const ref = resolveEntityRef(data, "champion", { canonicalId: "1" }, locale);
      expect(ref?.name).toBe(expected);
      expect(ref?.href).toBe("/champions/annie");
      expect(ref?.localizedName).toBe(expected);
    }
  });

  test("uses exact static route identifiers for regular and Mayhem items", () => {
    const boots = resolveEntityRef(data, "item", { canonicalId: "1001" }, "en");
    const atmas = resolveEntityRef(data, "item", { canonicalId: "223039" }, "en");
    expect(boots).toMatchObject({ routeIdentifier: "1001", href: "/items/1001", known: true });
    expect(atmas).toMatchObject({ routeIdentifier: "atmas-reckoning", href: "/items/atmas-reckoning", known: true });
  });

  test("does not route Noxian Feats boots as Mayhem items", () => {
    const immortalPath = resolveEntityRef(data, "item", { canonicalId: "3168" }, "zh-TW");
    expect(immortalPath).toMatchObject({
      id: "3168",
      name: "不朽之道",
      localizedName: "不朽之道",
      known: false,
      routeIdentifier: "",
    });
    expect(immortalPath?.href).toBeUndefined();
  });

  test("keeps Locke unlinked while preserving the CDragon identity", () => {
    const locke = resolveEntityRef(data, "champion", { canonicalId: "805" }, "en");
    expect(locke).toMatchObject({ id: "805", slug: "locke", known: false, routeIdentifier: "" });
    expect(locke?.href).toBeUndefined();
  });

  test("historical Forged By The Master retains its canonical page route", () => {
    const forged = resolveEntityRef(data, "augment", { canonicalId: "2127" }, "zh-TW");
    expect(forged).toMatchObject({
      id: "2127",
      slug: "forged-by-the-master",
      routeIdentifier: "forged-by-the-master",
      known: true,
      href: "/augments/forged-by-the-master",
      localizedName: "大師鑄造",
    });
  });

  test("current CDragon lifecycle fixtures stay active and routeable", () => {
    const fixtures = [
      ["terraind", "Terraind"],
      ["surge-field", "SurgeField"],
      ["squishy-slappy-grab", "SquishySlappyGrab"],
      ["porcupine", "PinCushion"],
      ["its-go-time", "ItsGoTime"],
      ["from-downtown", "ARAM_BangBang"],
    ] as const;

    for (const [slug, canonicalId] of fixtures) {
      const row = augmentsData.augments.find((augment) => augment.slug === slug);
      expect(row, slug).toBeTruthy();
      expect(row?.flags?.lifecycle, slug).toBe("active");
      expect(row?.flags?.lifecycle_patch, slug).toBeUndefined();

      for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
        const ref = resolveEntityRef(data, "augment", { canonicalId }, locale);
        expect(ref, `${slug}:${locale}`).toMatchObject({
          id: canonicalId,
          slug,
          routeIdentifier: slug,
          href: `/augments/${slug}`,
          known: true,
          localizedName: expect.any(String),
          iconUrl: expect.stringContaining("communitydragon.org"),
        });
      }

      const projected = data.entities.find(
        (entity) => entity.type === "augment" && entity.canonical_id === canonicalId,
      );
      expect(projected?.lifecycle.state, slug).toBe("active");
      expect(projected?.lifecycle.patch, slug).toBe("");
    }

    const genuinelyRemoved = augmentsData.augments.find((augment) => augment.slug === "frost-wraith");
    expect(genuinelyRemoved?.flags?.lifecycle).toBe("removed");
  });

  test("unknown structured occurrences remain icon/name frames without invented links", () => {
    const ref = unknownEntityRef("item", {
      id: "3168",
      slug: "immortal-path",
      name: "不朽之道",
      iconUrl: "https://raw.communitydragon.org/example.png",
    });
    expect(ref).toMatchObject({
      type: "item",
      id: "3168",
      localizedName: "不朽之道",
      iconUrl: "https://raw.communitydragon.org/example.png",
      known: false,
      routeIdentifier: "",
    });
    expect(ref.href).toBeUndefined();
  });

  test("static route guard covers every known EntityRef in all five locales", () => {
    const routes = buildEntityRouteSets({
      champions: championsData.champions,
      augments: augmentsData.augments,
      items: itemsData,
    });
    const locales = ["en", "zh-TW", "zh-CN", "ja", "ko"] as const;
    const refs = data.entities.flatMap((entity) => {
      const ref = resolveEntityRef(data, entity.type, { canonicalId: entity.canonical_id }, "en");
      return ref ? [ref] : [];
    });
    expect(() => assertEntityRefRoutes(refs, routes, locales)).not.toThrow();
    for (const entity of data.entities) {
      const ref = resolveEntityRef(data, entity.type, { canonicalId: entity.canonical_id }, "en");
      expect(ref, `${entity.type}:${entity.canonical_id}`).toBeTruthy();
      if (entity.known) {
        expect(entity.route_identifier, `${entity.type}:${entity.canonical_id}`).not.toBe("");
        expect(routes[entity.type].has(entity.route_identifier)).toBe(true);
        for (const locale of locales) {
          const localized = localizedEntityHref(locale, entity.type, entity.route_identifier);
          expect(localized).toBe(
            `${locale === "en" ? "" : `/${locale}`}/${entity.type === "champion" ? "champions" : entity.type === "augment" ? "augments" : "items"}/${entity.route_identifier}`,
          );
        }
      } else {
        expect(entity.route_identifier).toBe("");
        expect(ref?.known).toBe(false);
        expect(ref?.href).toBeUndefined();
      }
    }
  });

  test("known projected records cannot share one canonical detail route", () => {
    const routes = new Set<string>();
    for (const entity of data.entities) {
      if (!entity.known) continue;
      const key = `${entity.type}:${entity.route_identifier}`;
      expect(routes.has(key), `${key} (${entity.canonical_id})`).toBe(false);
      routes.add(key);
    }

    // CDragon contains a Golden Spatula variant that shares the Mayhem
    // display slug but is not a catalog-backed detail page. It must remain
    // an explicitly unlinked source entity.
    const variant = resolveEntityRef(data, "item", { canonicalId: "664403" }, "en");
    expect(variant).toMatchObject({ id: "664403", known: false, routeIdentifier: "" });
    expect(variant?.href).toBeUndefined();
  });

  test("duplicate static identifiers fail closed instead of creating ambiguous links", () => {
    expect(() => buildEntityRouteSets({
      champions: [{ slug: "duplicate" }, { slug: "duplicate" }],
      augments: [],
      items: { items: [], mayhemExclusive: [] },
    })).toThrow("duplicate champion static route identifier");
  });

  test("route guard diagnostics identify every contract dimension", () => {
    const ref = resolveEntityRef(data, "item", { canonicalId: "1001" }, "en");
    expect(ref).toBeTruthy();
    expect(() => assertEntityRefRoutes(
      [{ ...ref!, known: true, routeIdentifier: "boots", href: "/items/boots" }],
      buildEntityRouteSets({ champions: [], augments: [], items: { items: [], mayhemExclusive: [] } }),
      ["zh-TW"],
    )).toThrow(
      "type=item canonicalId=1001 routeIdentifier=boots locale=zh-TW href=/zh-TW/items/boots",
    );
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
    expect(formatEntityStatValue([10, 12], "percent")).toBe("10%–12%");
    expect(formatEntityStatValue("gold", "label")).toBe("gold");
  });
});
