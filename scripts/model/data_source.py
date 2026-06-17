#!/usr/bin/env python3
"""Thin telemetry table sources for offline model calibration."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Protocol

APPROVED_FIELDS = {
    "matches": (
        "game_hash",
        "schema_version",
        "patch",
        "queue_id",
        "duration_seconds",
        "source",
        "collected_at",
        "ingested_at",
    ),
    "participants": (
        "game_hash",
        "slot",
        "team",
        "champion_slug",
        "augment_slugs",
        "item_ids",
        "won",
        "kills",
        "deaths",
        "assists",
        "damage_to_champions",
        "patch",
        "ingested_at",
    ),
    "contributor_round_choices": (
        "game_hash",
        "round",
        "offered_augment_slugs",
        "selected_augment_slug",
        "ocr_confidence",
        "patch",
        "ingested_at",
    ),
    "quality_quarantine": (
        "game_hash",
        "reason",
        "detail",
        "raw_ref",
        "quarantined_at",
    ),
}
ARRAY_FIELDS = {"augment_slugs", "item_ids", "offered_augment_slugs"}


class DataSource(Protocol):
    def rows(self, table: str) -> Iterable[dict]:
        """Return rows from one frozen BigQuery table."""


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def approved_row(table: str, row: dict) -> dict:
    if table not in APPROVED_FIELDS:
        raise ValueError(f"unknown telemetry table: {table}")
    projected = {field: row.get(field) for field in APPROVED_FIELDS[table]}
    for field in ARRAY_FIELDS.intersection(projected):
        values = projected[field]
        projected[field] = sorted(values) if isinstance(values, list) else []
    return projected


class FixtureDataSource:
    def __init__(self, directory: Path):
        self.directory = directory

    def rows(self, table: str) -> Iterable[dict]:
        if table not in APPROVED_FIELDS:
            raise ValueError(f"unknown telemetry table: {table}")
        path = self.directory / f"{table}.ndjson"
        with path.open(encoding="utf-8") as rows:
            for line_number, line in enumerate(rows, start=1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"{path}:{line_number} must contain a JSON object")
                yield value


class BigQueryDataSource:
    def __init__(self, *, project: str, dataset: str = "mayhem_telemetry"):
        try:
            from google.cloud import bigquery
        except ImportError as exc:
            raise RuntimeError(
                "google-cloud-bigquery is required for the BigQuery data source"
            ) from exc
        self.project = project
        self.dataset = dataset
        self.client = bigquery.Client(project=project)

    def rows(self, table: str) -> Iterable[dict]:
        fields = APPROVED_FIELDS.get(table)
        if fields is None:
            raise ValueError(f"unknown telemetry table: {table}")
        query = (
            f"SELECT {', '.join(fields)} "
            f"FROM `{self.project}.{self.dataset}.{table}`"
        )
        for row in self.client.query(query).result():
            yield dict(row.items())
