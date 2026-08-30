/**
 * Manual, reproducible generator for the ARAMGG champion x augment artifact.
 *
 * Run it by hand, never on a schedule and never at gameplay time:
 *
 *   npx jiti scripts/aramgg/generate-champion-augment-artifact.ts
 *
 * It fetches ARAMGG's public STATIC files (no API credits, no `/aramgg-dev`
 * proxy — that proxy exists only inside the Vite dev server), reconciles every
 * augment identity against this repository's canonical catalog, resolves both
 * observed runtime patches through the one PatchIdentity authority, and writes
 * a byte-deterministic artifact plus a SHA-256 that binds it.
 *
 * ── Why the artifact lives in `data/internal/` ───────────────────────────────
 *
 * ARAMGG-derived statistics are third-party data we do not have the right to
 * redistribute, so they sit at the INTERNAL rung of the disclosure ladder
 * (CLAUDE.md "Disclosure ladder"). The earlier draft targeted
 * `overlay/public/data/`, which is wrong three times over: that directory is
 * gitignored (`overlay/.gitignore`), `overlay/scripts/sync-data.mjs` does
 * `rm -rf` on it and rebuilds it from a fixed five-file allowlist on every
 * `predev`/`prebuild`, and everything under it is bundled into the shipped
 * overlay. An artifact placed there would be untracked, deleted by the next
 * build, and published. `data/internal/` is tracked, is not copied into the
 * bundle, and is the rung this data belongs on.
 *
 * ── Patch namespaces ────────────────────────────────────────────────────────
 *
 * ARAMGG publishes RUNTIME patches ("16.16"); this repository's catalogs speak
 * the DISPLAY line ("26.16"). Equivalence is a registry LOOKUP through
 * `src/lib/contracts/patch-identity.ts` and never arithmetic — there is no
 * `+ 10` anywhere in this file, and `normalizeAramggPatch` is not coming back.
 * Two independent patches are resolved and neither may overwrite the other:
 *
 *   serving  the patch the observations actually describe, read from each
 *            champion file's `entry[2]`
 *   target   the newest patch ARAMGG's changelog publishes, read from
 *            `/data/augments-changelog/index.json` `.latest`
 *
 * ARAMGG serving 16.16 observations while this repository ships 26.17 mechanics
 * is a truthful lag, not corruption. Old observations are never relabelled to
 * the current catalog patch.
 *
 * ARAMGG's own named config fields (`gamePatch`, `targetGamePatch`,
 * `dataVersion`) are NOT exposed by any reachable public surface as of
 * 2026-08-29 — every candidate config path returns 404 and the rendered pages
 * carry only the display line. The two patches above are the observable
 * equivalents, each recorded with the URL it came from. A dataset revision is
 * recorded verbatim when a caller has one and is otherwise null: it is an
 * ARAMGG revision string, NOT a runtime version, so it is never truncated,
 * never passed to `runtimePatchFromVersion`, and never confused with the
 * signed-model manifest's unrelated `dataVersion`.
 *
 * ── Failure is closed ───────────────────────────────────────────────────────
 *
 * Nothing is written unless every champion was acquired, both patches resolved,
 * and every augment identity reconciled unambiguously. A partial or ambiguous
 * run leaves the previous artifact and checksum exactly as they were.
 */
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  resolvePatchIdentity,
  SEEDED_PATCH_REGISTRY,
  type PatchIdentity,
  type PatchRegistry,
  type PatchResolutionFailure,
} from "../../src/lib/contracts/patch-identity";
import {
  buildCatalogIndex,
  normalizeIconBase,
  resolveAugmentId,
  type MatchMethod,
} from "../../overlay/src/dev/aramggSource";

export const ARTIFACT_SCHEMA_VERSION = 1;

export const ARAMGG_ORIGIN = "https://aramgg.com";
export const CHAMPION_AUGMENTS_PATH_PATTERN = "/data/champion-augments/{championKey}.json";
export const CATALOG_PATH = "/data/aram-mayhem-augments.zh_cn.json";
export const CHANGELOG_PATH = "/data/augments-changelog/index.json";

export const ARTIFACT_RELATIVE_PATH = "data/internal/aramgg-champion-augments.artifact.json";

// ─── Inputs ───

export interface RosterEntry {
  championKey: string;
  slug: string;
}

/** One champion's file as retrieved. `text` is the raw body; absent files carry a status. */
export interface AcquiredChampionFile {
  championKey: string;
  slug: string;
  text: string;
}

export interface AbsentChampionFile {
  championKey: string;
  slug: string;
  httpStatus: number;
}

/** One augment as this repository canonically knows it. */
export interface CanonicalAugment {
  slug: string;
  /** Canonical `ARAM_*` identity, or null when CDragon has no registry row for it. */
  augmentId: string | null;
  iconLarge: string | null;
  localizedNameZhCn: string | null;
  lifecycle: string | null;
}

