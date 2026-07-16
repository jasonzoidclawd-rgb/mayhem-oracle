import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));

import { EntityLink } from "@/components/entities/EntityLink";
import type { EntityRef } from "@/lib/entities/types";

const base: EntityRef = {
  type: "item",
  id: "1001",
  slug: "boots",
  routeIdentifier: "1001",
  localizedName: "Boots",
  iconUrl: "",
  known: true,
  href: "/items/1001",
  canonicalId: "1001",
  name: "Boots",
  lifecycle: "active",
};

describe("EntityLink", () => {
  test("renders one combined crawlable link with deterministic icon fallback", () => {
    const html = renderToStaticMarkup(createElement(EntityLink, { entity: base, qualityTier: "S" }));
    expect(html).toContain('href="/items/1001"');
    expect(html).toContain("Boots");
    expect(html).toContain(">I</span>");
    expect((html.match(/href=/g) ?? []).length).toBe(1);
    expect(html).toContain('data-entity-type="item"');
    expect(html).not.toContain("data-tier=");
  });

  test("keeps quality-tier metadata on augment icons only", () => {
    const html = renderToStaticMarkup(createElement(EntityLink, {
      entity: {
        ...base,
        type: "augment",
        id: "ARAM_TEST",
        slug: "test-augment",
        localizedName: "Test Augment",
        canonicalId: "ARAM_TEST",
        href: "/augments/test-augment",
      },
      qualityTier: "S",
      rarity: "gold",
    }));
    expect(html).toContain('data-entity-icon="true"');
    expect(html).toContain('data-entity-type="augment"');
    expect(html).toContain('data-tier="S"');
    expect(html).toContain('data-rarity="gold"');
  });

  test("renders unresolved entities as an accessible non-interactive identity", () => {
    const html = renderToStaticMarkup(
      createElement(EntityLink, { entity: { ...base, known: false, href: undefined, routeIdentifier: "" } }),
    );
    expect(html).not.toContain("href=");
    expect(html).toContain('aria-label="Boots (item)"');
    expect(html).toContain("Boots");
    expect(html).toContain(">I</span>");
  });

  test("keeps a stable fallback visible while a remote icon loads", () => {
    const html = renderToStaticMarkup(
      createElement(EntityLink, {
        entity: { ...base, iconUrl: "https://cdn.example.test/items/1001.png" },
      }),
    );
    expect(html).toContain('data-entity-icon-state="loading"');
    expect(html).toContain(">I</span>");
    expect(html).toContain("cdn.example.test%2Fitems%2F1001.png");
  });
});
