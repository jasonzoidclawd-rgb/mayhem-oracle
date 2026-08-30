/**
 * Contract for the manual ARAMGG champion x augment artifact generator.
 *
 * The generator's whole value is that a number in the artifact can be traced
 * back to the patch and the augment it actually describes. Each test below pins
 * one way that tracing was previously lost:
 *
 *   - the dev loader read `entry[0]`/`entry[1]` and discarded the patch and
 *     date in `entry[2]`/`entry[3]`
 *   - `normalizeAramggPatch` converted namespaces by adding 10 to the major
 *   - a null win-rate row was dropped, making "too few samples" look identical
 *     to "this augment does not exist for this champion"
 *   - two canonical augments could claim one ARAMGG id and the first one seen
 *     silently won
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  ARTIFACT_SCHEMA_VERSION,
  acquireChampionFiles,
  buildArtifact,
  buildIdentityIndex,
  canonicalJson,
  generateAndWrite,
  parseChampionEnvelope,
  readCanonicalAugments,
  readRoster,
  serializeArtifact,
  sha256Hex,
  verifyArtifactChecksum,
  type BuildInputs,
  type CanonicalAugment,
} from "../../../scripts/aramgg/generate-champion-augment-artifact";
import { SEEDED_PATCH_REGISTRY, type PatchRegistry } from "../contracts/patch-identity";

// ─── Fixtures: frozen, so every assertion below is about the generator ───

const JUGGERNAUT = "1001";
const APEX = "1002";
const ORPHAN = "2135";

const ARAMGG_CATALOG: Record<string, unknown> = {
  [JUGGERNAUT]: {
    id: 1001,
    name: "ARAM_ImTheJuggernaut",
    displayName: "泰坦的坚决",
    iconLarge: "iamthejuggernaut_large.png",
    iconSmall: "iamthejuggernaut_small.png",
    enabled: true,
  },
  [APEX]: {
    id: 1002,
    name: "ARAM_ApexInventor",
    displayName: "尖端发明家",
    iconLarge: "apexinventor_large.png",
    iconSmall: "apexinventor_small.png",
    enabled: true,
  },
  // Present upstream, absent from the canonical catalog below — the shape of a
  // real 26.16-era augment that 26.17 removed.
  [ORPHAN]: {
    id: 2135,
    name: "Overkill",
    displayName: "针插垫",
    iconLarge: "overkill_large.png",
    enabled: true,
  },
};

const CANONICAL_AUGMENTS: CanonicalAugment[] = [
  {
    slug: "im-the-juggernaut",
    augmentId: "ARAM_ImTheJuggernaut",
    iconLarge: "assets/ux/cherry/augments/icons/iamthejuggernaut_large.png",
    localizedNameZhCn: "泰坦的坚决",
    lifecycle: "active",
  },
  {
    slug: "apex-inventor",
    augmentId: "ARAM_ApexInventor",
    iconLarge: "assets/ux/cherry/augments/icons/apexinventor_large.png",
    localizedNameZhCn: "尖端发明家",
    lifecycle: "active",
  },
];

/** A row carrying every statistic ARAMGG publishes when it has enough samples. */
const FULL_ROW = {
  tier: "3",
  rank: "101",
  total: "145",
  num_win_games: "191",
  win_rate: "0.5204",
  num_games: "367",
  pick_rate: "0.0021",
  win_rate_source: "aramgg-client-upload",
  win_rate_region: "WORLD",
  win_rate_minimum_games: 255,
};

/** A real row below the sample threshold. Not a malformed row. */
const NULL_STAT_ROW = {
  tier: "3",
  rank: "112",
  total: "145",
  num_win_games: null,
  win_rate: null,
  num_games: null,
  pick_rate: "0.001",
};

/**
 * `null` OMITS the element, rather than writing a null into it — passing
 * `undefined` would silently re-apply the default and test nothing.
 */
function championFile(
  championKey: string,
  augments: Record<string, unknown>,
  servingPatch: string | null = "16.16",
  observedAt: string | null = "2026-08-22",
): string {
  const payload = JSON.stringify({
    augments,
    region: "CN",
    source: "tencent",
    augment_trios_source: "aramgg-client-upload",
  });
  const entry: unknown[] = [championKey, payload];
  if (servingPatch !== null) entry.push(servingPatch);
  if (observedAt !== null) entry.push(observedAt);
  return JSON.stringify([entry]);
}

function inputs(overrides: Partial<BuildInputs> = {}): BuildInputs {
  return {
    roster: [{ championKey: "67", slug: "vayne" }],
    acquired: [
      {
        championKey: "67",
        slug: "vayne",
        text: championFile("67", { [JUGGERNAUT]: FULL_ROW, [APEX]: NULL_STAT_ROW }),
      },
    ],
    absent: [],
    aramggCatalog: ARAMGG_CATALOG,
    changelog: { versions: ["16.16", "16.17"], latest: "16.17" },
    canonicalAugments: CANONICAL_AUGMENTS,
    registry: SEEDED_PATCH_REGISTRY,
    ...overrides,
  };
}

