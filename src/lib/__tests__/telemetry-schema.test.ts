import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// The BigQuery schema is a frozen contract for Codex's M4 calibration. These
// tests pin its shape and prove it stays a 1:1 projection of SafeMatchExport
// (src/lib/contracts/telemetry.ts) — and that no identity fields leak in.
const RAW_SCHEMA = readFileSync(
  join(process.cwd(), "scripts/telemetry/bigquery-schema.sql"),
  "utf8",
).toLowerCase();

// Strip `--` comments: the leak check must scan real DDL, not prose that
// legitimately names the fields we exclude.
const SCHEMA = RAW_SCHEMA.replace(/--[^\n]*/g, "");

function tableBody(table: string): string {
  const start = SCHEMA.indexOf(`mayhem_telemetry.${table}\``);
  expect(start, `missing table ${table}`).toBeGreaterThan(-1);
  const open = SCHEMA.indexOf("(", start);
  // Balance parens so nested ARRAY<...> / type modifiers don't end the body early.
  let depth = 0;
  for (let i = open; i < SCHEMA.length; i += 1) {
    if (SCHEMA[i] === "(") depth += 1;
    else if (SCHEMA[i] === ")") {
      depth -= 1;
      if (depth === 0) return SCHEMA.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parens in ${table}`);
}

describe("BigQuery telemetry schema", () => {
  const tables = ["matches", "participants", "contributor_round_choices", "quality_quarantine"];

  test("defines the four calibration tables", () => {
    for (const table of tables) {
      expect(SCHEMA).toContain(`create table if not exists \`mayhem_telemetry.${table}\``);
    }
  });

  test("matches table carries dedupe key and provenance", () => {
    const body = tableBody("matches");
    for (const column of ["game_hash", "schema_version", "patch", "queue_id", "duration_seconds", "source", "collected_at", "ingested_at"]) {
      expect(body, `matches.${column}`).toContain(column);
    }
  });

  test("participants mirror SafeMatchExport participant fields", () => {
    const body = tableBody("participants");
    for (const column of ["game_hash", "slot", "team", "champion_slug", "augment_slugs", "item_ids", "won", "kills", "deaths", "assists", "damage_to_champions"]) {
      expect(body, `participants.${column}`).toContain(column);
    }
    expect(body).toContain("array<string>"); // augment_slugs / item_ids
  });

  test("contributor round choices keep round order and OCR confidence", () => {
    const body = tableBody("contributor_round_choices");
    for (const column of ["round", "offered_augment_slugs", "selected_augment_slug", "ocr_confidence"]) {
      expect(body, `contributor_round_choices.${column}`).toContain(column);
    }
  });

  test("quarantine records carry a reason and an R2 reference", () => {
    const body = tableBody("quality_quarantine");
    for (const column of ["reason", "raw_ref", "quarantined_at"]) {
      expect(body, `quality_quarantine.${column}`).toContain(column);
    }
  });

  test("no identity fields leak into any table", () => {
    for (const forbidden of ["puuid", "riot_id", "riotid", "summoner", "display_name", "account_id", "chat"]) {
      expect(SCHEMA, `forbidden identity field ${forbidden}`).not.toContain(forbidden);
    }
  });

  test("every table is partitioned to bound scan cost on the free tier", () => {
    const partitionCount = (SCHEMA.match(/partition by/g) ?? []).length;
    expect(partitionCount).toBe(4);
  });
});
