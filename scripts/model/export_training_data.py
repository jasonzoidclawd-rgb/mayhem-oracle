#!/usr/bin/env python3
"""Export allowlisted, quality-filtered telemetry for offline calibration."""

from __future__ import annotations

import argparse
from pathlib import Path

import data_source

MODEL_DIR = Path(__file__).resolve().parent
DEFAULT_FIXTURE_DIR = MODEL_DIR / "fixtures"
DEFAULT_OUTPUT = MODEL_DIR / "dist" / "training-data.json"
TRAINING_TABLES = ("matches", "participants", "contributor_round_choices")
SORT_FIELDS = {
    "matches": ("game_hash",),
    "participants": ("game_hash", "slot"),
    "contributor_round_choices": ("game_hash", "round"),
    "quality_quarantine": ("game_hash", "reason"),
}


def sorted_approved_rows(source: data_source.DataSource, table: str) -> list[dict]:
    rows = [data_source.approved_row(table, row) for row in source.rows(table)]
    return sorted(rows, key=lambda row: tuple(row[field] or "" for field in SORT_FIELDS[table]))


def export_dataset(source: data_source.DataSource) -> dict:
    quarantined = {
        row["game_hash"]
        for row in sorted_approved_rows(source, "quality_quarantine")
        if row["game_hash"]
    }
    matches = [
        row
        for row in sorted_approved_rows(source, "matches")
        if row["game_hash"] not in quarantined and row["duration_seconds"] >= 480
    ]
    valid_hashes = {row["game_hash"] for row in matches}
    dataset = {"matches": matches}
    for table in TRAINING_TABLES[1:]:
        dataset[table] = [
            row
            for row in sorted_approved_rows(source, table)
            if row["game_hash"] in valid_hashes
        ]
    return dataset


def write_dataset(path: Path, dataset: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data_source.canonical_json_bytes(dataset) + b"\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("fixture", "bigquery"), default="fixture")
    parser.add_argument("--fixture-dir", type=Path, default=DEFAULT_FIXTURE_DIR)
    parser.add_argument("--project")
    parser.add_argument("--dataset", default="mayhem_telemetry")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.source == "bigquery" and not args.project:
        parser.error("--project is required for the BigQuery source")
    return args


def main() -> None:
    args = parse_args()
    source: data_source.DataSource
    if args.source == "bigquery":
        source = data_source.BigQueryDataSource(
            project=args.project,
            dataset=args.dataset,
        )
    else:
        source = data_source.FixtureDataSource(args.fixture_dir)
    write_dataset(args.output, export_dataset(source))
    print(args.output)


if __name__ == "__main__":
    main()
