/**
 * Local-only collector calibration NDJSON exporter.
 *
 * This command consumes already-safe collector calibration event JSON and writes
 * sanitized NDJSON files locally. It has no BigQuery or network upload path.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  exportCollectorCalibrationRowsLocal,
  type LocalCollectorCalibrationExportSummary,
} from "../../src/lib/bigquery/local-collector-calibration-export";
import type {
  CollectorCalibrationEvent,
  CollectorCalibrationGate,
} from "../../src/lib/bigquery/collector-calibration";

interface Args {
  input?: string;
  outDir: string;
  enabled: boolean;
}

interface CollectorCalibrationLocalExportInput {
  events?: CollectorCalibrationEvent[];
  gate?: CollectorCalibrationGate;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run export:collector-calibration:local -- --enable-local-export --input /path/to/events.json --out-dir /tmp/mayhem-calibration",
    "",
    "Input JSON shape:",
    '  { "gate": { "liveCaptureAllowed": true }, "events": [] }',
  ].join("\n");
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: path.join(".collector-calibration-export"),
    enabled: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      args.input = argv[++index];
    } else if (arg === "--out-dir") {
      args.outDir = argv[++index];
    } else if (arg === "--enable-local-export") {
      args.enabled = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  return args;
}

async function readInput(inputPath?: string): Promise<CollectorCalibrationLocalExportInput> {
  if (!inputPath) {
    throw new Error(`--input is required\n\n${usage()}`);
  }
  const text = await readFile(inputPath, "utf-8");
  const parsed = JSON.parse(text) as CollectorCalibrationLocalExportInput;
  return {
    gate: parsed.gate,
    events: parsed.events,
  };
}

function normalizeInput(input: CollectorCalibrationLocalExportInput): {
  events: CollectorCalibrationEvent[];
  gate: CollectorCalibrationGate;
} {
  return {
    events: Array.isArray(input.events) ? input.events : [],
    gate: input.gate ?? { liveCaptureAllowed: false },
  };
}

async function main(): Promise<LocalCollectorCalibrationExportSummary> {
  const args = parseArgs(process.argv.slice(2));
  const input = normalizeInput(await readInput(args.input));
  const summary = await exportCollectorCalibrationRowsLocal({
    enabled: args.enabled,
    events: input.events,
    gate: input.gate,
    outDir: args.outDir,
  });
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
