#!/usr/bin/env python3

import json
import unittest

from scrape_mayhem_augments_cdragon import (
    build_base_catalog,
    build_tooltip_index,
    extract_augments,
)


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
        # ArcaneCometRecharge carries no parseable `kiwi_*` definition key, but
        # its art is in Riot's Kiwi (Mayhem) asset namespace, so it IS a Mayhem
        # registry row. Membership no longer depends on Riot having authored a
        # Mayhem-specific display string -- that gate silently dropped four real
        # offerable augments. It is admitted with no kiwi string evidence, which
        # keeps it out of the live catalog downstream (no live signal), while
        # the Cherry-namespace Arena row stays out entirely.
        self.assertEqual(set(by_id), {
            "ARAM_ADAPt",
            "ARAM_DivineDomain",
            "ARAM_MissingPingAugment",
            "ChainReaction",
            "ArcaneCometRecharge",
        })
        self.assertNotIn("ARAM_UnrelatedArenaRow", by_id)
        self.assertEqual(
            by_id["ArcaneCometRecharge"]["cdragon"]["mayhem"]["evidence"], "kiwi-asset-namespace"
        )
        self.assertFalse(by_id["ArcaneCometRecharge"]["cdragon"]["kiwi"]["present"])

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


def _kiwi_icon(name: str) -> str:
    return f"/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/{name}_small.png"


def _cherry_icon(name: str) -> str:
    return f"/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/{name}_small.png"


