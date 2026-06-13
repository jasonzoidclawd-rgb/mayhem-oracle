#!/usr/bin/env python3

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1]
ROOT = MODEL_DIR.parents[1]
FIXTURE_DIR = MODEL_DIR / "fixtures"
sys.path.insert(0, str(MODEL_DIR))

import calibrate
import data_source
import export_training_data


class CalibrateTests(unittest.TestCase):
    def setUp(self):
        self.training = export_training_data.export_dataset(
            data_source.FixtureDataSource(FIXTURE_DIR)
        )
        self.active = json.loads(
            (ROOT / "docs/handoffs/fixtures/m4/model-config.json").read_text()
        )
        self.archetypes = calibrate.load_augment_archetypes(
            ROOT / "data/internal/augments.json"
        )

    def candidate(self, training: dict | None = None) -> dict:
        return calibrate.calibrate_config(
            training=training or self.training,
            active=self.active,
            model_version="decision-v2-fixture",
            augment_archetypes=self.archetypes,
        )

    def test_fixture_yields_expected_candidate_config(self):
        expected = json.loads(
            (FIXTURE_DIR / "expected-candidate-config.json").read_text()
        )

        self.assertEqual(self.candidate(), expected)

    def test_calibration_emits_identical_bytes_for_identical_input(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            calibrate.write_config(first, self.candidate())
            calibrate.write_config(second, self.candidate())

            self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_round_effects_ignore_participant_final_state(self):
        changed = copy.deepcopy(self.training)
        for participant in changed["participants"]:
            participant["augment_slugs"] = ["overflow"]
            participant["item_ids"] = ["9999"]
            participant["won"] = not participant["won"]

        self.assertEqual(
            self.candidate(changed)["roundValue"],
            self.candidate()["roundValue"],
        )

    def test_contributor_choices_change_only_round_effects(self):
        changed = copy.deepcopy(self.training)
        for choice in changed["contributor_round_choices"]:
            choice["selected_augment_slug"] = "from-downtown"

        baseline = self.candidate()
        candidate = self.candidate(changed)
        self.assertNotEqual(candidate["roundValue"], baseline["roundValue"])
        self.assertEqual(
            {key: value for key, value in candidate.items() if key != "roundValue"},
            {key: value for key, value in baseline.items() if key != "roundValue"},
        )


if __name__ == "__main__":
    unittest.main()
