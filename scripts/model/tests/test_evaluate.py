#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1]
ROOT = MODEL_DIR.parents[1]
FIXTURE_DIR = MODEL_DIR / "fixtures"
PARITY_FIXTURE_DIR = ROOT / "docs/handoffs/fixtures/m1"
sys.path.insert(0, str(MODEL_DIR))

import calibrate
import data_source
import evaluate
import export_training_data


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        self.training = export_training_data.export_dataset(
            data_source.FixtureDataSource(FIXTURE_DIR)
        )
        self.active = json.loads(
            (ROOT / "docs/handoffs/fixtures/m4/model-config.json").read_text()
        )
        self.candidate = json.loads(
            (FIXTURE_DIR / "expected-candidate-config.json").read_text()
        )
        self.archetypes = calibrate.load_augment_archetypes(
            ROOT / "data/internal/augments.json"
        )

    def report(self) -> dict:
        return evaluate.build_report(
            training=self.training,
            active=self.active,
            candidate=self.candidate,
            parity_fixture_dir=PARITY_FIXTURE_DIR,
            augment_archetypes=self.archetypes,
        )

    def test_report_contains_required_sample_counts(self):
        counts = self.report()["sampleCounts"]

        self.assertEqual(counts["patch"], {"26.12": 2, "26.13": 1})
        self.assertEqual(counts["champion"], {"brand": 3, "garen": 3})
        self.assertEqual(
            counts["augment"],
            {
                "from-downtown": 1,
                "magic-missile": 2,
                "marksmage": 2,
                "mercys-strike": 3,
                "overflow": 2,
                "transmute-prismatic": 2,
            },
        )
        self.assertEqual(counts["round"], {"1": 2, "2": 2, "3": 2, "4": 2})

    def test_report_has_deltas_stability_traps_parity_and_manual_gate(self):
        report = self.report()

        self.assertIn("priorClamp.0", {delta["path"] for delta in report["calibrationDeltas"]})
        self.assertEqual(
            set(report["rankingStability"]),
            {"competitive", "exploration"},
        )
        self.assertEqual(report["trapWarningRegressions"]["regressions"], [])
        self.assertTrue(report["parityFixtureResults"]["passed"])
        self.assertEqual(report["releaseGate"]["status"], "manual-approval-required")
        self.assertIn("approve_release.py", report["releaseGate"]["command"])
        self.assertIn("--approve", report["releaseGate"]["command"])

    def test_report_bytes_are_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            evaluate.write_report(first, self.report())
            evaluate.write_report(second, self.report())

            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