class MayhemMembershipTests(unittest.TestCase):
    """Membership is an asset-namespace fact, not a localization fact.

    Riot marks an augment as ARAM Mayhem content by shipping its art under
    /UX/Kiwi/. Whether it ALSO ships a `kiwi_*` display string is a
    presentation detail: Upgrade_Ravenous, Quest_UltraHydra,
    Upgrade_SunderedSky and Upgrade_DeathDance publish their text under
    unprefixed `upgrade_*` / `quest_*` keys instead. Gating membership on the
    `kiwi_` string dropped four real, offerable augments that ARAMGG has
    thousands of games of evidence for.

    Cherry-namespace rows stay out, so repairing this cannot pull Arena
    content into the Mayhem catalog.
    """

    ROSTER = [
        {
            "id": 2140,
            "augmentNameId": "Upgrade_Ravenous",
            "nameTRA": "Upgrade Ravenous Hydra",
            "augmentSmallIconPath": _kiwi_icon("UpgradeSheen"),
            "rarity": "kGold",
        },
        {
            "id": 1411,
            "augmentNameId": "Upgrade_Thornmail",
            "nameTRA": "Upgrade Thornmail",
            "augmentSmallIconPath": _kiwi_icon("UpgradeCollector"),
            "rarity": "kSilver",
        },
        {
            "id": 1602,
            "augmentNameId": "ARAM_UnrelatedArenaRow",
            "nameTRA": "Unrelated Arena Row",
            "augmentSmallIconPath": _cherry_icon("Unrelated"),
            "rarity": "kSilver",
        },
        {
            "id": 393,
            "augmentNameId": "Quest_VoidImmolation",
            "nameTRA": "Icathia's Fall",
            "augmentSmallIconPath": _kiwi_icon("VoidImmolation"),
            "rarity": "kPrismatic",
        },
        {
            "id": 1361,
            "augmentNameId": "ARAM_Quest_VoidImmolation",
            "nameTRA": "Icathia's Fall",
            "augmentSmallIconPath": _kiwi_icon("VoidImmolation"),
            "rarity": "kPrismatic",
        },
    ]

    STRINGTABLES = {
        "en": {"entries": {
            "kiwi_upgrade_thornmail_name": "Upgrade Thornmail",
            "kiwi_questvoidimmolation_name": "Icathia's Fall",
            "upgrade_ravenous_name": "Upgrade Ravenous Hydra",
            "upgrade_ravenous_tooltip": "Upgrades Ravenous Hydra.",
            # An unprefixed key whose token is not a registry token must never
            # be read: the stringtable holds >130k unrelated game strings.
            "upgrade_ravenous_unrelated_name": "Not an augment string",
            "some_other_game_system_name": "Unrelated",
        }},
        "zh_cn": {"entries": {"upgrade_ravenous_name": "升级：贪欲九头蛇"}},
        "zh_tw": {"entries": {"upgrade_ravenous_name": "升級狂怒九頭蛇"}},
        "ja": {"entries": {"upgrade_ravenous_name": "ラヴァナス ハイドラ アップグレード"}},
        "ko": {"entries": {"upgrade_ravenous_name": "굶주린 히드라 업그레이드"}},
    }

    ARENA = {loc: {"augments": []} for loc in ("en", "zh_cn", "zh_tw", "ja", "ko")}

    def _catalog(self):
        return build_base_catalog(
            roster=self.ROSTER,
            arena_by_locale=self.ARENA,
            stringtables_by_locale=self.STRINGTABLES,
            fetched_at="2026-08-29T00:00:00+00:00",
        )

    def test_kiwi_asset_row_without_a_kiwi_string_is_admitted(self):
        by_id = {a["augmentId"]: a for a in self._catalog()["augments"]}
        self.assertIn("Upgrade_Ravenous", by_id)

    def test_cherry_asset_row_without_a_kiwi_string_stays_out(self):
        by_id = {a["augmentId"]: a for a in self._catalog()["augments"]}
        self.assertNotIn("ARAM_UnrelatedArenaRow", by_id)

    def test_membership_evidence_names_which_signal_admitted_the_row(self):
        by_id = {a["augmentId"]: a for a in self._catalog()["augments"]}
        self.assertEqual(
            by_id["Upgrade_Ravenous"]["cdragon"]["mayhem"]["evidence"], "kiwi-asset-namespace"
        )
        self.assertEqual(
            by_id["Upgrade_Thornmail"]["cdragon"]["mayhem"]["evidence"], "kiwi-stringtable"
        )

    def test_localization_comes_from_the_riot_keys_the_augment_actually_uses(self):
        by_id = {a["augmentId"]: a for a in self._catalog()["augments"]}
        names = by_id["Upgrade_Ravenous"]["names"]
        self.assertEqual(names["en"], "Upgrade Ravenous Hydra")
        self.assertEqual(names["zh_cn"], "升级：贪欲九头蛇")
        self.assertEqual(names["zh_tw"], "升級狂怒九頭蛇")
        self.assertEqual(names["ja"], "ラヴァナス ハイドラ アップグレード")
        self.assertEqual(names["ko"], "굶주린 히드라 업그레이드")
        # Five-locale parity holds without inventing a kiwi_ key Riot never shipped.
        self.assertEqual(set(names), {"en", "zh_cn", "zh_tw", "ja", "ko"})
        self.assertNotIn("kiwi_", by_id["Upgrade_Ravenous"]["provenance"]["names"]["zh_cn"])

    def test_an_unprefixed_key_for_an_unknown_token_is_never_read(self):
        by_id = {a["augmentId"]: a for a in self._catalog()["augments"]}
        self.assertNotIn("Not an augment string", json.dumps(by_id, ensure_ascii=False))

    def test_a_duplicate_bare_codename_row_does_not_create_a_second_augment(self):
        # 393 Quest_VoidImmolation and 1361 ARAM_Quest_VoidImmolation are one
        # augment under two registry ids. Admitting Kiwi rows must not publish
        # both -- the existing ARAM_-preference dedupe still decides.
        ids = [a["augmentId"] for a in self._catalog()["augments"]]
        self.assertIn("ARAM_Quest_VoidImmolation", ids)
        self.assertNotIn("Quest_VoidImmolation", ids)
        self.assertEqual(len([i for i in ids if i.endswith("Quest_VoidImmolation")]), 1)



if __name__ == "__main__":
    unittest.main()
