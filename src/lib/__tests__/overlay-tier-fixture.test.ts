import { describe, expect, test } from "vitest";
import {
  disabledMember,
  memberRecommendationsVisible,
} from "../../../overlay/src/auth/member";
import { formatWinRate, tierForGrade } from "../../../overlay/src/model/tier";
import {
  buildAramggDecisionResult,
  isTierFixtureEnabled,
  tierFixtureEnabledFrom,
  TIER_FIXTURE_MEMBER,
  type AramggFixtureCard,
} from "../../../overlay/src/dev/tierFixture";
import {
  buildCatalogIndex,
  decimalShiftPercent,
  loadAramggSource,
  numericTierToGrade,
  numericTierToLetter,
  parseAramggSource,
  parseNumericTier,
  parseStatsList,
  resolveAugmentId,
  type AramggRaws,
  type AramggStat,
} from "../../../overlay/src/dev/aramggSource";
import {
  geometryPreviewEnabledFrom,
  resolveOverlayFixtureMode,
  type FixtureModeInput,
} from "../../../overlay/src/dev/fixtureMode";

// ─── Fixtures modeling the real ARAMGG shapes ───

const CATALOG = {
  // unambiguous icon
  "1001": { name: "ARAM_Alpha", displayName: "阿尔法", iconLarge: "Alpha_large.png" },
  // 1002 & 1003 share an icon base → ambiguous unless localized name breaks it
  "1002": { name: "ARAM_Beta", displayName: "贝塔", iconLarge: "Shared_large.png" },
  "1003": { name: "ARAM_Gamma", displayName: "伽马", iconLarge: "Shared_large.png" },
  // duplicate display names → ambiguous localized-name lookup
  "1004": { name: "ARAM_Delta1", displayName: "重复", iconLarge: "D1_large.png" },
  "1005": { name: "ARAM_Delta2", displayName: "重复", iconLarge: "D2_large.png" },
  // Mayhem carries a "MayhemAugment" suffix ARAMGG omits
  "1006": { name: "ARAM_Warlock", displayName: "术士", iconLarge: "WarlockJuicebox_large.png" },
};

const STATS_RAW = [
  ["1001", JSON.stringify({ win_rate: "0.563213", num_games: "988166", pick_rate: "0.008409", tier: "2" })],
  // length-5 entry: blob at index 1, trailing metadata (mirrors observed data)
  ["1002", JSON.stringify({ win_rate: "0.5", num_games: "60000", tier: "1" }), "m1", "m2", "m3"],
  ["1006", JSON.stringify({ win_rate: "0.641955", num_games: "1903216", pick_rate: "0.02", tier: "1" })],
  ["1009", JSON.stringify({ win_rate: "0.4", num_games: "500", tier: "9" })], // bad tier → skipped
  ["1010", 12345], // no string blob → skipped
  "not-an-array", // skipped
];

