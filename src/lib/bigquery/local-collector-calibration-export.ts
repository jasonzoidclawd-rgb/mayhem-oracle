import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildPrivateCalibrationInputFromCollectorEvents,
  type CollectorCalibrationEvent,
  type CollectorCalibrationGate,
} from "./collector-calibration";
import {
  buildPrivateCalibrationExport,
  calibrationExportToNdjsonFiles,
} from "./private-calibration";

export interface LocalCollectorCalibrationExportRequest {
  enabled?: boolean;
  events: CollectorCalibrationEvent[];
  gate: CollectorCalibrationGate;
  outDir: string;
}

export interface LocalCollectorCalibrationExportSummary {
  mode: "local-only";
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

export async function exportCollectorCalibrationRowsLocal({
  enabled = false,
  events,
  gate,
  outDir,
}: LocalCollectorCalibrationExportRequest): Promise<LocalCollectorCalibrationExportSummary> {
  if (!enabled) {
    throw new Error("collector calibration local export must be explicitly enabled");
  }

  const input = buildPrivateCalibrationInputFromCollectorEvents(events, gate);
  const output = buildPrivateCalibrationExport(input);
  const files = calibrationExportToNdjsonFiles(output);
  await mkdir(outDir, { recursive: true });

  for (const [filename, contents] of Object.entries(files)) {
    await writeFile(join(outDir, filename), contents);
  }

  return {
    mode: "local-only",
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
