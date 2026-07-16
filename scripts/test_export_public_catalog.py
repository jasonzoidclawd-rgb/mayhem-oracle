#!/usr/bin/env python3
import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from export_public_catalog import build_public_augments, enrich_public_items, project_augment_icons


class ExportPublicCatalogTests(unittest.TestCase):
    def test_legacy_mayhem_rows_receive_stable_cdragon_ids(self):
        source = {
            "mayhemExclusive": [
                {"slug": "atmas-reckoning", "name": "Atma's Reckoning"},
                {"slug": "wooglets-witchcap", "name": "Wooglet's Witchcap"},
                {"slug": "unknown", "name": "Unknown"},
            ],
            "items": [],
        }
        result = enrich_public_items(source)
        self.assertEqual(result["mayhemExclusive"][0]["id"], 223039)
        self.assertEqual(result["mayhemExclusive"][1]["id"], 228002)
        self.assertNotIn("id", result["mayhemExclusive"][2])
        self.assertNotIn("id", source["mayhemExclusive"][0])

    def test_canonical_mayhem_rows_replace_duplicate_regular_item_rows(self):
        source = {
            "mayhemExclusive": [
                {"slug": "the-golden-spatula", "name": "The Golden Spatula"},
                {"slug": "rite-of-ruin", "name": "Rite of Ruin"},
            ],
            "items": [
                {
                    "id": 4403,
                    "name": "The Golden Spatula",
                    "name_zh_TW": "黃金鍋鏟",
                    "icon": "regular-spatula.png",
                },
                {"id": 3430, "name": "Rite Of Ruin", "icon": "regular-rite.png"},
                {"id": 1001, "name": "Boots", "icon": "boots.png"},
            ],
        }

        result = enrich_public_items(source)

        self.assertEqual([row["id"] for row in result["mayhemExclusive"]], [4403, 3430])
        self.assertEqual([row["id"] for row in result["items"]], [1001])
        self.assertEqual(result["mayhemExclusive"][0]["name_zh_TW"], "黃金鍋鏟")
        self.assertEqual(source["items"][0]["id"], 4403)

    def test_augment_projection_uses_small_cdragon_asset_without_mutating_source(self):
        source = {
            "augments": [{
                "slug": "buff-buddies",
                "icon": "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/cherry/augments/icons/buffbuddies_large.png",
                "cdragonIcon": {
                    "large": "assets/ux/cherry/augments/icons/buffbuddies_large.png",
                    "small": "assets/ux/cherry/augments/icons/buffbuddies_small.png",
                },
            }],
        }

        result = project_augment_icons(source)

        self.assertTrue(result["augments"][0]["icon"].endswith("buffbuddies_small.png"))
        self.assertTrue(source["augments"][0]["icon"].endswith("buffbuddies_large.png"))

    def test_mode_gated_noxian_boots_are_removed_from_public_mayhem_catalog(self):
        source = {
            "mayhemExclusive": [],
            "items": [
                {"id": 3168, "name": "Immortal Path"},
                {"id": 3175, "name": "Spellslinger's Shoes"},
                {"id": 1001, "name": "Boots"},
            ],
        }

        result = enrich_public_items(source)

        self.assertEqual([row["id"] for row in result["items"]], [1001])
        self.assertEqual([row["id"] for row in source["items"]], [3168, 3175, 1001])

    def test_void_immolation_uses_the_live_canonical_icon(self):
        source = {
            "mayhemExclusive": [],
            "items": [{"id": 223069, "name": "Void Immolation", "icon": "stale.png"}],
        }
        result = enrich_public_items(source)
        self.assertTrue(result["items"][0]["icon"].endswith("223069_kiwi_voidimmolation.png"))
        self.assertEqual(source["items"][0]["icon"], "stale.png")

    def test_reappeared_live_augments_do_not_keep_removed_patch_metadata(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "augments.json").write_text(json.dumps({
                "augments": [{
                    "slug": "terraind",
                    "flags": {"lifecycle": "active", "lifecycle_patch": "26.13"},
                }],
            }), encoding="utf-8")
            (root / "pool-rules.json").write_text(json.dumps({
                "lifecycle": {"added": {"terraind": "26.13"}, "removed": {}},
            }), encoding="utf-8")

            result = build_public_augments(root, forbidden=set())

            self.assertEqual(result["augments"][0]["flags"]["lifecycle"], "active")
            self.assertNotIn("lifecycle_patch", result["augments"][0]["flags"])

    def test_removed_canonical_alias_exposes_safe_replacement_slug(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "augments.json").write_text(json.dumps({
                "augments": [{
                    "slug": "pin-cushion",
                    "flags": {"lifecycle": "removed"},
                    "availability": {
                        "signals": {
                            "canonical_alias": {"canonicalSlug": "porcupine"},
                        },
                    },
                }],
            }), encoding="utf-8")
            (root / "pool-rules.json").write_text(json.dumps({
                "lifecycle": {"removed": {"pin-cushion": "26.13"}},
            }), encoding="utf-8")

            result = build_public_augments(root, forbidden={"availability"})

            self.assertEqual(
                result["augments"][0]["flags"]["replacement_slug"],
                "porcupine",
            )
            self.assertNotIn("availability", result["augments"][0])

    def test_public_augment_projection_exposes_only_the_categorical_tier(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "augments.json").write_text(json.dumps({
                "patch": "26.13",
                "augments": [{
                    "augmentId": "ARAM_TEST",
                    "slug": "test",
                    "flags": {"lifecycle": "active"},
                    "availability": {"status": "confirmed_live"},
                }],
            }), encoding="utf-8")
            (root / "augment-base-catalog.json").write_text(json.dumps({
                "augments": [{"augmentId": "ARAM_TEST"}],
            }), encoding="utf-8")
            (root / "augment-winrate-feed.json").write_text(json.dumps({
                "patch": "26.13",
                "win_rates": {"ARAM_TEST": 55.0},
                "sample_counts": {"ARAM_TEST": 1000},
            }), encoding="utf-8")
            (root / "pool-rules.json").write_text(json.dumps({"lifecycle": {}}), encoding="utf-8")

            result = build_public_augments(root, forbidden=set())

            self.assertEqual(result["augments"][0]["quality_tier"], "S+")
            self.assertNotIn("win_rate", result["augments"][0])
            self.assertNotIn("sample_counts", result["augments"][0])


if __name__ == "__main__":
    unittest.main()
