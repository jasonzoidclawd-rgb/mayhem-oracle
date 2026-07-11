#!/usr/bin/env python3
"""Presentation projections consume CDragon events, never prose structure."""

from __future__ import annotations

import json
import unittest

from patch_event_projection import build_patch_notes_projection, build_preview_projection


def event(**overrides: object) -> dict:
    base = {
        "entity_type": "champion",
        "canonical_id": "63",
        "slug": "brand",
        "names": {"en": "Brand", "zh-TW": "布蘭德"},
        "branch": "latest",
        "lane": "live",
        "change_kind": "numeric",
        "fields_changed": ["abilities.Q.cooldown"],
        "before": {"abilities.Q.cooldown": [8, 7, 6]},
        "after": {"abilities.Q.cooldown": [7, 6, 5]},
        "detected_at": "2026-07-11T01:00:00Z",
        "source_patch_label": "26.13",
        "landed": False,
        "is_hotfix": True,
    }
    base.update(overrides)
    return base


class PatchEventProjectionTests(unittest.TestCase):
    def test_live_projection_uses_snapshot_events_and_metadata_only(self):
        patch_events = {
            "current_open_cycle": "26.13",
            "observed_at": "2026-07-11T01:00:00Z",
            "events": [event()],
        }
        metadata = {
            "patches": [
                {
                    "version": "26.13",
                    "articleTitle": "Patch 26.13 Notes",
                    "publishedAt": "2026-06-25T12:00:00Z",
                    "sourceUrl": "https://riot.example/26-13",
                    "authors": ["Riot Fixture"],
                    "intro": "Metadata only.",
                },
                {
                    "version": "26.12",
                    "articleTitle": "Patch 26.12 Notes",
                    "publishedAt": "2026-06-11T12:00:00Z",
                    "sourceUrl": "https://riot.example/26-12",
                    "authors": [],
                    "intro": "",
                },
            ],
        }

        projection = build_patch_notes_projection(
            patch_events,
            metadata,
            known={"champion": {"brand"}, "item": set(), "augment": set()},
        )
        current, historical = projection["patches"]

        self.assertEqual(projection["source"], "CommunityDragon snapshot diffs")
        self.assertEqual(current["version"], "26.13")
        self.assertEqual(current["sections"][0]["id"], "champions")
        change = current["sections"][0]["changes"][0]
        self.assertEqual(change["kind"], "changed")
        self.assertEqual(change["targets"][0]["href"], "/champions/brand")
        self.assertEqual(change["text"]["en"], "abilities.Q.cooldown: [8, 7, 6] → [7, 6, 5]")
        self.assertEqual(historical["version"], "26.12")
        self.assertEqual(historical["sections"], [])
        self.assertNotIn("comparison", json.dumps(projection))

    def test_projection_keeps_only_current_open_live_cycle(self):
        projection = build_patch_notes_projection(
            {
                "current_open_cycle": "26.13",
                "observed_at": "2026-07-11T01:00:00Z",
                "events": [event(source_patch_label="26.12"), event(source_patch_label="26.13")],
            },
            {"patches": []},
        )

        self.assertEqual(len(projection["patches"]), 1)
        self.assertEqual(len(projection["patches"][0]["sections"][0]["changes"]), 1)

    def test_live_projection_marks_a_source_reconciled_preview_as_landed(self):
        live = event()
        projection = build_patch_notes_projection(
            {"current_open_cycle": "26.13", "events": [live]},
            {"patches": []},
            pbe_archive={
                "events": [
                    {
                        **event(branch="pbe", lane="preview"),
                        "lifecycle": "landed",
                        "landed": True,
                    },
                ],
            },
        )

        change = projection["patches"][0]["sections"][0]["changes"][0]
        self.assertTrue(change["landedFromPbe"])

    def test_preview_projection_is_bounded_and_only_links_live_canonical_entities(self):
        archive = {
            "status": "fresh",
            "source_patch_label": "pbe-cycle-16.14",
            "observed_at": "2026-07-11T01:00:00Z",
            "events": [
                event(branch="pbe", lane="preview", source_patch_label="pbe-cycle-16.14"),
                event(slug="new-champion", canonical_id="999", branch="pbe", lane="preview", source_patch_label="pbe-cycle-16.14"),
                event(slug="landed", lifecycle="landed", landed=True),
            ],
        }
        known = {
            "champion": {"brand"},
            "augment": set(),
            "item": set(),
        }

        projection = build_preview_projection(archive, known)

        self.assertEqual([row["slug"] for row in projection["events"]], ["brand", "new-champion"])
        self.assertEqual(projection["events"][0]["href"], "/champions/brand")
        self.assertNotIn("href", projection["events"][1])
        self.assertNotIn("lifecycle", json.dumps(projection))
        self.assertNotIn("comparison", json.dumps(projection))


if __name__ == "__main__":
    unittest.main()
