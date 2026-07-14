#!/usr/bin/env python3
"""Regression coverage for gameplay changes on entities produced by augments."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from cdragon_patch_pipeline import build_branch_update
from augment_entity_links import load_augment_entity_links
from cdragon_snapshot_diff import (
    apply_augment_entity_links,
    build_snapshot,
    compare_snapshots,
)
from semantic_entity_diff import gameplay_semantics, semantic_changes


ROOT = Path(__file__).resolve().parent
FIXTURE_DIR = ROOT / "fixtures" / "void-immolation-cross-entity"
LINK = {
    "augment_id": "ARAM_Quest_VoidImmolation",
    "item_id": "223069",
    "kind": "quest-reward-transformation",
    "provenance": "fixture relationship",
}


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def snapshots(payload: dict) -> dict[str, dict]:
    return {
        entity_type: build_snapshot(
            entity_type=entity_type,
            branch="latest",
            source_version=payload["source_version"],
            source_patch_label=payload["source_patch_label"],
            observed_at=payload["observed_at"],
            entities=payload[entity_type],
        )
        for entity_type in ("augment", "champion", "item")
    }


class CrossEntityAugmentChangeTests(unittest.TestCase):
    def test_source_owned_relationship_is_canonical_and_provenanced(self):
        relationships = load_augment_entity_links(ROOT.parent / "data" / "internal" / "augment-entity-links.json")
        self.assertEqual(relationships[0]["augment_id"], "ARAM_Quest_VoidImmolation")
        self.assertEqual(relationships[0]["item_id"], "223069")
        self.assertEqual(relationships[0]["kind"], "quest-reward-transformation")
        self.assertTrue(relationships[0]["provenance"])

    def test_semantic_comparison_covers_gameplay_collections_and_ignores_nonsemantic_churn(self):
        before = {
            "description": "<mainText><passive>Immolate</passive><br>Old text</mainText>",
            "passives": [{"name": "Ward", "description": "Old ward"}],
            "actives": [{"name": "Pulse", "description": "Pulse"}],
            "mechanics": [{"name": "Old mechanic", "description": "Keep"}],
            "effects": [{"id": "effect-a", "value": 1}],
            "quest_rewards": [{"id": "reward-a", "name": "Old reward"}],
            "linked_entities": [{"type": "item", "canonical_id": "1"}],
            "source_timestamp": "old",
            "localized": {"en": "Old", "zh-TW": "舊"},
        }
        after = {
            "description": "<mainText> <passive>Immolate</passive><br/>Old text </mainText>",
            "passives": [
                {"name": "Ward", "description": "New ward"},
                {"name": "Desolate", "description": "New passive"},
            ],
            "actives": [{"name": "New active", "description": "Added"}],
            "mechanics": [{"name": "New mechanic", "description": "Added"}],
            "effects": [{"id": "effect-a", "value": 2}],
            "quest_rewards": [{"id": "reward-b", "name": "New reward"}],
            "linked_entities": [{"type": "item", "canonical_id": "2"}],
            "source_timestamp": "new",
            "localized": {"en": "New", "zh-TW": "新"},
        }
        changes = semantic_changes(before, after)
        categories = {change["category"] for change in changes}
        self.assertIn("passive-added", categories)
        self.assertIn("passive-description-changed", categories)
        self.assertIn("active-added", categories)
        self.assertIn("mechanic-added", categories)
        self.assertIn("structured-effect-changed", categories)
        self.assertIn("quest-reward-transformation-added", categories)
        self.assertIn("quest-reward-transformation-removed", categories)
        self.assertIn("canonical-linked-entity-added", categories)
        self.assertIn("canonical-linked-entity-removed", categories)
        self.assertNotIn("source_timestamp", json.dumps(changes))
        self.assertNotIn("localized", json.dumps(changes))

    def test_fixture_reproduces_old_augment_only_miss_and_emits_one_linked_event(self):
        previous_payload = load_fixture("previous.json")
        current_payload = load_fixture("current.json")
        previous = snapshots(previous_payload)
        current = snapshots(current_payload)

        # The old detector compared only the augment row for an augment
        # question. Its name, tooltip, and rarity are unchanged.
        self.assertEqual(
            compare_snapshots(previous["augment"], current["augment"], detected_at=current_payload["observed_at"]),
            [],
        )
        self.assertEqual(
            [entry["name"] for entry in gameplay_semantics(previous["item"]["entities"][0]["fields"]) .get("passives", [])],
            ["Immolate"],
        )

        item_events = compare_snapshots(
            previous["item"],
            current["item"],
            detected_at=current_payload["observed_at"],
        )
        self.assertEqual(len(item_events), 1)
        self.assertEqual(item_events[0]["change"]["category"], "passive-added")

        events = apply_augment_entity_links(item_events, [LINK], current)

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["entity_type"], "augment")
        self.assertEqual(event["canonical_id"], "ARAM_Quest_VoidImmolation")
        self.assertEqual(event["affected_entities"], [{
            "entity_type": "item",
            "canonical_id": "223069",
            "slug": "void-immolation",
            "names": {"en": "Void Immolation"},
        }])
        self.assertEqual(event["change"], {
            "category": "passive-added",
            "name": "Desolate",
            "description": "Killing an enemy deals magic damage around them.",
        })

    def test_pipeline_second_identical_run_has_no_new_event_and_same_archive(self):
        previous = snapshots(load_fixture("previous.json"))
        current = snapshots(load_fixture("current.json"))
        first = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type={key: value["entities"] for key, value in current.items()},
            previous_snapshots=previous,
            latest_snapshots={},
            previous_archive=None,
            augment_entity_links=[LINK],
        )
        second = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type={key: value["entities"] for key, value in current.items()},
            previous_snapshots=first["snapshots"],
            latest_snapshots={},
            previous_archive=first["archive"],
            augment_entity_links=[LINK],
        )
        self.assertEqual(len(first["new_events"]), 1)
        self.assertEqual(second["new_events"], [])
        self.assertEqual(
            json.dumps(first["archive"], ensure_ascii=False, sort_keys=True),
            json.dumps(second["archive"], ensure_ascii=False, sort_keys=True),
        )


if __name__ == "__main__":
    unittest.main()
