#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODEL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODEL_DIR))

import approve_release
import package_model

from test_sign_model import generate_key_pair


class ApproveReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_dir.name)
        self.private_key, self.public_key = generate_key_pair(self.directory)
        self.public_key_path = self.directory / "public-key.txt"
        self.public_key_path.write_text(self.public_key, encoding="utf-8")
        self.config = {"modelVersion": "decision-v2", "priorClamp": [42, 62]}
        with patch.dict(os.environ, {"MAYHEM_MODEL_SIGNING_KEY": self.private_key}):
            self.package_path = package_model.build_model_package(
                config=self.config,
                engine_version="engine-v1",
                data_version="26.12",
                created_at="2026-06-13T00:00:00Z",
                output_dir=self.directory,
            )

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_releases(self, releases: list[dict]) -> Path:
        path = self.directory / "releases.json"
        path.write_text(json.dumps(releases), encoding="utf-8")
        return path

    def command(self, releases: Path, *extra: str) -> list[str]:
        return [
            sys.executable,
            str(MODEL_DIR / "approve_release.py"),
            "--package",
            str(self.package_path),
            "--public-key",
            str(self.public_key_path),
            "--package-url",
            "https://models.example/model-decision-v2.tar.gz",
            "--approved-by",
            "release@example.com",
            "--releases",
            str(releases),
            "--output-dir",
            str(self.directory / "approval"),
            *extra,
        ]

    def test_refuses_without_manual_approve_flag(self):
        releases = self.write_releases(
            [{"model_version": "decision-v1", "status": "active"}]
        )

        result = subprocess.run(self.command(releases), capture_output=True, text=True)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--approve", result.stderr)
        self.assertFalse((self.directory / "approval").exists())

    def test_approval_activates_candidate_and_rolls_back_previous_active(self):
        releases = self.write_releases(
            [
                {"model_version": "decision-v1", "status": "active"},
                {"model_version": "decision-v2", "status": "candidate"},
            ]
        )

        result = subprocess.run(
            self.command(releases, "--approve"),
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)

        self.assertEqual(payload["release"]["status"], "active")
        self.assertEqual(payload["transitions"], [
            {"model_version": "decision-v1", "from": "active", "to": "rolled-back"},
            {"model_version": "decision-v2", "from": "candidate", "to": "active"},
        ])
        sql = (self.directory / "approval" / "model-decision-v2.sql").read_text()
        self.assertIn("BEGIN;", sql)
        self.assertIn("COMMIT;", sql)
        self.assertEqual(sql.count("SET status = 'active'"), 1)
        active_count_guard = sql.index(
            "IF (SELECT count(*) FROM model_releases WHERE status = 'active') <> 1"
        )
        self.assertLess(active_count_guard, sql.index("UPDATE model_releases"))

    def test_rollback_restores_prior_active_release(self):
        rollback_config = {"modelVersion": "decision-v1", "priorClamp": [42, 62]}
        with patch.dict(os.environ, {"MAYHEM_MODEL_SIGNING_KEY": self.private_key}):
            rollback_package = package_model.build_model_package(
                config=rollback_config,
                engine_version="engine-v1",
                data_version="26.12",
                created_at="2026-06-12T00:00:00Z",
                output_dir=self.directory,
            )
        releases = self.write_releases(
            [
                {"model_version": "decision-v1", "status": "rolled-back"},
                {"model_version": "decision-v2", "status": "active"},
            ]
        )

        result = subprocess.run(
            [
                sys.executable,
                str(MODEL_DIR / "approve_release.py"),
                "--package",
                str(rollback_package),
                "--public-key",
                str(self.public_key_path),
                "--package-url",
                "https://models.example/model-decision-v1.tar.gz",
                "--approved-by",
                "release@example.com",
                "--releases",
                str(releases),
                "--output-dir",
                str(self.directory / "rollback"),
                "--approve",
                "--rollback",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)

        self.assertEqual(payload["release"]["model_version"], "decision-v1")
        self.assertEqual(payload["transitions"], [
            {"model_version": "decision-v2", "from": "active", "to": "candidate"},
            {"model_version": "decision-v1", "from": "rolled-back", "to": "active"},
        ])


if __name__ == "__main__":
    unittest.main()
