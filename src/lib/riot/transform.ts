export interface RiotFieldPath {
  path: string;
  key: string;
  valueType: string;
  valuePreview?: string | number | boolean | null;
}

export interface SelectedAugmentCandidate {
  path: string;
  value: string | number | boolean;
}

export interface SanitizedRiotParticipant {
  participantId?: number;
  participantIndex?: number;
  championId?: number;
  championName?: string;
  teamId?: number;
  win?: boolean;
  items: number[];
  summonerSpellIds: number[];
  selectedAugmentCandidates: SelectedAugmentCandidate[];
}

export interface SanitizedRiotMatchContext {
  matchId?: string;
  queueId?: number;
  gameMode?: string;
  mapId?: number;
  gameVersion?: string;
  participants: SanitizedRiotParticipant[];
}

export interface RiotMatchSchemaSummary {
  matchId?: string;
  queueId?: number;
  gameMode?: string;
  mapId?: number;
  gameVersion?: string;
  participantCount: number;
  selectedAugmentFieldPaths: string[];
  offeredAugmentFieldPaths: string[];
  perkFieldPaths: string[];
  modeSpecificFieldPaths: string[];
  hasSelectedAugmentCandidates: boolean;
  hasOfferedAugmentCandidates: boolean;
}

const SELECTED_AUGMENT_KEY_PATTERN = /(augment|playeraugment|cherry|mayhem|mission)/i;
const OFFER_KEY_PATTERN = /(offer|offered|choice|choices|option|options)/i;
const PERK_KEY_PATTERN = /^perks?$|perk/i;
const IDENTITY_KEY_PATTERN =
  /(puuid|summonerid|summonername|riotid|gameName|tagLine|profileIconId)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function primitivePreview(
  value: unknown,
  key: string,
  path: string,
): string | number | boolean | null | undefined {
  if (IDENTITY_KEY_PATTERN.test(key) || IDENTITY_KEY_PATTERN.test(path)) {
    return undefined;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function keyMatches(key: string, terms: string[]): boolean {
  const lowerKey = key.toLowerCase();
  return terms.some((term) => lowerKey.includes(term.toLowerCase()));
}

function stringValueMatches(value: unknown, terms: string[]): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const lowerValue = value.toLowerCase();
  return terms.some((term) => lowerValue.includes(term.toLowerCase()));
}

function pushUnique(paths: string[], path: string): void {
  if (!paths.includes(path)) {
    paths.push(path);
  }
}

function sortedUnique(paths: string[]): string[] {
  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right));
}

function participantPath(index: number, field: string): string {
  return `info.participants[${index}].${field}`;
}

function isPresentCandidateValue(value: unknown): value is string | number | boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (value === false) {
    return false;
  }
  if (value === 0) {
    return false;
  }
  if (typeof value === "string" && value.trim() === "") {
    return false;
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function extractSelectedAugmentCandidates(
  participant: Record<string, unknown>,
  participantIndex: number,
): SelectedAugmentCandidate[] {
  const candidates: SelectedAugmentCandidate[] = [];

  for (const [key, value] of Object.entries(participant)) {
    if (!SELECTED_AUGMENT_KEY_PATTERN.test(key)) {
      continue;
    }

    if (isPresentCandidateValue(value)) {
      candidates.push({
        path: participantPath(participantIndex, key),
        value,
      });
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, entryIndex) => {
        if (!isPresentCandidateValue(entry)) {
          return;
        }
        candidates.push({
          path: `${participantPath(participantIndex, key)}[${entryIndex}]`,
          value: entry,
        });
      });
    }
  }

  return candidates;
}

function participantRecords(match: unknown): Record<string, unknown>[] {
  const root = isRecord(match) ? match : {};
  const info = isRecord(root.info) ? root.info : {};
  return Array.isArray(info.participants)
    ? info.participants.filter(isRecord)
    : [];
}