describe("overlay ARAMGG tier fixture (dev-only)", () => {
  describe("disabled by default / production unchanged", () => {
    test("pure predicate is false with no flag", () => {
      expect(tierFixtureEnabledFrom({ dev: true, flag: undefined })).toBe(false);
      expect(tierFixtureEnabledFrom({ dev: true, flag: "0" })).toBe(false);
    });
    test("production build (dev=false) is inert even with the flag set", () => {
      expect(tierFixtureEnabledFrom({ dev: false, flag: "1" })).toBe(false);
    });
    test("only dev + flag === '1' enables; every other value is off", () => {
      expect(tierFixtureEnabledFrom({ dev: true, flag: "1" })).toBe(true);
      for (const flag of ["0", "", "true", "yes", "01", " 1"]) {
        expect(tierFixtureEnabledFrom({ dev: true, flag })).toBe(false);
      }
    });
    test("live wrapper is disabled in the ambient vitest env", () => {
      expect(isTierFixtureEnabled()).toBe(false);
    });
    test("production win-rate formatting still rounds to one decimal", () => {
      expect(formatWinRate(68.99)).toBe("69.0% WR");
      expect(formatWinRate(51.913)).toBe("51.9% WR");
      expect(formatWinRate(50)).toBe("50.0% WR");
      expect(formatWinRate(null)).toBe("WR —");
    });
    test("real member gating still needs collector + real entitlement", () => {
      expect(memberRecommendationsVisible(false, TIER_FIXTURE_MEMBER)).toBe(false);
      expect(memberRecommendationsVisible(true, disabledMember("x"))).toBe(false);
      expect(memberRecommendationsVisible(true, TIER_FIXTURE_MEMBER)).toBe(true);
    });
  });

  describe("exact win-rate via string decimal shift (no IEEE-754 artifacts)", () => {
    test.each([
      ["0.563213", "56.3213"],
      ["0.5", "50"],
      ["0.5000", "50.00"],
      ["1", "100"],
      ["0", "0"],
      ["0.641955", "64.1955"],
    ])("%s → %s", (input, expected) => {
      expect(decimalShiftPercent(input)).toBe(expected);
    });
    test("never introduces a float artifact the way ×100 would", () => {
      expect(decimalShiftPercent("0.563213")).toBe("56.3213");
      expect(decimalShiftPercent("0.563213")).not.toContain("0000000");
      // documents the artifact we deliberately avoid
      expect(String(0.563213 * 100)).not.toBe("56.3213");
    });
    test.each(["", "abc", "-0.5", "1.2.3", "1e3", ".5", "0."])(
      "rejects malformed fraction %s",
      (bad) => {
        expect(() => decimalShiftPercent(bad)).toThrow();
      },
    );
  });

  describe("tier mapping 1→S+ … 5→C", () => {
    test.each([
      ["1", "S+", "hot"],
      ["2", "S", "strong"],
      ["3", "A", "steady"],
      ["4", "B", "average"],
      ["5", "C", "weak"],
    ] as const)("tier %s", (tier, letter, grade) => {
      expect(numericTierToLetter(tier)).toBe(letter);
      expect(numericTierToGrade(tier)).toBe(grade);
      // the render path shows tierForGrade(grade) — must equal the letter
      expect(tierForGrade(numericTierToGrade(tier))).toBe(letter);
    });
    test.each(["0", "6", "x", "", " ", "1.0", "-1"])("rejects malformed tier %s", (bad) => {
      expect(() => parseNumericTier(bad)).toThrow();
    });
  });

  describe("parse nested statsJSONString", () => {
    test("double-parses, handles variable-length entries, skips malformed", () => {
      const { stats, skipped } = parseStatsList(STATS_RAW);
      expect(stats.get("1001")?.winRatePercent).toBe("56.3213");
      expect(stats.get("1001")?.tier).toBe(2);
      expect(stats.get("1001")?.tierLetter).toBe("S");
      expect(stats.get("1002")?.winRatePercent).toBe("50"); // length-5 entry
      expect(stats.get("1006")?.numGames).toBe("1903216");
      expect(stats.has("1009")).toBe(false); // bad tier
      expect(stats.has("1010")).toBe(false); // no blob
      expect(skipped).toBeGreaterThanOrEqual(3);
    });
    test("throws on a non-array payload (never fabricates)", () => {
      expect(() => parseStatsList({} as unknown)).toThrow();
    });
  });

  describe("canonical-ID matching priority (no silent ambiguous match)", () => {
    const index = buildCatalogIndex(CATALOG);

    test("priority 1: numeric canonical augment ID", () => {
      expect(resolveAugmentId({ numericId: "1001" }, index)).toEqual({
        augmentId: "1001",
        method: "canonical-name",
      });
    });
    test("priority 2: language-independent canonical (ARAM_*) name", () => {
      expect(resolveAugmentId({ canonicalName: "ARAM_Gamma" }, index)).toEqual({
        augmentId: "1003",
        method: "canonical-name",
      });
    });
    test("priority 2: unambiguous CDragon icon base", () => {
      expect(resolveAugmentId({ iconBase: "alpha" }, index)).toEqual({
        augmentId: "1001",
        method: "cdragon-icon",
      });
    });
    test("icon 'MayhemAugment' suffix still resolves via normalization", () => {
      expect(resolveAugmentId({ iconBase: "warlockjuicebox" }, index)).toEqual({
        augmentId: "1006",
        method: "cdragon-icon",
      });
    });
    test("ambiguous icon is rejected without a tie-break", () => {
      const r = resolveAugmentId({ iconBase: "shared" }, index);
      expect(r.augmentId).toBeNull();
      expect((r as { reason: string }).reason).toBe("ambiguous-icon");
    });
    test("ambiguous icon disambiguated by localized name", () => {
      expect(
        resolveAugmentId({ iconBase: "shared", localizedName: "贝塔" }, index),
      ).toEqual({ augmentId: "1002", method: "cdragon-icon+zh-tiebreak" });
    });
    test("priority 3: localized display-name last resort", () => {
      expect(resolveAugmentId({ localizedName: "阿尔法" }, index)).toEqual({
        augmentId: "1001",
        method: "localized-name",
      });
    });
    test("ambiguous localized name is rejected", () => {
      const r = resolveAugmentId({ localizedName: "重复" }, index);
      expect(r.augmentId).toBeNull();
      expect((r as { reason: string }).reason).toBe("ambiguous-name");
    });
    test("no match yields unmatched (never a guess)", () => {
      const r = resolveAugmentId({ iconBase: "nope", localizedName: "无" }, index);
      expect(r.augmentId).toBeNull();
      expect((r as { reason: string }).reason).toBe("unmatched");
    });
  });

  describe("decision result uses ONLY ARAMGG stats (no synthetic/local fallback)", () => {
    const stat = (over: Partial<AramggStat>): AramggStat => ({
      augmentId: "1001",
      rawWinRate: "0.563213",
      winRatePercent: "56.3213",
      numGames: "988166",
      pickRate: "0.008409",
      tier: 2,
      tierLetter: "S",
      grade: "strong",
      ...over,
    });
    const cards: AramggFixtureCard[] = [
      { slug: "alpha", stat: stat({}), method: "cdragon-icon" },
      {
        slug: "beta",
        stat: stat({
          augmentId: "1002",
          rawWinRate: "0.5",
          winRatePercent: "50",
          numGames: "600",
          tier: 1,
          tierLetter: "S+",
          grade: "hot",
        }),
        method: "cdragon-icon+zh-tiebreak",
      },
    ];

    test("winRateDisplayBySlug carries the exact string, not a rounded/float value", () => {
      const payload = buildAramggDecisionResult(cards, 1);
      expect(payload.winRateDisplayBySlug["alpha"]).toBe("56.3213");
      expect(payload.winRateDisplayBySlug["beta"]).toBe("50");
    });
    test("grade → tierForGrade reproduces the relabeled ARAMGG tier on every card", () => {
      const payload = buildAramggDecisionResult(cards, 1);
      for (const c of payload.result.candidates) {
        const row = payload.debugRows.find((d) => d.slug === c.augmentSlug)!;
        expect(tierForGrade(c.grade)).toBe(row.cardTier);
      }
    });
    test("confidence reflects real sample size (low below threshold)", () => {
      const payload = buildAramggDecisionResult(cards, 1);
      const alpha = payload.result.candidates.find((c) => c.augmentSlug === "alpha")!;
      const beta = payload.result.candidates.find((c) => c.augmentSlug === "beta")!;
      expect(alpha.confidence).toBe("high"); // 988166 games
      expect(beta.confidence).toBe("low"); // 600 games
    });
    test("debug rows expose full provenance for every rendered card", () => {
      const payload = buildAramggDecisionResult(cards, 1);
      expect(payload.debugRows).toHaveLength(2);
      expect(payload.debugRows[0]).toMatchObject({
        slug: "alpha",
        augmentId: "1001",
        method: "cdragon-icon",
        rawWinRate: "0.563213",
        winRatePercent: "56.3213",
        upstreamTier: 2,
        cardTier: "S",
      });
    });
  });

  describe("formatWinRate string passthrough (exact source, no float)", () => {
    test("passes the exact percentage string through verbatim", () => {
      expect(formatWinRate("56.3213")).toBe("56.3213% WR");
      expect(formatWinRate("50.00")).toBe("50.00% WR");
    });
    test("empty string renders the missing marker", () => {
      expect(formatWinRate("")).toBe("WR —");
    });
  });

  describe("loadAramggSource fails explicitly, never fakes", () => {
    const okResponse = (data: unknown) =>
      ({ ok: true, status: 200, json: async () => data }) as Response;

    const fakeFetch = (map: Record<string, unknown>): typeof fetch =>
      (async (input: RequestInfo | URL) => {
        const url = String(input);
        const key = Object.keys(map).find((k) => url.includes(k));
        if (!key) return { ok: false, status: 404, json: async () => ({}) } as Response;
        return okResponse(map[key]);
      }) as typeof fetch;

    test("parses a full live payload through the dev proxy paths", async () => {
      const source = await loadAramggSource(
        fakeFetch({
          "augments-stats-raw.json": STATS_RAW,
          "aram-mayhem-augments.zh_cn.json": CATALOG,
          "augments-changelog/index.json": { versions: ["16.13"], latest: "16.13" },
        }),
      );
      expect(source.patch).toBe("16.13");
      expect(source.statsById.get("1001")?.winRatePercent).toBe("56.3213");
      expect(source.sourceUrls.stats).toBe("https://aramgg.com/data/augments-stats-raw.json");
    });
    test("throws (does not fabricate) when a file 404s", async () => {
      await expect(
        loadAramggSource(fakeFetch({ "aram-mayhem-augments.zh_cn.json": CATALOG })),
      ).rejects.toThrow(/HTTP 404/);
    });
    test("throws when stats parse to zero valid records", () => {
      const raws: AramggRaws = {
        stats: ["garbage"],
        catalog: CATALOG,
        changelog: { latest: "16.13" },
      };
      expect(() => parseAramggSource(raws, 0)).toThrow(/zero valid records/);
    });
  });
});

