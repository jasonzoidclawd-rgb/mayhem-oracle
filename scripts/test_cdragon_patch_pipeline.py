#!/usr/bin/env python3
"""Fixture tests for two-lane CDragon promotion and failure behavior."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cdragon_patch_pipeline import build_branch_update, promote_branch, read_snapshot_lineage
from cdragon_snapshot_diff import build_snapshot, snapshot_filename


def entity(entity_id: str, slug: str, **fields: object) -> dict:
    return {"id": entity_id, "slug": slug, "names": {"en": slug}, "fields": fields}


def snapshot(entity_type: str, branch: str, version: str, rows: list[dict]) -> dict:
    return build_snapshot(
        entity_type=entity_type,
        branch=branch,
        source_version=version,
        source_patch_label=("26.13" if branch == "latest" else f"pbe-cycle-{version}"),
        observed_at="2026-07-11T00:00:00Z",
        entities=rows,
    )


def entities(version_delta: int = 0) -> dict[str, list[dict]]:
    return {
        "augment": [entity("A", "augment", rarity="gold")],
        "champion": [entity("63", "brand", abilities={"Q": {"cooldown": [8 - version_delta]}})],
        "item": [entity("1001", "boots", cost=300 + version_delta * 50)],
    }


class CDragonPatchPipelineTests(unittest.TestCase):
    def test_independent_latest_and_pbe_lineages_keep_provenance_isolated(self):
        latest = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(0),
            previous_snapshots={},
            latest_snapshots={},
            previous_archive=None,
        )
        pbe = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots={},
            latest_snapshots=latest["snapshots"],
            previous_archive=None,
        )

        self.assertEqual(set(latest["snapshots"]), {"augment", "champion", "item"})
        self.assertEqual(set(pbe["snapshots"]), {"augment", "champion", "item"})
        self.assertTrue(all(row["branch"] == "latest" for row in latest["snapshots"].values()))
        self.assertTrue(all(row["branch"] == "pbe" for row in pbe["snapshots"].values()))
        self.assertEqual(pbe["archive"]["branch"], "pbe")
        self.assertEqual(pbe["archive"]["status"], "fresh")
        self.assertTrue(all(event["branch"] == "pbe" for event in pbe["archive"]["events"]))
        self.assertTrue(all(event["comparison"]["base_branch"] == "latest" for event in pbe["archive"]["events"]))

    def test_live_hotfix_and_preview_to_live_landing_are_not_duplicated(self):
        latest_old = {kind: snapshot(kind, "latest", "16.13.1", rows) for kind, rows in entities(0).items()}
        latest_new = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T02:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots=latest_old,
            latest_snapshots={},
            previous_archive=None,
        )
        self.assertTrue(any(event["is_hotfix"] for event in latest_new["archive"]["events"]))

        pbe_old = {kind: snapshot(kind, "pbe", "16.14.1", rows) for kind, rows in entities(0).items()}
        pbe = build_branch_update(
            branch="pbe",
            source_version="16.14.2",
            source_patch_label="pbe-cycle-16.14.2",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots=pbe_old,
            latest_snapshots=latest_old,
            previous_archive=None,
        )
        landed = build_branch_update(
            branch="pbe",
            source_version="16.14.2",
            source_patch_label="pbe-cycle-16.14.2",
            observed_at="2026-07-12T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots=pbe["snapshots"],
            latest_snapshots=latest_new["snapshots"],
            previous_archive=pbe["archive"],
        )

        self.assertEqual(len(landed["archive"]["events"]), len(pbe["archive"]["events"]))
        self.assertTrue(all(event["landed"] for event in landed["archive"]["events"]))

    def test_pbe_version_regression_starts_a_fresh_lineage_without_removals(self):
        previous = {kind: snapshot(kind, "pbe", "16.14.9", rows) for kind, rows in entities(1).items()}
        prior_archive = {
            "schema_version": 1,
            "branch": "pbe",
            "lane": "preview",
            "events": [{"entity_type": "item", "slug": "old", "lifecycle": "upcoming", "landed": False}],
        }
        update = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(0),
            previous_snapshots=previous,
            latest_snapshots={},
            previous_archive=prior_archive,
        )

        self.assertTrue(update["reset"])
        self.assertEqual(update["new_events"], [])
        self.assertEqual(update["archive"]["events"][0]["lifecycle"], "aged_out")

    def test_current_pbe_without_a_latest_baseline_is_not_mislabeled_as_no_changes(self):
        update = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots={},
            latest_snapshots={},
            previous_archive=None,
        )

        self.assertEqual(update["archive"]["status"], "not_yet_confirmed")
        self.assertEqual(update["archive"]["events"], [])

    def test_stale_latest_baseline_keeps_pbe_unconfirmed(self):
        latest = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(0),
            previous_snapshots={},
            latest_snapshots={},
            previous_archive=None,
        )
        pbe = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T02:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots={},
            latest_snapshots=latest["snapshots"],
            previous_archive=None,
            latest_baseline_confirmed=False,
        )

        self.assertEqual(pbe["archive"]["status"], "not_yet_confirmed")
        self.assertEqual(pbe["archive"]["events"], [])

    def test_lineage_reader_rejects_malformed_snapshot_without_falling_back_to_another_lane(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            internal = Path(tmpdir)
            (internal / snapshot_filename("item", "pbe")).write_text("{bad", encoding="utf-8")
            (internal / snapshot_filename("item", "latest")).write_text(
                json.dumps(snapshot("item", "latest", "16.13.1", [entity("1", "boots")])),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "malformed"):
                read_snapshot_lineage(internal, "pbe")

    def test_failed_pbe_acquisition_does_not_promote_or_mutate_live_lineage(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            internal = Path(tmpdir)
            latest = snapshot("item", "latest", "16.13.1", [entity("1", "boots")])
            latest_path = internal / snapshot_filename("item", "latest")
            latest_path.write_text(json.dumps(latest), encoding="utf-8")
            before = latest_path.read_bytes()

            def unavailable(_url: str):
                raise OSError("fixture PBE source unavailable")

            with self.assertRaisesRegex(OSError, "source unavailable"):
                promote_branch("pbe", internal_dir=internal, fetch_json=unavailable)

            self.assertEqual(latest_path.read_bytes(), before)
            self.assertFalse((internal / snapshot_filename("item", "pbe")).exists())


if __name__ == "__main__":
    unittest.main()