export interface BuildInputs {
  roster: readonly RosterEntry[];
  acquired: readonly AcquiredChampionFile[];
  absent: readonly AbsentChampionFile[];
  /** Raw `/data/aram-mayhem-augments.zh_cn.json`. */
  aramggCatalog: unknown;
  /** Raw `/data/augments-changelog/index.json`. */
  changelog: unknown;
  canonicalAugments: readonly CanonicalAugment[];
  registry: PatchRegistry;
  /**
   * ARAMGG dataset revision, verbatim, when a caller has one (e.g. "16.16.3").
   * Provenance only: never truncated, never resolved as a runtime version.
   */
  revision?: { rawValue: string; source: string } | null;
}

// ─── Envelope parsing: entry[2] and entry[3] are contract, not decoration ───

export interface ChampionEnvelope {
  championKey: string;
  payload: Record<string, unknown>;
  /** `entry[2]` — the runtime patch these observations describe. */
  servingPatchRaw: string;
  /** `entry[3]` — the date ARAMGG observed them. */
  observedAt: string;
}

export type EnvelopeResult =
  | { ok: true; envelope: ChampionEnvelope }
  | { ok: false; reason: string };

/**
 * `[[championKey, payloadJsonString, servingPatch, observedAt]]`.
 *
 * The dev loader (`overlay/src/dev/championDataset.ts::parseChampionAugmentsFile`)
 * reads only elements 0 and 1 and throws 2 and 3 away. An entry shorter than
 * four elements is REJECTED here rather than defaulted: an artifact that cannot
 * say which patch a number came from is the thing this generator exists to
 * prevent.
 */
export function parseChampionEnvelope(text: string, championKey: string): EnvelopeResult {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed-json" };
  }
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, reason: "not-a-non-empty-array" };
  }
  const entry = list.find(
    (candidate) => Array.isArray(candidate) && String(candidate[0]) === championKey,
  ) as unknown[] | undefined;
  if (entry === undefined) return { ok: false, reason: "no-entry-for-champion" };
  if (entry.length < 4) return { ok: false, reason: "entry-missing-provenance-elements" };

  const [, blob, servingPatchRaw, observedAt] = entry;
  if (typeof blob !== "string") return { ok: false, reason: "payload-not-a-json-string" };
  if (typeof servingPatchRaw !== "string" || servingPatchRaw.length === 0) {
    return { ok: false, reason: "missing-serving-patch" };
  }
  if (typeof observedAt !== "string" || observedAt.length === 0) {
    return { ok: false, reason: "missing-observed-at" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(blob);
  } catch {
    return { ok: false, reason: "malformed-payload-json" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "payload-not-an-object" };
  }
  const augments = (payload as Record<string, unknown>).augments;
  if (augments === null || typeof augments !== "object" || Array.isArray(augments)) {
    return { ok: false, reason: "payload-missing-augments-table" };
  }

  return {
    ok: true,
    envelope: {
      championKey,
      payload: payload as Record<string, unknown>,
      servingPatchRaw,
      observedAt,
    },
  };
}

// ─── Statistic rows: raw strings, preserved exactly ───

/**
 * One champion x augment observation.
 *
 * Every rate stays the STRING ARAMGG published. Parsing "0.5204" into a float
 * and formatting it back is a round-trip that can only lose precision, and the
 * artifact's job is to be the evidence, not the presentation.
 *
 * `winRate`/`numGames`/`numWinGames` are legitimately null: ARAMGG publishes
 * rows below `win_rate_minimum_games` with a tier and a pick rate but no
 * win rate. Such a row is REAL and is kept — dropping it would make "not enough
 * samples yet" indistinguishable from "this augment does not exist here".
 */