function buildOk(overrides: Partial<BuildInputs> = {}) {
  const result = buildArtifact(inputs(overrides));
  if (!result.ok) {
    throw new Error(`expected a successful build, got: ${JSON.stringify(result.failures)}`);
  }
  return result.artifact;
}

// ─── Isolated current-file absence ───

/**
 * ARAMGG publishes a static file per champion. On a patch rollover an individual
 * champion's current-patch file can be missing while the origin is demonstrably
 * healthy: the catalog and changelog (same static origin, both mandatory inputs)
 * resolve, and every other champion serves a uniform current serving patch.
 *
 * That is a publication gap, not an outage, and the artifact must account for it
 * explicitly rather than either failing the whole run or — far worse — promoting
 * the champion's stale historical numbers as current. The champion is recorded
 * with zero rows so no fabricated, global, or stale value can reach a consumer.
 */
describe("an isolated current-file absence is accounted for, not fatal", () => {
  const ROSTER = [
    { championKey: "22", slug: "ashe" },
    { championKey: "67", slug: "vayne" },
  ];
  const ISOLATED_404 = { championKey: "22", slug: "ashe", httpStatus: 404 };

  function withAbsentAshe(overrides: Partial<BuildInputs> = {}) {
    return { roster: ROSTER, absent: [ISOLATED_404], ...overrides };
  }

  test("a healthy source with one isolated 404 still emits an artifact", () => {
    const result = buildArtifact(inputs(withAbsentAshe()));
    expect(result.ok).toBe(true);
  });

  test("the absent champion is accounted for, with no row of its own", () => {
    const artifact = buildOk(withAbsentAshe());
    expect(artifact.payload.championsWithoutCurrentSource).toEqual([
      { championKey: "22", slug: "ashe", httpStatus: 404 },
    ]);
    expect(artifact.payload.champions.map((c) => c.championKey)).toEqual(["67"]);
    expect(artifact.payload.roster.expectedChampions).toBe(2);
    expect(artifact.payload.roster.acquiredChampions).toBe(1);
    expect(artifact.payload.roster.absentChampions).toBe(1);
  });

  test("no stale statistic is promoted for the absent champion", () => {
    const artifact = buildOk(withAbsentAshe());
    const serialized = JSON.stringify(artifact.payload.champions);
    expect(serialized).not.toContain("\"22\"");
    expect(serialized).not.toContain("ashe");
    // Every row the artifact carries belongs to a champion that actually served one.
    const rowOwners = new Set(artifact.payload.champions.map((c) => c.championKey));
    expect(rowOwners.has("22")).toBe(false);
  });

  test("roster accounting still covers the absent champion", () => {
    const result = buildArtifact(inputs(withAbsentAshe()));
    expect(result.ok === false && result.failures.map((f) => f.kind)).not.toContain(
      "roster-not-accounted",
    );
  });

  test("a champion in neither channel is still fatal", () => {
    const kinds = failureKinds({
      roster: [...ROSTER, { championKey: "21", slug: "missfortune" }],
      absent: [ISOLATED_404],
    });
    expect(kinds).toContain("roster-not-accounted");
  });

  // ── everything that must still fail closed ──

  test("every champion absent is a source failure, not 173 isolated gaps", () => {
    const kinds = failureKinds({
      roster: ROSTER,
      acquired: [],
      absent: [ISOLATED_404, { championKey: "67", slug: "vayne", httpStatus: 404 }],
    });
    expect(kinds).toContain("acquisition-source-unhealthy");
  });

  test.each([500, 502, 503, 403, 429, 301])("HTTP %i is never an accounted absence", (status) => {
    const kinds = failureKinds({
      roster: ROSTER,
      absent: [{ championKey: "22", slug: "ashe", httpStatus: status }],
    });
    expect(kinds).toContain("champion-acquisition-incomplete");
  });

  test("a non-404 absence alongside an isolated 404 still fails the run", () => {
    const kinds = failureKinds({
      roster: [...ROSTER, { championKey: "21", slug: "missfortune" }],
      absent: [ISOLATED_404, { championKey: "21", slug: "missfortune", httpStatus: 500 }],
    });
    expect(kinds).toContain("champion-acquisition-incomplete");
  });

  test("a malformed envelope is still fatal even with an accounted absence", () => {
    const kinds = failureKinds(
      withAbsentAshe({ acquired: [{ championKey: "67", slug: "vayne", text: "{not json" }] }),
    );
    expect(kinds).toContain("champion-envelope-invalid");
  });

  test("a wrong-champion envelope is still fatal even with an accounted absence", () => {
    const kinds = failureKinds(
      withAbsentAshe({
        acquired: [
          {
            championKey: "67",
            slug: "vayne",
            text: championFile("99", { [JUGGERNAUT]: FULL_ROW }),
          },
        ],
      }),
    );
    expect(kinds).toContain("champion-envelope-invalid");
  });
});

