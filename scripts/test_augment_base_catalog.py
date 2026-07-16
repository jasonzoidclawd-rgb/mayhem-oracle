#!/usr/bin/env python3

import unittest

from scrape_mayhem_augments_cdragon import (
    build_base_catalog,
    build_tooltip_index,
    extract_augments,
)


class AugmentBaseCatalogTests(unittest.TestCase):
    def test_current_augment_stringtable_definitions_keep_the_six_live_registry_rows(self):
        roster = [
            {
                "id": 2103,
                "augmentNameId": "ARAM_BangBang",
                "nameTRA": "From Downtown",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/QuestBangBang_small.png",
                "rarity": "kGold",
            },
            {
                "id": 2125,
                "augmentNameId": "ItsGoTime",
                "nameTRA": "It's Go Time",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/GenericAbilityAugmentIcon_Silver.png",
                "rarity": "kSilver",
            },
            {
                "id": 2139,
                "augmentNameId": "PinCushion",
                "nameTRA": "Porcupine",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/PinCushion_small.png",
                "rarity": "kGold",
            },
            {
                "id": 2115,
                "augmentNameId": "SquishySlappyGrab",
                "nameTRA": "Squishy Slappy Grab",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/SquishySlappyGrab_small.png",
                "rarity": "kPrismatic",
            },
            {
                "id": 2134,
                "augmentNameId": "SurgeField",
                "nameTRA": "Surge Field",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/SurgeField_small.png",
                "rarity": "kPrismatic",
            },
            {
                "id": 2129,
                "augmentNameId": "Terraind",
                "nameTRA": "Terrain'd",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/LightningStrikes_small.png",
                "rarity": "kGold",
            },
        ]
        stringtable = {
            "entries": {
                "augment_bangbang_name": "From Downtown",
                "augment_bangbang_desc": "Snipe enemies from downtown.",
                "augment_itsgotime_name": "It's Go Time",
                "augment_itsgotime_summary": "Gain movement speed.",
                "augment_pincushion_name": "Porcupine",
                "augment_pincushion_summary": "Burst needles.",
                "augment_squishyslappygrab_name": "Squishy Slappy Grab",
                "augment_squishyslappygrab_tooltip": "Pull nearby enemies.",
                # CDragon's current registry uses the unsuffixed name key for
                # this row; it is still an authoritative definition.
                "augment_surgefield": "Surge Field",
                "augment_surgefield_summary": "Create a zone.",
                "augment_terraind_name": "Terrain'd",
                "augment_terraind_summary": "Damage in an area.",
            }
        }
        empty_arena = {"augments": []}
        locales = {locale: stringtable for locale in ("en", "zh_cn", "zh_tw", "ja", "ko")}

        catalog = build_base_catalog(
            roster=roster,
            arena_by_locale={locale: empty_arena for locale in locales},
            stringtables_by_locale=locales,
            fetched_at="2026-07-14T00:00:00+00:00",
        )

        self.assertEqual(
            {row["augmentId"] for row in catalog["augments"]},
            {
                "ARAM_BangBang",
                "ItsGoTime",
                "PinCushion",
                "SquishySlappyGrab",
                "SurgeField",
                "Terraind",
            },
        )
        self.assertEqual(
            {row["name"] for row in catalog["augments"]},
            {"From Downtown", "It's Go Time", "Porcupine", "Squishy Slappy Grab", "Surge Field", "Terrain'd"},
        )

    def test_generic_augment_namespace_does_not_promote_unreviewed_legacy_rows(self):
        roster = [{
            "id": 2132,
            "augmentNameId": "WarlockJuicebox",
            "nameTRA": "Warlock Juicebox",
            "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/WarlockJuicebox_small.png",
            "rarity": "kGold",
        }]
        stringtable = {"entries": {
            "augment_warlockjuicebox_name": "Warlock Juicebox",
            "augment_warlockjuicebox_summary": "Gain omnivamp.",
        }}
        locales = {locale: stringtable for locale in ("en", "zh_cn", "zh_tw", "ja", "ko")}
        catalog = build_base_catalog(
            roster=roster,
            arena_by_locale={locale: {"augments": []} for locale in locales},
            stringtables_by_locale=locales,
            fetched_at="2026-07-14T00:00:00+00:00",
        )
        self.assertEqual(catalog["augments"], [])

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
                "id": 1500,
                "augmentNameId": "ADAPt",
                "nameTRA": "ADAPt Duplicate",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/ADAPt_duplicate_small.png",
                "rarity": "kGold",
            },
            {
                "id": 1424,
                "augmentNameId": "ARAM_MissingPingAugment",
                "nameTRA": "???",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/MissingPing_small.png",
                "rarity": "kPrismatic",
            },
            {
                "id": 1601,
                "augmentNameId": "ChainReaction",
                "nameTRA": "",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/ChainReaction_small.png",
                "rarity": "kGold",
            },
            {
                "id": 1602,
                "augmentNameId": "ARAM_UnrelatedArenaRow",
                "nameTRA": "Unrelated Arena Row",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Unrelated_small.png",
                "rarity": "kSilver",
            },
            {
                "id": 1603,
                "augmentNameId": "ArcaneCometRecharge",
                "nameTRA": "Arcane Comet Recharge",
                "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/ArcaneCometRecharge_small.png",
                "rarity": "kSilver",
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
                    "kiwi_adapt_name": "ADAPt",
                    "kiwi_adapt_tooltip": "Kiwi ADAPt tooltip",
                    "kiwi_augment_divinedomain_name": "Rite of Ascension",
                    "kiwi_augment_divinedomain_summary": "Essence summary.",
                    "kiwi_augment_divinedomain_tooltip": "Essence tooltip.",
                    "kiwi_aram_missingpingaugment_name": "???",
                    "kiwi_chainreaction_name": "Chain Reaction",
                    "kiwi_chainreaction_summary": "React in a chain.",
                    "kiwi_chainreaction_tooltip": "Chain Reaction tooltip.",
                    "kiwi_arcanecomet_recharge": "Comet recharge status text.",
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
        self.assertEqual(set(by_id), {
            "ARAM_ADAPt",
            "ARAM_DivineDomain",
            "ARAM_MissingPingAugment",
            "ChainReaction",
        })

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

        codename = by_id["ChainReaction"]
        self.assertEqual(codename["name"], "Chain Reaction")
        self.assertEqual(codename["slug"], "chain-reaction")
        self.assertEqual(codename["rarity"], "gold")
        self.assertEqual(codename["effectText"]["desc"], "React in a chain.")
        self.assertEqual(codename["effectText"]["tooltip"], "Chain Reaction tooltip.")
        self.assertTrue(codename["cdragon"]["kiwi"]["present"])
        self.assertIn("kiwi_chainreaction_name", codename["cdragon"]["kiwi"]["keys"])

    def test_hotfix_snapshot_uses_same_kiwi_definition_set_as_base_catalog(self):
        roster = [
            {
                "augmentNameId": "ChainReaction",
                "nameTRA": "",
                "rarity": "kGold",
            },
            {
                "augmentNameId": "ARAM_UnrelatedArenaRow",
                "nameTRA": "Unrelated Arena Row",
                "rarity": "kSilver",
            },
        ]
        stringtable = {
            "entries": {
                "kiwi_chainreaction_name": "Chain Reaction",
                "kiwi_chainreaction_tooltip": "Chain Reaction tooltip.",
            }
        }

        snapshot = extract_augments(
            roster,
            build_tooltip_index(stringtable),
            names_idx={},
            stringtable=stringtable,
        )

        self.assertEqual([augment["nameId"] for augment in snapshot], ["ChainReaction"])
        self.assertEqual(snapshot[0]["name"], "Chain Reaction")
        self.assertEqual(snapshot[0]["slug"], "chain-reaction")
        self.assertEqual(snapshot[0]["tooltip"], "Chain Reaction tooltip.")

    def test_reviewed_registry_token_aliases_bridge_codename_drift(self):
        roster = [
            {
                "augmentNameId": "BloodMoneyBurn",
                "nameTRA": "Combusting Interest",
                "rarity": "kGold",
            }
        ]
        stringtables_by_locale = {
            "en": {"entries": {"kiwi_bloodmoney_name": "Combusting Interest"}},
            "zh_cn": {"entries": {"kiwi_bloodmoney_name": "Combusting Interest zh-CN"}},
            "zh_tw": {"entries": {"kiwi_bloodmoney_name": "Combusting Interest zh-TW"}},
            "ja": {"entries": {"kiwi_bloodmoney_name": "Combusting Interest ja"}},
            "ko": {"entries": {"kiwi_bloodmoney_name": "Combusting Interest ko"}},
        }

        catalog = build_base_catalog(
            roster=roster,
            arena_by_locale={"en": {"augments": []}},
            stringtables_by_locale=stringtables_by_locale,
            registry_token_aliases={"bloodmoney": "BloodMoneyBurn"},
            fetched_at="2026-06-22T00:00:00+00:00",
        )

        by_id = {augment["augmentId"]: augment for augment in catalog["augments"]}

        self.assertIn("BloodMoneyBurn", by_id)
        self.assertEqual(by_id["BloodMoneyBurn"]["name"], "Combusting Interest")
        self.assertEqual(catalog["reports"]["kiwiDefinitions"]["aliasedTokens"][0]["token"], "bloodmoney")

if __name__ == "__main__":
    unittest.main()
