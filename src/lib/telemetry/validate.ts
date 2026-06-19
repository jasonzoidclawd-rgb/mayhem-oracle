import type { SafeMatchExport } from "../contracts/telemetry";

// Server-side re-validation of an uploaded batch. The desktop collector
// sanitizes before upload, but the server MUST NOT trust that — this rebuilds
// each record from an allowlist so any identity field (PUUID, Riot ID, name,
// chat) or unknown key is dropped, and rejects anything malformed or off-queue.

// Long, unambiguous identity tokens match as substrings; short ones (name, ip)
// match only as a whole key so legitimate fields like "participants" pass.
const FORBIDDEN_SUBSTRING = /puuid|riotid|summoner|displayname|accountid|chat|email/i;
const FORBIDDEN_EXACT = new Set(["name", "ip", "ipaddress", "account"]);

function isForbiddenKey(key: string): boolean {
  if (FORBIDDEN_SUBSTRING.test(key)) return true;
  return FORBIDDEN_EXACT.has(key.toLowerCase().replace(/_/g, ""));
}

export type BatchParse =
  | { ok: true; matches: SafeMatchExport[] }
  | { ok: false; error: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function finiteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Any forbidden key anywhere in the object graph fails the whole batch. */
function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) => isForbiddenKey(key) || hasForbiddenKey(child),
    );
  }
  return false;
}

function parseParticipant(raw: unknown): SafeMatchExport["participants"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const stats = p.stats as Record<string, unknown> | undefined;
  if (
    typeof p.slot !== "string" ||
    (p.team !== 100 && p.team !== 200) ||
    typeof p.championSlug !== "string" ||
    !isStringArray(p.augmentSlugs) ||
    !isStringArray(p.itemIds) ||
    typeof p.won !== "boolean" ||
    !stats ||
    !finiteInt(stats.kills) ||
    !finiteInt(stats.deaths) ||
    !finiteInt(stats.assists) ||
    !finiteInt(stats.damageToChampions)
  ) {
    return null;
  }
  return {
    slot: p.slot,
    team: p.team,
    championSlug: p.championSlug,
    augmentSlugs: p.augmentSlugs,
    itemIds: p.itemIds,
    won: p.won,
    stats: {
      kills: stats.kills as number,
      deaths: stats.deaths as number,
      assists: stats.assists as number,
      damageToChampions: stats.damageToChampions as number,
    },
  };
}

function parseContributorRounds(raw: unknown): SafeMatchExport["contributorRounds"] | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  // A real Mayhem game has at most 4 rounds; cap length to prevent a single
  // upload inflating BqRoundRow output (amplification/DoS surface).
  if (raw.length > 8) return null;
  const rounds: NonNullable<SafeMatchExport["contributorRounds"]> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const r = entry as Record<string, unknown>;
    if (
      ![1, 2, 3, 4].includes(r.round as number) ||
      !isStringArray(r.offeredAugmentSlugs) ||
      (r.selectedAugmentSlug !== undefined && typeof r.selectedAugmentSlug !== "string") ||
      !finiteInt(r.ocrConfidence)
    ) {
      return null;
    }
    rounds.push({
      round: r.round as 1 | 2 | 3 | 4,
      offeredAugmentSlugs: r.offeredAugmentSlugs,
      ...(typeof r.selectedAugmentSlug === "string"
        ? { selectedAugmentSlug: r.selectedAugmentSlug }
        : {}),
      ocrConfidence: r.ocrConfidence as number,
    });
  }
  return rounds;
}

function parseMatch(raw: unknown): SafeMatchExport | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== 1) return null;
  if (m.queueId !== 2400) return null;
  if (
    typeof m.gameHash !== "string" ||
    m.gameHash.length < 8 ||
    typeof m.patch !== "string" ||
    !finiteInt(m.durationSeconds) ||
    typeof m.collectedAt !== "string" ||
    (m.source !== "owned-history" && m.source !== "snowball") ||
    !Array.isArray(m.participants)
  ) {
    return null;
  }
  const participants = m.participants.map(parseParticipant);
  if (participants.some((p) => p === null)) return null;
  const contributorRounds = parseContributorRounds(m.contributorRounds);
  if (contributorRounds === null) return null;

  return {
    schemaVersion: 1,
    gameHash: m.gameHash,
    patch: m.patch,
    queueId: 2400,
    durationSeconds: m.durationSeconds,
    collectedAt: m.collectedAt,
    source: m.source,
    participants: participants as SafeMatchExport["participants"],
    ...(contributorRounds ? { contributorRounds } : {}),
  };
}

export function parseBatch(raw: unknown): BatchParse {
  if (!Array.isArray(raw)) return { ok: false, error: "batch must be an array of matches" };
  if (raw.length === 0) return { ok: false, error: "empty batch" };
  if (raw.length > 100) return { ok: false, error: "batch exceeds 100 matches" };
  if (hasForbiddenKey(raw)) return { ok: false, error: "identity field present" };

  const matches: SafeMatchExport[] = [];
  for (const entry of raw) {
    const match = parseMatch(entry);
    if (!match) return { ok: false, error: "malformed or off-queue match" };
    matches.push(match);
  }
  return { ok: true, matches };
}
