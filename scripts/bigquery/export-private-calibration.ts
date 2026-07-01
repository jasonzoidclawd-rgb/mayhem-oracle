/**
 * Private calibration NDJSON exporter.
 *
 * Default mode is local dry-run only. BigQuery upload requires `--upload` and
 * the explicit BigQuery environment gate.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createBigQueryRestUploader,
  uploadPrivateCalibrationExport,
  type BigQueryCalibrationUploadSummary,
  type BigQueryCalibrationUploader,
} from "../../src/lib/bigquery/bigquery-upload";
import {
  buildPrivateCalibrationExport,
  calibrationExportToNdjsonFiles,
  type PrivateCalibrationInput,
} from "../../src/lib/bigquery/private-calibration";

interface Args {
  input?: string;
  outDir: string;
  upload: boolean;
}

interface PrivateCalibrationDryRunSummary {
  mode: "dry-run";
  outDir: string;
  files: string[];
  rows: {
    collectorOffers: number;
    collectorRoundEvents: number;
    collectorLocalMatchContexts: number;
    riotMatchSummaries: number;
    riotParticipantAugments: number;
  };
}

type PrivateCalibrationExportCliSummary =
  | PrivateCalibrationDryRunSummary
  | BigQueryCalibrationUploadSummary;

interface BigQueryUploaderWithTarget extends BigQueryCalibrationUploader {
  projectId: string;
  dataset: string;
}

export interface PrivateCalibrationExportCliDeps {
  createUploader?: () => BigQueryUploaderWithTarget;
  log?: (message: string) => void;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: path.join(".private-calibration-export"),
    upload: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[++i];
    } else if (arg === "--out-dir") {
      args.outDir = argv[++i];
    } else if (arg === "--upload") {
      args.upload = true;
    } else if (arg === "--dry-run") {
      args.upload = false;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readInput(inputPath?: string): Promise<PrivateCalibrationInput> {
  if (!inputPath) return {};
  const text = await readFile(inputPath, "utf-8");
  return JSON.parse(text) as PrivateCalibrationInput;
}

async function writeNdjsonFiles(outDir: string, files: Record<string, string>): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const [filename, contents] of Object.entries(files)) {
    await writeFile(path.join(outDir, filename), contents);
  }
}

function dryRunSummary(
  outDir: string,
  files: Record<string, string>,
  output: ReturnType<typeof buildPrivateCalibrationExport>,
): PrivateCalibrationDryRunSummary {
  return {
    mode: "dry-run",
    outDir,
    files: Object.keys(files).sort(),
    rows: {
      collectorOffers: output.collector_raw.augment_offers.length,
      collectorRoundEvents: output.collector_raw.round_events.length,
      collectorLocalMatchContexts: output.collector_raw.local_match_context.length,
      riotMatchSummaries: output.riot_raw.match_summaries.length,
      riotParticipantAugments: output.riot_derived.participant_augments.length,
    },
  };
}

export async function runPrivateCalibrationExportCli(
  argv: string[] = process.argv.slice(2),
  deps: PrivateCalibrationExportCliDeps = {},
): Promise<PrivateCalibrationExportCliSummary> {
  const args = parseArgs(argv);
  const input = await readInput(args.input);
  const output = buildPrivateCalibrationExport(input);

  if (args.upload) {
    const uploader = deps.createUploader?.() ?? createBigQueryRestUploader();
    const summary = await uploadPrivateCalibrationExport(output, uploader, {
      projectId: uploader.projectId,
      dataset: uploader.dataset,
    });
    (deps.log ?? console.log)(JSON.stringify(summary, null, 2));
    return summary;
  }

  const files = calibrationExportToNdjsonFiles(output);
  await writeNdjsonFiles(args.outDir, files);
  const summary = dryRunSummary(args.outDir, files, output);
  (deps.log ?? console.log)(JSON.stringify(summary, null, 2));
  return summary;
}

function main(): Promise<PrivateCalibrationExportCliSummary> {
  return runPrivateCalibrationExportCli();
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
