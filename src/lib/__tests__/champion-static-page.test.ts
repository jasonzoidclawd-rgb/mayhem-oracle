import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = path.join(
  process.cwd(),
  "src/app/[locale]/champions/[slug]/page.tsx",
);

describe("static champion page boundary", () => {
  const source = readFileSync(pagePath, "utf8");

  it("keeps canonical static params and rejects dynamic slugs", () => {
    expect(source).toContain("export const dynamicParams = false");
    expect(source).toContain("export async function generateStaticParams()");
    expect(source).toContain("routing.locales.flatMap");
  });

  it("contains no server entitlement or Supabase request dependency", () => {
    expect(source).not.toMatch(/requireActiveEntitlement/);
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/next\/(headers|cookies)/);
    expect(source).toContain("ChampionMemberIsland");
  });
});
