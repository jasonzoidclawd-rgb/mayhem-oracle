#!/usr/bin/env python3
import unittest
from unittest.mock import patch

from cdragon_entity_adapters import is_mayhem_item_row, normalize_item_entities
from scrape_community_dragon import build_items, remove_mayhem_duplicate_rows


class CommunityDragonItemTests(unittest.TestCase):
    def test_curated_mayhem_id_replaces_regular_cdragon_row(self):
        catalog = [
            {"id": 4403, "name": "The Golden Spatula", "cost": 7187},
            {"id": 1001, "name": "Boots", "cost": 300},
        ]
        mayhem = [{"id": 4403, "slug": "the-golden-spatula"}]

        self.assertEqual(
            remove_mayhem_duplicate_rows(catalog, mayhem),
            [{"id": 1001, "name": "Boots", "cost": 300}],
        )

    def test_repeated_regular_cdragon_id_is_deterministically_deduped(self):
        catalog = [
            {"id": 1001, "name": "Boots", "cost": 300},
            {"id": 1001, "name": "Boots (duplicate)", "cost": 300},
        ]

        self.assertEqual(remove_mayhem_duplicate_rows(catalog, []), catalog[:1])

    def test_noxian_feats_boots_are_not_admitted_to_mayhem_catalog(self):
        noxian_boot = {
            "id": 3168,
            "name": "Immortal Path",
            "inStore": True,
            "priceTotal": 1000,
            "requiredBuffCurrencyName": "Feats_NoxianBootPurchaseBuff",
        }
        regular_boot = {
            "id": 1001,
            "name": "Boots",
            "inStore": True,
            "priceTotal": 300,
        }

        self.assertFalse(is_mayhem_item_row(noxian_boot))
        self.assertTrue(is_mayhem_item_row(regular_boot))
        self.assertIn("3168", {row["id"] for row in normalize_item_entities([noxian_boot])})

        with patch("scrape_community_dragon.fetch_json", return_value=[noxian_boot, regular_boot]):
            _, catalog = build_items()

        self.assertNotIn(3168, {row["id"] for row in catalog})
        self.assertIn(1001, {row["id"] for row in catalog})


if __name__ == "__main__":
    unittest.main()
