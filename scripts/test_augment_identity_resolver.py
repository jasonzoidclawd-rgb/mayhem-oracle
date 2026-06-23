#!/usr/bin/env python3

import unittest

from augment_identity_resolver import (
    build_identity_outputs,
    normalize_identity_key,
)


class AugmentIdentityResolverTests(unittest.TestCase):
    def test_normalizes_punctuation_case_and_leading_quest_prefix(self):
        self.assertEqual(normalize_identity_key("Quest: Steel Your Heart"), "steelyourheart")
        self.assertEqual(normalize_identity_key("a-d-a-pt"), "adapt")
        self.assertEqual(normalize_identity_key("  Icathia's Fall! "), "icathiasfall")

    def test_resolves_internal_names_and_slugs_to_cdragon_augment_name_ids(self):
        outputs = build_identity_outputs(
            cdragon_snapshot={
                "augments": [
                    {
                        "nameId": "ARAM_ADAPt",
                        "name": "ADAPt",
                        "names": {"en": "ADAPt"},
                        "slug": "a-d-a-pt",
                        "rarity": "silver",
                    },
                    {
                        "nameId": "ARAM_Quest_SteelYourHeart",
                        "name": "Steel Your Heart",
                        "names": {"en": "Quest: Steel Your Heart"},
                        "slug": "quest_-steel-your-heart",
                        "rarity": "gold",
                    },
                ]
            },
            internal_catalog={
                "augments": [
                    {
                        "slug": "adapt",
                        "name": "ADAPt",
                        "rarity": "silver",
                        "wikiDescription": "Convert attack damage to ability power.",
                        "flags": {"lifecycle": "active"},
                    },
                    {
                        "slug": "quest-steel-your-heart",
                        "name": "Quest: Steel Your Heart",
                        "rarity": "gold",
                        "wikiDescription": "Quest reward.",
                        "flags": {"lifecycle": "active"},
                    },
                ]
            },
            alias_table={"aliases": []},
        )

        by_slug = {
            source["slug"]: mapping["augmentId"]
            for mapping in outputs["mapping"]["mappings"]
            for source in mapping["sources"].get("internal_augments", [])
        }

        self.assertEqual(by_slug["adapt"], "ARAM_ADAPt")
        self.assertEqual(by_slug["quest-steel-your-heart"], "ARAM_Quest_SteelYourHeart")
        self.assertEqual(outputs["unmatched"]["counts"]["internal_augments"], 0)

    def test_resolves_base_catalog_augment_ids_and_bare_codenames(self):
        outputs = build_identity_outputs(
            cdragon_snapshot={
                "augments": [
                    {
                        "augmentId": "ChainReaction",
                        "name": "Chain Reaction",
                        "names": {"en": "Chain Reaction"},
                        "slug": "chain-reaction",
                        "rarity": "gold",
                    }
                ]
            },
            internal_catalog={
                "augments": [
                    {
                        "slug": "chain-reaction",
                        "name": "Chain Reaction",
                        "rarity": "gold",
                        "wikiDescription": "Deal damage in a chain.",
                        "flags": {"lifecycle": "active"},
                    }
                ]
            },
            alias_table={"aliases": []},
        )

        by_slug = {
            source["slug"]: mapping["augmentId"]
            for mapping in outputs["mapping"]["mappings"]
            for source in mapping["sources"].get("internal_augments", [])
        }

        self.assertEqual(by_slug["chain-reaction"], "ChainReaction")
        self.assertEqual(outputs["unmatched"]["counts"]["internal_augments"], 0)

    def test_uses_minimal_aliases_for_true_identity_exceptions(self):
        outputs = build_identity_outputs(
            cdragon_snapshot={
                "augments": [
                    {
                        "nameId": "ARAM_Quest_VoidImmolation",
                        "name": "Icathia's Fall",
                        "names": {"en": "Icathia's Fall"},
                        "slug": "quest_-void-immolation",
                        "rarity": "prismatic",
                    }
                ]
            },
            internal_catalog={
                "augments": [
                    {
                        "slug": "void-immolation",
                        "name": "Void Immolation",
                        "rarity": "prismatic",
                        "wikiDescription": "Quest: Icathia's Fall reward.",
                        "win_rate": 51.2,
                        "flags": {"lifecycle": "active"},
                    },
                    {
                        "slug": "source-only",
                        "name": "Source Only",
                        "rarity": "gold",
                        "wikiDescription": "Not in CDragon.",
                        "win_rate": 50.0,
                        "flags": {"lifecycle": "active"},
                    },
                ]
            },
            alias_table={
                "aliases": [
                    {
                        "augmentNameId": "ARAM_Quest_VoidImmolation",
                        "aliases": ["Void Immolation"],
                        "applies_to": ["internal_augments", "wiki", "arammayhem_win_rate"],
                        "reason": "Existing/wiki display name is the reward item; CDragon canonical display name is Icathia's Fall.",
                    }
                ]
            },
        )

        mapped = {
            mapping["augmentId"]: mapping
            for mapping in outputs["mapping"]["mappings"]
        }

        self.assertIn("ARAM_Quest_VoidImmolation", mapped)
        self.assertEqual(outputs["unmatched"]["counts"]["internal_augments"], 1)
        self.assertEqual(outputs["unmatched"]["counts"]["arammayhem_win_rate"], 1)
        self.assertEqual(outputs["contradictions"]["counts"]["identity"], 3)

    def test_reports_existence_rarity_and_availability_contradictions_without_deciding_them(self):
        outputs = build_identity_outputs(
            cdragon_snapshot={
                "augments": [
                    {
                        "nameId": "ARAM_Matched",
                        "name": "Matched",
                        "names": {"en": "Matched"},
                        "slug": "matched",
                        "rarity": "gold",
                    },
                    {
                        "nameId": "ARAM_CDragonOnly",
                        "name": "CDragon Only",
                        "names": {"en": "CDragon Only"},
                        "slug": "cdragon-only",
                        "rarity": "silver",
                    },
                ]
            },
            internal_catalog={
                "augments": [
                    {
                        "slug": "matched",
                        "name": "Matched",
                        "rarity": "silver",
                        "wikiDescription": "Matched wiki row.",
                        "flags": {"lifecycle": "removed"},
                    },
                    {
                        "slug": "internal-only",
                        "name": "Internal Only",
                        "rarity": "gold",
                        "wikiDescription": "Source-only wiki row.",
                        "flags": {"lifecycle": "active"},
                    },
                ]
            },
            alias_table={"aliases": []},
        )

        contradictions = outputs["contradictions"]

        self.assertEqual(contradictions["counts"]["existence"], 3)
        self.assertEqual(contradictions["counts"]["rarity"], 1)
        self.assertEqual(contradictions["counts"]["availability"], 2)
        self.assertIn("unavailable", contradictions["wiki_availability"]["status"])


if __name__ == "__main__":
    unittest.main()
