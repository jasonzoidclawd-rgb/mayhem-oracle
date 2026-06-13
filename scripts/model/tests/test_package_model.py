#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODEL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODEL_DIR))

import package_model
import sign_model

from test_sign_model import generate_key_pair


class PackageModelTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_dir.name)
        self.private_key, self.public_key = generate_key_pair(self.directory)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_loads_current_versioned_engine_config(self):
        config = package_model.load_current_model_config()

        self.assertEqual(config["modelVersion"], "decision-v1")
        self.assertEqual(config["priorClamp"], [42, 62])
        self.assertEqual(config["roundValue"]["scaling"]["4"], -6)

    def test_loads_explicit_candidate_config_for_signing(self):
        path = MODEL_DIR / "fixtures" / "expected-candidate-config.json"

        config = package_model.load_model_config(path)

        self.assertEqual(config["modelVersion"], "decision-v2-fixture")
        self.assertEqual(config["priorClamp"], [40, 64])

    def test_package_contains_only_signed_manifest_and_canonical_config(self):
        config = {"modelVersion": "decision-v1", "priorClamp": [42, 62]}
        with patch.dict(os.environ, {"MAYHEM_MODEL_SIGNING_KEY": self.private_key}):
            package_path = package_model.build_model_package(
                config=config,
                engine_version="engine-v1",
                data_version="26.12",
                created_at="2026-06-13T00:00:00Z",
                output_dir=self.directory,
            )

        self.assertEqual(package_path.name, "model-decision-v1.tar.gz")
        with tarfile.open(package_path, "r:gz") as archive:
            self.assertEqual(
                sorted(archive.getnames()),
                ["manifest.json", "model-config.json"],
            )
            manifest = json.load(archive.extractfile("manifest.json"))
            packaged_config = json.load(archive.extractfile("model-config.json"))

        self.assertEqual(
            list(manifest),
            [
                "modelVersion",
                "engineVersion",
                "dataVersion",
                "createdAt",
                "configSha256",
                "signature",
            ],
        )
        self.assertEqual(packaged_config, config)
        self.assertTrue(sign_model.verify_manifest(manifest, packaged_config, self.public_key))


if __name__ == "__main__":
    unittest.main()
