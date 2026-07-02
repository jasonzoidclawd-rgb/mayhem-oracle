import { GoogleAuth } from "google-auth-library";
import privateCalibrationSchemaJson from "../../../scripts/bigquery/private-calibration-schema.json";
import { assertBigQueryUploadEnv, type BigQueryUploadEnv } from "./private-calibration";

type FetchLike = typeof fetch;

interface PrivateCalibrationSchemaFile {
  tables: Record<
    string,
    {
      description?: string;
      fields: Record<string, string>;
    }
  >;
}

export interface BigQueryTableField {
  name: string;
  type: string;
  mode: "NULLABLE" | "REQUIRED" | "REPEATED";
}

export interface ExpectedPrivateCalibrationTable {
  table: string;
  description?: string;
  fields: BigQueryTableField[];
}

export interface BigQueryCalibrationSchemaClient {
  datasetExists(): Promise<boolean>;
  getTableSchema(table: string): Promise<{ exists: true; fields: BigQueryTableField[] } | { exists: false }>;
  createTable(table: string, fields: BigQueryTableField[], description?: string): Promise<void>;
}

export interface BigQuerySchemaValidationFieldMismatch {
  name: string;
  expected: BigQueryTableField;
  actual: BigQueryTableField;
}

export interface BigQuerySchemaValidationTableReport {
  table: string;
  status: "valid" | "missing" | "mismatch" | "not_checked";
  missingFields: string[];
  extraFields: string[];
  mismatchedFields: BigQuerySchemaValidationFieldMismatch[];
}

export interface BigQuerySchemaValidationReport {
  datasetExists: boolean;
  ok: boolean;
  tables: BigQuerySchemaValidationTableReport[];
}

export interface BigQuerySchemaProvisioningReport {
  validation: BigQuerySchemaValidationReport;
  createdTables: string[];
}

const BIGQUERY_SCHEMA_SCOPE = "https://www.googleapis.com/auth/bigquery";

function parseFieldSpec(name: string, spec: string): BigQueryTableField {
  const normalized = spec.trim().toUpperCase();
  const arrayMatch = normalized.match(/^ARRAY<(.+)>$/);
  if (arrayMatch) {
    return {
      name,
      type: arrayMatch[1],
      mode: "REPEATED",
    };
  }
  const [type, ...qualifiers] = normalized.split(/\s+/);
  return {
    name,
    type,
    mode: qualifiers.includes("REQUIRED") ? "REQUIRED" : "NULLABLE",
  };
}

function canonicalType(type: string): string {
  const upper = type.toUpperCase();
  if (upper === "INTEGER") return "INT64";
  if (upper === "FLOAT") return "FLOAT64";
  if (upper === "BOOLEAN") return "BOOL";
  return upper;
}

function canonicalField(field: BigQueryTableField): BigQueryTableField {
  return {
    name: field.name,
    type: canonicalType(field.type),
    mode: field.mode ?? "NULLABLE",
  };
}

function restFieldType(type: string): string {
  const canonical = canonicalType(type);
  if (canonical === "INT64") return "INTEGER";
  if (canonical === "FLOAT64") return "FLOAT";
  if (canonical === "BOOL") return "BOOLEAN";
  return canonical;
}

function toRestField(field: BigQueryTableField) {
  return {
    name: field.name,
    type: restFieldType(field.type),
    mode: field.mode,
  };
}

function makeEmptyReport(
  table: string,
  status: BigQuerySchemaValidationTableReport["status"],
): BigQuerySchemaValidationTableReport {
  return {
    table,
    status,
    missingFields: [],
    extraFields: [],
    mismatchedFields: [],
  };
}

function compareTableSchema(
  expected: ExpectedPrivateCalibrationTable,
  actualFields: BigQueryTableField[],
): BigQuerySchemaValidationTableReport {
  const report = makeEmptyReport(expected.table, "valid");
  const actualByName = new Map(actualFields.map((field) => [field.name, canonicalField(field)]));
  const expectedByName = new Map(expected.fields.map((field) => [field.name, canonicalField(field)]));

  for (const expectedField of expected.fields.map(canonicalField)) {
    const actual = actualByName.get(expectedField.name);
    if (!actual) {
      report.missingFields.push(expectedField.name);
      continue;
    }
    if (actual.type !== expectedField.type || actual.mode !== expectedField.mode) {
      report.mismatchedFields.push({
        name: expectedField.name,
        expected: expectedField,
        actual,
      });
    }
  }

  for (const actual of actualByName.values()) {
    if (!expectedByName.has(actual.name)) {
      report.extraFields.push(actual.name);
    }
  }

  if (
    report.missingFields.length > 0 ||
    report.extraFields.length > 0 ||
    report.mismatchedFields.length > 0
  ) {
    report.status = "mismatch";
  }
  return report;
}

