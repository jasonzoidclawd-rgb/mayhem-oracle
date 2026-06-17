#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1]
FIXTURE_DIR = MODEL_DIR / "fixtures"
sys.path.insert(0, str(MODEL_DIR))

import data_source
import export_training_data


class ExportTrainingDataTests(unittest.TestCase):
    def setUp(self):
        self.source = data_source.FixtureDataSource(FIXTURE_DIR)

    def test_excludes_quarantined_and_sub_eight_minute_matches(self):
        dataset = export_training_data.export_dataset(self.source)

        self.assertEqual(
            [row["game_hash"] for row in dataset["matches"]],
            ["good-owned", "good-second", "good-snowball"],
        )
        for table in ("participants", "contributor_round_choices"):
            hashes = {row["game_hash"] for row in dataset[table]}
            self.assertNotIn("short-match", hashes)
            self.assertNotIn("quarantined-match", hashes)
        self.assertNotIn("quality_quarantine", dataset)

    def test_exports_only_approved_frozen_schema_fields(self):
        dataset = export_training_data.export_dataset(self.source)

        self.assertEqual(
            set(dataset["participants"][0]),
            set(data_source.APPROVED_FIELDS["participants"]),
        )
        self.assertNotIn("puuid", json.dumps(dataset))
        self.assertNotIn("unapproved", json.dumps(dataset))

    def test_output_is_canonical_and_deterministic(self):
        dataset = export_training_data.export_dataset(self.source)

        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            export_training_data.write_dataset(first, dataset)
            export_training_data.write_dataset(second, dataset)

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(first.read_bytes(), data_source.canonical_json_bytes(dataset) + b"\n")


if __name__ == "__main__":
    unittest.main()
