import { describe, expect, it, vi } from "vitest";
import { createBigQuerySchemaRestClient, expectedPrivateCalibrationTables } from "./calibration-schema";
import type { BigQueryCalibrationSchemaClient } from "./calibration-schema";

async function importCli() {
  const originalArgv = process.argv;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`unexpected process.exit(${code}) during import`);
  }) as never);
  process.argv = ["node", "scripts/bigquery/calibration-schema.ts"];
  try {
    return await import("../../../scripts/bigquery/calibration-schema");
  } finally {
    process.argv = originalArgv;
    exitSpy.mockRestore();
  }
}

function validClient(): BigQueryCalibrationSchemaClient {
  const tables = Object.fromEntries(
    expectedPrivateCalibrationTables().map((table) => [table.table, table.fields]),
  );
  return {
    async datasetExists() {
      return true;
    },
    async getTableSchema(table) {
      return { exists: true, fields: tables[table] };
    },
    async createTable() {
      throw new Error("createTable must not be called in validate mode");
    },
  };
}

describe("BigQuery calibration schema CLI", () => {
  it("requires an explicit safe mode and does not construct a BigQuery client by default", async () => {
    const { runBigQueryCalibrationSchemaCli } = await importCli();
    const createClient = vi.fn(() => {
      throw new Error("BigQuery client must not be constructed without a mode");
    });

    await expect(
      runBigQueryCalibrationSchemaCli([], {
        createClient,
        log: () => undefined,
      }),
    ).rejects.toThrow(/Usage:/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("fails closed for BigQuery-backed validation when env vars are missing", async () => {
    const { runBigQueryCalibrationSchemaCli } = await importCli();

    await expect(
      runBigQueryCalibrationSchemaCli(["--validate"], {
        createClient: () => createBigQuerySchemaRestClient({}),
        log: () => undefined,
      }),
    ).rejects.toThrow(/missing BigQuery env/i);
  });

  it("runs validation with a mocked BigQuery client", async () => {
    const { runBigQueryCalibrationSchemaCli } = await importCli();
    const createClient = vi.fn(() => ({
      projectId: "project",
      dataset: "dataset",
      ...validClient(),
    }));

    const report = await runBigQueryCalibrationSchemaCli(["--validate"], {
      createClient,
      log: () => undefined,
    });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(report.mode).toBe("validate");
    expect(report.validation.ok).toBe(true);
  });

  it("creates only missing tables in create-missing mode with a mocked client", async () => {
    const { runBigQueryCalibrationSchemaCli } = await importCli();
    const expected = expectedPrivateCalibrationTables();
    const created: string[] = [];
    const createClient = vi.fn(() => ({
      projectId: "project",
      dataset: "dataset",
      async datasetExists() {
        return true;
      },
      async getTableSchema(table: string) {
        if (table === "riot_derived.participant_augments") return { exists: false };
        return { exists: true, fields: expected.find((entry) => entry.table === table)?.fields };
      },
      async createTable(table: string) {
        created.push(table);
      },
    }));

    const report = await runBigQueryCalibrationSchemaCli(["--create-missing"], {
      createClient,
      log: () => undefined,
    });

    expect(created).toEqual(["riot_derived.participant_augments"]);
    expect(report.mode).toBe("create-missing");
    expect(report.provisioning.createdTables).toEqual(["riot_derived.participant_augments"]);
  });
});