async function readResponseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function expectedPrivateCalibrationTables(): ExpectedPrivateCalibrationTable[] {
  const schema = privateCalibrationSchemaJson as PrivateCalibrationSchemaFile;
  return Object.entries(schema.tables).map(([table, definition]) => ({
    table,
    description: definition.description,
    fields: Object.entries(definition.fields).map(([name, spec]) => parseFieldSpec(name, spec)),
  }));
}

export function createBigQuerySchemaRestClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): BigQueryCalibrationSchemaClient & Pick<BigQueryUploadEnv, "projectId" | "dataset"> {
  const uploadEnv = assertBigQueryUploadEnv(env);
  const auth = new GoogleAuth({
    keyFile: uploadEnv.credentialsPath,
    scopes: [BIGQUERY_SCHEMA_SCOPE],
  });

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
    if (!token) {
      throw new Error("BigQuery schema validation could not obtain an access token");
    }
    return fetchImpl(`https://bigquery.googleapis.com/bigquery/v2/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return {
    projectId: uploadEnv.projectId,
    dataset: uploadEnv.dataset,
    async datasetExists() {
      const response = await request(
        "GET",
        `projects/${encodeURIComponent(uploadEnv.projectId)}/datasets/${encodeURIComponent(uploadEnv.dataset)}`,
      );
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new Error(`BigQuery dataset check failed: HTTP ${response.status}`);
      }
      return true;
    },
    async getTableSchema(table) {
      const response = await request(
        "GET",
        [
          "projects",
          encodeURIComponent(uploadEnv.projectId),
          "datasets",
          encodeURIComponent(uploadEnv.dataset),
          "tables",
          encodeURIComponent(table),
        ].join("/"),
      );
      if (response.status === 404) return { exists: false };
      if (!response.ok) {
        throw new Error(`BigQuery table schema check failed for ${table}: HTTP ${response.status}`);
      }
      const payload = await readResponseJson(response);
      const schema = payload.schema as { fields?: BigQueryTableField[] } | undefined;
      return { exists: true, fields: schema?.fields ?? [] };
    },
    async createTable(table, fields, description) {
      const response = await request(
        "POST",
        [
          "projects",
          encodeURIComponent(uploadEnv.projectId),
          "datasets",
          encodeURIComponent(uploadEnv.dataset),
          "tables",
        ].join("/"),
        {
          tableReference: {
            projectId: uploadEnv.projectId,
            datasetId: uploadEnv.dataset,
            tableId: table,
          },
          description,
          schema: {
            fields: fields.map(toRestField),
          },
        },
      );
      if (!response.ok) {
        throw new Error(`BigQuery table create failed for ${table}: HTTP ${response.status}`);
      }
    },
  };
}

export async function validatePrivateCalibrationSchema(
  client: BigQueryCalibrationSchemaClient,
): Promise<BigQuerySchemaValidationReport> {
  const expectedTables = expectedPrivateCalibrationTables();
  const datasetExists = await client.datasetExists();
  if (!datasetExists) {
    return {
      datasetExists: false,
      ok: false,
      tables: expectedTables.map((table) => makeEmptyReport(table.table, "not_checked")),
    };
  }

  const tables: BigQuerySchemaValidationTableReport[] = [];
  for (const expected of expectedTables) {
    const actual = await client.getTableSchema(expected.table);
    if (!actual.exists) {
      tables.push(makeEmptyReport(expected.table, "missing"));
      continue;
    }
    tables.push(compareTableSchema(expected, actual.fields));
  }

  return {
    datasetExists: true,
    ok: tables.every((table) => table.status === "valid"),
    tables,
  };
}

export async function provisionMissingPrivateCalibrationTables(
  client: BigQueryCalibrationSchemaClient,
): Promise<BigQuerySchemaProvisioningReport> {
  const expectedByTable = new Map(
    expectedPrivateCalibrationTables().map((table) => [table.table, table]),
  );
  const validation = await validatePrivateCalibrationSchema(client);
  const createdTables: string[] = [];

  if (!validation.datasetExists) {
    return { validation, createdTables };
  }

  for (const table of validation.tables) {
    if (table.status !== "missing") continue;
    const expected = expectedByTable.get(table.table);
    if (!expected) continue;
    await client.createTable(expected.table, expected.fields, expected.description);
    createdTables.push(expected.table);
  }

  return { validation, createdTables };
}
