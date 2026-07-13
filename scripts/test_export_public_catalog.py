#!/usr/bin/env python3
import unittest

from export_public_catalog import enrich_public_items, project_augment_icons


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


if __name__ == "__main__":
    unittest.main()
