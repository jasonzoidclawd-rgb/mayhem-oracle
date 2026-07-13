#!/usr/bin/env python3
import json
import unittest

from entity_presentation_projection import CANONICAL_AUGMENT_IDS, MAYHEM_CANONICAL_ITEM_IDS, build_entity_presentation


def snapshot(entity_type, branch, version, patch, entities, lane=None):
    return {
        "schema_version": 1,
        "entity_type": entity_type,
        "branch": branch,
        "lane": lane or ("live" if branch == "latest" else "preview"),
        "source_version": version,
        "source_patch_label": patch,
        "observed_at": "2026-07-12T00:00:00Z",
        "entities": entities,
    }


def entity(entity_id, slug, fields, names=None):
    return {"id": entity_id, "slug": slug, "names": names or {"en": slug.title()}, "fields": fields}


class EntityPresentationProjectionTests(unittest.TestCase):
    def test_mayhem_item_aliases_keep_cdragon_ids_and_localized_catalog_fields(self):
        self.assertEqual(
            set(MAYHEM_CANONICAL_ITEM_IDS),
            {
                "atmas-reckoning", "rite-of-ruin", "sword-of-blossoming-dawn",
                "the-golden-spatula", "stormrazor", "heartsteel", "wooglets-witchcap",
            },
        )
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", []),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", []),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [
                entity("3430", "rite-of-ruin", {"cost": 2500}),
            ]),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": []},
                "augment": {"rows": []},
                "item": {"rows": [
                    {"id": 3430, "name": "Rite Of Ruin", "name_zh_TW": "殞落之祭"},
                    {"id": 3430, "slug": "rite-of-ruin", "name": "Rite of Ruin"},
                ]},
            },
        )
        row = next(row for row in result["entities"] if row["type"] == "item")
        self.assertEqual(row["slug"], "rite-of-ruin")
        self.assertEqual(row["names"]["zh-TW"], "殞落之祭")

    def test_explicitly_unroutable_item_keeps_safe_localized_metadata(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", []),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", []),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [
                entity("3168", "immortal-path", {"cost": 1000}),
            ]),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": []},
                "augment": {"rows": []},
                "item": {"rows": [{
                    "id": 3168,
                    "name": "Immortal Path",
                    "name_zh_TW": "不朽之道",
                    "icon": "immortal-path.png",
                    "_route_identifier": "",
                }]},
            },
        )

        row = next(row for row in result["entities"] if row["canonical_id"] == "3168")
        self.assertFalse(row["known"])
        self.assertEqual(row["route_identifier"], "")
        self.assertEqual(row["names"]["zh-TW"], "不朽之道")
        self.assertEqual(row["icon"], "immortal-path.png")

    def test_all_entity_types_project_canonical_ids_and_safe_stats(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [
                entity("1", "annie", {"base_stats": {"health": 560, "armor": 23}}),
            ]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [
                entity("ARAM_TEST", "test-augment", {"rarity": "gold"}),
            ]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [
                entity("1001", "boots", {"cost": 300, "stats": {"movementSpeed": 25}}),
            ]),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": [{"slug": "annie", "name": "Annie", "icon": "annie.png"}]},
                "augment": {"rows": [{"augmentId": "ARAM_TEST", "slug": "test-augment", "name": "Test Augment", "icon": "augment.png"}]},
                "item": {"rows": [{"id": 1001, "slug": "boots", "name": "Boots", "icon": "boots.png"}]},
            },
        )

        self.assertEqual([(row["type"], row["canonical_id"]) for row in result["entities"]], [
            ("augment", "ARAM_TEST"), ("champion", "1"), ("item", "1001"),
        ])
        champion = next(row for row in result["entities"] if row["type"] == "champion")
        item = next(row for row in result["entities"] if row["type"] == "item")
        self.assertEqual(champion["route_identifier"], "annie")
        self.assertTrue(champion["known"])
        self.assertEqual(item["route_identifier"], "1001")
        self.assertTrue(item["known"])
        armor_stat = next(stat for stat in champion["stats"] if stat["key"] == "base_armor")
        self.assertEqual(armor_stat["source_path"], "fields.base_stats.armor")
        self.assertEqual(item["stats"][0]["unit"], "gold")
        self.assertNotIn("description", item["stats"])

    def test_champion_ability_arrays_are_presented_with_units_without_template_prose(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity(
                "1",
                "annie",
                {"abilities": {"Q": {
                    "cost": "@Cost@ @AbilityResourceName@",
                    "cooldown_coefficients": [4, 4, 4],
                    "range": [625, 625, 625],
                }}},
            )]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", []),
            "item": snapshot("item", "latest", "16.13.2", "26.13", []),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": [{"slug": "annie", "name": "Annie"}]}, "augment": {"rows": []}, "item": {"rows": []}},
        )
        stats = next(row for row in result["entities"] if row["type"] == "champion")["stats"]
        self.assertTrue(any(stat["key"] == "ability_cooldown_Q" and stat["unit"] == "seconds" for stat in stats))
        self.assertTrue(any(stat["key"] == "ability_range_Q" and stat["unit"] == "units" for stat in stats))
        self.assertFalse(any(stat["value"] == "@Cost@ @AbilityResourceName@" for stat in stats))

    def test_numeric_diff_has_explicit_direction_and_lane_provenance(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {"base_stats": {"health": 600}})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [entity("A", "a", {"rarity": "gold"})]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [entity("1001", "boots", {"cost": 280})]),
        }
        patch_events = {
            "current_open_cycle": "26.13",
            "status": "fresh",
            "events": [{
                "entity_type": "champion", "canonical_id": "1", "slug": "annie",
                "source_patch_label": "26.13", "lane": "live", "branch": "latest",
                "change_kind": "numeric", "fields_changed": ["base_stats.health"],
                "before": {"base_stats.health": 560}, "after": {"base_stats.health": 600},
                "is_hotfix": True, "comparison": {"target_version": "16.13.2"},
            }],
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": [{"slug": "annie", "name": "Annie"}]}, "augment": {"rows": []}, "item": {"rows": []}},
            patch_events=patch_events,
        )
        change = next(row for row in result["entities"] if row["type"] == "champion")["patch_changes"][0]
        self.assertEqual(change["direction"], "buff")
        self.assertTrue(change["is_hotfix"])
        self.assertEqual(change["source_version"], "16.13.2")

    def test_ability_numeric_diff_retains_context_and_is_not_prose_derived(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {"abilities": {"Q": {"cooldown_coefficients": [3, 3, 3]}}})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", []),
            "item": snapshot("item", "latest", "16.13.2", "26.13", []),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": [{"slug": "annie", "name": "Annie"}]}, "augment": {"rows": []}, "item": {"rows": []}},
            patch_events={"current_open_cycle": "26.13", "events": [{
                "entity_type": "champion", "canonical_id": "1", "slug": "annie", "lane": "live",
                "source_patch_label": "26.13", "fields_changed": ["abilities.Q.cooldown_coefficients"],
                "before": {"abilities.Q.cooldown_coefficients": [4, 4, 4]},
                "after": {"abilities.Q.cooldown_coefficients": [3, 3, 3]},
                "comparison": {"target_version": "16.13.2"},
            }]},
        )
        changes = next(row for row in result["entities"] if row["type"] == "champion")["patch_changes"]
        self.assertEqual(changes[0]["unit"], "seconds")
        self.assertEqual(changes[0]["context"], "Q")
        self.assertEqual(changes[0]["direction"], "changed")

    def test_cooldown_or_cost_semantics_can_be_lower_is_better_without_prose_parsing(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [entity("A", "a", {})]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [entity("1001", "boots", {"cost": 280})]),
        }
        patch_events = {
            "current_open_cycle": "26.13", "events": [{
                "entity_type": "item", "canonical_id": "1001", "slug": "boots", "lane": "live",
                "source_patch_label": "26.13", "fields_changed": ["cost"],
                "before": {"cost": 300}, "after": {"cost": 280},
            }],
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": []}, "augment": {"rows": []}, "item": {"rows": [{"id": 1001, "slug": "boots", "name": "Boots", "description": "300 gold"}]}},
            patch_events=patch_events,
        )
        change = next(row for row in result["entities"] if row["type"] == "item")["patch_changes"][0]
        self.assertEqual(change["direction"], "buff")
        # The numeric string in the description must not become a stat.
        self.assertEqual([stat["key"] for stat in next(row for row in result["entities"] if row["type"] == "item")["stats"]], ["cost"])

    def test_pbe_landing_is_preserved_once_and_current_cycle_is_bounded(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {"base_stats": {"health": 600}})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [entity("A", "a", {})]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [entity("1001", "boots", {})]),
        }
        pbe = {
            "source_patch_label": "pbe-cycle-26.14", "observed_at": "2026-07-12T01:00:00Z", "events": [{
                "entity_type": "champion", "canonical_id": "1", "slug": "annie", "lane": "preview",
                "source_patch_label": "pbe-cycle-26.14", "change_kind": "numeric", "fields_changed": ["base_stats.health"],
                "before": {"base_stats.health": 560}, "after": {"base_stats.health": 600},
                "landed": True, "lifecycle": "landed",
            }, {
                "entity_type": "champion", "canonical_id": "1", "slug": "annie", "lane": "preview",
                "source_patch_label": "pbe-cycle-26.13", "change_kind": "numeric", "fields_changed": ["base_stats.health"],
                "before": {"base_stats.health": 550}, "after": {"base_stats.health": 560},
                "landed": False, "lifecycle": "aged_out",
            }],
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": [{"slug": "annie", "name": "Annie"}]}, "augment": {"rows": []}, "item": {"rows": []}},
            pbe_archive=pbe,
        )
        changes = next(row for row in result["entities"] if row["type"] == "champion")["patch_changes"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["lifecycle"], "landed")

    def test_duplicate_catalog_ids_fail_closed_and_output_is_byte_deterministic(self):
        kwargs = {
            "snapshots": {"champion": snapshot("champion", "latest", "1", "1", [entity("1", "one", {})]), "augment": snapshot("augment", "latest", "1", "1", [entity("A", "a", {})]), "item": snapshot("item", "latest", "1", "1", [entity("1", "item", {})])},
            "catalogs": {"champion": {"rows": [{"slug": "one", "name": "One"}]}, "augment": {"rows": [{"augmentId": "A", "slug": "a", "name": "A"}]}, "item": {"rows": [{"id": 1, "slug": "item", "name": "Item"}]}},
        }
        first = build_entity_presentation(**kwargs)
        second = build_entity_presentation(**kwargs)
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        kwargs["catalogs"]["item"]["rows"].append({"id": 1, "slug": "duplicate", "name": "Duplicate"})
        duplicate_safe = build_entity_presentation(**kwargs)
        self.assertEqual(
            [row["slug"] for row in duplicate_safe["entities"] if row["type"] == "item"],
            ["item"],
        )

    def test_item_variant_cannot_inherit_route_from_same_slug_catalog_row(self):
        """Route ownership is canonical-ID based; slug matching is presentation-only."""
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", []),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", []),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [
                entity("4403", "the-golden-spatula", {"cost": 2500}),
                entity("664403", "the-golden-spatula", {"cost": 2500}),
            ]),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": []},
                "augment": {"rows": []},
                "item": {"rows": [{
                    "id": 4403,
                    "slug": "the-golden-spatula",
                    "name": "The Golden Spatula",
                    "name_zh_TW": "黃金鍋鏟",
                    "icon": "spatula.png",
                    "_route_identifier": "the-golden-spatula",
                }]},
            },
        )
        rows = {row["canonical_id"]: row for row in result["entities"] if row["type"] == "item"}
        self.assertEqual(rows["4403"]["route_identifier"], "the-golden-spatula")
        self.assertTrue(rows["4403"]["known"])
        self.assertEqual(rows["664403"]["route_identifier"], "")
        self.assertFalse(rows["664403"]["known"])
        # The same-slug catalog row may provide safe display metadata, but not
        # a route or a known=true claim for the unlisted canonical ID.
        self.assertEqual(rows["664403"]["names"]["zh-TW"], "黃金鍋鏟")
        self.assertEqual(rows["664403"]["icon"], "spatula.png")

    def test_forged_by_the_master_snapshot_presence_clears_legacy_removal(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {})]),
            "augment": snapshot(
                "augment",
                "latest",
                "16.13.2",
                "26.13",
                [entity("ARAM_FORGED_BY_THE_MASTER", "forged-by-the-master", {"rarity": "silver", "tooltip": "A structured tooltip"})],
            ),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [entity("1001", "boots", {})]),
        }
        legacy_removal = {
            "current_open_cycle": "26.13",
            "events": [{
                "entity_type": "augment",
                "canonical_id": "ARAM_FORGED_BY_THE_MASTER",
                "slug": "forged-by-the-master",
                "source_patch_label": "26.13",
                "change_kind": "removed",
                "fields_changed": [],
                "before": {"rarity": "silver"},
                "after": {},
            }],
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": [{"slug": "annie", "name": "Annie"}]},
                "augment": {"rows": [{
                    "augmentId": "ARAM_FORGED_BY_THE_MASTER",
                    "slug": "forged-by-the-master",
                    "name": "Forged By The Master",
                    "icon": "forged.png",
                    "flags": {"lifecycle": "removed", "lifecycle_patch": "26.13"},
                    "wikiDescription": "Neutral description with 26.13 in prose",
                }]},
                "item": {"rows": [{"id": 1001, "slug": "boots", "name": "Boots"}]},
            },
            patch_events=legacy_removal,
        )
        forged = next(row for row in result["entities"] if row["slug"] == "forged-by-the-master")
        self.assertEqual(forged["canonical_id"], "ARAM_FORGED_BY_THE_MASTER")
        self.assertEqual(forged["lifecycle"]["state"], "active")
        self.assertEqual(forged["patch_changes"], [])
        self.assertEqual([stat["key"] for stat in forged["stats"]], ["rarity"])
        self.assertNotIn("26.13", [stat["value"] for stat in forged["stats"]])

    def test_forged_numeric_id_regression_and_noop_pbe_target(self):
        self.assertEqual(CANONICAL_AUGMENT_IDS["forged-by-the-master"], "2127")
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", []),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [
                entity("2127", "forged-by-the-master", {"rarity": "silver"}),
            ]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", []),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": []},
                "augment": {"rows": [{
                    "slug": "forged-by-the-master",
                    "name": "Forged By The Master",
                    "augmentId": "2127",
                    "flags": {"lifecycle": "removed", "lifecycle_patch": "26.13"},
                }]},
                "item": {"rows": []},
            },
            patch_events={"current_open_cycle": "26.13", "events": [{
                "entity_type": "augment", "canonical_id": "2127", "slug": "forged-by-the-master",
                "source_patch_label": "26.13", "change_kind": "removed", "fields_changed": [],
            }]},
            pbe_archive={"source_patch_label": "pbe-cycle-26.14", "events": [{
                "entity_type": "augment", "canonical_id": "2127", "slug": "forged-by-the-master",
                "source_patch_label": "pbe-cycle-26.14", "lane": "preview", "lifecycle": "upcoming",
                "landed": False, "fields_changed": ["rarity"],
                "before": {"rarity": "silver"}, "after": {"rarity": "silver"},
            }]},
        )
        forged = next(row for row in result["entities"] if row["canonical_id"] == "2127")
        self.assertEqual(forged["lifecycle"]["state"], "active")
        self.assertEqual(forged["patch_changes"], [])

    def test_pbe_only_changes_are_projected_when_normalized_target_differs(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {"base_stats": {"health": 600}})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [entity("A", "a", {})]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [entity("1001", "boots", {})]),
        }
        pbe = {
            "source_patch_label": "pbe-cycle-26.14",
            "events": [{
                "entity_type": "champion", "canonical_id": "1", "slug": "annie", "lane": "preview",
                "source_patch_label": "pbe-cycle-26.14", "fields_changed": ["base_stats.health"],
                "before": {"base_stats.health": 600}, "after": {"base_stats.health": 610},
                "lifecycle": "upcoming", "landed": False,
            }],
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": [{"slug": "annie", "name": "Annie"}]}, "augment": {"rows": []}, "item": {"rows": []}},
            pbe_archive=pbe,
        )
        changes = next(row for row in result["entities"] if row["type"] == "champion")["patch_changes"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["lane"], "preview")
        self.assertEqual(changes[0]["lifecycle"], "preview")

    def test_removed_historical_catalog_rows_keep_removed_lifecycle_without_entering_current_snapshot(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("1", "annie", {})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", [entity("A", "active", {"rarity": "gold"})]),
            "item": snapshot("item", "latest", "16.13.2", "26.13", [entity("1001", "boots", {})]),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={
                "champion": {"rows": []},
                "augment": {"rows": [{"augmentId": "A_OLD", "slug": "old", "name": "Old", "flags": {"lifecycle": "removed"}}]},
                "item": {"rows": []},
            },
        )
        old = next(row for row in result["entities"] if row["canonical_id"] == "A_OLD")
        self.assertEqual(old["lifecycle"]["state"], "removed")

    def test_cdragon_only_champion_is_explicitly_unlinked(self):
        latest = {
            "champion": snapshot("champion", "latest", "16.13.2", "26.13", [entity("805", "locke", {})]),
            "augment": snapshot("augment", "latest", "16.13.2", "26.13", []),
            "item": snapshot("item", "latest", "16.13.2", "26.13", []),
        }
        result = build_entity_presentation(
            snapshots=latest,
            catalogs={"champion": {"rows": []}, "augment": {"rows": []}, "item": {"rows": []}},
        )
        locke = result["entities"][0]
        self.assertEqual(locke["slug"], "locke")
        self.assertEqual(locke["route_identifier"], "")
        self.assertFalse(locke["known"])


if __name__ == "__main__":
    unittest.main()