export interface EvidenceRow {
  aramggAugmentId: string;
  canonicalAugmentId: string;
  identityMethod: MatchMethod;
  tier: string | null;
  rank: string | null;
  total: string | null;
  winRateRaw: string | null;
  numGames: string | null;
  numWinGames: string | null;
  pickRateRaw: string | null;
  minimumSampleSize: number | null;
  statSource: string | null;
  region: string | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ─── Identity reconciliation ───

export interface IdentityMatch {
  canonicalAugmentId: string;
  slug: string;
  method: MatchMethod;
}

export interface IdentityCollision {
  aramggAugmentId: string;
  /** Canonical slugs that all claimed the same ARAMGG augment. */
  slugs: string[];
}

export interface CanonicalRejection {
  slug: string;
  reason: string;
  detail: string | null;
  lifecycle: string | null;
}

export interface IdentityIndex {
  byAramggId: Map<string, IdentityMatch>;
  collisions: IdentityCollision[];
  rejections: CanonicalRejection[];
  methodCounts: Record<string, number>;
}

interface Claim {
  slug: string;
  canonicalAugmentId: string;
  method: MatchMethod;
  lifecycle: string | null;
}

/**
 * How strongly a claim identifies an ARAMGG augment, mirroring the priority
 * order `resolveAugmentId` already documents on `MatchMethod`.
 *
 * A canonical `ARAM_*` name IS the augment's identity. An icon base is a shared
 * *asset* — Riot ships Droppybara (`Dropybara_Active`) using Orbital Laser's
 * icon, and ARAMGG publishes no Orbital Laser entry at all — so an icon match
 * must never take an id away from the augment whose canonical name matches it.
 * A localized display name is a last resort and weaker still.
 */
function claimStrength(method: MatchMethod): number {
  switch (method) {
    case "canonical-name":
      return 3;
    case "cdragon-icon":
    case "cdragon-icon+zh-tiebreak":
      return 2;
    case "localized-name":
      return 1;
    default:
      return 0;
  }
}

/**
 * Map this repository's canonical augments onto ARAMGG's numeric ids using the
 * already-tested resolver in `overlay/src/dev/aramggSource.ts`.
 *
 * The direction matters. `resolveAugmentId` answers "which ARAMGG id is this
 * CDragon augment", so the canonical catalog is the thing iterated and the
 * result is inverted afterwards. Writing a second, weaker resolver that walked
 * the other way — matching ARAMGG ids against names — would reintroduce exactly
 * the ambiguity that function already rejects.
 *
 * Two canonical augments resolving to one ARAMGG id is a COLLISION and is
 * fatal. It is never silently resolved by preferring whichever was seen first:
 * that choice would silently attribute one augment's win rate to another.
 */
export function buildIdentityIndex(
  canonicalAugments: readonly CanonicalAugment[],
  aramggCatalog: unknown,
): IdentityIndex {
  const index = buildCatalogIndex(aramggCatalog);
  const byAramggId = new Map<string, IdentityMatch>();
  const claimedBy = new Map<string, Claim[]>();
  const rejections: CanonicalRejection[] = [];
  const methodCounts: Record<string, number> = {};

  for (const augment of canonicalAugments) {
    const resolution = resolveAugmentId(
      {
        canonicalName: augment.augmentId,
        iconBase: normalizeIconBase(augment.iconLarge),
        localizedName: augment.localizedNameZhCn,
      },
      index,
    );

    if (resolution.augmentId === null) {
      rejections.push({
        slug: augment.slug,
        reason: resolution.reason,
        detail: resolution.detail ?? null,
        lifecycle: augment.lifecycle,
      });
      continue;
    }

    claimedBy.set(resolution.augmentId, [
      ...(claimedBy.get(resolution.augmentId) ?? []),
      {
        slug: augment.slug,
        canonicalAugmentId: augment.augmentId ?? augment.slug,
        method: resolution.method,
        lifecycle: augment.lifecycle,
      },
    ]);
  }

  // Resolve every claim by strength, never by iteration order. A claim made on
  // a stronger identity beats a weaker one outright; only equally strong claims
  // are a real ambiguity.
  const collisions: IdentityCollision[] = [];
  for (const [aramggAugmentId, claims] of claimedBy) {
    const best = Math.max(...claims.map((claim) => claimStrength(claim.method)));
    const winners = claims.filter((claim) => claimStrength(claim.method) === best);
    const losers = claims.filter((claim) => claimStrength(claim.method) < best);

    if (winners.length > 1) {
      // A contested id resolves to nothing at all. Leaving the first claimant
      // in place would publish a confident, wrong attribution.
      collisions.push({
        aramggAugmentId,
        slugs: winners.map((claim) => claim.slug).sort(),
      });
    } else {
      const winner = winners[0];
      methodCounts[winner.method] = (methodCounts[winner.method] ?? 0) + 1;
      byAramggId.set(aramggAugmentId, {
        canonicalAugmentId: winner.canonicalAugmentId,
        slug: winner.slug,
        method: winner.method,
      });
    }

    // A losing claimant is still accounted for, so no canonical augment can
    // disappear from the reconciliation without a stated reason.
    for (const loser of losers) {
      rejections.push({
        slug: loser.slug,
        reason: "outranked",
        detail:
          `ARAMGG ${aramggAugmentId} claimed by "${loser.slug}" via ${loser.method}, ` +
          `outranked by "${winners.map((claim) => claim.slug).join(", ")}" via ${winners[0].method}`,
        lifecycle: loser.lifecycle,
      });
    }
  }
  collisions.sort((a, b) => compareNumericId(a.aramggAugmentId, b.aramggAugmentId));
  rejections.sort((a, b) => a.slug.localeCompare(b.slug));

  return { byAramggId, collisions, rejections, methodCounts };
}

/** Numeric-aware id ordering, so "1010" sorts after "999" rather than before it. */
function compareNumericId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

// ─── Artifact shape ───

export interface ResolvedPatchFacet {
  rawValue: string;
  provenance: string;
  identity: PatchIdentity;
}

export interface ChampionRecord {
  championKey: string;
  slug: string;
  servingPatchRaw: string;
  observedAt: string;
  /** Payload-level provenance: which population these champion totals came from. */
  region: string | null;
  statSource: string | null;
  augmentTriosSource: string | null;
  rowCount: number;
  nullWinRateRowCount: number;
  rows: EvidenceRow[];
}

export interface ArtifactPayload {
  artifact: {
    kind: string;
    schemaVersion: number;
    generator: string;
    disclosure: string;
    /**
     * Constant for every row in this artifact, declared once instead of
     * repeated 25k times. ARAMGG exposes no round-conditioned statistics, so
     * `selectionRound` is null and is never invented.
     */
    granularity: "champion-augment";
    selectionRound: null;
  };
  source: {
    origin: string;
    championAugmentsPathPattern: string;
    catalogPath: string;
    changelogPath: string;
  };
  sourcePatch: {
    serving: ResolvedPatchFacet;
    target: ResolvedPatchFacet;
    revision: { rawValue: string | null; source: string | null; note: string };
  };
  observation: {
    /** Validated across every champion before being stated here, never assumed. */
    distinctServingPatches: string[];
    distinctObservedAt: string[];
    distinctRegions: string[];
    distinctStatSources: string[];
  };
  roster: {
    source: string;
    expectedChampions: number;
    acquiredChampions: number;
    absentChampions: number;
  };
  identityReconciliation: {
    totalRows: number;
    matchedRows: number;
    unmatchedRows: number;
    ambiguousRows: number;
    distinctAramggAugmentIds: number;
    matchedAramggAugmentIds: number;
    byMethod: Record<string, number>;
  };
  totals: {
    rows: number;
    nullWinRateRows: number;
  };
  champions: ChampionRecord[];
  /**
   * Rostered champions ARAMGG publishes no current-patch file for.
   *
   * They are listed, never fabricated into `champions`: a consumer that finds a
   * champion here knows the absence was observed and accounted for, and that no
   * row anywhere in the artifact belongs to it.
   */
  championsWithoutCurrentSource: AbsentChampionFile[];
}

export interface ArtifactFile {
  schemaVersion: number;
  checksum: {
    algorithm: "sha256";
    encoding: "hex";
    /** The checksum covers `canonicalJson(payload)` — see `canonicalJson`. */
    covers: "payload";
    value: string;
  };
  payload: ArtifactPayload;
}

// ─── Failures ───

export type BuildFailure =
  | { kind: "champion-acquisition-incomplete"; absent: AbsentChampionFile[] }
  | { kind: "acquisition-source-unhealthy"; absent: AbsentChampionFile[] }
  | { kind: "roster-not-accounted"; missing: RosterEntry[] }
  | { kind: "champion-envelope-invalid"; championKey: string; slug: string; reason: string }
  | {
      kind: "patch-unresolved";
      facet: "serving" | "target";
      rawValue: string;
      reason: PatchResolutionFailure;
    }
  | { kind: "changelog-latest-missing" }
  | {
      kind: "serving-patch-not-uniform";
      distinct: string[];
    }
  | { kind: "ambiguous-augment-identity"; collisions: IdentityCollision[] }
  | {
      kind: "unmatched-augment-identity";
      ids: Array<{ aramggAugmentId: string; rows: number; aramggName: string | null }>;
    };

/**
 * What the run resolved, reported whether or not the run succeeded.
 *
 * A failed run still has to be able to answer "which patch did you think this
 * was?". Reporting the resolution only on success would mean the one situation
 * an operator most needs the provenance is the one that hides it.
 */
export interface ResolvedPatches {
  serving: ResolvedPatchFacet | null;
  target: ResolvedPatchFacet | null;
}

export type BuildResult =
  | { ok: true; artifact: ArtifactFile; identity: IdentityIndex; resolved: ResolvedPatches }
  | {
      ok: false;
      failures: BuildFailure[];
      identity: IdentityIndex | null;
      resolved: ResolvedPatches;
    };

// ─── Deterministic serialization ───

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonicalize(source[key]);
    return out;
  }
  return value;
}