// ─── Release-blocking regressions from the 12:20–12:22 live test ───
//
// The reported defects (synthetic B/C/A badges over Finder/Safari, stale S
// badges lingering, injected records over real cards, non-recovery on refocus,
// a persistent empty translucent rectangle) all traced to auto-injected
// geometry firing whenever OCR dropped below three cards while forcing
// leagueFocused/phase. `resolveOverlayFixtureMode` is the pure state machine
// that replaces that logic; these tests pin every reported failure path.
describe("overlay fixture STATE MACHINE — release-blocking regressions", () => {
  const base: FixtureModeInput = {
    tierFixtureOn: true,
    previewOn: false,
    leagueFocused: true,
    phase: "augment_selection",
    completeOffer: true,
    aramggReady: true,
  };
  const kind = (o: Partial<FixtureModeInput> = {}) =>
    resolveOverlayFixtureMode({ ...base, ...o }).kind;

  // 1. focus → blur → focus with the SAME offer
  test("focus→blur→focus (same offer): real → hidden → real recovers", () => {
    expect(kind({ leagueFocused: true })).toBe("real-offer");
    expect(kind({ leagueFocused: false })).toBe("hidden"); // blur hides everything
    expect(kind({ leagueFocused: true })).toBe("real-offer"); // refocus recovers
  });

  // 2. focus → blur → focus with a CHANGED offer (OCR mid-rescan on refocus)
  test("focus→blur→focus (changed offer): no badges until 3 confident cards", () => {
    expect(kind({ leagueFocused: false })).toBe("hidden");
    // refocused but the new offer's OCR is not yet complete → diagnostic, not
    // stale badges from the prior offer
    expect(kind({ leagueFocused: true, completeOffer: false })).toBe("ocr-unavailable");
    // OCR completes on the new offer → real badges
    expect(kind({ leagueFocused: true, completeOffer: true })).toBe("real-offer");
  });

  // 3. OCR failure while League remains visible/focused
  test("OCR failure while League focused → diagnostic, never synthetic", () => {
    expect(kind({ completeOffer: false })).toBe("ocr-unavailable");
    // ARAMGG not ready is still a diagnostic, never a geometry/preview fallback
    expect(kind({ completeOffer: false, aramggReady: false })).toBe("ocr-unavailable");
  });

  // 4. no synthetic fallback in an active game
  test("active game (in_game) never injects geometry", () => {
    expect(kind({ phase: "in_game", completeOffer: false })).toBe("hidden");
    // even with the preview flag on, a running game (non-idle) suppresses preview
    expect(kind({ phase: "in_game", previewOn: true, leagueFocused: false })).toBe("hidden");
  });

  // 5. no badges outside League (unfocused or not detected)
  test("League unfocused/idle hides all in-game surfaces", () => {
    expect(kind({ leagueFocused: false, phase: "augment_selection" })).toBe("hidden");
    expect(kind({ leagueFocused: false, phase: "idle" })).toBe("hidden");
    expect(kind({ leagueFocused: true, phase: "idle" })).toBe("hidden");
    expect(kind({ leagueFocused: false, phase: "client_found" })).toBe("hidden");
  });

  // 6. stale-offer invalidation: an incomplete offer never yields real badges
  test("incomplete offer is never rendered as real badges", () => {
    expect(kind({ completeOffer: false })).not.toBe("real-offer");
  });

  // 7 & 9. single overlay surface / no duplicate layers: the resolver returns
  // exactly ONE mode, and real-offer vs preview are mutually exclusive because
  // preview requires League to be entirely absent.
  test("real-offer and preview are mutually exclusive (no duplicate layers)", () => {
    // preview flag + focused real offer → real-offer wins, no preview overlay
    expect(
      kind({ previewOn: true, leagueFocused: true, phase: "augment_selection" }),
    ).toBe("real-offer");
    // preview flag + League entirely absent → preview only
    expect(
      kind({
        tierFixtureOn: false,
        previewOn: true,
        leagueFocused: false,
        phase: "idle",
      }),
    ).toBe("preview");
  });

  // 8. no orphaned/synthetic surface: geometry preview requires its OWN flag AND
  // League entirely absent, and never fabricates stats.
  test("geometry preview requires its own flag AND League absent", () => {
    const preview = (o: Partial<FixtureModeInput>) =>
      kind({ tierFixtureOn: false, previewOn: true, ...o });
    // tier fixture alone (no preview flag) never previews, even idle+unfocused
    expect(kind({ previewOn: false, leagueFocused: false, phase: "idle" })).toBe("hidden");
    // preview flag but League focused → suppressed
    expect(preview({ leagueFocused: true, phase: "idle" })).toBe("hidden");
    // preview flag but a game is running (non-idle) → suppressed
    expect(preview({ leagueFocused: false, phase: "in_game" })).toBe("hidden");
    // preview flag + League absent (idle + unfocused) + ARAMGG ready → preview
    expect(preview({ leagueFocused: false, phase: "idle", aramggReady: true })).toBe("preview");
    // ARAMGG not ready → hidden, never synthetic stats
    expect(preview({ leagueFocused: false, phase: "idle", aramggReady: false })).toBe("hidden");
  });

  // 10. dummy P:50% removed — ARAMGG-backed candidates carry probability 0 (the
  // badge suppresses the `P:` span entirely for fixture-backed candidates).
  test("ARAMGG-backed candidates carry NO fabricated pick probability", () => {
    const card: AramggFixtureCard = {
      slug: "alpha",
      method: "cdragon-icon",
      stat: {
        augmentId: "1001",
        rawWinRate: "0.563213",
        winRatePercent: "56.3213",
        numGames: "988166",
        pickRate: "0.008409",
        tier: 2,
        tierLetter: "S",
        grade: "strong",
      },
    };
    const payload = buildAramggDecisionResult([card], 1);
    expect(payload.result.candidates[0].probability.withNormalRerolls).toBe(0);
    expect(payload.result.candidates[0].probability.initialThree).toBe(0);
  });

  // 11. atomic three-card update: real badges require a COMPLETE three-card offer
  test("real badges require a complete three-card offer (atomic replacement)", () => {
    expect(kind({ completeOffer: true })).toBe("real-offer");
    expect(kind({ completeOffer: false })).toBe("ocr-unavailable");
  });

  // preview enable predicate: dev build AND explicit flag=1 (separate from the
  // tier-fixture flag).
  test("geometryPreviewEnabledFrom requires dev build AND flag=1", () => {
    expect(geometryPreviewEnabledFrom({ dev: true, flag: "1" })).toBe(true);
    expect(geometryPreviewEnabledFrom({ dev: false, flag: "1" })).toBe(false);
    expect(geometryPreviewEnabledFrom({ dev: true, flag: undefined })).toBe(false);
    expect(geometryPreviewEnabledFrom({ dev: true, flag: "0" })).toBe(false);
  });
});
