/**
 * Nightly telemetry loader (GitHub Actions, Task 3B.2).
 *
 * For each stored R2 batch: read it, project to the frozen BigQuery row shapes
 * with quarantine rules (transformBatch), stream-insert into BigQuery, finalize
 * any reserved trial credits for >8-minute contributor matches, and mark the
 * batch processed. Also expires reservations older than 24 hours.
 *
 * CI-only: kept under scripts/ so its google-auth-library / R2 deps never reach
 * the web bundle. Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * R2_* , GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS (or _JSON).
 * CURRENT_PATCH is an optional override; otherwise public/data/meta.json is
 * the source of truth.
 */
import { readFile } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";
import { GoogleAuth } from "google-auth-library";
import type { SafeMatchExport } from "../../src/lib/contracts/telemetry";
import { transformBatch, type TransformResult } from "../../src/lib/telemetry/transform";

const DATASET = "mayhem_telemetry";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function validatePatch(value: unknown, source: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+$/.test(value.trim())) {
    throw new Error(`malformed telemetry patch in ${source}: expected version like 26.13`);
  }
  return value.trim();
}

export function patchFromMetaJson(raw: string, source = "public/data/meta.json"): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`malformed telemetry patch metadata in ${source}: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`malformed telemetry patch metadata in ${source}: expected object`);
  }
  return validatePatch((parsed as { patch?: unknown }).patch, `${source}.patch`);
}

export async function resolveCurrentPatch(
  metaPath = path.join(process.cwd(), "public", "data", "meta.json"),
): Promise<string> {
  if (process.env.CURRENT_PATCH !== undefined) {
    return validatePatch(process.env.CURRENT_PATCH, "CURRENT_PATCH");
  }
  return patchFromMetaJson(await readFile(metaPath, "utf-8"), metaPath);
}

function r2Client(): { client: AwsClient; endpoint: string } {
  const client = new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
  return { client, endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}` };
}

async function insertRows(
  auth: GoogleAuth,
  projectId: string,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const token = await auth.getAccessToken();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${DATASET}/tables/${table}/insertAll`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      // game_hash makes inserts idempotent against BigQuery's dedup window.
      rows: rows.map((row) => ({ insertId: String(row.game_hash ?? ""), json: row })),
    }),
  });
  if (!response.ok) throw new Error(`BigQuery insert ${table} failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { insertErrors?: unknown[] };
  if (body.insertErrors?.length) throw new Error(`BigQuery insertErrors: ${JSON.stringify(body.insertErrors)}`);
}

async function main(): Promise<void> {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/bigquery.insertdata"] });
  const projectId = env("GCP_PROJECT_ID");
  const currentPatch = await resolveCurrentPatch();
  console.log(`using telemetry patch ${currentPatch}`);
  const { client, endpoint } = r2Client();

  // Expire stale trial reservations (>24h) so abandoned games release credits.
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  await supabase
    .from("referral_progress")
    .update({ reserved_game_hash: null, reserved_at: null })
    .lt("reserved_at", dayAgo)
    .not("reserved_game_hash", "is", null);

  const { data: batches } = await supabase
    .from("telemetry_batches")
    .select("id,r2_key,user_id")
    .eq("status", "stored")
    .limit(200);

  let loadedMatches = 0;
  for (const batch of batches ?? []) {
    const object = await client.fetch(`${endpoint}/${batch.r2_key}`);
    if (!object.ok) {
      console.error(`skip ${batch.r2_key}: R2 ${object.status}`);
      continue;
    }
    const matches = (await object.json()) as SafeMatchExport[];
    const out: TransformResult = transformBatch(matches, {
      currentPatch,
      rawRef: batch.r2_key as string,
    });

    await insertRows(auth, projectId, "matches", out.matches as unknown as Array<Record<string, unknown>>);
    await insertRows(auth, projectId, "participants", out.participants as unknown as Array<Record<string, unknown>>);
    await insertRows(auth, projectId, "contributor_round_choices", out.rounds as unknown as Array<Record<string, unknown>>);
    await insertRows(auth, projectId, "quality_quarantine", out.quarantine as unknown as Array<Record<string, unknown>>);

    // Finalize reserved trial credits for this contributor's qualifying games.
    for (const loaded of out.matches) {
      if (loaded.source === "owned-history") {
        await supabase.rpc("finalize_trial_credit", {
          p_game_hash: loaded.game_hash,
          p_duration_seconds: loaded.duration_seconds,
        });
      }
    }

    await supabase
      .from("telemetry_batches")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", batch.id);
    loadedMatches += out.matches.length;
  }

  console.log(`loaded ${loadedMatches} matches from ${batches?.length ?? 0} batches`);
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