export function findRiotFieldPaths(value: unknown, terms: string[]): RiotFieldPath[] {
  const results: RiotFieldPath[] = [];

  function visit(current: unknown, path: string, key: string): void {
    const matches = keyMatches(key, terms) || stringValueMatches(current, terms);
    if (path && matches && !IDENTITY_KEY_PATTERN.test(key) && !IDENTITY_KEY_PATTERN.test(path)) {
      const entry: RiotFieldPath = {
        path,
        key,
        valueType: valueType(current),
      };
      const preview = primitivePreview(current, key, path);
      if (preview !== undefined) {
        entry.valuePreview = preview;
      }
      results.push(entry);
    }

    if (Array.isArray(current)) {
      current.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`, key);
      });
      return;
    }

    if (!isRecord(current)) {
      return;
    }

    for (const [childKey, childValue] of Object.entries(current)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      visit(childValue, childPath, childKey);
    }
  }

  visit(value, "", "");
  return results;
}

export function extractMatchContext(match: unknown): SanitizedRiotMatchContext {
  const root = isRecord(match) ? match : {};
  const metadata = isRecord(root.metadata) ? root.metadata : {};
  const info = isRecord(root.info) ? root.info : {};
  const participants = participantRecords(match);

  return {
    matchId: stringValue(metadata.matchId),
    queueId: numberValue(info.queueId),
    gameMode: stringValue(info.gameMode),
    mapId: numberValue(info.mapId),
    gameVersion: stringValue(info.gameVersion),
    participants: participants.map((participant, index) => ({
      participantId: numberValue(participant.participantId),
      participantIndex: numberValue(participant.participantIndex) ?? index,
      championId: numberValue(participant.championId),
      championName: stringValue(participant.championName),
      teamId: numberValue(participant.teamId),
      win: booleanValue(participant.win),
      items: [0, 1, 2, 3, 4, 5, 6].map((itemIndex) => {
        const item = numberValue(participant[`item${itemIndex}`]);
        return item ?? 0;
      }),
      summonerSpellIds: [participant.summoner1Id, participant.summoner2Id].flatMap((spellId) => {
        const value = numberValue(spellId);
        return value === undefined ? [] : [value];
      }),
      selectedAugmentCandidates: extractSelectedAugmentCandidates(participant, index),
    })),
  };
}

export function summarizeRiotMatchSchema(
  match: unknown,
  timeline?: unknown,
): RiotMatchSchemaSummary {
  const context = extractMatchContext(match);
  const candidatePaths = findRiotFieldPaths(match, [
    "augment",
    "playerAugment",
    "perk",
    "cherry",
    "mayhem",
    "mission",
  ]);
  const timelineCandidatePaths = timeline
    ? findRiotFieldPaths(timeline, [
        "augment",
        "playerAugment",
        "perk",
        "cherry",
        "mayhem",
        "mission",
        "offer",
        "choice",
      ])
    : [];

  const selectedAugmentFieldPaths = candidatePaths
    .filter(
      (entry) =>
        entry.path.includes("info.participants[") &&
        SELECTED_AUGMENT_KEY_PATTERN.test(entry.key),
    )
    .map((entry) => entry.path);

  const offeredAugmentFieldPaths: string[] = [];
  for (const entry of [...candidatePaths, ...timelineCandidatePaths]) {
    if (
      OFFER_KEY_PATTERN.test(entry.key) &&
      /(augment|cherry|mayhem|mission)/i.test(`${entry.key} ${entry.path}`)
    ) {
      pushUnique(offeredAugmentFieldPaths, entry.path);
    }
  }

  const perkFieldPaths = candidatePaths
    .filter((entry) => PERK_KEY_PATTERN.test(entry.key))
    .map((entry) => entry.path);

  const modeSpecificFieldPaths = candidatePaths
    .filter((entry) => /(cherry|mayhem|mission)/i.test(`${entry.key} ${String(entry.valuePreview)}`))
    .map((entry) => entry.path);

  return {
    matchId: context.matchId,
    queueId: context.queueId,
    gameMode: context.gameMode,
    mapId: context.mapId,
    gameVersion: context.gameVersion,
    participantCount: context.participants.length,
    selectedAugmentFieldPaths: sortedUnique(selectedAugmentFieldPaths),
    offeredAugmentFieldPaths: sortedUnique(offeredAugmentFieldPaths),
    perkFieldPaths: sortedUnique(perkFieldPaths),
    modeSpecificFieldPaths: sortedUnique(modeSpecificFieldPaths),
    hasSelectedAugmentCandidates: selectedAugmentFieldPaths.length > 0,
    hasOfferedAugmentCandidates: offeredAugmentFieldPaths.length > 0,
  };
}