function failureKinds(overrides: Partial<BuildInputs> = {}): string[] {
  const result = buildArtifact(inputs(overrides));
  if (result.ok) throw new Error("expected the build to fail closed, but it succeeded");
  return result.failures.map((failure) => failure.kind);
}

// ─── Provenance preservation ───

describe("source provenance survives generation", () => {
  test("entry[2] and entry[3] reach the artifact", () => {
    const artifact = buildOk();
    const champion = artifact.payload.champions[0];
    expect(champion.servingPatchRaw).toBe("16.16");
    expect(champion.observedAt).toBe("2026-08-22");
  });

  test("payload-level region and stat source are kept apart from the row-level ones", () => {
    // ARAMGG reports the champion totals as CN/tencent while the per-augment
    // win rates carry WORLD/aramgg-client-upload. Collapsing the two would
    // attribute one population's numbers to another.
    const champion = buildOk().payload.champions[0];
    expect(champion.region).toBe("CN");
    expect(champion.statSource).toBe("tencent");
    const row = champion.rows.find((r) => r.aramggAugmentId === JUGGERNAUT);
    expect(row?.region).toBe("WORLD");
    expect(row?.statSource).toBe("aramgg-client-upload");
  });

  test("an entry without the patch/date elements is rejected, not defaulted", () => {
    const result = parseChampionEnvelope(
      JSON.stringify([["67", JSON.stringify({ augments: {} })]]),
      "67",
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("entry-missing-provenance-elements");
  });

  test("a build over such a file fails closed", () => {
    expect(
      failureKinds({
        acquired: [
          {
            championKey: "67",
            slug: "vayne",
            text: championFile("67", { [JUGGERNAUT]: FULL_ROW }, null, null),
          },
        ],
      }),
    ).toContain("champion-envelope-invalid");
  });
});

// ─── Patch semantics ───

describe("patch identity is a lookup, resolved once per namespace", () => {
  test("the serving patch resolves through PatchIdentity", () => {
    const serving = buildOk().payload.sourcePatch.serving;
    expect(serving.rawValue).toBe("16.16");
    expect(serving.identity.displayPatch).toBe("26.16");
    expect(serving.identity.runtimePatch).toBe("16.16");
    expect(serving.identity.equivalenceEvidence).toBe("sequence-inferred");
  });

  test("the target patch resolves independently and does not overwrite the serving patch", () => {
    const { serving, target } = buildOk().payload.sourcePatch;
    expect(target.rawValue).toBe("16.17");
    expect(target.identity.displayPatch).toBe("26.17");
    expect(target.identity.equivalenceEvidence).toBe("live-co-observed");
    // The lag is the point: 16.16 observations under a 16.17 collection target.
    expect(serving.identity.displayPatch).not.toBe(target.identity.displayPatch);
    expect(serving.rawValue).toBe("16.16");
  });

  test("observations are never relabelled to the current catalog patch", () => {
    const artifact = buildOk();
    for (const champion of artifact.payload.champions) {
      expect(champion.servingPatchRaw).toBe("16.16");
      expect(champion.servingPatchRaw).not.toBe("26.17");
      expect(champion.servingPatchRaw).not.toBe("16.17");
    }
  });

  test("an unresolvable serving patch fails closed", () => {
    // 15.9 is well-formed and in the runtime namespace, but the registry has no
    // pair for it. Arithmetic would have happily minted "25.9".
    expect(
      failureKinds({
        acquired: [
          {
            championKey: "67",
            slug: "vayne",
            text: championFile("67", { [JUGGERNAUT]: FULL_ROW }, "15.9"),
          },
        ],
      }),
    ).toContain("patch-unresolved");
  });

  test("an unresolvable target patch fails closed", () => {
    expect(failureKinds({ changelog: { latest: "15.9" } })).toContain("patch-unresolved");
  });

  test("a changelog with no .latest fails closed", () => {
    expect(failureKinds({ changelog: { versions: ["16.16"] } })).toContain(
      "changelog-latest-missing",
    );
  });

  test("champions disagreeing about the serving patch are never collapsed", () => {
    const kinds = failureKinds({
      roster: [
        { championKey: "67", slug: "vayne" },
        { championKey: "104", slug: "graves" },
      ],
      acquired: [
        {
          championKey: "67",
          slug: "vayne",
          text: championFile("67", { [JUGGERNAUT]: FULL_ROW }, "16.16"),
        },
        {
          championKey: "104",
          slug: "graves",
          text: championFile("104", { [JUGGERNAUT]: FULL_ROW }, "16.17"),
        },
      ],
    });
    expect(kinds).toContain("serving-patch-not-uniform");
  });

  test("an empty registry vouches for nothing", () => {
    const empty: PatchRegistry = { pairs: [], previewRuntimePatches: [] };
    expect(failureKinds({ registry: empty })).toContain("patch-unresolved");
  });

  test("a rejected run still reports which patches it resolved", () => {
    // The run an operator most needs provenance from is the one that failed.
    const result = buildArtifact(
      inputs({ absent: [{ championKey: "22", slug: "ashe", httpStatus: 500 }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.resolved.serving?.identity.displayPatch).toBe("26.16");
    expect(result.resolved.target?.identity.displayPatch).toBe("26.17");
  });

  test("a patch that cannot be resolved is reported as null, not guessed", () => {
    const result = buildArtifact({ ...inputs(), changelog: { latest: "15.9" } });
    expect(result.ok).toBe(false);
    expect(result.resolved.target).toBeNull();
    // The other facet is unaffected: one bad patch does not poison the other.
    expect(result.resolved.serving?.identity.displayPatch).toBe("26.16");
  });

  test("the generator contains no arithmetic namespace conversion", () => {
    const source = readFileSync(
      path.resolve(__dirname, "..", "..", "..", "scripts", "aramgg", "generate-champion-augment-artifact.ts"),
      "utf8",
    );
    // Comments are stripped first: the claim is about what the generator DOES.
    // Its documentation names `normalizeAramggPatch` precisely to record that
    // the function is gone and must not return, and that prose must not be
    // mistaken for the thing it warns about.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/normalizeAramggPatch/);
    // `major + 10` / `major - 10` in any spacing, and the string surgery that
    // used to stand in for it.
    expect(code).not.toMatch(/major\s*[+-]\s*10/);
    expect(code).not.toMatch(/[+-]\s*10\b/);
    expect(code).not.toMatch(/replace\(\s*["'`]16\./);
    expect(code).not.toMatch(/replace\(\s*["'`]26\./);
  });
});

describe("the ARAMGG dataset revision is not a patch", () => {
  test("it is preserved verbatim and never truncated", () => {
    const artifact = buildOk({
      revision: { rawValue: "16.16.3", source: "https://aramgg.com/example" },
    });
    const revision = artifact.payload.sourcePatch.revision;
    expect(revision.rawValue).toBe("16.16.3");
    expect(revision.source).toBe("https://aramgg.com/example");
    // Not truncated to "16.16", and not resolved into either namespace.
    expect(revision.rawValue).not.toBe("16.16");
    expect(revision).not.toHaveProperty("identity");
    expect(revision).not.toHaveProperty("displayPatch");
  });

  test("it is null, not invented, when no surface publishes one", () => {
    expect(buildOk().payload.sourcePatch.revision.rawValue).toBeNull();
  });

  test("it never displaces either resolved patch", () => {
    const artifact = buildOk({ revision: { rawValue: "16.16.3", source: "x" } });
    expect(artifact.payload.sourcePatch.serving.rawValue).toBe("16.16");
    expect(artifact.payload.sourcePatch.target.rawValue).toBe("16.17");
  });
});

// ─── Identity reconciliation ───

describe("augment identity reconciliation", () => {
  test("a canonical-name match carries its method", () => {
    const row = buildOk().payload.champions[0].rows.find((r) => r.aramggAugmentId === JUGGERNAUT);
    expect(row?.canonicalAugmentId).toBe("ARAM_ImTheJuggernaut");
    expect(row?.identityMethod).toBe("canonical-name");
  });

  test("an ARAMGG augment with no canonical counterpart fails the run closed", () => {
    const kinds = failureKinds({
      acquired: [
        {
          championKey: "67",
          slug: "vayne",
          text: championFile("67", { [JUGGERNAUT]: FULL_ROW, [ORPHAN]: FULL_ROW }),
        },
      ],
    });
    expect(kinds).toContain("unmatched-augment-identity");
  });

  test("an unmatched augment is reported by id and name, never as absent data", () => {
    const result = buildArtifact(
      inputs({
        acquired: [
          {
            championKey: "67",
            slug: "vayne",
            text: championFile("67", { [JUGGERNAUT]: FULL_ROW, [ORPHAN]: FULL_ROW }),
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unmatched = result.failures.find((f) => f.kind === "unmatched-augment-identity");
    expect(unmatched).toBeDefined();
    if (unmatched?.kind !== "unmatched-augment-identity") return;
    expect(unmatched.ids).toEqual([
      { aramggAugmentId: ORPHAN, rows: 1, aramggName: "Overkill" },
    ]);
  });

  test("two canonical augments claiming one ARAMGG id is ambiguous, not first-wins", () => {
    const duplicated: CanonicalAugment[] = [
      ...CANONICAL_AUGMENTS,
      {
        // Same canonical identity as im-the-juggernaut. This is the shape of the
        // real `ARAM_RabbleRousing` duplicate in data/internal/augments.json.
        slug: "juggernaut-duplicate",
        augmentId: "ARAM_ImTheJuggernaut",
        iconLarge: null,
        localizedNameZhCn: null,
        lifecycle: "active",
      },
    ];
    const index = buildIdentityIndex(duplicated, ARAMGG_CATALOG);
    expect(index.collisions).toEqual([
      { aramggAugmentId: JUGGERNAUT, slugs: ["im-the-juggernaut", "juggernaut-duplicate"] },
    ]);
    // The contested id resolves to nothing rather than to whichever came first.
    expect(index.byAramggId.has(JUGGERNAUT)).toBe(false);
    expect(failureKinds({ canonicalAugments: duplicated })).toContain("ambiguous-augment-identity");
  });

  test("a canonical-name claim outranks an icon claim on the same ARAMGG id", () => {
    // The real shape: Riot ships Droppybara (Dropybara_Active, ARAMGG 1414)
    // using Orbital Laser's icon asset, and ARAMGG publishes no Orbital Laser
    // entry at all. Droppybara names the augment; Orbital Laser only shares its
    // picture. An icon is an asset, not an identity, so it must never take an
    // id away from the augment whose canonical name matches it.
    const sharedIcon: CanonicalAugment[] = [
      ...CANONICAL_AUGMENTS,
      {
        slug: "shares-apex-icon",
        augmentId: "ARAM_NotPublishedByAramgg",
        iconLarge: "assets/ux/cherry/augments/icons/apexinventor_large.png",
        localizedNameZhCn: null,
        lifecycle: "active",
      },
    ];
    const index = buildIdentityIndex(sharedIcon, ARAMGG_CATALOG);

    expect(index.collisions).toEqual([]);
    expect(index.byAramggId.get(APEX)?.slug).toBe("apex-inventor");
    expect(index.byAramggId.get(APEX)?.method).toBe("canonical-name");
    // The weaker claimant is not silently dropped: it is reported as outranked.
    const outranked = index.rejections.find((r) => r.slug === "shares-apex-icon");
    expect(outranked?.reason).toBe("outranked");
    expect(outranked?.detail).toContain("apex-inventor");
  });

  test("two equally strong claims stay ambiguous rather than being ranked", () => {
    // Both claim ARAMGG 1002 by icon alone. Neither is stronger, so neither wins.
    const tied: CanonicalAugment[] = [
      CANONICAL_AUGMENTS[0],
      {
        slug: "icon-claimant-a",
        augmentId: "ARAM_UnknownA",
        iconLarge: "assets/ux/cherry/augments/icons/apexinventor_large.png",
        localizedNameZhCn: null,
        lifecycle: "active",
      },
      {
        slug: "icon-claimant-b",
        augmentId: "ARAM_UnknownB",
        iconLarge: "assets/ux/cherry/augments/icons/apexinventor_large.png",
        localizedNameZhCn: null,
        lifecycle: "active",
      },
    ];
    const index = buildIdentityIndex(tied, ARAMGG_CATALOG);
    expect(index.collisions).toEqual([
      { aramggAugmentId: APEX, slugs: ["icon-claimant-a", "icon-claimant-b"] },
    ]);
    expect(index.byAramggId.has(APEX)).toBe(false);
  });

  test("a canonical augment with no ARAMGG counterpart is recorded with its lifecycle", () => {
    const withRemoved: CanonicalAugment[] = [
      ...CANONICAL_AUGMENTS,
      {
        slug: "porcupine",
        augmentId: null,
        iconLarge: null,
        localizedNameZhCn: "豪猪",
        lifecycle: "removed",
      },
    ];
    const index = buildIdentityIndex(withRemoved, ARAMGG_CATALOG);
    const rejection = index.rejections.find((r) => r.slug === "porcupine");
    expect(rejection?.reason).toBe("unmatched");
    expect(rejection?.lifecycle).toBe("removed");
  });

  test("no augment row reaches the artifact without a resolved identity", () => {
    const artifact = buildOk();
    for (const champion of artifact.payload.champions) {
      for (const row of champion.rows) {
        expect(row.canonicalAugmentId).toBeTruthy();
        expect(row.identityMethod).toBeTruthy();
      }
    }
  });
});

// ─── Source statistics ───

describe("statistics are preserved exactly as published", () => {
  test("the raw win rate stays an exact string", () => {
    const row = buildOk().payload.champions[0].rows.find((r) => r.aramggAugmentId === JUGGERNAUT);
    expect(row?.winRateRaw).toBe("0.5204");
    expect(typeof row?.winRateRaw).toBe("string");
  });

  test("sample sizes and the threshold survive", () => {
    const row = buildOk().payload.champions[0].rows.find((r) => r.aramggAugmentId === JUGGERNAUT);
    expect(row?.numGames).toBe("367");
    expect(row?.numWinGames).toBe("191");
    expect(row?.minimumSampleSize).toBe(255);
    expect(row?.pickRateRaw).toBe("0.0021");
    expect(row?.tier).toBe("3");
    expect(row?.rank).toBe("101");
  });

  test("a null win-rate row survives generation", () => {
    // Dropping it would make a below-threshold augment indistinguishable from
    // one this champion has no data for at all.
    const champion = buildOk().payload.champions[0];
    const row = champion.rows.find((r) => r.aramggAugmentId === APEX);
    expect(row).toBeDefined();
    expect(row?.winRateRaw).toBeNull();
    expect(row?.numGames).toBeNull();
    expect(row?.numWinGames).toBeNull();
    // Still a real row: it keeps the statistics ARAMGG did publish.
    expect(row?.tier).toBe("3");
    expect(row?.pickRateRaw).toBe("0.001");
    expect(champion.nullWinRateRowCount).toBe(1);
    expect(champion.rowCount).toBe(2);
  });

  test("no synthetic win rate is ever substituted", () => {
    const row = buildOk().payload.champions[0].rows.find((r) => r.aramggAugmentId === APEX);
    expect(row?.winRateRaw).not.toBe("0.5");
    expect(row?.winRateRaw).not.toBe("50");
  });

  test("rounds are never invented", () => {
    const artifact = buildOk();
    expect(artifact.payload.artifact.granularity).toBe("champion-augment");
    expect(artifact.payload.artifact.selectionRound).toBeNull();
  });
});

// ─── Reproducibility ───

describe("the artifact is byte-deterministic", () => {
  test("the same frozen inputs produce identical bytes and the same SHA-256", () => {
    const first = serializeArtifact(buildOk());
    const second = serializeArtifact(buildOk());
    expect(second).toBe(first);
    expect(sha256Hex(second)).toBe(sha256Hex(first));
  });

  test("input ordering does not change the output", () => {
    // Map/Set iteration and filesystem traversal order must not leak in.
    const forwards = serializeArtifact(buildOk());
    const backwards = serializeArtifact(
      buildOk({
        canonicalAugments: [...CANONICAL_AUGMENTS].reverse(),
        acquired: [
          {
            championKey: "67",
            slug: "vayne",
            text: championFile("67", { [APEX]: NULL_STAT_ROW, [JUGGERNAUT]: FULL_ROW }),
          },
        ],
      }),
    );
    expect(backwards).toBe(forwards);
  });

  test("champions and rows are ordered numerically, not lexicographically", () => {
    const artifact = buildOk({
      roster: [
        { championKey: "9", slug: "fiddlesticks" },
        { championKey: "104", slug: "graves" },
      ],
      acquired: [
        {
          championKey: "104",
          slug: "graves",
          text: championFile("104", { [JUGGERNAUT]: FULL_ROW }),
        },
        {
          championKey: "9",
          slug: "fiddlesticks",
          text: championFile("9", { [JUGGERNAUT]: FULL_ROW }),
        },
      ],
    });
    expect(artifact.payload.champions.map((c) => c.championKey)).toEqual(["9", "104"]);
  });

  test("no wall-clock timestamp is embedded", () => {
    const serialized = serializeArtifact(buildOk());
    expect(serialized).not.toMatch(/generatedAt/);
    // The only dates present are ARAMGG's own observation dates.
    const years = serialized.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    expect(new Set(years)).toEqual(new Set(["2026-08-22"]));
  });

  test("the checksum binds the payload and verifies", () => {
    const artifact = buildOk();
    expect(artifact.checksum.algorithm).toBe("sha256");
    expect(artifact.checksum.covers).toBe("payload");
    expect(artifact.checksum.value).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.checksum.value).toBe(sha256Hex(canonicalJson(artifact.payload)));
    expect(verifyArtifactChecksum(artifact)).toBe(true);
  });

  test("tampering with the payload breaks verification", () => {
    const artifact = buildOk();
    artifact.payload.champions[0].rows[0].winRateRaw = "0.9999";
    expect(verifyArtifactChecksum(artifact)).toBe(false);
  });

  test("the schema version is stated", () => {
    expect(buildOk().schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
  });
});

// ─── Atomicity ───

describe("a failed run never replaces a good artifact", () => {
  test("the previous artifact and its checksum survive a failing generation byte-for-byte", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aramgg-artifact-"));
    const artifactPath = path.join(directory, "champion-augments.artifact.json");

    const good = serializeArtifact(buildOk());
    writeFileSync(artifactPath, good, "utf8");
    const goodHash = sha256Hex(good);

    // A run that cannot reconcile one augment identity.
    const failed = await generateAndWrite(
      inputs({
        acquired: [
          {
            championKey: "67",
            slug: "vayne",
            text: championFile("67", { [JUGGERNAUT]: FULL_ROW, [ORPHAN]: FULL_ROW }),
          },
        ],
      }),
      artifactPath,
    );

    expect(failed.ok).toBe(false);
    const after = readFileSync(artifactPath, "utf8");
    expect(after).toBe(good);
    expect(sha256Hex(after)).toBe(goodHash);
    // And no half-written temporary is left lying around.
    expect(existsSync(`${artifactPath}.tmp`)).toBe(false);
  });

  test("an incomplete champion acquisition writes nothing at all", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aramgg-artifact-"));
    const artifactPath = path.join(directory, "champion-augments.artifact.json");

    const result = await generateAndWrite(
      inputs({
        roster: [
          { championKey: "22", slug: "ashe" },
          { championKey: "67", slug: "vayne" },
        ],
        absent: [{ championKey: "22", slug: "ashe", httpStatus: 500 }],
      }),
      artifactPath,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failures.map((f) => f.kind)).toContain(
      "champion-acquisition-incomplete",
    );
    expect(existsSync(artifactPath)).toBe(false);
  });

  test("a successful run does write, and what it writes verifies", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aramgg-artifact-"));
    const artifactPath = path.join(directory, "champion-augments.artifact.json");

    const result = await generateAndWrite(inputs(), artifactPath);
    expect(result.ok).toBe(true);

    const written = readFileSync(artifactPath, "utf8");
    expect(written).toBe(serializeArtifact(buildOk()));
    expect(written.endsWith("\n")).toBe(true);
    expect(verifyArtifactChecksum(JSON.parse(written))).toBe(true);
    expect(existsSync(`${artifactPath}.tmp`)).toBe(false);
  });
});

// ─── No acquisition outcome is quietly acceptable ───

/**
 * ARAMGG answers HTTP 404 for `/data/champion-augments/22.json` (Ashe) while
 * its own `/en/champion-stats/22` returns 200, is titled "Ashe ARAM Mayhem
 * Build", and renders live statistics — at "Version: 26.15", while every other
 * champion sampled (1, 23, 24, 33, 67, 84, 157, 412, 888) renders 26.17. The
 * 404 is therefore a per-champion rollover gap: ARAMGG still has Ashe data and
 * has not yet published Ashe's file for the patch it is currently serving.
 *
 * The literal "No data" string on that page is NOT evidence of champion-level
 * absence. It is the "Best Augment Combos" card's empty state ("No data for new
 * version yet") and it appears on champions 1, 23, 24, 33, 84 and 888, all of
 * which serve complete statistics. Treating it as proof of absence would invent
 * a no-data state for champions that have data.
 *
 * So there is deliberately no acceptance path below. Every test here pins one
 * way an unserved champion could otherwise slip into the artifact as though it
 * had been observed.
 */
function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const ASHE_AND_VAYNE = [
  { championKey: "22", slug: "ashe" },
  { championKey: "67", slug: "vayne" },
];

describe("no acquisition outcome is quietly acceptable", () => {
  test.each([500, 502, 403, 429, 301])("HTTP %i fails the build closed", (status) => {
    // 404 is deliberately absent: it is the one status that states "this file is
    // not published" rather than "this request failed", and it is accounted for
    // in "an isolated current-file absence is accounted for, not fatal". Every
    // other status here still fails the run closed.
    const kinds = failureKinds({
      roster: ASHE_AND_VAYNE,
      absent: [{ championKey: "22", slug: "ashe", httpStatus: status }],
    });
    expect(kinds).toContain("champion-acquisition-incomplete");
  });

  test("the failure names the champion and its status, not just a count", () => {
    const result = buildArtifact(
      inputs({
        roster: ASHE_AND_VAYNE,
        absent: [{ championKey: "22", slug: "ashe", httpStatus: 500 }],
      }),
    );
    expect(result.ok).toBe(false);
    const failure =
      result.ok === false &&
      result.failures.find((f) => f.kind === "champion-acquisition-incomplete");
    expect(failure && failure.kind === "champion-acquisition-incomplete" && failure.absent).toEqual([
      { championKey: "22", slug: "ashe", httpStatus: 500 },
    ]);
  });

  test("a roster champion that was neither acquired nor reported absent is fatal", () => {
    // The dangerous shape: a champion silently vanishes from both channels and
    // the artifact quietly describes a smaller roster than it claims to cover.
    const kinds = failureKinds({ roster: ASHE_AND_VAYNE, absent: [] });
    expect(kinds).toContain("roster-not-accounted");
  });

  test("a fully accounted roster raises no accounting failure", () => {
    const kinds = failureKinds({
      roster: ASHE_AND_VAYNE,
      absent: [{ championKey: "22", slug: "ashe", httpStatus: 500 }],
    });
    expect(kinds).not.toContain("roster-not-accounted");
  });

  test("a 200 carrying a malformed body is fatal, never treated as no data", () => {
    const kinds = failureKinds({
      acquired: [{ championKey: "67", slug: "vayne", text: "<!doctype html><html>" }],
    });
    expect(kinds).toContain("champion-envelope-invalid");
  });

  test("a body naming the wrong champion is fatal", () => {
    const kinds = failureKinds({
      roster: [{ championKey: "22", slug: "ashe" }],
      // ARAMGG answered 200 for Ashe — with Vayne in the envelope.
      acquired: [
        { championKey: "22", slug: "ashe", text: championFile("67", { [JUGGERNAUT]: FULL_ROW }) },
      ],
    });
    expect(kinds).toContain("champion-envelope-invalid");
  });

  test("acquisition records every non-OK status instead of dropping the champion", async () => {
    const bodies: Record<string, { status: number; body: string }> = {
      "22": { status: 404, body: "<html>not found</html>" },
      "67": { status: 200, body: championFile("67", { [JUGGERNAUT]: FULL_ROW }) },
      "21": { status: 500, body: "" },
    };
    const result = await acquireChampionFiles(
      [...ASHE_AND_VAYNE, { championKey: "21", slug: "missfortune" }],
      async (input) => {
        const key = String(input).split("/").pop()?.replace(".json", "") ?? "";
        return fakeResponse(bodies[key].status, bodies[key].body);
      },
      2,
    );

    expect(result.acquired.map((a) => a.championKey)).toEqual(["67"]);
    // Both non-OK champions are accounted for, each keeping its own status.
    expect(result.absent).toEqual([
      { championKey: "21", slug: "missfortune", httpStatus: 500 },
      { championKey: "22", slug: "ashe", httpStatus: 404 },
    ]);
  });

  test("a transport error is never downgraded into an absence", async () => {
    // A timeout or TLS failure has no status to record. It must surface, not
    // silently shrink the roster.
    await expect(
      acquireChampionFiles(ASHE_AND_VAYNE, async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow(/fetch failed/);
  });

  test("an unaccounted roster writes nothing and leaves no temporary behind", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aramgg-artifact-"));
    const artifactPath = path.join(directory, "champion-augments.artifact.json");

    const result = await generateAndWrite(inputs({ roster: ASHE_AND_VAYNE }), artifactPath);

    expect(result.ok).toBe(false);
    expect(existsSync(artifactPath)).toBe(false);
    expect(existsSync(`${artifactPath}.tmp`)).toBe(false);
  });
});

// ─── Repository readers ───

describe("repository inputs are read as identity, not as presentation", () => {
  test("the champion universe comes from this repository, never from ARAMGG", () => {
    const roster = readRoster({
      champions: [
        { slug: "vayne", champion_key: "67" },
        { slug: "annie", champion_key: "1" },
        { slug: "no-key", champion_key: null },
      ],
    });
    expect(roster).toEqual([
      { championKey: "1", slug: "annie" },
      { championKey: "67", slug: "vayne" },
    ]);
  });

  test("canonical augments carry their identity and lifecycle", () => {
    const augments = readCanonicalAugments({
      augments: [
        {
          slug: "tank-engine",
          augmentId: "ARAM_TankEngine",
          name_zh_CN: "坦克引擎",
          cdragonIcon: { large: "assets/ux/cherry/augments/icons/tank_engine_large.png" },
          flags: { lifecycle: "active" },
        },
        {
          slug: "porcupine",
          augmentId: null,
          name_zh_CN: "豪猪",
          cdragonIcon: null,
          flags: { lifecycle: "removed" },
        },
      ],
    });
    expect(augments).toEqual([
      {
        slug: "porcupine",
        augmentId: null,
        iconLarge: null,
        localizedNameZhCn: "豪猪",
        lifecycle: "removed",
      },
      {
        slug: "tank-engine",
        augmentId: "ARAM_TankEngine",
        iconLarge: "assets/ux/cherry/augments/icons/tank_engine_large.png",
        localizedNameZhCn: "坦克引擎",
        lifecycle: "active",
      },
    ]);
  });

  test("an empty icon string is not mistaken for an icon", () => {
    // data/internal/augments.json really does carry `cdragonIcon.large: ""`.
    const [augment] = readCanonicalAugments({
      augments: [{ slug: "droppybara", augmentId: "Dropybara_Active", cdragonIcon: { large: "" } }],
    });
    expect(augment.iconLarge).toBeNull();
  });
});
