import { RiotApiClient, RiotApiError } from "../../src/lib/riot/client";
import type { RiotPlatformRoute, RiotRegionalRoute } from "../../src/lib/riot/routing";
import {
  extractMatchContext,
  summarizeRiotMatchSchema,
  type RiotMatchSchemaSummary,
  type SanitizedRiotMatchContext,
} from "../../src/lib/riot/transform";

interface CliOptions {
  gameName?: string;
  tagLine?: string;
  puuid?: string;
  matchId?: string;
  regionalRoute: RiotRegionalRoute;
  platformRoute: RiotPlatformRoute;
  count: number;
  start: number;
  queue?: number;
  timeline: boolean;
  status: boolean;
}

interface ObservedMatch {
  schema: RiotMatchSchemaSummary;
  context: SanitizedRiotMatchContext;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const trimmed = token.slice(2);
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      parsed[trimmed.slice(0, equalsIndex)] = trimmed.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[trimmed] = next;
      index += 1;
      continue;
    }

    parsed[trimmed] = true;
  }

  return parsed;
}

function stringOption(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function numberOption(args: Record<string, string | boolean>, key: string): number | undefined {
  const value = stringOption(args, key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanOption(args: Record<string, string | boolean>, key: string): boolean {
  return args[key] === true || args[key] === "true";
}

function parseCliOptions(argv: string[]): CliOptions {
  const args = parseArgs(argv);
  return {
    gameName: stringOption(args, "game-name"),
    tagLine: stringOption(args, "tag-line"),
    puuid: stringOption(args, "puuid"),
    matchId: stringOption(args, "match-id"),
    regionalRoute: (stringOption(args, "regional") ?? "americas") as RiotRegionalRoute,
    platformRoute: (stringOption(args, "platform") ?? "na1") as RiotPlatformRoute,
    count: numberOption(args, "count") ?? 20,
    start: numberOption(args, "start") ?? 0,
    queue: numberOption(args, "queue"),
    timeline: booleanOption(args, "timeline"),
    status: booleanOption(args, "status"),
  };
}

function usage(): string {
  return [
    "Usage:",
    "  RIOT_API_KEY=... npx --yes tsx scripts/riot/discover_matches.ts --status",
    "  RIOT_API_KEY=... npx --yes tsx scripts/riot/discover_matches.ts --match-id NA1_... [--timeline]",
    "  RIOT_API_KEY=... npx --yes tsx scripts/riot/discover_matches.ts --puuid <puuid> [--queue 2400] [--count 20] [--timeline]",
    '  RIOT_API_KEY=... npx --yes tsx scripts/riot/discover_matches.ts --game-name "Name" --tag-line TAG [--queue 2400]',
    "",
    "The script prints sanitized summaries only. Do not commit raw Riot payloads.",
  ].join("\n");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function hasAnySelectedAugment(matches: ObservedMatch[]): boolean {
  return matches.some((match) => match.schema.hasSelectedAugmentCandidates);
}

function hasAnyOfferedAugment(matches: ObservedMatch[]): boolean {
  return matches.some((match) => match.schema.hasOfferedAugmentCandidates);
}

async function fetchObservedMatch(
  client: RiotApiClient,
  matchId: string,
  includeTimeline: boolean,
  endpointsChecked: string[],
): Promise<ObservedMatch> {
  endpointsChecked.push("match-v5/matches/{matchId}");
  const match = await client.matchById(matchId);
  const timeline = includeTimeline ? await client.timelineByMatchId(matchId) : undefined;
  if (includeTimeline) {
    endpointsChecked.push("match-v5/matches/{matchId}/timeline");
  }

  return {
    schema: summarizeRiotMatchSchema(match, timeline),
    context: extractMatchContext(match),
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    throw new Error(`RIOT_API_KEY is required.\n\n${usage()}`);
  }

  const endpointsChecked: string[] = [];
  const client = new RiotApiClient({
    apiKey,
    regionalRoute: options.regionalRoute,
    platformRoute: options.platformRoute,
  });

  if (options.status) {
    endpointsChecked.push("lol-status-v4/platform-data");
    const status = await client.platformStatus();
    printJson({
      endpointsChecked,
      platformRoute: options.platformRoute,
      statusKeys: Object.keys(status).sort(),
    });
    return;
  }

  let puuid = options.puuid;
  if (!puuid && options.gameName && options.tagLine) {
    endpointsChecked.push("account-v1/accounts/by-riot-id/{gameName}/{tagLine}");
    const account = await client.accountByRiotId(options.gameName, options.tagLine);
    puuid = account.puuid;
  }

  let matchIds: string[] = [];
  if (options.matchId) {
    matchIds = [options.matchId];
  } else if (puuid) {
    endpointsChecked.push("match-v5/matches/by-puuid/{puuid}/ids");
    matchIds = await client.matchIdsByPuuid({
      puuid,
      start: options.start,
      count: options.count,
      queue: options.queue,
    });
  } else {
    throw new Error(`Provide --match-id, --puuid, --game-name/--tag-line, or --status.\n\n${usage()}`);
  }

  const observedMatches: ObservedMatch[] = [];
  for (const matchId of matchIds.slice(0, options.count)) {
    const observed = await fetchObservedMatch(client, matchId, options.timeline, endpointsChecked);
    if (options.queue !== undefined && observed.schema.queueId !== options.queue) {
      continue;
    }
    observedMatches.push(observed);
  }

  printJson({
    endpointsChecked: Array.from(new Set(endpointsChecked)),
    regionalRoute: options.regionalRoute,
    platformRoute: options.platformRoute,
    observedMatchCount: observedMatches.length,
    selectedAugmentsPresent: hasAnySelectedAugment(observedMatches),
    offeredAugmentsPresent: hasAnyOfferedAugment(observedMatches),
    collectorReplacement:
      hasAnyOfferedAugment(observedMatches)
        ? "inspect_fields_before_changing_collector_ownership"
        : "no_for_offered_but_not_picked_augments",
    matches: observedMatches,
  });
}

main().catch((error: unknown) => {
  if (error instanceof RiotApiError) {
    process.stderr.write(`${error.message}\n${error.bodyPreview}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write("Unknown Riot discovery error.\n");
  }
  process.exit(1);
});
