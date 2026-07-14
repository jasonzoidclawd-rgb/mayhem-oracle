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
        "source": "CommunityDragon snapshot diffs",
        "sourceKind": "cdragon-structured-diff-v1",
        "status": "fresh",
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
        (public_dir / "entity-presentation.json").write_text(
            json.dumps({
                "schema_version": 1,
                "source": "fixture",
                "status": "fresh",
                "patch": "26.13",
                "pbe_patch": "26.14",
                "observed_at": "2026-06-23T18:00:00Z",
                "entities": [{"type": "augment", "canonical_id": "A", "slug": "fixture"}],
            }),
            encoding="utf-8",
        )

    def test_passing_data_returns_concise_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes())

            summary = verify_patch_publish(
                root=root,
                changed_paths=[
                    "data/internal/patch-events.json",
                    "public/data/patch-notes.json",
                    "public/data/entity-presentation.json",
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
                    changed_paths=["data/internal/patch-events.json"],
                )

    def test_internal_pbe_preview_change_requires_public_preview_change(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes())

            with self.assertRaisesRegex(PatchPublishError, "public PBE preview"):
                verify_patch_publish(
                    root=root,
                    changed_paths=[
                        "data/internal/pbe-preview.json",
                        "public/data/patch-notes.json",
                        "public/data/entity-presentation.json",
                    ],
                )

    def test_cdragon_change_requires_public_entity_presentation_change(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_public_data(root, patch_notes=public_patch_notes())

            with self.assertRaisesRegex(PatchPublishError, "public entity presentation"):
                verify_patch_publish(
                    root=root,
                    changed_paths=["data/internal/cdragon-item-latest.json"],
                )

    def test_current_patch_completeness_resolves_subject_and_affected_entity(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            notes = public_patch_notes(notes=[{
                **patch_note(patch="26.13", kind="mechanism"),
                "sections": [{
                    "id": "augments",
                    "title": "Augments",
                    "changes": [{
                        "subject": {"en": "Icathia's Fall"},
                        "text": {"en": "Passive added: Desolate.", "zh-tw": "新增被動效果：Desolate。"},
                        "kind": "mechanism",
                        "targets": [{"type": "augment", "canonicalId": "ARAM_Quest_VoidImmolation", "id": "ARAM_Quest_VoidImmolation"}],
                        "relatedEntities": [{"type": "item", "canonicalId": "223069", "id": "223069"}],
                    }],
                }],
            }, patch_note(patch="26.12", kind="buffed"), patch_note(patch="26.11", kind="changed")])
            self.write_public_data(root, patch_notes=notes)
            entity_path = root / "public" / "data" / "entity-presentation.json"
            entity_path.write_text(json.dumps({
                "schema_version": 1, "source": "fixture", "status": "fresh", "patch": "26.13", "pbe_patch": "26.14", "observed_at": "2026-06-23T18:00:00Z",
                "entities": [
                    {"type": "augment", "canonical_id": "ARAM_Quest_VoidImmolation", "slug": "void-immolation", "patch_changes": [{"patch": "26.13", "after": "Desolate: Killing an enemy deals magic damage around them."}]},
                    {"type": "item", "canonical_id": "223069", "slug": "void-immolation", "patch_changes": [{"patch": "26.13", "after": "Desolate: Killing an enemy deals magic damage around them."}]},
                ],
            }), encoding="utf-8")
            internal = root / "data" / "internal"
            internal.mkdir(parents=True)
            (internal / "patch-events.json").write_text(json.dumps({
                "events": [{
                    "entity_type": "augment", "canonical_id": "ARAM_Quest_VoidImmolation", "slug": "void-immolation", "source_patch_label": "26.13", "change": {"category": "passive-added", "name": "Desolate"}, "affected_entities": [{"entity_type": "item", "canonical_id": "223069"}],
                }]
            }), encoding="utf-8")
            summary = verify_patch_publish(
                root=root,
                changed_paths=["data/internal/patch-events.json", "public/data/patch-notes.json", "public/data/entity-presentation.json"],
            )
        self.assertEqual(summary["officialEntityChanges"], 1)
        self.assertEqual(summary["resolvedEntityChanges"], 1)
        self.assertEqual(summary["projectedEntityChanges"], 1)
        self.assertEqual(summary["unmatchedSubjects"], [])
        self.assertEqual(summary["missingProjections"], [])

    def test_current_patch_completeness_fails_when_affected_item_is_dropped(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            notes = public_patch_notes(notes=[patch_note(patch="26.13", kind="mechanism"), patch_note(patch="26.12", kind="buffed"), patch_note(patch="26.11", kind="changed")])
            self.write_public_data(root, patch_notes=notes)
            internal = root / "data" / "internal"
            internal.mkdir(parents=True)
            (internal / "patch-events.json").write_text(json.dumps({
                "events": [{"entity_type": "augment", "canonical_id": "A", "slug": "fixture", "source_patch_label": "26.13", "change": {"category": "passive-added", "name": "Desolate"}, "affected_entities": [{"entity_type": "item", "canonical_id": "223069"}]}]
            }), encoding="utf-8")
            with self.assertRaisesRegex(PatchPublishError, "current-patch entity projection is incomplete"):
                verify_patch_publish(
                    root=root,
                    changed_paths=["data/internal/patch-events.json", "public/data/patch-notes.json", "public/data/entity-presentation.json"],
                )


if __name__ == "__main__":
    unittest.main()
