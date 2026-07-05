import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const SEO_DIR = path.join(process.cwd(), "src/lib/seo");

/**
 * Structural boundary for the public SEO/GEO helpers: whatever fixtures the
 * output tests use, a helper that can reach member, session, internal, or
 * network data is already a leak vector. Every file in src/lib/seo must stay
 * a pure transform over public inputs.
 */
const forbiddenPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /data\/internal/, reason: "internal data path" },
  { pattern: /supabase/i, reason: "Supabase client access" },
  { pattern: /entitlement/i, reason: "member entitlement access" },
  { pattern: /\bsession\b/i, reason: "session state access" },
  { pattern: /\bfetch\s*\(/, reason: "network fetch" },
  { pattern: /createClient\s*\(/, reason: "service client construction" },
  { pattern: /process\.env/, reason: "environment access" },
  { pattern: /next\/headers/, reason: "request header access" },
  { pattern: /node:fs|from "fs|require\("fs/, reason: "filesystem access" },
  { pattern: /pool-orchestrator|oracle-score|augment-tailoring/, reason: "scoring engine import" },
];

describe("public SEO helper boundary", () => {
  const files = readdirSync(SEO_DIR).filter((file) => file.endsWith(".ts"));

  test("covers the SEO helper directory", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    test(`${file} stays a pure transform over public inputs`, () => {
      const source = readFileSync(path.join(SEO_DIR, file), "utf8");

      for (const { pattern, reason } of forbiddenPatterns) {
        expect(
          pattern.test(source),
          `src/lib/seo/${file} must not contain ${reason} (${pattern})`,
        ).toBe(false);
      }
    });
  }
});
