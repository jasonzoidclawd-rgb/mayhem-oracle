import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBigQueryRestUploader } from "./bigquery-upload";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mayhem-private-calibration-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function importCli() {
  const originalArgv = process.argv;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`unexpected process.exit(${code}) during import`);
  }) as never);
  process.argv = ["node", "scripts/bigquery/export-private-calibration.ts", "--upload"];
  try {
    return await import("../../../scripts/bigquery/export-private-calibration");
  } finally {
    process.argv = originalArgv;
    exitSpy.mockRestore();
  }
}

describe("private calibration export CLI", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("keeps default mode local-only and does not construct a BigQuery uploader", async () => {
    const { runPrivateCalibrationExportCli } = await importCli();
    const inputDir = await tempDir();
    const outDir = await tempDir();
    const inputPath = join(inputDir, "input.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        collectorOffers: [
          {
            localMatchNonce: "local-match-abc",
            offeredAugmentSlugs: ["left-card", "middle-card", "right-card"],
            clientTimestamp: "2026-07-02T01:23:45.000Z",
          },
        ],
      }),
    );

    const createUploader = vi.fn(() => {
      throw new Error("BigQuery uploader must not be constructed during dry-run");
    });

    const summary = await runPrivateCalibrationExportCli(
      ["--input", inputPath, "--out-dir", outDir],
      {
        createUploader,
        log: () => undefined,
      },
    );

    expect(summary.mode).toBe("dry-run");
    expect(createUploader).not.toHaveBeenCalled();
    expect(await readFile(join(outDir, "collector_raw.augment_offers.ndjson"), "utf-8")).toContain(
      "\"local_match_nonce\":\"local-match-abc\"",
    );
  });

  it("requires explicit upload flag and fails closed when upload env is missing", async () => {
    const { runPrivateCalibrationExportCli } = await importCli();
    const inputDir = await tempDir();
    const inputPath = join(inputDir, "input.json");
    await writeFile(inputPath, JSON.stringify({ collectorOffers: [] }));

    await expect(
      runPrivateCalibrationExportCli(["--upload", "--input", inputPath], {
        createUploader: () => createBigQueryRestUploader({}),
        log: () => undefined,
      }),
    ).rejects.toThrow(/missing BigQuery env/i);
  });

  it("routes sanitized rows to BigQuery only when --upload is present", async () => {
    const { runPrivateCalibrationExportCli } = await importCli();
    const inputDir = await tempDir();
    const inputPath = join(inputDir, "input.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        collectorOffers: [
          {
            localMatchNonce: "local-match-abc",
            offeredAugmentSlugs: ["left-card", "middle-card", "right-card"],
            clientTimestamp: "2026-07-02T01:23:45.000Z",
          },
        ],
      }),
    );
    const calls: Array<{ table: string; rows: unknown[] }> = [];
    const createUploader = vi.fn(() => ({
      projectId: "project",
      dataset: "dataset",
      insertRows: async (table: string, rows: unknown[]) => {
        calls.push({ table, rows });
      },
    }));

    const summary = await runPrivateCalibrationExportCli(["--upload", "--input", inputPath], {
      createUploader,
      log: () => undefined,
    });

    expect(createUploader).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.table)).toEqual(["collector_raw.augment_offers"]);
    expect(summary).toMatchObject({
      mode: "upload",
      projectId: "project",
      dataset: "dataset",
      rowsUploaded: 1,
    });
  });
});