/**
 * Compact, deep-key-sorted JSON — the same canonical form
 * `scripts/model/sign_model.py::canonical_json_bytes` hashes, so the two
 * checksum conventions in this repository mean the same thing.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The bytes written to disk. Indented for review, but ordered by the same
 * `canonicalize` the checksum uses, so the file and the hash can never disagree
 * about field order.
 *
 * No wall-clock anywhere: a `generatedAt` would make two runs over identical
 * inputs produce different bytes and a different SHA-256, which would destroy
 * the only property that makes this artifact verifiable. The meaningful time is
 * ARAMGG's own `observedAt`, which is an input.
 */
export function serializeArtifact(file: ArtifactFile): string {
  return `${JSON.stringify(canonicalize(file), null, 2)}\n`;
}

// ─── The build ───

export function buildArtifact(inputs: BuildInputs): BuildResult {
  const failures: BuildFailure[] = [];

  // A 404 is the only absence the source can *state*: the static path is simply
  // not published. Every other outcome (5xx, 403, 429, a redirect) describes the
  // request failing, not the file being absent, so it stays fatal. Transport
  // errors never reach here at all — `acquireChampionFiles` lets them reject.
  const byNumericKey = (a: AbsentChampionFile, b: AbsentChampionFile) =>
    compareNumericId(a.championKey, b.championKey);
  const notPublished = inputs.absent.filter((entry) => entry.httpStatus === 404);
  const requestFailures = inputs.absent.filter((entry) => entry.httpStatus !== 404);

  if (requestFailures.length > 0) {
    failures.push({
      kind: "champion-acquisition-incomplete",
      absent: [...requestFailures].sort(byNumericKey),
    });
  }

  // Tolerating an isolated gap must never tolerate a dead endpoint. With nothing
  // acquired there is no observed serving patch to be consistent with and no
  // evidence the origin is healthy, so a uniform sweep of 404s reads as exactly
  // what it is: the source failing, not 173 simultaneous publication gaps.
  if (inputs.acquired.length === 0) {
    failures.push({
      kind: "acquisition-source-unhealthy",
      absent: [...inputs.absent].sort(byNumericKey),
    });
  }

  // Every rostered champion has to leave a trace in one of the two channels.
  // Without this, a champion dropped from `acquired` AND `absent` would produce
  // a perfectly valid-looking artifact that silently covers a smaller roster
  // than the one it names — the failure mode hardest to notice after the fact.
  const accounted = new Set<string>([
    ...inputs.acquired.map((entry) => entry.championKey),
    ...inputs.absent.map((entry) => entry.championKey),
  ]);
  const missing = inputs.roster.filter((entry) => !accounted.has(entry.championKey));
  if (missing.length > 0) {
    failures.push({
      kind: "roster-not-accounted",
      missing: [...missing].sort((a, b) => compareNumericId(a.championKey, b.championKey)),
    });
  }

  // ── envelopes ──
  const envelopes: Array<{ entry: AcquiredChampionFile; envelope: ChampionEnvelope }> = [];
  for (const entry of inputs.acquired) {
    const parsed = parseChampionEnvelope(entry.text, entry.championKey);
    if (!parsed.ok) {
      failures.push({
        kind: "champion-envelope-invalid",
        championKey: entry.championKey,
        slug: entry.slug,
        reason: parsed.reason,
      });
      continue;
    }
    envelopes.push({ entry, envelope: parsed.envelope });
  }

  // ── patches ──
  const servingPatches = [...new Set(envelopes.map((e) => e.envelope.servingPatchRaw))].sort();
  if (servingPatches.length > 1) {
    // Collapsing disagreeing champions to one artifact-level patch would
    // relabel somebody's observations. Refuse instead.
    failures.push({ kind: "serving-patch-not-uniform", distinct: servingPatches });
  }

  let serving: ResolvedPatchFacet | null = null;
  if (servingPatches.length === 1) {
    const rawValue = servingPatches[0];
    const resolution = resolvePatchIdentity({ runtimePatch: rawValue }, inputs.registry);
    if (!resolution.ok) {
      failures.push({ kind: "patch-unresolved", facet: "serving", rawValue, reason: resolution.reason });
    } else {
      serving = {
        rawValue,
        provenance: `${ARAMGG_ORIGIN}${CHAMPION_AUGMENTS_PATH_PATTERN} entry[2]`,
        identity: resolution.identity,
      };
    }
  }

  let target: ResolvedPatchFacet | null = null;
  const changelogLatest =
    inputs.changelog !== null &&
    typeof inputs.changelog === "object" &&
    typeof (inputs.changelog as Record<string, unknown>).latest === "string"
      ? ((inputs.changelog as Record<string, unknown>).latest as string)
      : null;
  if (changelogLatest === null) {
    failures.push({ kind: "changelog-latest-missing" });
  } else {
    // Resolved INDEPENDENTLY of `serving`. Neither may overwrite the other:
    // ARAMGG legitimately targets a newer patch than it currently serves.
    const resolution = resolvePatchIdentity({ runtimePatch: changelogLatest }, inputs.registry);
    if (!resolution.ok) {
      failures.push({
        kind: "patch-unresolved",
        facet: "target",
        rawValue: changelogLatest,
        reason: resolution.reason,
      });
    } else {
      target = {
        rawValue: changelogLatest,
        provenance: `${ARAMGG_ORIGIN}${CHANGELOG_PATH} .latest`,
        identity: resolution.identity,
      };
    }
  }

  // ── identity ──
  const identity = buildIdentityIndex(inputs.canonicalAugments, inputs.aramggCatalog);
  if (identity.collisions.length > 0) {
    failures.push({ kind: "ambiguous-augment-identity", collisions: identity.collisions });
  }

  // ── rows ──
  const champions: ChampionRecord[] = [];
  const unmatchedRowsById = new Map<string, number>();
  const distinctAramggIds = new Set<string>();
  let totalRows = 0;
  let matchedRows = 0;
  let ambiguousRows = 0;
  let nullWinRateRows = 0;

  const collisionIds = new Set(identity.collisions.map((c) => c.aramggAugmentId));

  for (const { entry, envelope } of envelopes) {
    const augments = envelope.payload.augments as Record<string, unknown>;
    const rows: EvidenceRow[] = [];
    let championNullWinRate = 0;

    for (const aramggAugmentId of Object.keys(augments).sort(compareNumericId)) {
      const raw = augments[aramggAugmentId];
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const record = raw as Record<string, unknown>;

      totalRows++;
      distinctAramggIds.add(aramggAugmentId);

      const match = identity.byAramggId.get(aramggAugmentId);
      if (match === undefined) {
        if (collisionIds.has(aramggAugmentId)) ambiguousRows++;
        else unmatchedRowsById.set(aramggAugmentId, (unmatchedRowsById.get(aramggAugmentId) ?? 0) + 1);
        continue;
      }
      matchedRows++;

      const winRateRaw = optionalString(record.win_rate);
      if (winRateRaw === null) {
        championNullWinRate++;
        nullWinRateRows++;
      }

      rows.push({
        aramggAugmentId,
        canonicalAugmentId: match.canonicalAugmentId,
        identityMethod: match.method,
        tier: optionalString(record.tier),
        rank: optionalString(record.rank),
        total: optionalString(record.total),
        winRateRaw,
        numGames: optionalString(record.num_games),
        numWinGames: optionalString(record.num_win_games),
        pickRateRaw: optionalString(record.pick_rate),
        minimumSampleSize: optionalNumber(record.win_rate_minimum_games),
        statSource: optionalString(record.win_rate_source),
        region: optionalString(record.win_rate_region),
      });
    }

    champions.push({
      championKey: entry.championKey,
      slug: entry.slug,
      servingPatchRaw: envelope.servingPatchRaw,
      observedAt: envelope.observedAt,
      region: optionalString(envelope.payload.region),
      statSource: optionalString(envelope.payload.source),
      augmentTriosSource: optionalString(envelope.payload.augment_trios_source),
      rowCount: rows.length,
      nullWinRateRowCount: championNullWinRate,
      rows,
    });
  }

  if (unmatchedRowsById.size > 0) {
    const catalog =
      inputs.aramggCatalog !== null && typeof inputs.aramggCatalog === "object"
        ? (inputs.aramggCatalog as Record<string, Record<string, unknown> | undefined>)
        : {};
    failures.push({
      kind: "unmatched-augment-identity",
      ids: [...unmatchedRowsById.entries()]
        .sort((a, b) => compareNumericId(a[0], b[0]))
        .map(([aramggAugmentId, rows]) => ({
          aramggAugmentId,
          rows,
          aramggName: optionalString(catalog[aramggAugmentId]?.name),
        })),
    });
  }

  if (failures.length > 0 || serving === null || target === null) {
    return { ok: false, failures, identity, resolved: { serving, target } };
  }

  champions.sort((a, b) => compareNumericId(a.championKey, b.championKey));

  const payload: ArtifactPayload = {
    artifact: {
      kind: "aramgg-champion-augment-statistics",
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      generator: "scripts/aramgg/generate-champion-augment-artifact.ts",
      disclosure: "internal",
      granularity: "champion-augment",
      selectionRound: null,
    },
    source: {
      origin: ARAMGG_ORIGIN,
      championAugmentsPathPattern: CHAMPION_AUGMENTS_PATH_PATTERN,
      catalogPath: CATALOG_PATH,
      changelogPath: CHANGELOG_PATH,
    },
    sourcePatch: {
      serving,
      target,
      revision: {
        rawValue: inputs.revision?.rawValue ?? null,
        source: inputs.revision?.source ?? null,
        note:
          "ARAMGG dataset revision, verbatim. Not a runtime version and not a display patch: " +
          "never truncated, never resolved through PatchIdentity, and unrelated to the " +
          "signed-model manifest's dataVersion. Null when no reachable ARAMGG surface publishes one.",
      },
    },
    observation: {
      distinctServingPatches: servingPatches,
      distinctObservedAt: [...new Set(champions.map((c) => c.observedAt))].sort(),
      distinctRegions: [...new Set(champions.map((c) => c.region).filter((v): v is string => v !== null))].sort(),
      distinctStatSources: [
        ...new Set(champions.map((c) => c.statSource).filter((v): v is string => v !== null)),
      ].sort(),
    },
    roster: {
      source: "data/internal/champions.json",
      expectedChampions: inputs.roster.length,
      acquiredChampions: champions.length,
      absentChampions: notPublished.length,
    },
    identityReconciliation: {
      totalRows,
      matchedRows,
      unmatchedRows: 0,
      ambiguousRows,
      distinctAramggAugmentIds: distinctAramggIds.size,
      matchedAramggAugmentIds: new Set(champions.flatMap((c) => c.rows.map((r) => r.aramggAugmentId)))
        .size,
      byMethod: identity.methodCounts,
    },
    totals: { rows: matchedRows, nullWinRateRows },
    champions,
    championsWithoutCurrentSource: [...notPublished].sort(byNumericKey),
  };

  const checksumValue = sha256Hex(canonicalJson(payload));

  return {
    ok: true,
    identity,
    resolved: { serving, target },
    artifact: {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      checksum: { algorithm: "sha256", encoding: "hex", covers: "payload", value: checksumValue },
      payload,
    },
  };
}

