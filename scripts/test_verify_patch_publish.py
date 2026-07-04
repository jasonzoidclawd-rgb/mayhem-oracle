#!/usr/bin/env python3

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from verify_patch_publish import (
    PatchPublishError,
    verify_patch_publish,
)


def patch_note(
    *,
    patch: str = "26.13",
    kind: str = "added",
    text_zh_tw: str | None = "新增一個增幅。",
) -> dict:
    text = {"en": "Added an augment."}
    if text_zh_tw is not None:
        text["zh-tw"] = text_zh_tw

    return {
        "version": patch,
        "title": f"Patch {patch} Notes",
        "released": "2026-06-25",
        "publishedAt": "2026-06-25T12:00:00Z",
        "sections": [
            {
                "id": "augments",
                "title": "Augments",
                "changes": [
                    {
                        "subject": {"en": "Fixture", "zh-tw": "測試"},
                        "text": text,
                        "kind": kind,
                    }
                ],
            }
        ],
    }


def public_patch_notes(*, patch: str = "26.13", notes: list[dict] | None = None) -> dict:
    return {
        "patch": patch,
        "source": "fixture",
        "scraped_at": "2026-06-23T18:00:00.000Z",
        "patches": notes
        if notes is not None
        else [
            patch_note(patch="26.13", kind="added"),
            patch_note(patch="26.12", kind="buffed"),
            patch_note(patch="26.11", kind="changed"),
        ],
    }


class VerifyPatchPublishTests(unittest.TestCase):
    def write_public_data(
        self,
        root: Path,
        *,
        patch_notes: dict | None = None,
        meta_patch: str | None = "26.13",
    ) -> None:
        public_dir = root / "public" / "data"
        public_dir.mkdir(parents=True)
        if patch_notes is not None:
            (public_dir / "patch-notes.json").write_text(
                json.dumps(patch_notes),
                encoding="utf-8",
            )
        if meta_patch is not None:
            (public_dir / "meta.json").write_text(
                json.dumps({"patch": meta_patch}),
                encoding="utf-8",
            )

    def test_passing_data_returns_concise_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes())

            summary = verify_patch_publish(
                root=root,
                changed_paths=[
                    "data/internal/patch-notes.json",
                    "public/data/patch-notes.json",
                ],
            )

        self.assertEqual(summary["patch"], "26.13")
        self.assertEqual(summary["scraped_at"], "2026-06-23T18:00:00.000Z")
        self.assertEqual(summary["patches"], 3)
        self.assertEqual(summary["totalChanges"], 3)
        self.assertEqual(summary["zhTwText"], 3)
        self.assertEqual(summary["zhTwCoverage"], 1.0)
        self.assertEqual(summary["kinds"], ["added", "buffed", "changed"])

    def test_low_zh_tw_coverage_fails(self):
        notes = [
            patch_note(patch="26.13", text_zh_tw=None),
            patch_note(patch="26.12", text_zh_tw=None),
            patch_note(patch="26.11", text_zh_tw="修正。"),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes(notes=notes))

            with self.assertRaisesRegex(PatchPublishError, "zh-TW text coverage"):
                verify_patch_publish(root=root, changed_paths=[])

    def test_patch_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(
                root,
                patch_notes=public_patch_notes(patch="26.12"),
                meta_patch="26.13",
            )

            with self.assertRaisesRegex(PatchPublishError, "patch mismatch"):
                verify_patch_publish(root=root, changed_paths=[])

    def test_missing_public_patch_notes_file_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=None)

            with self.assertRaisesRegex(PatchPublishError, "missing public patch-notes"):
                verify_patch_publish(root=root, changed_paths=[])

    def test_invalid_kind_fails(self):
        notes = [
            patch_note(patch="26.13", kind="added"),
            patch_note(patch="26.12", kind="experimental"),
            patch_note(patch="26.11", kind="changed"),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes(notes=notes))

            with self.assertRaisesRegex(PatchPublishError, "unsupported kind"):
                verify_patch_publish(root=root, changed_paths=[])

    def test_internal_patch_notes_change_requires_public_patch_notes_change(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes())

            with self.assertRaisesRegex(PatchPublishError, "public patch-notes"):
                verify_patch_publish(
                    root=root,
                    changed_paths=["data/internal/patch-notes.json"],
                )


if __name__ == "__main__":
    unittest.main()
