#!/usr/bin/env python3

from pathlib import Path
import unittest

from augment_wiki_feed import build_augment_wiki_outputs


FIXTURE = Path(__file__).parent / "fixtures" / "augment_wiki_page.html"
FETCHED_AT = "2026-06-23T00:00:00+00:00"


def base_catalog():
    return {
        "augments": [
            {"augmentId": "ARAM_ADAPt", "name": "ADAPt", "rarity": "silver"},
            {"augmentId": "ARAM_Adamant", "name": "Adamant", "rarity": "gold"},
            {"augmentId": "ARAM_ApexInventor", "name": "Apex Inventor", "rarity": "gold"},
            {"augmentId": "ARAM_BreadAndButter", "name": "Bread and Butter", "rarity": "silver"},
            {"augmentId": "ARAM_SlowCooker", "name": "Slow Cooker", "rarity": "prismatic"},
            {"augmentId": "ARAM_Quest_VoidImmolation", "name": "Icathia's Fall", "rarity": "prismatic"},
            {"augmentId": "ARAM_CDragonOnly", "name": "CDragon Only", "rarity": "silver"},
        ]
    }


def identity_map():
    return {
        "alias_entries": [
            {
                "augmentNameId": "ARAM_Quest_VoidImmolation",
                "aliases": ["Void Immolation"],
                "tokens": ["voidimmolation"],
                "applies_to": ["internal_augments", "wiki", "arammayhem_win_rate"],
                "reason": "Existing/wiki display name is the reward item; CDragon canonical display name is Icathia's Fall.",
            }
        ],
        "mappings": [
            {
                "augmentId": "ARAM_ADAPt",
                "cdragon": {"name": "ADAPt", "rarity": "silver"},
                "sources": {"wiki": [{"sourceKey": "ADAPt", "name": "ADAPt"}]},
            }
        ],
    }


class AugmentWikiFeedTests(unittest.TestCase):
    def test_builds_feed_keyed_by_augment_id_without_resolving_availability(self):
        outputs = build_augment_wiki_outputs(
            html=FIXTURE.read_text(encoding="utf-8"),
            identity_map=identity_map(),
            base_catalog=base_catalog(),
            fetched_at=FETCHED_AT,
        )

        feed = outputs["feed"]
        reports = outputs["reports"]

        self.assertEqual(
            sorted(feed["augments"]),
            [
                "ARAM_ADAPt",
                "ARAM_Adamant",
                "ARAM_ApexInventor",
                "ARAM_BreadAndButter",
                "ARAM_Quest_VoidImmolation",
                "ARAM_SlowCooker",
            ],
        )
        self.assertEqual(feed["augments"]["ARAM_Adamant"]["wikiDescription"], "Immobilizing an enemy champion grants resistances.")
        self.assertEqual(feed["augments"]["ARAM_Adamant"]["wikiAvailabilityNotes"], ["This augment is currently disabled."])
        self.assertNotIn("availability", feed["augments"]["ARAM_Adamant"])
        self.assertNotIn("flags", feed["augments"]["ARAM_Adamant"])
        self.assertEqual(feed["augments"]["ARAM_Adamant"]["wikiFetchedAt"], FETCHED_AT)

        self.assertEqual(feed["augments"]["ARAM_BreadAndButter"]["wikiNotes"], [
            'If a champion acquires all three "Bread" augments ( Bread and Butter, Bread and Cheese, Bread and Jam), they gain a buff called Bread Sandwich.'
        ])
        self.assertEqual(feed["pageNotes"], [
            "Transmuted augments will state that they are such in their title (e.g. Transmuted: Jeweled Gauntlet).",
            'If a champion acquires all three "Bread" augments ( Bread and Butter, Bread and Cheese, Bread and Jam), they gain a buff called Bread Sandwich.',
            "When a Burn stack is active, Slow Cooker can extend it.",
        ])
        self.assertEqual(feed["augments"]["ARAM_SlowCooker"]["wikiNotes"], ["When a Burn stack is active, Slow Cooker can extend it."])
        self.assertNotIn("wikiDescription", feed["augments"]["ARAM_SlowCooker"])

        self.assertEqual(reports["wiki_only"]["counts"]["wikiOnlyRows"], 1)
        self.assertEqual(reports["unmatched"]["counts"]["unmatchedWikiRows"], 1)
        self.assertEqual(reports["contradictions"]["counts"], {
            "existence": 2,
            "rarity": 1,
            "availability": 1,
        })

    def test_uses_step1_alias_entries_to_resolve_wiki_names(self):
        outputs = build_augment_wiki_outputs(
            html=FIXTURE.read_text(encoding="utf-8"),
            identity_map=identity_map(),
            base_catalog=base_catalog(),
            fetched_at=FETCHED_AT,
        )

        row = outputs["feed"]["augments"]["ARAM_Quest_VoidImmolation"]

        self.assertEqual(row["wikiDescription"], "Quest reward text from the wiki.")
        self.assertEqual(row["wikiRarity"], "prismatic")

    def test_ignores_nested_table_text_inside_effect_cells(self):
        outputs = build_augment_wiki_outputs(
            html=FIXTURE.read_text(encoding="utf-8"),
            identity_map=identity_map(),
            base_catalog=base_catalog(),
            fetched_at=FETCHED_AT,
        )

        self.assertEqual(outputs["feed"]["augments"]["ARAM_ApexInventor"]["wikiDescription"], "Grants 100 item haste.")
        self.assertNotIn("Item Cooldowns", outputs["feed"]["augments"]["ARAM_ApexInventor"]["wikiDescription"])


if __name__ == "__main__":
    unittest.main()
