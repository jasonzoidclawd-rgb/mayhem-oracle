#!/usr/bin/env python3

import unittest

from assemble_augments import (
    assemble_catalog,
    lifecycle_for_availability,
    resolve_availability,
)


def base_row(augment_id: str, name: str = "Test Augment") -> dict:
    return {
        "augmentId": augment_id,
        "cdragon": {"augmentNameId": augment_id, "arenaApiName": name.replace(" ", "")},
        "name": name,
        "names": {
            "en": name,
            "zh_cn": f"{name} zh-CN",
            "zh_tw": f"{name} zh-TW",
            "ja": f"{name} ja",
            "ko": f"{name} ko",
        },
        "rarity": "gold",
        "icon": {
            "large": "assets/ux/cherry/augments/icons/test_large.png",
            "small": "assets/ux/cherry/augments/icons/test_small.png",
            "rosterSmall": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Test_small.png",
        },
        "effectText": {"desc": "CDragon desc.", "tooltip": "CDragon tooltip."},
        "effectTextByLocale": {"en": {"desc": "CDragon desc.", "tooltip": "CDragon tooltip."}},
        "dataValues": {"Amount": [1.0]},
        "calculations": {"AmountCalc": {"__type": "GameCalculation"}},
        "definitionPlaceholder": False,
        "provenance": {"definition": "cdragon", "name": "cdragon:test"},
    }


class AvailabilityResolverTests(unittest.TestCase):
    def test_registry_only_resolves_candidate_registry_present(self):
        availability = resolve_availability(
            augment_id="ARAM_RegistryOnly",
            slug="registry-only",
            cdragon_present=True,
            wiki_row=None,
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "candidate_registry_present")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "added")
        self.assertTrue(availability["signals"]["cdragon_registry"]["present"])
        self.assertFalse(availability["signals"]["wiki"]["present"])

    def test_wiki_currently_disabled_resolves_disabled(self):
        availability = resolve_availability(
            augment_id="ARAM_ClownCollege",
            slug="clown-college",
            cdragon_present=True,
            wiki_row={"wikiAvailabilityNotes": ["This augment is currently disabled."]},
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "disabled")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertEqual(availability["signals"]["wiki"]["status"], "disabled")

    def test_missing_ping_placeholder_never_becomes_confirmed_live(self):
        availability = resolve_availability(
            augment_id="ARAM_MissingPingAugment",
            slug="missing-ping-augment",
            cdragon_present=True,
            wiki_row={"wikiDescription": "Placeholder should not be live evidence."},
            definition_placeholder=True,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "candidate_registry_present")
        self.assertNotEqual(availability["status"], "confirmed_live")
        self.assertTrue(availability["signals"]["cdragon_registry"]["definitionPlaceholder"])

    def test_registry_with_wiki_live_resolves_confirmed_live(self):
        availability = resolve_availability(
            augment_id="ARAM_Live",
            slug="live",
            cdragon_present=True,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "confirmed_live")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "active")
        self.assertEqual(availability["signals"]["wiki"]["status"], "live")

    def test_removed_tombstone_wins_over_live_signals(self):
        availability = resolve_availability(
            augment_id="ARAM_Removed",
            slug="removed",
            cdragon_present=True,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=True,
        )

        self.assertEqual(availability["status"], "removed")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertTrue(availability["signals"]["tombstone"]["removed"])


class AssembleCatalogTests(unittest.TestCase):
    def test_assembles_with_source_precedence_and_preserved_curated_fields(self):
        existing = {
            "patch": "26.12",
            "scraped_at": "old",
            "augments": [
                {
                    "slug": "adapt",
                    "name": "Old ADAPt",
                    "rarity": "prismatic",
                    "win_rate": 1.23,
                    "icon": "https://example.test/old.png",
                    "name_zh_CN": "old zh-CN",
                    "name_zh_TW": "old zh-TW",
                    "name_ja": "old ja",
                    "name_ko": "old ko",
                    "wikiDescription": "old wiki text",
                    "kit_tags": ["ability"],
                    "flags": {
                        "system_breaker": True,
                        "lifecycle": "active",
                        "availability_override": "bug_mechanism",
                    },
                    "type": "standalone",
                }
            ],
        }
        identity_map = {
            "mappings": [
                {
                    "augmentId": "ARAM_ADAPt",
                    "cdragon": {"name": "ADAPt", "slug": "adapt", "rarity": "silver"},
                    "sources": {
                        "internal_augments": [
                            {"slug": "adapt", "name": "Old ADAPt", "lifecycle": "active"}
                        ]
                    },
                }
            ]
        }
        base_catalog = {"generated_at": "2026-06-23T00:00:00+00:00", "augments": [base_row("ARAM_ADAPt", "ADAPt")]}
        wiki_feed = {
            "augments": {
                "ARAM_ADAPt": {
                    "wikiDescription": "Wiki display text.",
                    "wikiNotes": ["Wiki note."],
                    "wikiAvailabilityNotes": [],
                    "wikiFetchedAt": "2026-06-22T17:54:33+00:00",
                    "wikiRarity": "gold",
                }
            }
        }
        winrate_feed = {"win_rates": {"ARAM_ADAPt": 55.5}}

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog=base_catalog,
            wiki_feed=wiki_feed,
            winrate_feed=winrate_feed,
            identity_map=identity_map,
        )

        row = output["augments"][0]
        self.assertEqual(row["augmentId"], "ARAM_ADAPt")
        self.assertEqual(row["slug"], "adapt")
        self.assertEqual(row["name"], "ADAPt")
        self.assertEqual(row["rarity"], "gold")
        self.assertEqual(row["cdragonRarity"], "gold")
        self.assertTrue(row["icon"].startswith("https://raw.communitydragon.org/latest/plugins/"))
        self.assertEqual(row["effectText"]["tooltip"], "CDragon tooltip.")
        self.assertEqual(row["dataValues"], {"Amount": [1.0]})
        self.assertEqual(row["wikiDescription"], "Wiki display text.")
        self.assertEqual(row["wikiNotes"], ["Wiki note."])
        self.assertEqual(row["win_rate"], 55.5)
        self.assertEqual(row["kit_tags"], ["ability"])
        self.assertTrue(row["flags"]["system_breaker"])
        self.assertEqual(row["flags"]["availability_override"], "bug_mechanism")
        self.assertEqual(row["type"], "standalone")
        self.assertEqual(row["availability"]["status"], "confirmed_live")
        self.assertEqual(row["flags"]["lifecycle"], "active")
        self.assertEqual(row["provenance"]["win_rate"], "arammayhem:augment-winrate-feed")
        self.assertEqual(row["provenance"]["wikiDescription"], "wiki:augment-wiki-feed")


if __name__ == "__main__":
    unittest.main()
