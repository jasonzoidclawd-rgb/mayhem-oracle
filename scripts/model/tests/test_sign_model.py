#!/usr/bin/env python3

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODEL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODEL_DIR))

import sign_model


def generate_key_pair(directory: Path) -> tuple[str, str]:
    private_key = directory / "private.pem"
    public_key = directory / "public.pem"
    openssl = sign_model.resolve_openssl()
    subprocess.run(
        [openssl, "genpkey", "-algorithm", "Ed25519", "-out", private_key],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [openssl, "pkey", "-in", private_key, "-pubout", "-out", public_key],
        check=True,
        capture_output=True,
        text=True,
    )
    return (
        private_key.read_text(encoding="utf-8"),
        public_key.read_text(encoding="utf-8"),
    )


class SignModelTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_dir.name)
        self.private_key, self.public_key = generate_key_pair(self.directory)
        self.config = {"modelVersion": "decision-v1", "weights": {"reliability": 1.2}}
        self.manifest = {
            "modelVersion": "decision-v1",
            "engineVersion": "engine-v1",
            "dataVersion": "26.12",
            "createdAt": "2026-06-13T00:00:00Z",
            "configSha256": "",
            "signature": "",
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_sign_then_verify_round_trip(self):
        with patch.dict(os.environ, {"MAYHEM_MODEL_SIGNING_KEY": self.private_key}):
            signed = sign_model.sign_manifest(self.manifest, self.config)

        self.assertTrue(sign_model.verify_manifest(signed, self.config, self.public_key))
        self.assertEqual(
            set(signed),
            {
                "modelVersion",
                "engineVersion",
                "dataVersion",
                "createdAt",
                "configSha256",
                "signature",
            },
        )

    def test_tampered_config_fails_verification(self):
        with patch.dict(os.environ, {"MAYHEM_MODEL_SIGNING_KEY": self.private_key}):
            signed = sign_model.sign_manifest(self.manifest, self.config)

        tampered = {"modelVersion": "decision-v1", "weights": {"reliability": 9.9}}
        self.assertFalse(sign_model.verify_manifest(signed, tampered, self.public_key))

    def test_cli_prints_public_key_without_private_key_material(self):
        with patch.dict(os.environ, {"MAYHEM_MODEL_SIGNING_KEY": self.private_key}):
            result = subprocess.run(
                [sys.executable, MODEL_DIR / "sign_model.py", "public-key"],
                check=True,
                capture_output=True,
                text=True,
                env=os.environ,
            )

        self.assertIn("BEGIN PUBLIC KEY", result.stdout)
        self.assertNotIn("PRIVATE", result.stdout)

    def test_canonical_json_is_stable(self):
        left = sign_model.canonical_json_bytes({"b": 2, "a": {"z": 1, "y": 0}})
        right = sign_model.canonical_json_bytes({"a": {"y": 0, "z": 1}, "b": 2})

        self.assertEqual(left, right)
        self.assertEqual(json.loads(left), {"a": {"y": 0, "z": 1}, "b": 2})

    def test_resolves_homebrew_openssl_3_before_path_libressl(self):
        homebrew = "/opt/homebrew/bin/openssl"
        path_openssl = shutil.which("openssl")
        self.assertIsNotNone(path_openssl)

        with patch("sign_model.shutil.which", return_value=path_openssl):
            resolved = sign_model.resolve_openssl()

        self.assertEqual(resolved, homebrew)
        self.assertIn(
            "OpenSSL 3.",
            subprocess.run(
                [resolved, "version"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout,
        )


if __name__ == "__main__":
    unittest.main()
