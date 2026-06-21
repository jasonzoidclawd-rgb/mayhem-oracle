#!/usr/bin/env python3

import unittest

from scrape_arammayhem import merge_champion_sources, parse_search_index


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

    def test_display_slug_aliases_merge_into_canonical_champion_rows(self):
        primary = [{
            "slug": "drmundo",
            "name": "Drmundo",
            "tier": "S+",
            "rank": 4,
            "win_rate": 54.34,
            "pick_rate": 1.2,
            "tags": ["tank"],
            "icon": "/champions/36.png",
        }]
        fallback = [{
            "slug": "dr-mundo",
            "name": "Dr. Mundo",
            "tier": "S+",
            "rank": 29,
            "win_rate": 54.34,
            "pick_rate": None,
            "tags": [],
            "icon": "/champions/36.png",
        }]

        merged = merge_champion_sources(primary, fallback)

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["slug"], "drmundo")
        self.assertEqual(merged[0]["rank"], 4)


if __name__ == "__main__":
    unittest.main()