/** Recompute the checksum from the payload and compare. */
export function verifyArtifactChecksum(file: ArtifactFile): boolean {
  return file.checksum.value === sha256Hex(canonicalJson(file.payload));
}

// ─── Atomic write ───

/**
 * Write through a temporary file and rename. `rename(2)` within one filesystem
 * is atomic, so a reader sees either the previous artifact or the complete new
 * one — never a half-written file. Callers only reach this after a successful
 * build, so a failed run cannot replace a good artifact.
 */
export async function writeArtifactAtomically(
  artifactPath: string,
  contents: string,
): Promise<void> {
  const temporary = `${artifactPath}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, artifactPath);
}

/**
 * Build, and write ONLY on success. This is the whole fail-closed guarantee in
 * one place so it can be tested directly rather than living inside `main` where
 * nothing could reach it: a build that reports any failure returns here without
 * touching the filesystem, leaving the previous artifact byte-for-byte intact.
 */
export async function generateAndWrite(
  inputs: BuildInputs,
  artifactPath: string,
): Promise<BuildResult> {
  const result = buildArtifact(inputs);
  if (!result.ok) return result;
  await writeArtifactAtomically(artifactPath, serializeArtifact(result.artifact));
  return result;
}

// ─── Reporting ───

export function describeFailure(failure: BuildFailure): string {
  switch (failure.kind) {
    case "roster-not-accounted":
      return `roster-not-accounted: ${failure.missing.length} rostered champion(s) neither acquired nor reported: ${failure.missing
        .map((entry) => `${entry.slug}(${entry.championKey})`)
        .join(", ")}`;
    case "champion-acquisition-incomplete":
      return `champion-acquisition-incomplete: ${failure.absent.length} champion file(s) not acquired: ${failure.absent
        .map((a) => `${a.slug}(${a.championKey})=HTTP ${a.httpStatus}`)
        .join(", ")}`;
    case "acquisition-source-unhealthy":
      return `acquisition-source-unhealthy: no champion file was acquired; ${failure.absent.length} absent — the ARAMGG source is not serving, not publishing gaps`;
    case "champion-envelope-invalid":
      return `champion-envelope-invalid: ${failure.slug}(${failure.championKey}) -> ${failure.reason}`;
    case "patch-unresolved":
      return `patch-unresolved: ${failure.facet} patch "${failure.rawValue}" -> ${failure.reason}`;
    case "changelog-latest-missing":
      return "changelog-latest-missing: no .latest in the ARAMGG changelog index";
    case "serving-patch-not-uniform":
      return `serving-patch-not-uniform: champions disagree: ${failure.distinct.join(", ")}`;
    case "ambiguous-augment-identity":
      return `ambiguous-augment-identity: ${failure.collisions.length} ARAMGG id(s) claimed by more than one canonical augment: ${failure.collisions
        .map((c) => `${c.aramggAugmentId}<-[${c.slugs.join(" | ")}]`)
        .join(", ")}`;
    case "unmatched-augment-identity":
      return `unmatched-augment-identity: ${failure.ids.length} ARAMGG id(s) with no canonical counterpart, covering ${failure.ids.reduce(
        (sum, entry) => sum + entry.rows,
        0,
      )} row(s): ${failure.ids.map((e) => `${e.aramggAugmentId}(${e.aramggName ?? "?"})x${e.rows}`).join(", ")}`;
  }
}

// ─── Repository inputs ───

export function readRoster(championsJson: unknown): RosterEntry[] {
  const champions = (championsJson as { champions?: unknown })?.champions;
  if (!Array.isArray(champions)) throw new Error("champions.json: missing `champions` array");
  const roster: RosterEntry[] = [];
  for (const champion of champions) {
    if (champion === null || typeof champion !== "object") continue;
    const record = champion as Record<string, unknown>;
    const championKey = record.champion_key;
    const slug = record.slug;
    if (typeof championKey !== "string" || !/^\d+$/.test(championKey)) continue;
    if (typeof slug !== "string" || slug.length === 0) continue;
    roster.push({ championKey, slug });
  }
  roster.sort((a, b) => compareNumericId(a.championKey, b.championKey));
  return roster;
}

export function readCanonicalAugments(augmentsJson: unknown): CanonicalAugment[] {
  const augments = (augmentsJson as { augments?: unknown })?.augments;
  if (!Array.isArray(augments)) throw new Error("augments.json: missing `augments` array");
  const out: CanonicalAugment[] = [];
  for (const augment of augments) {
    if (augment === null || typeof augment !== "object") continue;
    const record = augment as Record<string, unknown>;
    const slug = record.slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    const icon = record.cdragonIcon;
    const iconLarge =
      icon !== null && typeof icon === "object"
        ? optionalString((icon as Record<string, unknown>).large)
        : null;
    const flags = record.flags;
    out.push({
      slug,
      augmentId: optionalString(record.augmentId),
      iconLarge: iconLarge !== null && iconLarge.length > 0 ? iconLarge : null,
      localizedNameZhCn: optionalString(record.name_zh_CN),
      lifecycle:
        flags !== null && typeof flags === "object"
          ? optionalString((flags as Record<string, unknown>).lifecycle)
          : null,
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

// ─── Acquisition ───

export interface AcquisitionResult {
  acquired: AcquiredChampionFile[];
  absent: AbsentChampionFile[];
}

/**
 * Fetch every roster champion's static file directly from ARAMGG.
 *
 * Build-time only. No API credits and no `/aramgg-dev` proxy: that proxy is a
 * Vite dev-server affordance for the overlay webview's CSP and does not exist
 * here. A 404 is recorded as a distinct, provable absence rather than being
 * lumped in with a transport error, because "ARAMGG does not publish this
 * champion" and "the network failed" are different facts — though neither one
 * is allowed to produce an artifact.
 */
export async function acquireChampionFiles(
  roster: readonly RosterEntry[],
  fetchImpl: typeof fetch = fetch,
  concurrency = 6,
): Promise<AcquisitionResult> {
  const acquired: AcquiredChampionFile[] = [];
  const absent: AbsentChampionFile[] = [];
  const queue = [...roster];

  async function worker(): Promise<void> {
    for (;;) {
      const entry = queue.shift();
      if (entry === undefined) return;
      const url = `${ARAMGG_ORIGIN}${CHAMPION_AUGMENTS_PATH_PATTERN.replace(
        "{championKey}",
        entry.championKey,
      )}`;
      const response = await fetchImpl(url);
      if (!response.ok) {
        absent.push({ championKey: entry.championKey, slug: entry.slug, httpStatus: response.status });
        continue;
      }
      acquired.push({
        championKey: entry.championKey,
        slug: entry.slug,
        text: await response.text(),
      });
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  acquired.sort((a, b) => compareNumericId(a.championKey, b.championKey));
  absent.sort((a, b) => compareNumericId(a.championKey, b.championKey));
  return { acquired, absent };
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`ARAMGG fetch failed: ${url} -> HTTP ${response.status}`);
  return response.json();
}

// ─── Entry point ───

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const artifactPath = path.join(repoRoot, ARTIFACT_RELATIVE_PATH);

  const roster = readRoster(
    JSON.parse(await readFile(path.join(repoRoot, "data/internal/champions.json"), "utf8")),
  );
  const canonicalAugments = readCanonicalAugments(
    JSON.parse(await readFile(path.join(repoRoot, "data/internal/augments.json"), "utf8")),
  );

  process.stdout.write(`roster: ${roster.length} champions\n`);
  process.stdout.write(`canonical augments: ${canonicalAugments.length}\n`);
  process.stdout.write(`fetching ${ARAMGG_ORIGIN}${CHAMPION_AUGMENTS_PATH_PATTERN} ...\n`);

  const [aramggCatalog, changelog, acquisition] = await Promise.all([
    fetchJson(fetch, `${ARAMGG_ORIGIN}${CATALOG_PATH}`),
    fetchJson(fetch, `${ARAMGG_ORIGIN}${CHANGELOG_PATH}`),
    acquireChampionFiles(roster),
  ]);

  process.stdout.write(
    `acquired: ${acquisition.acquired.length}/${roster.length}` +
      (acquisition.absent.length > 0 ? `  absent: ${acquisition.absent.length}\n` : "\n"),
  );

  const result = await generateAndWrite(
    {
      roster,
      acquired: acquisition.acquired,
      absent: acquisition.absent,
      aramggCatalog,
      changelog,
      canonicalAugments,
      registry: SEEDED_PATCH_REGISTRY,
    },
    artifactPath,
  );

  // Printed before the fail-closed exit: a rejected run still has to say which
  // patch it believed it was looking at.
  for (const facet of ["serving", "target"] as const) {
    const resolved = result.resolved[facet];
    process.stdout.write(
      resolved === null
        ? `${facet} patch: UNRESOLVED\n`
        : `${facet} patch: raw ${resolved.rawValue} -> display ${resolved.identity.displayPatch} ` +
          `(runtime ${resolved.identity.runtimePatch}, evidence ${resolved.identity.equivalenceEvidence})\n`,
    );
  }

  if (result.identity !== null) {
    process.stdout.write(
      `identity: ${result.identity.byAramggId.size} canonical->ARAMGG mappings, ` +
        `${result.identity.collisions.length} collision(s), ` +
        `${result.identity.rejections.length} canonical augment(s) unresolved\n`,
    );
    process.stdout.write(`identity methods: ${JSON.stringify(result.identity.methodCounts)}\n`);
  }

  if (!result.ok) {
    process.stderr.write("\nFAILED CLOSED - no artifact written, previous artifact untouched.\n");
    for (const failure of result.failures) process.stderr.write(`  - ${describeFailure(failure)}\n`);
    if (result.identity !== null && result.identity.rejections.length > 0) {
      process.stderr.write("\ncanonical augments with no ARAMGG counterpart:\n");
      for (const rejection of result.identity.rejections) {
        process.stderr.write(
          `  - ${rejection.slug} (${rejection.reason}, lifecycle=${rejection.lifecycle ?? "?"})\n`,
        );
      }
    }
    process.exit(1);
  }

  const contents = serializeArtifact(result.artifact);

  process.stdout.write(`\nartifact: ${ARTIFACT_RELATIVE_PATH}\n`);
  process.stdout.write(`bytes: ${Buffer.byteLength(contents, "utf8")}\n`);
  process.stdout.write(`sha256(payload): ${result.artifact.checksum.value}\n`);
  process.stdout.write(`champions: ${result.artifact.payload.champions.length}\n`);
  process.stdout.write(`rows: ${result.artifact.payload.totals.rows}\n`);
  process.stdout.write(`null win-rate rows: ${result.artifact.payload.totals.nullWinRateRows}\n`);
}

/**
 * Run only when this file IS the thing that was invoked.
 *
 * `require.main === module` does not hold under jiti, which is how this script
 * runs, so it would never have fired. A bare `process.env.VITEST !== "true"`
 * guard fires too often instead: any non-vitest importer — another script, a
 * REPL — would silently kick off a live 173-champion fetch just by importing a
 * pure helper. Comparing argv[1] to this file answers the actual question.
 */
function invokedDirectly(): boolean {
  if (process.env.VITEST === "true") return false;
  const entry = process.argv[1];
  return typeof entry === "string" && path.resolve(entry) === path.resolve(__filename);
}

if (invokedDirectly()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
