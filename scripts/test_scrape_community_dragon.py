#!/usr/bin/env python3
import unittest

from scrape_community_dragon import remove_mayhem_duplicate_rows


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


if __name__ == "__main__":
    unittest.main()
