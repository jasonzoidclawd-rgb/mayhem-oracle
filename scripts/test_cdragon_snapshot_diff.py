#!/usr/bin/env python3
"""Contract tests for the source-versioned CDragon patch event engine."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from cdragon_entity_adapters import (
    AdapterError,
    extract_base_stats_from_bin,
    normalize_augment_entities,
    normalize_champion_entities,
    normalize_item_entities,
)
from cdragon_snapshot_diff import (
    SnapshotValidationError,
    advance_preview_lifecycle,
    atomic_write_many,
    build_public_preview_projection,
    build_snapshot,
    compare_snapshots,
    snapshot_filename,
    validate_snapshot,
)


def entity(entity_id: str, slug: str, **fields: object) -> dict:
    return {
        "id": entity_id,
        "slug": slug,
        "names": {"en": slug.replace("-", " ").title()},
        "fields": fields,
    }


def snapshot(
    entity_type: str,
    branch: str,
    version: str,
    rows: list[dict],
) -> dict:
    return build_snapshot(
        entity_type=entity_type,
        branch=branch,
        source_version=version,
        source_patch_label=("26.13" if branch == "latest" else f"pbe-cycle-{version}"),
        observed_at="2026-07-11T00:00:00Z",
        entities=rows,
    )


class CDragonSnapshotDiffTests(unittest.TestCase):
    def test_snapshot_paths_are_lane_and_entity_isolated(self):
        self.assertEqual(
            snapshot_filename("augment", "latest"),
            "cdragon-augment-latest.json",
        )
        self.assertEqual(
            snapshot_filename("champion", "pbe"),
            "cdragon-champion-pbe.json",
        )
        self.assertNotEqual(
            snapshot_filename("item", "latest"),
            snapshot_filename("item", "pbe"),
        )

    def test_augment_addition_removal_and_rarity_change_are_structured(self):
        before = snapshot(
            "augment",
            "latest",
            "16.13.1",
            [entity("A", "arcane-comet", rarity="gold", tooltip="Old")],
        )
        after = snapshot(
            "augment",
            "latest",
            "16.13.2",
            [
                entity("A", "arcane-comet", rarity="prismatic", tooltip="Old"),
                entity("B", "new-augment", rarity="silver", tooltip="New"),
            ],
        )

        events = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")

        self.assertEqual(
            [(event["slug"], event["change_kind"]) for event in events],
            [("arcane-comet", "rarity"), ("new-augment", "added")],
        )
        self.assertEqual(events[0]["fields_changed"], ["rarity"])
        self.assertEqual(events[0]["branch"], "latest")
        self.assertEqual(events[0]["lane"], "live")
        self.assertEqual(events[0]["comparison"]["base_version"], "16.13.1")

    def test_champion_addition_removal_and_numeric_ability_change(self):
        before = snapshot(
            "champion",
            "latest",
            "16.13.1",
            [entity("63", "brand", abilities={"Q": {"cooldown": [8, 7, 6]}})],
        )
        after = snapshot(
            "champion",
            "latest",
            "16.13.2",
            [
                entity("63", "brand", abilities={"Q": {"cooldown": [7, 6, 5]}}),
                entity("22", "ashe", base_stats={"health": 640}),
            ],
        )

        events = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")

        self.assertEqual(
            [(event["slug"], event["change_kind"]) for event in events],
            [("ashe", "added"), ("brand", "numeric")],
        )
        self.assertEqual(events[1]["fields_changed"], ["abilities.Q.cooldown"])

    def test_item_addition_removal_and_field_change(self):
        before = snapshot(
            "item",
            "latest",
            "16.13.1",
            [
                entity("1001", "boots", cost=300, stats={"moveSpeed": 25}),
                entity("2003", "potion", cost=50),
            ],
        )
        after = snapshot(
            "item",
            "latest",
            "16.13.2",
            [
                entity("1001", "boots", cost=350, stats={"moveSpeed": 25}),
                entity("3006", "berserkers-greaves", cost=1100),
            ],
        )

        events = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")

        self.assertEqual(
            [(event["slug"], event["change_kind"]) for event in events],
            [
                ("berserkers-greaves", "added"),
                ("boots", "numeric"),
                ("potion", "removed"),
            ],
        )

    def test_same_patch_live_diff_is_an_undocumented_hotfix(self):
        before = snapshot("augment", "latest", "16.13.1", [entity("A", "arcane-comet", tooltip="10")])
        after = snapshot("augment", "latest", "16.13.2", [entity("A", "arcane-comet", tooltip="12")])

        event = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")[0]

        self.assertTrue(event["is_hotfix"])
        self.assertEqual(event["source_patch_label"], "26.13")

    def test_comparison_is_stable_and_idempotent(self):
        before = snapshot("item", "latest", "16.13.1", [entity("2", "zeta", cost=2), entity("1", "alpha", cost=1)])
        after = snapshot("item", "latest", "16.13.2", [entity("3", "beta", cost=3), entity("1", "alpha", cost=2)])

        first = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")
        second = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")

        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        self.assertEqual([event["slug"] for event in first], ["alpha", "beta", "zeta"])

    def test_duplicate_ids_malformed_snapshots_and_coverage_loss_fail_closed(self):
        duplicate = snapshot("item", "latest", "16.13.2", [entity("1", "one")])
        duplicate["entities"].append(entity("1", "duplicate"))
        with self.assertRaisesRegex(SnapshotValidationError, "duplicate canonical id"):
            validate_snapshot(duplicate)

        malformed = {"branch": "latest", "entities": []}
        with self.assertRaisesRegex(SnapshotValidationError, "missing"):
            validate_snapshot(malformed)

        previous = snapshot("item", "latest", "16.13.1", [entity(str(i), f"item-{i}") for i in range(10)])
        reduced = snapshot("item", "latest", "16.13.2", [entity("1", "item-1")])
        with self.assertRaisesRegex(SnapshotValidationError, "coverage loss"):
            validate_snapshot(reduced, previous=previous)

    def test_pbe_version_regression_fails_without_touching_latest(self):
        previous = snapshot("champion", "pbe", "16.14.5", [entity("1", "one")])
        regressed = snapshot("champion", "pbe", "16.14.4", [entity("1", "one")])

        with self.assertRaisesRegex(SnapshotValidationError, "version regression"):
            validate_snapshot(regressed, previous=previous)

    def test_preview_lands_once_without_cross_lane_duplication(self):
        pbe_before = snapshot("champion", "pbe", "16.14.1", [entity("63", "brand", cost=50)])
        pbe_after = snapshot("champion", "pbe", "16.14.2", [entity("63", "brand", cost=40)])
        preview_event = compare_snapshots(pbe_before, pbe_after, detected_at="2026-07-11T01:00:00Z")[0]
        live_before = snapshot("champion", "latest", "16.13.9", [entity("63", "brand", cost=50)])
        live_after = snapshot("champion", "latest", "16.14.1", [entity("63", "brand", cost=40)])
        live_event = compare_snapshots(live_before, live_after, detected_at="2026-07-12T01:00:00Z")[0]

        archive = advance_preview_lifecycle(
            previous_archive=None,
            preview_events=[preview_event],
            latest_events=[],
            current_cycle="pbe-cycle-16.14.2",
            observed_at="2026-07-11T01:00:00Z",
        )
        landed = advance_preview_lifecycle(
            previous_archive=archive,
            preview_events=[preview_event],
            latest_events=[live_event],
            current_cycle="pbe-cycle-16.14.2",
            observed_at="2026-07-12T01:00:00Z",
        )

        self.assertEqual(len(landed["events"]), 1)
        self.assertTrue(landed["events"][0]["landed"])
        self.assertEqual(landed["events"][0]["lifecycle"], "landed")
        projection = build_public_preview_projection(landed)
        self.assertEqual(projection["events"], [])

    def test_preview_ages_out_only_across_cycles_and_repeated_polls_do_not_duplicate(self):
        event = compare_snapshots(
            snapshot("item", "pbe", "16.14.1", [entity("1", "boots", cost=300)]),
            snapshot("item", "pbe", "16.14.2", [entity("1", "boots", cost=350)]),
            detected_at="2026-07-11T01:00:00Z",
        )[0]
        archive = advance_preview_lifecycle(None, [event], [], "pbe-cycle-16.14.2", "2026-07-11T01:00:00Z")
        again = advance_preview_lifecycle(archive, [event], [], "pbe-cycle-16.14.2", "2026-07-11T02:00:00Z")
        self.assertEqual(len(again["events"]), 1)
        self.assertEqual(again["events"][0]["observed_cycles"], 1)

        aged = advance_preview_lifecycle(again, [], [], "pbe-cycle-16.15.1", "2026-07-18T00:00:00Z", max_open_cycles=1)
        self.assertEqual(aged["events"][0]["lifecycle"], "aged_out")

    def test_public_projection_is_current_open_cycle_only(self):
        archive = {
            "schema_version": 1,
            "branch": "pbe",
            "source_patch_label": "pbe-cycle-16.14.2",
            "observed_at": "2026-07-11T01:00:00Z",
            "events": [
                {"entity_type": "item", "slug": "active", "landed": False, "lifecycle": "upcoming", "before": {}, "after": {}},
                {"entity_type": "item", "slug": "landed", "landed": True, "lifecycle": "landed", "before": {}, "after": {}},
                {"entity_type": "item", "slug": "old", "landed": False, "lifecycle": "aged_out", "before": {}, "after": {}},
            ],
            "history": [{"private": True}],
        }

        projection = build_public_preview_projection(archive)

        self.assertEqual([event["slug"] for event in projection["events"]], ["active"])
        self.assertNotIn("history", projection)
        self.assertNotIn("private", json.dumps(projection))

    def test_adapters_use_stable_ids_and_reject_unmapped_positional_effects(self):
        augments = normalize_augment_entities([
            {"nameId": "ARAM_ADAPt", "slug": "a-d-a-pt", "name": "ADAPt", "names": {"en": "ADAPt"}, "rarity": "silver", "tooltip": "Convert"},
        ])
        self.assertEqual(augments[0]["id"], "ARAM_ADAPt")

        champions = normalize_champion_entities(
            [{"id": 63, "alias": "Brand", "name": "Brand"}],
            {"63": {"spells": [{"cost": [50], "cooldown": [8], "range": [1050], "mDataValues": [{"name": "Damage", "values": [80]}], "effectAmounts": [[80]]}]}},
        )
        self.assertEqual(champions[0]["id"], "63")
        self.assertEqual(champions[0]["fields"]["abilities"]["Q"]["effect_amounts"], {"Damage": [80]})

        items = normalize_item_entities([{"id": 3006, "name": "Berserker's Greaves", "priceTotal": 1100, "stats": {"attackSpeed": 35}}])
        self.assertEqual(items[0]["id"], "3006")
        self.assertEqual(items[0]["fields"]["cost"], 1100)

        base_stats = extract_base_stats_from_bin({
            "Characters/Brand/CharacterRecords/Root": {
                "__type": "CharacterRecord",
                "baseHPModifiable": {"baseValue": 570},
                "baseArmorModifiable": {"baseValue": 24},
            },
        })
        self.assertEqual(base_stats, {"health": 570, "armor": 24})

        with self.assertRaisesRegex(AdapterError, "positional"):
            normalize_champion_entities(
                [{"id": 63, "alias": "Brand", "name": "Brand"}],
                {"63": {"spells": [{"effectAmounts": [[80]]}]}},
            )

    def test_atomic_promotion_restores_old_files_after_a_write_failure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            first = root / "first.json"
            second = root / "second.json"
            first.write_text('{"before": 1}\n', encoding="utf-8")
            second.write_text('{"before": 2}\n', encoding="utf-8")

            with self.assertRaisesRegex(OSError, "fixture failure"):
                atomic_write_many(
                    {first: {"after": 1}, second: {"after": 2}},
                    fail_after=1,
                )

            self.assertEqual(first.read_text(encoding="utf-8"), '{"before": 1}\n')
            self.assertEqual(second.read_text(encoding="utf-8"), '{"before": 2}\n')


if __name__ == "__main__":
    unittest.main()
