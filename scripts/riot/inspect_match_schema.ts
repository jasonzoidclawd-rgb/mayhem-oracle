import { readFileSync } from "node:fs";

import {
  extractMatchContext,
  summarizeRiotMatchSchema,
} from "../../src/lib/riot/transform";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const trimmed = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[trimmed] = next;
      index += 1;
    } else {
      parsed[trimmed] = true;
    }
  }

  return parsed;
}

function stringOption(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function usage(): string {
  return [
    "Usage:",
    "  npx --yes tsx scripts/riot/inspect_match_schema.ts --match-file /path/to/match.json [--timeline-file /path/to/timeline.json]",
    "",
    "The output is sanitized, but raw input files may contain PUUID/name data. Do not commit raw Riot payloads.",
  ].join("\n");
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const args = parseArgs(process.argv.slice(2));
const matchFile = stringOption(args, "match-file");

if (!matchFile) {
  process.stderr.write(`${usage()}\n`);
  process.exit(1);
}

const match = readJsonFile(matchFile);
const timelineFile = stringOption(args, "timeline-file");
const timeline = timelineFile ? readJsonFile(timelineFile) : undefined;

process.stdout.write(
  `${JSON.stringify(
    {
      schema: summarizeRiotMatchSchema(match, timeline),
      context: extractMatchContext(match),
    },
    null,
    2,
  )}\n`,
);
