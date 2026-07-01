/**
 * Private calibration NDJSON exporter.
 *
 * Default mode is local dry-run only. It does not contact BigQuery unless a
 * future `--upload` path is explicitly implemented behind credential checks.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertBigQueryUploadEnv,
  buildPrivateCalibrationExport,
  calibrationExportToNdjsonFiles,
  type PrivateCalibrationInput,
} from "../../src/lib/bigquery/private-calibration";

interface Args {
  input?: string;
  outDir: string;
  upload: boolean;
}

function parseArgs(argv: string[]): Args {
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.upload) {
    assertBigQueryUploadEnv();
    throw new Error("BigQuery upload is intentionally not implemented in this scaffold");
  }

  const input = await readInput(args.input);
  const output = buildPrivateCalibrationExport(input);
  const files = calibrationExportToNdjsonFiles(output);
  await mkdir(args.outDir, { recursive: true });

  for (const [filename, contents] of Object.entries(files)) {
    await writeFile(path.join(args.outDir, filename), contents);
  }

  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        outDir: args.outDir,
        files: Object.keys(files).sort(),
        rows: {
          collectorOffers: output.collector_raw.augment_offers.length,
          collectorRoundEvents: output.collector_raw.round_events.length,
          collectorLocalMatchContexts: output.collector_raw.local_match_context.length,
          riotMatchSummaries: output.riot_raw.match_summaries.length,
          riotParticipantAugments: output.riot_derived.participant_augments.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
