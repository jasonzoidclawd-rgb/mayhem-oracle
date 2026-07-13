#!/usr/bin/env python3

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from verify_public_bundle_boundary import verify_bundle_boundary


class PublicBundleBoundaryTests(unittest.TestCase):
    def _build(self, root: Path) -> None:
        (root / ".next/static/chunk").mkdir(parents=True)
        (root / ".next/server/app/[locale]/patch-notes").mkdir(parents=True)

    def test_clean_production_artifacts_pass(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._build(root)
            (root / ".next/static/chunk/app.js").write_bytes(b"public projection only")
            self.assertEqual(verify_bundle_boundary(root)["leaks"], 0)

    def test_internal_lineage_marker_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._build(root)
            (root / ".next/static/chunk/app.js").write_bytes(b"comparison")
            with self.assertRaisesRegex(ValueError, "boundary violation"):
                verify_bundle_boundary(root)


if __name__ == "__main__":
    unittest.main()
