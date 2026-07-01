/**
 * Private calibration BigQuery schema validation/provisioning.
 *
 * Default mode is usage-only and does not construct a BigQuery client. Any
 * BigQuery-backed mode requires an explicit flag and the shared env gate.
 */
import {
  createBigQuerySchemaRestClient,
  provisionMissingPrivateCalibrationTables,
  validatePrivateCalibrationSchema,
  type BigQueryCalibrationSchemaClient,
  type BigQuerySchemaProvisioningReport,
  type BigQuerySchemaValidationReport,
} from "../../src/lib/bigquery/calibration-schema";

interface Args {
  mode?: "validate" | "create-missing";
}

interface BigQuerySchemaClientWithTarget extends BigQueryCalibrationSchemaClient {
  projectId: string;
  dataset: string;
}

interface ValidateSummary {
  mode: "validate";
  projectId: string;
  dataset: string;
  validation: BigQuerySchemaValidationReport;
}

interface CreateMissingSummary {
  mode: "create-missing";
  projectId: string;
  dataset: string;
  provisioning: BigQuerySchemaProvisioningReport;
}

type SchemaCliSummary = ValidateSummary | CreateMissingSummary;

export interface BigQueryCalibrationSchemaCliDeps {
  createClient?: () => BigQuerySchemaClientWithTarget;
  log?: (message: string) => void;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run bigquery:calibration:schema -- --validate",
    "  npm run bigquery:calibration:schema -- --create-missing",
    "",
    "Required for BigQuery-backed modes:",
    "  BIGQUERY_PROJECT_ID",
    "  BIGQUERY_DATASET",
    "  GOOGLE_APPLICATION_CREDENTIALS",
  ].join("\n");
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const arg of argv) {
    if (arg === "--validate") {
      if (args.mode) throw new Error(`choose only one schema mode\n\n${usage()}`);
      args.mode = "validate";
    } else if (arg === "--create-missing") {
      if (args.mode) throw new Error(`choose only one schema mode\n\n${usage()}`);
      args.mode = "create-missing";
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  return args;
}

function createDefaultClient(): BigQuerySchemaClientWithTarget {
  return createBigQuerySchemaRestClient();
}

export async function runBigQueryCalibrationSchemaCli(
  argv: string[] = process.argv.slice(2),
  deps: BigQueryCalibrationSchemaCliDeps = {},
): Promise<SchemaCliSummary> {
  const args = parseArgs(argv);
  if (!args.mode) {
    throw new Error(usage());
  }

  const client = deps.createClient?.() ?? createDefaultClient();
  if (args.mode === "validate") {
    const validation = await validatePrivateCalibrationSchema(client);
    const summary: ValidateSummary = {
      mode: "validate",
      projectId: client.projectId,
      dataset: client.dataset,
      validation,
    };
    (deps.log ?? console.log)(JSON.stringify(summary, null, 2));
    return summary;
  }

  const provisioning = await provisionMissingPrivateCalibrationTables(client);
  const summary: CreateMissingSummary = {
    mode: "create-missing",
    projectId: client.projectId,
    dataset: client.dataset,
    provisioning,
  };
  (deps.log ?? console.log)(JSON.stringify(summary, null, 2));
  return summary;
}

function main(): Promise<SchemaCliSummary> {
  return runBigQueryCalibrationSchemaCli();
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
