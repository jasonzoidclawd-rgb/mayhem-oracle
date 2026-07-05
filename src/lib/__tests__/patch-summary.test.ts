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

/** Mirrors the English `augments.patchSummary*` message templates. */
function englishCopy(name: string) {
  return {
    title: "Patch summary",
    body: ({ patch }: { patch: string }) =>
      `This augment page for ${name} reflects public Arena Mayhem data for patch ${patch}.`,
    removed: ({ patch }: { patch: string }) =>
      `${name} is marked removed in patch ${patch}.`,
  };
}

describe("public patch summary", () => {
  test("builds a bounded current-patch summary from the public patch value", () => {
    const summary = buildPatchSummary({ patch: "26.13" }, englishCopy("Tank Engine"));

    expect(summary?.title).toBe("Patch summary");
    expect(summary?.lines).toEqual([
      "This augment page for Tank Engine reflects public Arena Mayhem data for patch 26.13.",
    ]);
  });

  test("returns null without a public patch value so no unsourced freshness claim renders", () => {
    expect(buildPatchSummary({}, englishCopy("Tank Engine"))).toBeNull();
    expect(buildPatchSummary({ patch: "  " }, englishCopy("Tank Engine"))).toBeNull();
  });

  test("includes lifecycle wording only when public lifecycle flags are passed", () => {
    const active = buildPatchSummary({ patch: "26.13" }, englishCopy("Tank Engine"));
    const removed = buildPatchSummary(
      { patch: "26.13", lifecycleState: "removed", lifecyclePatch: "26.13" },
      englishCopy("Warlock Juicebox"),
    );

    expect(active?.lines.join(" ")).not.toContain("marked");
    expect(removed?.lines).toContain("Warlock Juicebox is marked removed in patch 26.13.");
  });

  test("does not render lifecycle wording for states outside the public allowlist", () => {
    for (const lifecycleState of ["new", "disabled", "internal-only"]) {
      const summary = buildPatchSummary(
        { patch: "26.13", lifecycleState, lifecyclePatch: "26.13" },
        englishCopy("Tank Engine"),
      );

      expect(summary?.lines).toEqual([
        "This augment page for Tank Engine reflects public Arena Mayhem data for patch 26.13.",
      ]);
    }
  });

  test("skips the lifecycle line when no removed copy is provided", () => {
    const { title, body } = englishCopy("Warlock Juicebox");
    const summary = buildPatchSummary(
      { patch: "26.13", lifecycleState: "removed", lifecyclePatch: "26.13" },
      { title, body },
    );

    expect(summary?.lines).toEqual([
      "This augment page for Warlock Juicebox reflects public Arena Mayhem data for patch 26.13.",
    ]);
  });

  test("falls back to the current patch when the lifecycle patch is missing", () => {
    const summary = buildPatchSummary(
      { patch: "26.13", lifecycleState: "removed" },
      englishCopy("Warlock Juicebox"),
    );

    expect(summary?.lines).toContain("Warlock Juicebox is marked removed in patch 26.13.");
  });

  test("does not invent changes when no public changes are provided", () => {
    const summary = buildPatchSummary({ patch: "26.13" }, englishCopy("Tank Engine"));

    expect(summary?.lines.join(" ")).not.toMatch(/buff|nerf|changed|reworked/i);
  });

  test("keeps private scoring, prompts, and session terms out of summary output", () => {
    const summary = buildPatchSummary(
      { patch: "26.13", lifecycleState: "removed", lifecyclePatch: "26.13" },
      englishCopy("Tank Engine"),
    );
    const serialized = JSON.stringify(summary).toLowerCase();

    for (const term of forbiddenSummaryTerms) {
      expect(serialized).not.toContain(term.toLowerCase());
    }
  });

  test("augment detail page renders a localized patch summary section", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/augments/[slug]/page.tsx"),
      "utf8",
    );

    expect(source).toContain('import { buildPatchSummary } from "@/lib/seo/patch-summary"');
    expect(source).toContain("const patchSummary = buildPatchSummary(");
    expect(source).toContain('t("patchSummaryTitle")');
    expect(source).toContain('t("patchSummaryBody", { name: augmentName, patch })');
    expect(source).toContain('t("patchSummaryRemoved", { name: augmentName, patch })');
    expect(source).toContain("{patchSummary && (");
    expect(source).toContain("patchSummary.lines.map");
  });

  test("item detail page renders a localized patch summary section from public meta patch", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/items/[identifier]/page.tsx"),
      "utf8",
    );

    expect(source).toContain('import { buildPatchSummary } from "@/lib/seo/patch-summary"');
    expect(source).toContain('import { readMetaFile } from "@/lib/data/read-public-file"');
    expect(source).toContain("const patchSummary = buildPatchSummary(");
    expect(source).toContain('t("patchSummaryTitle")');
    expect(source).toContain('t("patchSummaryBody", { name: itemName, patch })');
    expect(source).toContain("{patchSummary && (");
    expect(source).toContain("patchSummary.lines.map");
  });

  test("patch summary copy exists in every locale message file", () => {
    for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"]) {
      const messages = JSON.parse(
        readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8"),
      ) as { augments: Record<string, string>; items: Record<string, string> };

      for (const key of ["patchSummaryTitle", "patchSummaryBody", "patchSummaryRemoved"]) {
        expect(messages.augments[key], `${locale}.augments.${key}`).toBeTruthy();
      }
      for (const key of ["patchSummaryTitle", "patchSummaryBody"]) {
        expect(messages.items[key], `${locale}.items.${key}`).toBeTruthy();
      }
      for (const namespace of ["augments", "items"] as const) {
        expect(messages[namespace].patchSummaryBody).toContain("{name}");
        expect(messages[namespace].patchSummaryBody).toContain("{patch}");
      }
      expect(messages.augments.patchSummaryRemoved).toContain("{name}");
      expect(messages.augments.patchSummaryRemoved).toContain("{patch}");
    }
  });
});
