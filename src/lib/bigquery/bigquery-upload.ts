import { GoogleAuth } from "google-auth-library";
import {
  assertBigQueryUploadEnv,
  buildPrivateCalibrationExport,
  type BigQueryUploadEnv,
  type PrivateCalibrationExport,
  type PrivateCalibrationInput,
} from "./private-calibration";

export interface BigQueryCalibrationUploader {
  insertRows(table: string, rows: unknown[]): Promise<void>;
}

export interface BigQueryCalibrationUploadTableSummary {
  table: string;
  rows: number;
  skipped: boolean;
}

export interface BigQueryCalibrationUploadSummary {
  mode: "upload";
  projectId: string;
  dataset: string;
  rowsUploaded: number;
  tables: BigQueryCalibrationUploadTableSummary[];
}

type FetchLike = typeof fetch;

const BIGQUERY_INSERT_SCOPE = "https://www.googleapis.com/auth/bigquery.insertdata";

const PRIVATE_CALIBRATION_TABLES = [
  ["collector_raw.augment_offers", (output: PrivateCalibrationExport) => output.collector_raw.augment_offers],
  ["collector_raw.round_events", (output: PrivateCalibrationExport) => output.collector_raw.round_events],
  [
    "collector_raw.local_match_context",
    (output: PrivateCalibrationExport) => output.collector_raw.local_match_context,
  ],
  ["riot_raw.match_summaries", (output: PrivateCalibrationExport) => output.riot_raw.match_summaries],
  [
    "riot_derived.participant_augments",
    (output: PrivateCalibrationExport) => output.riot_derived.participant_augments,
  ],
] as const;

export function createBigQueryRestUploader(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): BigQueryCalibrationUploader & Pick<BigQueryUploadEnv, "projectId" | "dataset"> {
  const uploadEnv = assertBigQueryUploadEnv(env);
  const auth = new GoogleAuth({
    keyFile: uploadEnv.credentialsPath,
    scopes: [BIGQUERY_INSERT_SCOPE],
  });

  return {
    projectId: uploadEnv.projectId,
    dataset: uploadEnv.dataset,
    async insertRows(table, rows) {
      if (rows.length === 0) return;

      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
      if (!token) {
        throw new Error("BigQuery upload could not obtain an access token");
      }

      const url = [
        "https://bigquery.googleapis.com/bigquery/v2/projects",
        encodeURIComponent(uploadEnv.projectId),
        "datasets",
        encodeURIComponent(uploadEnv.dataset),
        "tables",
        encodeURIComponent(table),
        "insertAll",
      ].join("/");
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rows: rows.map((row, index) => ({
            insertId: `${table}:${index}`,
            json: row,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`BigQuery insert failed for ${table}: HTTP ${response.status}`);
      }

      const payload = (await response.json().catch(() => ({}))) as { insertErrors?: unknown[] };
      if (Array.isArray(payload.insertErrors) && payload.insertErrors.length > 0) {
        throw new Error(`BigQuery insert failed for ${table}: insertErrors returned`);
      }
    },
  };
}

export async function uploadPrivateCalibrationExport(
  output: PrivateCalibrationExport,
  uploader: BigQueryCalibrationUploader,
  env: Pick<BigQueryUploadEnv, "projectId" | "dataset"> = {
    projectId: "mocked",
    dataset: "mocked",
  },
): Promise<BigQueryCalibrationUploadSummary> {
  const tables: BigQueryCalibrationUploadTableSummary[] = [];
  let rowsUploaded = 0;

  for (const [table, rowsForTable] of PRIVATE_CALIBRATION_TABLES) {
    const rows = rowsForTable(output);
    if (rows.length === 0) {
      tables.push({ table, rows: 0, skipped: true });
      continue;
    }
    await uploader.insertRows(table, rows);
    rowsUploaded += rows.length;
    tables.push({ table, rows: rows.length, skipped: false });
  }

  return {
    mode: "upload",
    projectId: env.projectId,
    dataset: env.dataset,
    rowsUploaded,
    tables,
  };
}

export async function uploadPrivateCalibrationInput(
  input: PrivateCalibrationInput,
  uploader: BigQueryCalibrationUploader,
  env?: Pick<BigQueryUploadEnv, "projectId" | "dataset">,
): Promise<BigQueryCalibrationUploadSummary> {
  return uploadPrivateCalibrationExport(buildPrivateCalibrationExport(input), uploader, env);
}
