#!/usr/bin/env python3

import unittest

from scrape_mayhem_augments_cdragon import build_base_catalog


class AugmentBaseCatalogTests(unittest.TestCase):
    def test_builds_rich_cdragon_rows_and_stringtable_bridged_rows(self):
        roster = [
            {
                "id": 1205,
                "augmentNameId": "ARAM_ADAPt",
                "nameTRA": "ADAPt",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/ADAPt_small.png",
                "rarity": "kSilver",
            },
            {
                "id": 1499,
                "augmentNameId": "ARAM_DivineDomain",
                "nameTRA": "Divine Domain",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/DivineDomain_small.png",
                "rarity": "kPrismatic",
            },
            {
                "id": 1424,
                "augmentNameId": "ARAM_MissingPingAugment",
                "nameTRA": "???",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/MissingPing_small.png",
                "rarity": "kPrismatic",
            },
        ]
        arena_by_locale = {
            "en": {
                "augments": [
                    {
                        "id": 205,
                        "apiName": "ADAPt",
                        "name": "ADAPt",
                        "rarity": 0,
                        "iconSmall": "assets/ux/cherry/augments/icons/adapt_small.png",
                        "iconLarge": "assets/ux/cherry/augments/icons/adapt_large.png",
                        "desc": "Convert AD to AP.",
                        "tooltip": "Arena ADAPt tooltip",
                        "dataValues": {"APAmp": [0.15]},
                        "calculations": {"APAmpCalcTooltip": {"__type": "GameCalculation"}},
                    },
                    {
                        "id": 333,
                        "apiName": "RiteOfAscension",
                        "name": "Rite of Ascension",
                        "rarity": 2,
                        "iconSmall": "assets/ux/kiwi/augments/icons/divinedomain_small.png",
                        "iconLarge": "assets/ux/kiwi/augments/icons/divinedomain_large.png",
                        "desc": "Consume essences.",
                        "tooltip": "Arena Rite tooltip",
                        "dataValues": {"Soul_Duration": [8.0]},
                        "calculations": {},
                    },
                ]
            },
            "zh_cn": {"augments": [{"apiName": "ADAPt", "name": "物理转魔法"}]},
            "zh_tw": {"augments": [{"apiName": "ADAPt", "name": "靈活轉換"}]},
            "ja": {"augments": [{"apiName": "ADAPt", "name": "変力装置"}]},
            "ko": {"augments": [{"apiName": "ADAPt", "name": "적응형 능력치"}]},
        }
        stringtables_by_locale = {
            "en": {
                "entries": {
                    "cherry_adapt_tooltip": "Cherry ADAPt tooltip",
                    "kiwi_adapt_tooltip": "Kiwi ADAPt tooltip",
                    "kiwi_augment_divinedomain_name": "Rite of Ascension",
                    "kiwi_augment_divinedomain_summary": "Essence summary.",
                    "kiwi_augment_divinedomain_tooltip": "Essence tooltip.",
                    "kiwi_aram_missingpingaugment_name": "???",
                }
            },
            "zh_cn": {"entries": {"kiwi_augment_divinedomain_name": "飞升仪式"}},
            "zh_tw": {
                "entries": {
                    "kiwi_augment_divinedomain_name": "飛昇儀式",
                    "kiwi_augment_divinedomain_summary": "精華摘要。",
                    "kiwi_augment_divinedomain_tooltip": "精華提示。",
                }
            },
            "ja": {"entries": {"kiwi_augment_divinedomain_name": "昇天の儀式"}},
            "ko": {"entries": {"kiwi_augment_divinedomain_name": "승천 의식"}},
        }

        catalog = build_base_catalog(
            roster=roster,
            arena_by_locale=arena_by_locale,
            stringtables_by_locale=stringtables_by_locale,
            fetched_at="2026-06-22T00:00:00+00:00",
        )

        by_id = {augment["augmentId"]: augment for augment in catalog["augments"]}

        adapt = by_id["ARAM_ADAPt"]
        self.assertEqual(adapt["rarity"], "silver")
        self.assertEqual(adapt["names"]["zh_cn"], "物理转魔法")
        self.assertEqual(adapt["icon"]["large"], "assets/ux/cherry/augments/icons/adapt_large.png")
        self.assertEqual(adapt["effectText"]["desc"], "Convert AD to AP.")
        self.assertEqual(adapt["effectText"]["tooltip"], "Kiwi ADAPt tooltip")
        self.assertEqual(adapt["dataValues"], {"APAmp": [0.15]})
        self.assertEqual(adapt["calculations"], {"APAmpCalcTooltip": {"__type": "GameCalculation"}})
        self.assertEqual(adapt["provenance"]["definition"], "cdragon")

        bridged = by_id["ARAM_DivineDomain"]
        self.assertEqual(bridged["cdragon"]["arenaApiName"], "RiteOfAscension")
        self.assertEqual(bridged["names"]["en"], "Rite of Ascension")
        self.assertEqual(bridged["names"]["ko"], "승천 의식")
        self.assertEqual(bridged["effectTextByLocale"]["zh_tw"]["desc"], "精華摘要。")
        self.assertEqual(bridged["effectTextByLocale"]["zh_tw"]["tooltip"], "精華提示。")
        self.assertEqual(bridged["dataValues"], {"Soul_Duration": [8.0]})
        self.assertFalse(bridged["definitionPlaceholder"])

        missing = by_id["ARAM_MissingPingAugment"]
        self.assertTrue(missing["definitionPlaceholder"])
        self.assertEqual(missing["name"], "???")
        self.assertEqual(missing["dataValues"], {})
        self.assertNotIn("availability", missing)


if __name__ == "__main__":
    unittest.main()
