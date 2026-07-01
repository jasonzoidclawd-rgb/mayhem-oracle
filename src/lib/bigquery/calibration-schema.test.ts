import { describe, expect, it } from "vitest";
import {
  createBigQuerySchemaRestClient,
  expectedPrivateCalibrationTables,
  provisionMissingPrivateCalibrationTables,
  validatePrivateCalibrationSchema,
  type BigQueryCalibrationSchemaClient,
  type BigQueryTableField,
} from "./calibration-schema";

function tableMapWithAllValid(): Record<string, BigQueryTableField[] | undefined> {
  return Object.fromEntries(
    expectedPrivateCalibrationTables().map((table) => [table.table, table.fields]),
  );
}

function mockSchemaClient(options: {
  datasetExists?: boolean;
  tables?: Record<string, BigQueryTableField[] | undefined>;
}) {
  const tables = options.tables ?? {};
  const calls: {
    datasetExists: number;
    getTableSchema: string[];
    createTable: Array<{ table: string; fields: BigQueryTableField[]; description?: string }>;
  } = {
    datasetExists: 0,
    getTableSchema: [],
    createTable: [],
  };
  const client: BigQueryCalibrationSchemaClient = {
    async datasetExists() {
      calls.datasetExists += 1;
      return options.datasetExists ?? true;
    },
    async getTableSchema(table) {
      calls.getTableSchema.push(table);
      const fields = tables[table];
      return fields ? { exists: true, fields } : { exists: false };
    },
    async createTable(table, fields, description) {
      calls.createTable.push({ table, fields, description });
    },
  };
  return { calls, client };
}

describe("BigQuery private calibration schema validation", () => {
  it("fails closed before constructing a REST schema client when env vars are missing", () => {
    expect(() => createBigQuerySchemaRestClient({})).toThrow(/missing BigQuery env/i);
    expect(() =>
      createBigQuerySchemaRestClient({
        BIGQUERY_PROJECT_ID: "project",
        BIGQUERY_DATASET: "dataset",
      }),
    ).toThrow(/GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it("reports missing dataset without checking tables", async () => {
    const { calls, client } = mockSchemaClient({ datasetExists: false });

    const report = await validatePrivateCalibrationSchema(client);

    expect(report.datasetExists).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.tables.every((table) => table.status === "not_checked")).toBe(true);
    expect(calls.getTableSchema).toEqual([]);
  });

  it("reports valid, missing, and mismatched tables", async () => {
    const tables = tableMapWithAllValid();
    delete tables["collector_raw.round_events"];
    tables["collector_raw.local_match_context"] = tables["collector_raw.local_match_context"]?.map(
      (field) => (field.name === "queue_id" ? { ...field, type: "STRING" } : field),
    );
    const { client } = mockSchemaClient({ tables });

    const report = await validatePrivateCalibrationSchema(client);
    const byTable = Object.fromEntries(report.tables.map((table) => [table.table, table]));

    expect(report.ok).toBe(false);
    expect(byTable["collector_raw.augment_offers"].status).toBe("valid");
    expect(byTable["collector_raw.round_events"].status).toBe("missing");
    expect(byTable["collector_raw.local_match_context"]).toMatchObject({
      status: "mismatch",
      mismatchedFields: [
        {
          name: "queue_id",
          expected: { name: "queue_id", type: "INT64", mode: "NULLABLE" },
          actual: { name: "queue_id", type: "STRING", mode: "NULLABLE" },
        },
      ],
    });
  });

  it("normalizes BigQuery type aliases during validation", async () => {
    const tables = tableMapWithAllValid();
    tables["collector_raw.augment_offers"] = tables["collector_raw.augment_offers"]?.map((field) => {
      if (field.type === "INT64") return { ...field, type: "INTEGER" };
      if (field.type === "FLOAT64") return { ...field, type: "FLOAT" };
      return field;
    });
    tables["riot_raw.match_summaries"] = tables["riot_raw.match_summaries"]?.map((field) =>
      field.type === "BOOL" ? { ...field, type: "BOOLEAN" } : field,
    );
    const { client } = mockSchemaClient({ tables });

    const report = await validatePrivateCalibrationSchema(client);

    expect(report.ok).toBe(true);
    expect(report.tables.every((table) => table.status === "valid")).toBe(true);
  });

  it("create-missing provisions only missing tables and leaves mismatches unchanged", async () => {
    const tables = tableMapWithAllValid();
    delete tables["collector_raw.round_events"];
    tables["collector_raw.local_match_context"] = tables["collector_raw.local_match_context"]?.filter(
      (field) => field.name !== "queue_id",
    );
    const { calls, client } = mockSchemaClient({ tables });

    const report = await provisionMissingPrivateCalibrationTables(client);

    expect(calls.createTable.map((call) => call.table)).toEqual(["collector_raw.round_events"]);
    expect(calls.createTable[0].fields).toEqual(
      expectedPrivateCalibrationTables().find((table) => table.table === "collector_raw.round_events")
        ?.fields,
    );
    expect(report.createdTables).toEqual(["collector_raw.round_events"]);
    expect(report.validation.tables.find((table) => table.table === "collector_raw.local_match_context"))
      .toMatchObject({
        status: "mismatch",
        missingFields: ["queue_id"],
      });
  });

  it("schema source of truth contains exactly the five private calibration tables", () => {
    expect(expectedPrivateCalibrationTables().map((table) => table.table)).toEqual([
      "collector_raw.augment_offers",
      "collector_raw.round_events",
      "collector_raw.local_match_context",
      "riot_raw.match_summaries",
      "riot_derived.participant_augments",
    ]);
  });
});
