import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildPatchSummary } from "@/lib/seo/patch-summary";

const forbiddenSummaryTerms = [
  "oracleScore",
  "modelWeights",
  "scoreBreakdown",
  "computedPool",
  "championPools",
  "poolRules",
  "signals",
  "provenance",
  "data/internal",
  "prompt",
  "openai",
  "anthropic",
  "llm",
  "supabase",
  "member",
  "session",
];

describe("public patch summary", () => {
  test("builds a bounded current-patch summary from the public patch value", () => {
    const summary = buildPatchSummary({
      entityName: "Tank Engine",
      entityKind: "augment",
      patch: "26.13",
    });

    expect(summary.title).toBe("Patch summary");
    expect(summary.lines).toEqual([
      "This augment page for Tank Engine reflects public Arena Mayhem data for patch 26.13.",
    ]);
  });

  test("includes lifecycle wording only when public lifecycle flags are passed", () => {
    const active = buildPatchSummary({
      entityName: "Tank Engine",
      entityKind: "augment",
      patch: "26.13",
    });
    const removed = buildPatchSummary({
      entityName: "Warlock Juicebox",
      entityKind: "augment",
      patch: "26.13",
      lifecycleState: "removed",
      lifecyclePatch: "26.13",
    });

    expect(active.lines.join(" ")).not.toContain("marked");
    expect(removed.lines).toContain("Warlock Juicebox is marked removed in patch 26.13.");
  });

  test("does not render lifecycle wording for states outside the public allowlist", () => {
    for (const lifecycleState of ["new", "disabled", "internal-only"]) {
      const summary = buildPatchSummary({
        entityName: "Tank Engine",
        entityKind: "augment",
        patch: "26.13",
        lifecycleState,
        lifecyclePatch: "26.13",
      });

      expect(summary.lines).toEqual([
        "This augment page for Tank Engine reflects public Arena Mayhem data for patch 26.13.",
      ]);
    }
  });

  test("does not invent changes when no public changes are provided", () => {
    const summary = buildPatchSummary({
      entityName: "Tank Engine",
      entityKind: "augment",
      patch: "26.13",
    });

    expect(summary.lines.join(" ")).not.toMatch(/buff|nerf|changed|reworked/i);
  });

  test("keeps private scoring, prompts, and session terms out of summary output", () => {
    const summary = buildPatchSummary({
      entityName: "Tank Engine",
      entityKind: "augment",
      patch: "26.13",
      lifecycleState: "removed",
      lifecyclePatch: "26.13",
    });
    const serialized = JSON.stringify(summary).toLowerCase();

    for (const term of forbiddenSummaryTerms) {
      expect(serialized).not.toContain(term.toLowerCase());
    }
  });

  test("augment detail page renders a visible patch summary section", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/augments/[slug]/page.tsx"),
      "utf8",
    );

    expect(source).toContain('import { buildPatchSummary } from "@/lib/seo/patch-summary"');
    expect(source).toContain("const patchSummary = buildPatchSummary(");
    expect(source).toContain("patchSummary.lines.map");
    expect(source).toContain("<section");
    expect(source).toContain("patchSummary.title");
  });
});
