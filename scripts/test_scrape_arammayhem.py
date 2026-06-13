#!/usr/bin/env python3

import unittest

from scrape_arammayhem import parse_search_index


class SearchIndexParserTests(unittest.TestCase):
    def test_parses_champion_tier_win_rate_and_combos(self):
        champions, combos = parse_search_index({
            "patch": "26.12",
            "champions": [{
                "id": "Brand",
                "championId": "Brand",
                "name": {"en": "Brand"},
                "tier": "S+",
                "winRate": "56.49%",
                "icon": "/champions/brand.png",
            }],
            "augments": [{
                "id": "infernal_conduit",
                "name": {"en": "Infernal Conduit"},
            }],
            "combos": [{
                "slug": "brand-infernal-conduit",
                "championId": "Brand",
                "augmentIds": ["infernal_conduit"],
                "tier": "S",
            }],
        })

        self.assertEqual(champions, [{
            "slug": "brand",
            "name": "Brand",
            "tier": "S+",
            "rank": 1,
            "win_rate": 56.49,
            "pick_rate": None,
            "tags": [],
            "icon": "https://arammayhem.com/champions/brand.png",
        }])
        self.assertEqual(combos, [{
            "champion": "brand",
            "augment": "Infernal Conduit",
            "tier": "S",
            "ref": "search-index:brand-infernal-conduit",
        }])


if __name__ == "__main__":
    unittest.main()
